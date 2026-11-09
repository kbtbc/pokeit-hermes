"""Read-only PokeIt proxy for Hermes Desktop. Mounted behind Hermes authentication.

No API keys, background jobs, subprocesses or configurable upstream addresses.
Synchronous handlers run in FastAPI's worker pool, never on the gateway loop.
Besides MCP reads it fetches Pokémon icons from the PokeIt map's own assets.
"""
import base64
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime
import json
import math
from pathlib import Path
import re
import socket
import threading
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Request

router = APIRouter()
MCP_URL = "https://mcp.pokeit.cc/mcp"
READ_TOOLS = frozenset({"find_gyms", "find_pokemon", "find_pokestops", "find_raids", "get_coverage", "get_scan_status", "search_places"})
MAX_BYTES = 2 * 1024 * 1024
CACHE_SECONDS = 20
MAX_CACHE_ITEMS = 128
MAX_CACHE_BYTES = 8 * 1024 * 1024
SCAN_ID = re.compile(r"[A-Za-z0-9_-]{32}\Z")
OBSERVATION_ID = re.compile(r"pid_[A-Za-z0-9_-]{1,96}\Z")
_cache = OrderedDict()
_cache_lock = threading.Lock()
_call_locks = [threading.Lock() for _ in range(16)]
_slots = threading.BoundedSemaphore(4)
ICON_BASE = "https://pokeit.cc/assets/bigfunOutline/"
ICON_MAX_BYTES = 64 * 1024
MAX_ICONS = 256
_icons = OrderedDict()
_icon_index = {"at": 0.0, "names": frozenset()}
_icon_lock = threading.Lock()
_icon_slots = threading.BoundedSemaphore(3)


def plugin_version():
    try:
        version = json.loads((Path(__file__).resolve().parent.parent / "plugin.json").read_text(encoding="utf-8"))["version"]
        return version if re.fullmatch(r"[0-9A-Za-z.+-]{1,40}", version) else "unknown"
    except (OSError, ValueError, KeyError, TypeError):
        return "unknown"


VERSION = plugin_version()


class ProxyError(Exception):
    def __init__(self, code, message, retryable=False):
        self.code, self.message, self.retryable = code, message, retryable


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProxyError("upstream_redirect", "PokeIt returned an unexpected redirect.", True)


def parse_reply(body, content_type):
    """Accept MCP JSON or complete SSE message events, never HTML challenges."""
    try:
        text = body.decode("utf-8")
        if "text/event-stream" in content_type:
            packets = []
            for event in text.replace("\r\n", "\n").split("\n\n"):
                data = "\n".join(line[5:].lstrip(" ") for line in event.splitlines() if line.startswith("data:"))
                if data:
                    packet = json.loads(data)
                    if isinstance(packet, dict) and packet.get("id") == 1:
                        packets.append(packet)
            if len(packets) != 1:
                raise ValueError("missing reply")
            result = packets[0]
        elif "application/json" in content_type:
            result = json.loads(text)
        else:
            raise ValueError("unexpected content type")
        if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or result.get("id") != 1:
            raise ValueError("invalid envelope")
        if "error" in result:
            raise ProxyError("upstream_error", "PokeIt could not complete this read. Please try again.", True)
        payload = result["result"]
        if payload.get("isError"):
            # Do not reflect arbitrary upstream text, URLs or markup into the UI.
            raise ProxyError("tool_error", "PokeIt could not read this result. It may no longer be available.", True)
        if "tools" in payload:
            return {"reachable": True, "version": VERSION, "tool_count": len(payload["tools"])}
        data = payload.get("structuredContent")
        if data is None:
            data = json.loads(next(c["text"] for c in payload.get("content", []) if c.get("type") == "text"))
        if not isinstance(data, dict):
            raise ValueError("nonobject result")
        return data
    except (ValueError, KeyError, TypeError, StopIteration, AttributeError):
        raise ProxyError("invalid_response", "PokeIt returned an unreadable response. Please try again.", True) from None


