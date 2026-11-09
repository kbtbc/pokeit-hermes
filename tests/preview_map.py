"""Optional visual check of the map viewer with live PokeIt reads (no scan is started).

  python tests/preview_map.py <output-directory> [lat lon [radius_m]]

Writes index.html: the viewer inside a sandboxed frame, as the Desktop plugin shows it, with
buttons to exercise selection, theme, watch and a new arrival. Serve the directory over http
and open it. Needs FastAPI (the Hermes venv has it). Reads only.
"""
import importlib.util
import json
from pathlib import Path
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("pokeit_proxy", ROOT / "dashboard" / "plugin_api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

out = Path(sys.argv[1])
lat, lon = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (34.0754, -84.2941)
radius = int(sys.argv[4]) if len(sys.argv) > 4 else 500


def rows(selection):
    data, _ = api.dispatch("nearby", {"lat": str(lat), "lon": str(lon), "radius_m": str(radius), "limit": "50", "selection": selection})
    return data.get("observations", []), data.get("highest_observed_iv")


def item(p):
    from datetime import datetime
    try:
        end = datetime.fromisoformat(p["expires_at"].replace("Z", "+00:00")).timestamp() * 1000
    except (KeyError, ValueError, AttributeError):
        end = None
    rank1 = any(r.get("rank") == 1 for league in (p.get("pvp_iv_rankings") or {}).values() if isinstance(league, list) for r in league)
    iv = p.get("iv_percent")
    return {"id": p["observation_id"], "lat": p["lat"], "lon": p["lon"], "name": p.get("name", ""), "pokemon_id": p.get("pokemon_id", 0),
            "form": p.get("form") or 0, "iv": iv, "tag": "Hundo" if iv == 100 else "Nundo" if iv == 0 else "PvP #1" if rank1 else None,
            "expires": end, "verified": p.get("expiry_verified") is True}


best, pick = rows("highlights")
if not best and pick:
    best = [pick]
everything, _ = rows("all")
shown = {p["observation_id"] for p in best}
state = {"theme": "dark", "center": {"lat": lat, "lon": lon}, "radius": radius, "busy": False, "watching": False,
         "selected": best[0]["observation_id"] if best else None, "items": [item(p) for p in best],
         "dots": [item(p) for p in everything if p["observation_id"] not in shown][:50]}
doc, _ = api.map_document()
page = doc["document"].replace(doc["state_slot"], json.dumps(state).replace("<", "\\u003c"))
host = """<!doctype html><meta charset="utf-8"><title>PokeIt map check</title>
<body style="margin:0;background:#050C20;color:#F2F6FF;font:13px 'Segoe UI',system-ui">
<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
<b>LIVE READ, TEST HOST</b><span id="count"></span>
<button id="theme">Theme</button><button id="watch">Watch</button><button id="busy">Busy</button><button id="next">Select next</button><button id="arrive">New arrival</button>
<span id="picked"></span></div>
<div id="box" style="width:WIDTHpx;height:380px;margin:0 10px;border:1px solid #30436A;border-radius:12px;overflow:hidden">
<iframe id="f" sandbox="allow-scripts" referrerpolicy="no-referrer" style="width:100%;height:100%;border:0;display:block" src="SRC"></iframe></div>
<script>
const state = STATE, f = document.getElementById('f'); let i = 0;
const send = () => f.contentWindow.postMessage({source:'pokeit-host', state}, '*');
document.getElementById('count').textContent = state.items.length + ' catches, ' + state.dots.length + ' dots';
addEventListener('message', e => { if (e.source !== f.contentWindow || e.data?.source !== 'pokeit-map') return;
  window.lastMessage = e.data; if (e.data.type === 'select') { state.selected = e.data.id; document.getElementById('picked').textContent = 'picked ' + e.data.id; } });
theme.onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.body.style.background = state.theme === 'dark' ? '#050C20' : '#FBF8F1'; send(); };
watch.onclick = () => { state.watching = !state.watching; send(); };
busy.onclick = () => { state.busy = !state.busy; send(); };
next.onclick = () => { i = (i + 1) % Math.max(1, state.items.length); state.selected = state.items[i]?.id || null; send(); };
arrive.onclick = () => { const d = state.dots.shift(); if (d) { state.items = [...state.items, {...d, tag: 'Hundo', iv: 100}]; send(); } };
</script>"""
out.mkdir(parents=True, exist_ok=True)
for name, width in (("index.html", 350), ("wide.html", 760)):
    (out / name).write_text(host.replace("WIDTH", str(width)).replace("SRC", "data:text/html;charset=utf-8," + quote(page, safe="")).replace("STATE", json.dumps(state)), encoding="utf-8")
print(f"{len(state['items'])} catches, {len(state['dots'])} dots, document {len(page)} bytes -> {out}")
(out / "guest.html").write_text(page, encoding="utf-8")  # the viewer page on its own, for inspection
