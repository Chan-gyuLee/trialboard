import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { consumeAgentStream, isLocalDemo, runLiveAgent } from "../src/agent-live.ts";

const report = JSON.parse(await readFile(new URL("../public/data/agent/public-record.json", import.meta.url), "utf8"));
const start = { type: "started", sequence: 1, run_id: "one", elapsed_ms: 0, case: "public", execution_mode: "CODEX_CHATGPT" };
const progress = { type: "progress", sequence: 2, run_id: "one", elapsed_ms: 123, stage: "EXTRACT", attempt: 0, state: "COMPLETED", observations: 2 };
const result = { type: "result", sequence: 3, run_id: "one", elapsed_ms: 200, report };
function response(events, split = false) {
  const bytes = new TextEncoder().encode(": waiting\n\n" + events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""));
  return new Response(new ReadableStream({start(c) { if (split) { for (let i = 0; i < bytes.length; i += 17) c.enqueue(bytes.slice(i, i + 17)); } else c.enqueue(bytes); c.close(); }}), {headers:{"content-type":"text/event-stream"}});
}
test("consumes fragmented UTF-8 stream, reports actual progress and validates final report", async () => {
  const seen = []; const r = await consumeAgentStream(response([start, progress, result], true), "public", e => seen.push(e));
  assert.equal(r.run_id, report.run_id); assert.equal(seen.length, 1); assert.equal(seen[0].observations, 2);
});
for (const [name, es] of [
  ["missing start", [progress, result]],
  ["duplicate start", [start, {...start, sequence:2}]],
  ["different run", [start, {...progress, run_id:"two"}]],
  ["sequence gap", [start, {...progress, sequence:3}]],
  ["wrong case", [{...start, case:"synthetic"}]],
  ["scripted fallback", [{...start, execution_mode:"SCRIPTED_TEST_DOUBLE"}]],
  ["unknown stage", [start, {...progress, stage:"THINKING"}]],
  ["negative counts", [start, {...progress, observations:-1}]],
  ["oversized items", [start, {...progress,items:Array(25).fill({})}]],
  ["unsupported internal reasoning item", [start, {...progress,items:[{kind:'reasoning',id:'1',text:'hidden',span_ids:[]}]}]],
  ["oversized item text", [start, {...progress,items:[{kind:'finding',id:'1',text:'x'.repeat(1001),span_ids:[]}]}]],
  ["truncated result", [start, progress]],
  ["terminal error", [{type:"error", sequence:1, run_id:"one", elapsed_ms:0, code:"PRIVATE_TEXT"}]],
  ["mismatched result", [start, progress, {...result, report:{...report, execution_mode:"SCRIPTED_TEST_DOUBLE"}}]],
]) test(`fails closed on ${name}`, async () => { await assert.rejects(consumeAgentStream(response(es), "public", () => {})); });
test("HTTP and content-type failures do not become successful results", async () => {
  for (const r of [new Response("", {status:429}), new Response("{}", {headers:{"content-type":"application/json"}})]) await assert.rejects(consumeAgentStream(r, "public", () => {}));
});
test("only exact local dev origin may execute; remote rejection occurs before fetch", async () => {
  assert.equal(isLocalDemo({hostname:"127.0.0.1",port:"5173",protocol:"http:"}), true);
  for (const location of [{hostname:"attacker.invalid",port:"5173",protocol:"http:"}, {hostname:"localhost",port:"80",protocol:"http:"}, {hostname:"localhost",port:"5173",protocol:"https:"}]) {
    assert.equal(isLocalDemo(location), false);
    await assert.rejects(runLiveAgent("public", new AbortController().signal, () => {}, location));
  }
});

test("competition stream preserves provider identity without personal-account fallback", async () => {
  const daconStart = {...start, execution_mode:"DACON_RESPONSES"};
  const daconReport = {...report, execution_mode:"DACON_RESPONSES", model:"gpt-5.6-terra"};
  const r = await consumeAgentStream(response([daconStart, progress, {...result, report:daconReport}]), "public", () => {}, "DACON_RESPONSES");
  assert.equal(r.execution_mode, "DACON_RESPONSES");
  await assert.rejects(consumeAgentStream(response([start, progress, result]), "public", () => {}, "DACON_RESPONSES"));
  await assert.rejects(consumeAgentStream(response([daconStart, progress, result]), "public", () => {}));
});