def _fetch(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, allow_nan=False).encode()
    req = urllib.request.Request(MCP_URL, data=body, method="POST", headers={
        "Accept": "application/json, text/event-stream", "Content-Type": "application/json",
        "User-Agent": "PokeIt-Hermes-Desktop/" + VERSION,
    })
    if not _slots.acquire(timeout=0.1):
        raise ProxyError("busy", "PokeIt Radar is already checking several results. Try again shortly.", True)
    try:
        # Disable environment/system proxies and redirects; the declared host is the only destination.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(req, timeout=20) as response:
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ProxyError("response_too_large", "PokeIt returned too much data. Try a smaller radius.")
            return parse_reply(data, response.headers.get("Content-Type", ""))
    except urllib.error.HTTPError as exc:
        message = "PokeIt is temporarily limiting reads. Please wait before retrying." if exc.code == 429 else "PokeIt is temporarily unavailable. Please try again."
        exc.close()
        raise ProxyError("http_" + str(exc.code), message, True) from None
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError):
        raise ProxyError("unreachable", "PokeIt did not respond. Check your connection and try again.", True) from None
    finally:
        _slots.release()


def _get_asset(url, limit, accept):
    """One GET to a fixed pokeit.cc address: no proxies, no redirects, bounded size."""
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "PokeIt-Hermes-Desktop/" + VERSION})
    if not _icon_slots.acquire(timeout=5):
        raise ProxyError("busy", "PokeIt Radar is already loading several icons. Try again shortly.", True)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(req, timeout=15) as response:
            body = response.read(limit + 1)
            if len(body) > limit:
                raise ProxyError("response_too_large", "An icon was larger than expected.")
            return body, response.headers.get("Content-Type", "").split(";")[0].strip()
    except urllib.error.HTTPError as exc:
        exc.close()
        raise ProxyError("http_" + str(exc.code), "PokeIt is temporarily unavailable. Please try again.", True) from None
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError):
        raise ProxyError("unreachable", "PokeIt did not respond. Check your connection and try again.", True) from None
    finally:
        _icon_slots.release()


def icon_names():
    with _icon_lock:
        if _icon_index["names"] and time.monotonic() - _icon_index["at"] < 3600:
            return _icon_index["names"]
    body, _ = _get_asset(ICON_BASE + "index.json", MAX_BYTES, "application/json")
    try:
        names = frozenset(n for n in json.loads(body)["pokemon"] if isinstance(n, str) and n.endswith(".webp"))
    except (ValueError, KeyError, TypeError):
        raise ProxyError("invalid_response", "PokeIt returned an unreadable icon list.", True) from None
    with _icon_lock:
        _icon_index.update(at=time.monotonic(), names=names)
    return names


def icon(pokemon_id, form):
    """A species icon as an inline image, or no icon. Names come only from the map's own index."""
    names = icon_names()
    name = next((n for n in ([f"{pokemon_id}_f{form}.webp"] if form else []) + [f"{pokemon_id}.webp"] if n in names), None)
    if name is None:
        return {"url": None}, {"cached": True}
    with _icon_lock:
        if name in _icons:
            _icons.move_to_end(name)
            return {"url": _icons[name]}, {"cached": True}
    body, kind = _get_asset(ICON_BASE + "pokemon/" + name, ICON_MAX_BYTES, "image/webp")
    if kind != "image/webp" or body[:4] != b"RIFF" or body[8:12] != b"WEBP":
        raise ProxyError("invalid_response", "PokeIt returned an unreadable icon.", True)
    url = "data:image/webp;base64," + base64.b64encode(body).decode("ascii")
    with _icon_lock:
        _icons[name] = url
        _icons.move_to_end(name)
        while len(_icons) > MAX_ICONS:
            _icons.popitem(last=False)
    return {"url": url}, {"cached": False}


MAP_DIR = Path(__file__).resolve().parent.parent / "assets" / "map"
MAP_CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
           "img-src data: https://tile.openstreetmap.org https://pokeit.cc")
MAP_STATE_SLOT = "__POKEIT_MAP_STATE__"
_map_document = []


