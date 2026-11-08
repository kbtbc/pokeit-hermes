"""Small, bounded PokeIt read check. Never starts scans or changes the service.

Run: python tools/read_load.py --run --output read-check.json
The default sends at most 48 reads, at concurrency 1, 2, 4, then 8. This is a
latency smoke test, not a capacity claim. Stop on refusal, service errors, or
a material tail-latency increase. No keys or additional dependencies required.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import argparse
import json
import math
from pathlib import Path
import statistics
import threading
import time
import urllib.error
import urllib.request

ENDPOINT = "https://mcp.pokeit.cc/mcp"
TIMEOUT_SECONDS = 8
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
POINT = {"lat": 34.074635, "lon": -84.292271}  # Alpharetta City Hall
READS = {
    "find_pokemon": {**POINT, "radius_m": 500, "selection": "highlights", "limit": 3},
    "get_coverage": POINT,
    "get_game_context": {"pokemon_ids": [25, 714], "timezone_name": "America/New_York"},
}
TOOLS = tuple(READS)


class BadReply(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BadReply("unexpected redirect")


def packet(tool):
    if tool not in READS:
        raise ValueError("Only the three fixed read tools are allowed.")
    return json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": tool, "arguments": READS[tool]}}, allow_nan=False).encode()


def check_reply(raw, content_type):
    """Validate success without retaining sightings, locations or article bodies."""
    try:
        if "text/event-stream" in content_type:
            candidates = []
            for event in raw.decode().replace("\r\n", "\n").split("\n\n"):
                text = "\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith("data:"))
                if text:
                    obj = json.loads(text)
                    if isinstance(obj, dict) and obj.get("id") == 1:
                        candidates.append(obj)
            if len(candidates) != 1:
                raise ValueError("missing response")
            result = candidates[0]
        elif "application/json" in content_type:
            result = json.loads(raw)
        else:
            raise ValueError("not MCP")
        if result.get("id") != 1 or result.get("jsonrpc") != "2.0" or "error" in result:
            raise ValueError("RPC error")
        data = result["result"]
        if data.get("isError"):
            raise ValueError("tool error")
        structured = data.get("structuredContent")
        if structured is None:
            structured = json.loads(next(c["text"] for c in data.get("content", []) if c.get("type") == "text"))
        if not isinstance(structured, dict):
            raise ValueError("unexpected result")
    except (ValueError, TypeError, KeyError, AttributeError, StopIteration, UnicodeError):
        raise BadReply("unsuccessful or malformed MCP response") from None


def read_once(tool):
    request = urllib.request.Request(ENDPOINT, data=packet(tool), method="POST", headers={
        "Accept": "application/json, text/event-stream", "Content-Type": "application/json",
        "User-Agent": "PokeIt-Read-Check/1",
    })
    start = time.monotonic()
    row = {"tool": tool, "ok": False, "http_status": None, "error": None}
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            row["http_status"] = response.status
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise BadReply("response too large")
            check_reply(raw, response.headers.get("Content-Type", ""))
            row.update(ok=True, response_bytes=len(raw))
    except urllib.error.HTTPError as exc:
        row.update(http_status=exc.code, error="http_error")
        exc.close()
    except (urllib.error.URLError, TimeoutError, OSError):
        row["error"] = "unreachable_or_timeout"
    except BadReply:
        row["error"] = "invalid_mcp_response"
    row["latency_ms"] = round((time.monotonic() - start) * 1000, 1)
    return row


def percentile(values, percent):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(percent * len(ordered)) - 1)] if ordered else None


def summarize(rows):
    values = [row["latency_ms"] for row in rows if row["ok"]]
    return {"requests": len(rows), "successes": len(values), "errors": len(rows)-len(values),
            "median_ms": round(statistics.median(values), 1) if values else None,
            "p95_ms": percentile(values, .95), "max_ms": max(values) if values else None}


def stage(concurrency, requests, reader=read_once):
    stop = threading.Event()
    start = time.monotonic()

    def one(index):
        if stop.is_set():
            return None
        row = reader(TOOLS[index % len(TOOLS)])
        # Cancel work not yet started on *any* failure. Already-running reads finish.
        if not row["ok"]:
            stop.set()
        return row

    rows = []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(one, i) for i in range(requests)]
        for future in as_completed(futures):
            row = future.result()
            if row is not None:
                rows.append(row)
    return {"concurrency": concurrency, "requested": requests,
            "wall_seconds": round(time.monotonic()-start, 3), **summarize(rows),
            "by_tool": {tool: summarize([r for r in rows if r["tool"] == tool]) for tool in TOOLS},
            "samples": rows}


def run(requests_per_stage=12, max_concurrency=8, reader=read_once):
    if requests_per_stage not in (3, 6, 9, 12, 15, 18, 21, 24) or max_concurrency not in (1, 2, 4, 8):
        raise ValueError("Choose 3–24 reads per stage in multiples of 3 and concurrency 1, 2, 4 or 8.")
    report = {"checked_at_utc": datetime.now(timezone.utc).isoformat(), "endpoint": ENDPOINT,
              "location": "Alpharetta City Hall", "tools": list(TOOLS), "stages": [],
              "maximum_requests": requests_per_stage * (1, 2, 4, 8).index(max_concurrency) + requests_per_stage,
              "timeout_seconds": TIMEOUT_SECONDS, "stopped_reason": "completed_bounded_check",
              "notes": ["Read-only fixed public location; no scan or quota-identity changes.",
                        "Small samples on repeated reads, often warm caches. Not a fleet capacity estimate.",
                        "p95 is the nearest-rank observed sample; compare the per-tool mix."]}
    for concurrency in (1, 2, 4, 8):
        if concurrency > max_concurrency:
            break
        result = stage(concurrency, requests_per_stage, reader)
        report["stages"].append(result)
        if result["errors"]:
            report["stopped_reason"] = "read_failure_or_refusal"
            break
        baseline = report["stages"][0]["p95_ms"]
        if concurrency > 1 and result["p95_ms"] > max(1000, baseline * 1.75):
            report["stopped_reason"] = "tail_latency_increased"
            break
    report["total_requests"] = sum(s["requests"] for s in report["stages"])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="Send the bounded live read requests.")
    parser.add_argument("--requests-per-stage", type=int, choices=(3, 6, 9, 12, 15, 18, 21, 24), default=12)
    parser.add_argument("--max-concurrency", type=int, choices=(1, 2, 4, 8), default=8)
    parser.add_argument("--output", type=Path, help="Save timing metadata as JSON (no response bodies).")
    args = parser.parse_args()
    if not args.run:
        parser.print_help()
        print("\nNo requests sent. Add --run to perform the check.")
        return
    report = run(args.requests_per_stage, args.max_concurrency)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({**report, "stages": [{k:v for k,v in s.items() if k != "samples"} for s in report["stages"]]}, indent=2))


if __name__ == "__main__":
    main()
