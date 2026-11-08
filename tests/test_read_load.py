"""Offline failure and stop-policy tests for the bounded live-read checker."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("read_load", ROOT / "tools" / "read_load.py")
load = importlib.util.module_from_spec(spec)
spec.loader.exec_module(load)
GOOD = {"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"observations":[]},"isError":False}}


class LoadTests(unittest.TestCase):
    def setUp(self):
        guard=patch.object(load.urllib.request,"build_opener",side_effect=AssertionError("Offline test attempted network"))
        guard.start();self.addCleanup(guard.stop)

    def reader(self, tool, latency=100, ok=True, status=200):
        return {"tool":tool,"latency_ms":latency,"ok":ok,"http_status":status,"error":None if ok else "test_error"}

    def test_exact_bounds_and_read_allowlist(self):
        report=load.run(reader=self.reader)
        self.assertEqual([s['concurrency'] for s in report['stages']],[1,2,4,8])
        self.assertEqual(report['total_requests'],48)
        for s in report['stages']:
            self.assertEqual({k:v['requests'] for k,v in s['by_tool'].items()},{k:4 for k in load.TOOLS})
        with self.assertRaises(ValueError):load.packet('unknown_write')
        with self.assertRaises(ValueError):load.run(100,32,self.reader)
        for tool in load.TOOLS:
            request=json.loads(load.packet(tool))
            self.assertEqual(request['method'],'tools/call')
            self.assertEqual(request['params']['name'],tool)

    def test_refusal_stops_without_next_stage(self):
        calls=[]
        def reader(tool):
            calls.append(tool)
            return self.reader(tool,ok=False,status=429)
        report=load.run(reader=reader)
        self.assertEqual(len(calls),1)
        self.assertEqual(len(report['stages']),1)
        self.assertEqual(report['stopped_reason'],'read_failure_or_refusal')

    def test_material_tail_increase_stops_ramp(self):
        calls=[]
        def reader(tool):
            calls.append(tool)
            return self.reader(tool,latency=100 if len(calls)<=12 else 1200)
        report=load.run(reader=reader)
        self.assertEqual(report['total_requests'],24)
        self.assertEqual(report['stopped_reason'],'tail_latency_increased')

    def test_unreachable_is_readable_and_does_not_raise(self):
        class Opener:
            def open(self,*args,**kwargs):raise urllib.error.URLError('offline')
        with patch.object(load.urllib.request,'build_opener',return_value=Opener()):
            result=load.read_once('get_coverage')
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'],'unreachable_or_timeout')

    def test_http_service_failure_is_readable(self):
        class Opener:
            def open(self,*args,**kwargs):raise urllib.error.HTTPError(load.ENDPOINT,503,'offline',{},io.BytesIO(b'private error'))
        with patch.object(load.urllib.request,'build_opener',return_value=Opener()):
            result=load.read_once('get_coverage')
        self.assertEqual(result['http_status'],503)
        self.assertNotIn('private',json.dumps(result))

    def test_malformed_and_tool_error_are_failures(self):
        for body,ct in [(b'<html>challenge</html>','text/html'),(b'[]','application/json'),
                        (b'{"jsonrpc":"2.0","id":1,"result":{"isError":true}}','application/json')]:
            with self.assertRaises(load.BadReply):load.check_reply(body,ct)
        load.check_reply(json.dumps(GOOD).encode(),'application/json')
        load.check_reply(('event: message\ndata: '+json.dumps(GOOD)+'\n\n').encode(),'text/event-stream')


if __name__=='__main__':unittest.main()
