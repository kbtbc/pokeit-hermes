"""Proxy contracts; recorded public reads are fixtures, never live sightings."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime
import importlib.util
import io
import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch
import urllib.error

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pokeit_proxy", ROOT / "dashboard" / "plugin_api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
app = FastAPI()
app.include_router(api.router, prefix="/api/plugins/pokeit")
client = TestClient(app)
recorded = json.loads((ROOT / "tests/fixtures/pokemon-recorded.json").read_text(encoding="utf-8"))
places = json.loads((ROOT / "tests/fixtures/place-recorded.json").read_text(encoding="utf-8"))
SNAPSHOT = recorded["result"]["structuredContent"]
AT = datetime.fromisoformat(SNAPSHOT["queried_at"]).timestamp()
ROW = SNAPSHOT["observations"][0]


class Reply(io.BytesIO):
    def __init__(self, body, content_type="application/json"):
        super().__init__(body)
        self.headers = {"Content-Type": content_type}


class ProxyTests(unittest.TestCase):
    def setUp(self):
        api._cache.clear()

    def request(self, path, **kwargs):
        return client.get("/api/plugins/pokeit" + path, **kwargs).json()

    def test_parses_recorded_json_and_sse(self):
        data = api.parse_reply(json.dumps(recorded).encode(), "application/json")
        self.assertEqual(data, SNAPSHOT)
        event = "event: message\r\ndata: " + json.dumps(recorded) + "\r\n\r\n"
        self.assertEqual(api.parse_reply(event.encode(), "text/event-stream"), SNAPSHOT)
        self.assertEqual(api.parse_reply(json.dumps(places).encode(), "application/json"), places["result"]["structuredContent"])

    def test_html_errors_and_wrong_envelopes_are_not_reflected(self):
        cases = [(b"<script>secret</script>", "text/html"), (b"[]", "application/json"),
                 (b'{"id":2,"jsonrpc":"2.0","result":{}}', "application/json"),
                 (b'{"id":1,"jsonrpc":"2.0","error":{"message":"SECRET"}}', "application/json")]
        for body, kind in cases:
            with self.subTest(body=body), self.assertRaises(api.ProxyError) as got:
                api.parse_reply(body, kind)
            self.assertNotIn("SECRET", got.exception.message)

    def test_only_fixed_read_destination_and_headers(self):
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append((request, timeout))
                return Reply(json.dumps(recorded).encode())
        with patch.object(api.urllib.request, "build_opener", return_value=Opener()):
            api.call_read("find_pokemon", {"lat":34,"lon":-84})
        request, timeout = requests[0]
        self.assertEqual((request.full_url, request.method, timeout), (api.MCP_URL, "POST", 20))
        self.assertEqual(json.loads(request.data)["params"]["name"], "find_pokemon")
        self.assertTrue(request.get_header("User-agent").startswith("PokeIt-Hermes-Desktop/"))
        self.assertIsNone(request.get_header("Authorization"))
        self.assertIsNone(request.get_header("X-pokeit-search-diagnostics"))
        with self.assertRaises(api.ProxyError):
            api.call_read("anything_else", {})

    def test_oversized_payload_and_redirect_refused(self):
        class Opener:
            def open(self, request, timeout):
                return Reply(b"x" * (api.MAX_BYTES+1))
        with patch.object(api.urllib.request, "build_opener", return_value=Opener()), self.assertRaises(api.ProxyError) as got:
            api.call_read("health", {})
        self.assertEqual(got.exception.code, "response_too_large")
        with self.assertRaises(api.ProxyError):
            api.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://example.test")

    def test_invalid_inputs_never_reach_network(self):
        queries = ["lat=nan&lon=0", "lat=inf&lon=0", "lat=86&lon=0", "lat=0&lon=181",
                   "lat=0&lon=0&radius_m=49", "lat=0&lon=0&radius_m=2001",
                   "lat=0&lon=0&radius_m=50.5", "lat=0&lon=0&limit=51",
                   "lat=0&lon=0&selection=evil", "lat=0&lon=0&url=http://127.0.0.1",
                   "lat=0&lat=34&lon=0", "lat=0&lon=0&min_iv=90&max_iv=10"]
        with patch.object(api, "_fetch") as fetch:
            for query in queries:
                with self.subTest(query=query):
                    result = self.request("/nearby?" + query)
                    self.assertFalse(result["ok"])
                    self.assertEqual(result["error"]["code"], "invalid_input")
            self.assertFalse(self.request("/card?lat=0&lon=0&id=../../secret")["ok"])
            self.assertFalse(self.request("/place?query=a")["ok"])
            self.assertFalse(self.request("/scan/short")["ok"])
            self.assertFalse(self.request("/scan/" + "a"*32 + "?request_id=" + "b"*32)["ok"])
            fetch.assert_not_called()

    def test_cache_coalesces_and_does_not_leak_mutations(self):
        def fetch(*args):
            time.sleep(.03)
            return deepcopy(SNAPSHOT)
        with patch.object(api, "_fetch", side_effect=fetch) as upstream:
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _:api.call_read("find_pokemon", {"lat":34,"lon":-84}), range(4)))
            self.assertEqual(upstream.call_count, 1)
            results[0][0]["observations"].clear()
            self.assertTrue(api.call_read("find_pokemon", {"lat":34,"lon":-84})[0]["observations"])
            self.assertEqual(sum(r[1]["cached"] for r in results), 3)

    def test_real_schema_scan_counts_preserved_wait_zero(self):
        data = {"request_id":"a"*32, "status":"queued", "counts":{"confirmed":12,"existing_area":4,"pending":33,"failed":0,"unverified":0}, "total_points":49, "poll_after_seconds":5}
        with patch.object(api, "_fetch", return_value=data) as fetch:
            result = self.request("/scan/"+"a"*32)
        self.assertEqual(result["data"], data)
        self.assertEqual(fetch.call_args.args, ("tools/call", {"name":"get_scan_status", "arguments":{"request_id":"a"*32,"wait_seconds":0}}))

    def test_cache_has_a_byte_budget_not_only_an_entry_limit(self):
        with patch.object(api, "MAX_CACHE_BYTES", 300), patch.object(api, "_fetch", return_value={"text":"x"*150}):
            api.call_read("search_places", {"query":"first"})
            api.call_read("search_places", {"query":"second"})
        self.assertEqual(len(api._cache), 1)
        self.assertLessEqual(sum(entry[2] for entry in api._cache.values()), 300)

    def test_nearby_filters_and_expiry(self):
        with patch.object(api, "_fetch", return_value=deepcopy(SNAPSHOT)) as fetch, patch.object(api.time,"time",return_value=AT):
            result = self.request("/nearby?lat=34&lon=-84&selection=all&min_iv=90&limit=10&order=priority&timezone_name=America/New_York")
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["observations"], SNAPSHOT["observations"])
        args = fetch.call_args.args[1]["arguments"]
        self.assertEqual((args["min_iv"],args["limit"],args["order"]),(90,10,"priority"))
        with patch.object(api.time, "time", return_value=AT + 86400):
            result = self.request("/nearby?lat=34&lon=-84&selection=all&min_iv=90&limit=10&order=priority&timezone_name=America/New_York")
        self.assertTrue(result["meta"]["cached"])
        self.assertEqual(result["data"]["observations"], [])

    def test_card_found_origin_direction_and_absence_are_truthful(self):
        query = f"/card?id={ROW['observation_id']}&lat={ROW['lat']}&lon={ROW['lon']}"
        with patch.object(api, "_fetch", return_value=deepcopy(SNAPSHOT)), patch.object(api.time,"time",return_value=AT):
            result = self.request(query)
            self.assertEqual(result["data"]["status"], "observed")
            self.assertIsNone(result["data"]["observation"]["distance_m"])
            result = self.request(query + "&origin_lat=34.07&origin_lon=-84.3")
            self.assertEqual(result["data"]["observation"]["direction"], "NE")
            self.assertGreater(result["data"]["observation"]["distance_m"], 500)
        api._cache.clear()
        with patch.object(api,"_fetch",return_value={"observations":[],"truncated":True}):
            result = self.request(query)
        self.assertEqual(result["data"]["status"], "not_seen")
        self.assertIsNone(result["data"]["gone"])

    def test_cached_card_verified_expiry(self):
        query = f"/card?id={ROW['observation_id']}&lat={ROW['lat']}&lon={ROW['lon']}"
        with patch.object(api, "_fetch", return_value=deepcopy(SNAPSHOT)), patch.object(api.time,"time",return_value=AT):
            self.assertFalse(self.request(query)["data"]["gone"])
        with patch.object(api.time,"time",return_value=AT+86400):
            result = self.request(query)
        self.assertTrue(result["data"]["gone"])
        self.assertEqual(result["data"]["status"], "expired")
        self.assertIsNone(result["data"]["observation"])

    def test_transport_failure_returns_readable_json_and_is_not_cached(self):
        with patch.object(api, "_fetch", side_effect=api.ProxyError("unreachable","Try again.",True)) as fetch:
            first = self.request("/health")
            second = self.request("/health")
        self.assertEqual(fetch.call_count, 2)
        self.assertFalse(first["ok"])
        self.assertTrue(second["error"]["retryable"])


if __name__ == "__main__":
    unittest.main()