def map_document():
    """The map viewer as one self-contained page, built from the files shipped in assets/map.

    The Desktop plugin shows it in a sandboxed frame and fills MAP_STATE_SLOT with what it
    already read. Nothing here comes from a request, and the page loads no scripts or styles
    from the network. Its CSP allows only map tiles and PokeIt species icons.
    """
    if not _map_document:
        try:
            part = {name: (MAP_DIR / name).read_text(encoding="utf-8") for name in ("leaflet.css", "guest.css", "leaflet.js", "guest.js")}
        except OSError:
            raise ProxyError("map_unavailable", "The map viewer files are missing from this install.") from None
        if any("</script" in part[n].lower() for n in ("leaflet.js", "guest.js")) or any("</style" in part[n].lower() for n in ("leaflet.css", "guest.css")):
            raise ProxyError("map_unavailable", "The map viewer files could not be combined safely.")
        _map_document.append(
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta http-equiv="Content-Security-Policy" content="{MAP_CSP}">'
            '<meta name="viewport" content="width=device-width, initial-scale=1"><title>PokeIt map</title>'
            f'<style>{part["leaflet.css"]}\n{part["guest.css"]}</style></head>'
            '<body><div id="map"></div><div id="note" role="status"></div>'
            f'<script id="state" type="application/json">{MAP_STATE_SLOT}</script>'
            f'<script>{part["leaflet.js"]}</script><script>{part["guest.js"]}</script></body></html>')
    return {"document": _map_document[0], "state_slot": MAP_STATE_SLOT}, {"cached": True}


def call_read(tool, args):
    if tool == "health":
        method, params = "tools/list", {}
    elif tool in READ_TOOLS:
        method, params = "tools/call", {"name": tool, "arguments": args}
    else:
        raise ProxyError("unsupported_tool", "This Desktop interface supports read-only lookups.")
    key = json.dumps([tool, args], sort_keys=True, allow_nan=False)
    ttl = 3 if tool == "get_scan_status" else CACHE_SECONDS
    # Coalesce identical concurrent reads, while keeping memory bounded.
    with _call_locks[hash(key) % len(_call_locks)]:
        with _cache_lock:
            hit = _cache.get(key)
            if hit and time.monotonic() - hit[0] < ttl:
                _cache.move_to_end(key)
                return deepcopy(hit[1]), {"cached": True, "cache_age_seconds": round(time.monotonic() - hit[0], 1)}
        data = _fetch(method, params)
        with _cache_lock:
            _cache[key] = (time.monotonic(), deepcopy(data), len(json.dumps(data).encode()))
            _cache.move_to_end(key)
            while len(_cache) > MAX_CACHE_ITEMS or sum(entry[2] for entry in _cache.values()) > MAX_CACHE_BYTES:
                _cache.popitem(last=False)
        return data, {"cached": False, "cache_age_seconds": 0}


def number(params, name, low, high, default=None, integer=False):
    raw = params.get(name, default)
    if raw is None:
        raise ValueError(name + " is required.")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(name + " must be a number.") from None
    if not math.isfinite(value) or not low <= value <= high or (integer and value != int(value)):
        raise ValueError(f"{name} must be {'an integer ' if integer else ''}between {low} and {high}.")
    return int(value) if integer else value


def choice(params, name, choices, default):
    value = params.get(name, default)
    if value not in choices:
        raise ValueError("Invalid " + name + ".")
    return value


def coordinates(params, prefix=""):
    return {"lat": number(params, prefix + "lat", -85, 85), "lon": number(params, prefix + "lon", -180, 180)}


def allowed(params, names):
    if any(k not in names for k in params):
        raise ValueError("Unexpected query parameter.")


def expiry(row):
    try:
        value = datetime.fromisoformat(row.get("expires_at", "").replace("Z", "+00:00"))
        return value.timestamp() if value.tzinfo else None
    except (ValueError, AttributeError, TypeError):
        return None


