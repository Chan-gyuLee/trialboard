import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readResearchResult,readResearchStream} from '../src/research.ts';

test('actual Python research SSE including citation preparation is accepted by the web reader',async()=>{
 const script=`
import json, sys, tempfile
from pathlib import Path
from threading import BoundedSemaphore
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
sys.path.insert(0, "tests")
from test_research import setup, FakeModel, ORIGIN
from trialboard.api.research import research_router
with tempfile.TemporaryDirectory() as temp, pytest.MonkeyPatch.context() as mp:
    path, request, _ = setup.__wrapped__(Path(temp), mp)
    app = FastAPI()
    app.include_router(research_router(path, BoundedSemaphore(1), provider_factory=FakeModel))
    with TestClient(app) as client:
        response = client.post("/api/research/run", json={**request.model_dump(), "model_consent": True}, headers=ORIGIN)
        assert response.status_code == 200
        events = [json.loads(x[6:]) for x in response.text.split("\\n\\n") if x.startswith("data: ")]
        result = client.get("/api/research/runs/" + events[-1]["run_id"]).json()
        print(json.dumps({"stream": response.text, "result": result}))
`;
 const raw=execFileSync('uv',['run','python','-c',script],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:30000,maxBuffer:2_000_000});
 const data=JSON.parse(raw),seen=[];
 const id=await readResearchStream(new Response(data.stream,{headers:{'content-type':'text/event-stream'}}),e=>seen.push(e));
 const c=readResearchResult(JSON.stringify(data.result)).collection;
 assert.equal(c.id,id);assert.equal(c.execution_mode,'SCRIPTED_TEST_DOUBLE');assert.equal(c.status,'COMPLETE');
 assert.ok(seen.some(e=>e.stage==='CITATIONS_READY'));assert.ok(seen.some(e=>e.stage==='REVIEW_READY'));
 assert.equal(c.calls.length,2);assert.equal(c.calls[1].contract_version,'source-spans/2');
 assert.equal(c.review.findings.length,1);
 const finding=c.review.findings[0],source=c.sources.find(s=>s.id===finding.source_id);
 assert.ok(source.text.includes(finding.quote));
});