def direction(origin, target):
    a, b = math.radians(origin["lat"]), math.radians(target["lat"])
    delta = math.radians(target["lon"] - origin["lon"])
    h = math.sin((b-a)/2)**2 + math.cos(a)*math.cos(b)*math.sin(delta/2)**2
    distance = 6371000 * 2 * math.asin(math.sqrt(min(1, max(0, h))))
    bearing = (math.degrees(math.atan2(math.sin(delta)*math.cos(b), math.cos(a)*math.sin(b)-math.sin(a)*math.cos(b)*math.cos(delta))) + 360) % 360
    return {"distance_m": round(distance), "bearing_deg": round(bearing, 1) if distance >= 1 else None,
            "direction": ("N", "NE", "E", "SE", "S", "SW", "W", "NW")[int((bearing+22.5)//45) % 8] if distance >= 1 else None}


def dispatch(route, params):
    if route == "health":
        allowed(params, set())
        return call_read("health", {})
    if route == "map":
        allowed(params, set())
        return map_document()
    if route == "place":
        allowed(params, {"query", "limit"})
        query = params.get("query", "").strip()
        if not 2 <= len(query) <= 200 or any(ord(c) < 32 for c in query):
            raise ValueError("Use a place name between 2 and 200 characters.")
        return call_read("search_places", {"query": query, "limit": number(params, "limit", 1, 5, 3, True)})
    if route == "icon":
        allowed(params, {"pokemon_id", "form"})
        return icon(number(params, "pokemon_id", 1, 4999, integer=True), number(params, "form", 0, 9999, 0, True))
    if route == "scan":
        allowed(params, {"request_id"})
        if not SCAN_ID.fullmatch(params.get("request_id", "")):
            raise ValueError("Invalid scan ID.")
        return call_read("get_scan_status", {"request_id": params["request_id"], "wait_seconds": 0})
    point = coordinates(params)
    if route == "coverage":
        allowed(params, {"lat", "lon"})
        return call_read("get_coverage", point)
    if route == "card":
        allowed(params, {"id", "lat", "lon", "origin_lat", "origin_lon"})
        if not OBSERVATION_ID.fullmatch(params.get("id", "")):
            raise ValueError("Invalid catch ID.")
        origin = coordinates(params, "origin_") if "origin_lat" in params or "origin_lon" in params else None
        data, meta = call_read("find_pokemon", {**point, "radius_m": 50, "selection": "all", "limit": 50})
        row = next((r for r in data.get("observations", []) if r.get("observation_id") == params["id"]), None)
        expired = bool(row and row.get("expiry_verified") is True and expiry(row) is not None and expiry(row) <= time.time())
        if row:
            row = deepcopy(row)
            row.update(direction(origin, row) if origin else {"distance_m": None, "bearing_deg": None, "direction": None})
        return {"observation": None if expired else row, "gone": True if expired else False if row else None,
                "status": "expired" if expired else "observed" if row else "not_seen",
                "query_center": point, "origin": origin, "queried_at": data.get("queried_at"),
                "truncated": data.get("truncated", True),
                "note": "Verified expiry has passed." if expired else "No longer in this read; absence alone does not prove despawn." if not row else None}, meta
    if route == "forts":
        # Gyms and Pokestops give the map its landmarks. Two reads of existing data, trimmed to what is drawn.
        allowed(params, {"lat", "lon", "radius_m"})
        args = {**point, "radius_m": number(params, "radius_m", 50, 2000, 500, True), "limit": 50}
        gyms, meta = call_read("find_gyms", args)
        stops, _ = call_read("find_pokestops", args)

        def rows(data, extra):
            out = []
            for r in data.get("results", []) if isinstance(data.get("results"), list) else []:
                if isinstance(r, dict) and isinstance(r.get("id"), str) and all(isinstance(r.get(k), (int, float)) for k in ("lat", "lon")):
                    out.append({"id": r["id"][:80], "lat": r["lat"], "lon": r["lon"], "name": str(r.get("name") or "")[:80], **extra(r)})
            return out
        return {"gyms": rows(gyms, lambda r: {"team": r.get("team") if r.get("team") in ("valor", "mystic", "instinct") else "neutral", "raid": r.get("active_raid") is True}),
                "stops": rows(stops, lambda r: {"lure": bool(r.get("lure")), "rocket": bool(r.get("rocket_incidents"))}),
                "truncated": bool(gyms.get("truncated")) or bool(stops.get("truncated"))}, meta
    if route not in {"nearby", "raids"}:
        raise ValueError("Unknown read.")
    base = {"lat", "lon", "radius_m", "limit"}
    args = {**point, "radius_m": number(params, "radius_m", 50, 2000, 500, True),
            "limit": number(params, "limit", 1, 50, 50, True)}
    if route == "raids":
        allowed(params, base | {"include_eggs", "eggs_only"})
        for name, default in (("include_eggs", "true"), ("eggs_only", "false")):
            args[name] = choice(params, name, {"true", "false"}, default) == "true"
        return call_read("find_raids", args)
    allowed(params, base | {"selection", "min_iv", "max_iv", "pvp_league", "max_pvp_rank", "order", "timezone_name"})
    args["selection"] = choice(params, "selection", {"auto", "highlights", "all", "rare", "uncommon"}, "highlights")
    args["order"] = choice(params, "order", {"default", "priority"}, "default")
    for name in ("min_iv", "max_iv"):
        if name in params:
            args[name] = number(params, name, 0, 100)
    if args.get("min_iv", 0) > args.get("max_iv", 100):
        raise ValueError("Minimum IV cannot exceed maximum IV.")
    if "pvp_league" in params:
        args["pvp_league"] = choice(params, "pvp_league", {"little", "great", "ultra"}, None)
        args["max_pvp_rank"] = number(params, "max_pvp_rank", 1, 4096, 1, True)
    elif "max_pvp_rank" in params:
        raise ValueError("Choose a PvP league for a rank filter.")
    if "timezone_name" in params:
        tz = params["timezone_name"]
        if len(tz) > 80:
            raise ValueError("Invalid timezone.")
        try:
            ZoneInfo(tz)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Use an IANA timezone.") from None
        args["timezone_name"] = tz
    data, meta = call_read("find_pokemon", args)
    # A read from our cache can outlive a very short encounter. Never keep it on the radar.
    rows = data.get("observations", [])
    data["observations"] = [r for r in rows if expiry(r) is None or expiry(r) > time.time()]
    data["returned"] = len(data["observations"])
    pick = data.get("highest_observed_iv")
    if pick and expiry(pick) is not None and expiry(pick) <= time.time():
        data["highest_observed_iv"] = None
    return data, meta


def respond(route, request, extra=None):
    try:
        pairs = list(request.query_params.multi_items())
        if len(pairs) != len({k for k, _ in pairs}) or any(k in (extra or {}) for k, _ in pairs):
            raise ValueError("Repeated query parameters are not supported.")
        data, meta = dispatch(route, {**dict(pairs), **(extra or {})})
        return {"ok": True, "data": data, "meta": meta}
    except ValueError as exc:
        return {"ok": False, "error": {"code": "invalid_input", "message": str(exc), "retryable": False}}
    except ProxyError as exc:
        return {"ok": False, "error": {"code": exc.code, "message": exc.message, "retryable": exc.retryable}}
    except (KeyError, TypeError, AttributeError, OverflowError):
        return {"ok": False, "error": {"code": "invalid_response", "message": "PokeIt returned an unreadable result. Please try again.", "retryable": True}}


@router.get("/nearby")
def nearby(request: Request):
    return respond("nearby", request)


@router.get("/raids")
def raids(request: Request):
    return respond("raids", request)


@router.get("/card")
def card(request: Request):
    return respond("card", request)


@router.get("/forts")
def forts(request: Request):
    return respond("forts", request)


@router.get("/coverage")
def coverage(request: Request):
    return respond("coverage", request)


@router.get("/place")
def place(request: Request):
    return respond("place", request)


@router.get("/scan/{request_id}")
def scan(request_id: str, request: Request):
    return respond("scan", request, {"request_id": request_id})


@router.get("/icon/{pokemon_id}")
def icon_route(pokemon_id: str, request: Request):
    return respond("icon", request, {"pokemon_id": pokemon_id})


@router.get("/map")
def map_route(request: Request):
    return respond("map", request)


@router.get("/health")
def health(request: Request):
    return respond("health", request)
