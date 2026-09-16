/** Rehearse the real PDF parser -> scripted review -> local calculation -> meeting roundtrip.
 * All attestations and values are synthetic automation fixtures, never human/expert review.
 * Requires a PDF from scripts/create_design_demo_pdf.py and opt-in local API through Vite.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, version } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPages } from "../src/pdf-extract.ts";
import { attestSpan, evidenceExport } from "../src/pdf-contract.ts";
import { canonical, decide, digest, FIELD_NAMES, importAgentReport, exportReview } from "../src/field-review.ts";
import { restoreReview } from "../src/field-review-restore.ts";
import { bindBrief } from "../src/design-brief.ts";
import { executeLocalDesign } from "../src/design-client.ts";
import { newMeeting, recordNote, packetJson, packetMarkdown, restorePacket } from "../src/meeting-packet.ts";

const path = resolve(process.argv[2] ?? "");
if (!path.endsWith("/SYNTHETIC-DEMO-NOT-CLINICAL.pdf")) throw new Error("Supply only the generated synthetic demo PDF.");
const bytes = readFileSync(path), folder = dirname(path), repo = fileURLToPath(new URL("../../", import.meta.url));
const task = getDocument({ data: new Uint8Array(bytes), stopAtErrors: true, useSystemFonts: false, verbosity: 0,
  standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)) });
const save = (name, data) => writeFileSync(join(folder, name), typeof data === "string" ? data : JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
try {
  const pdf = await task.promise, pages = await extractPages(pdf);
  const source = { schemaVersion: "pdf-evidence/1", name: "SYNTHETIC-DEMO-NOT-CLINICAL.pdf", byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), extractor: `pdfjs-dist/${version}`, pages, status: "TEXT_EXTRACTED", coordinateSystem: "normalized_top_left_rotated_viewport" };
  const observations = pages.flatMap(p => p.spans).filter(s => s.text.startsWith("asset DEMO-01;"));
  assert.equal(observations.length, 4); assert.ok(observations.every(s => s.box));
  const notes = observations.map(s => attestSpan(source, s.id, "SYNTHETIC AUTOMATION FIXTURE", "Not a human visual attestation. Test software only.", true));
  const sourcePacket = evidenceExport(source, notes);
  const agentRaw = execFileSync("uv", ["run", "python", "-c", `
import asyncio, copy, json, sys
from trialboard.agent.pdf_input import from_pdf_export
from trialboard.agent.example import demo_input, ScriptedProvider
from trialboard.agent.engine import run_agent
d = demo_input()
packet = json.load(sys.stdin)
data = from_pdf_export(packet, **{k:getattr(d,k) for k in ('asset','indication','study','question')})
class DemoProvider(ScriptedProvider):
 async def complete(self, **kwargs):
  if kwargs['schema']['title'] != 'Critique':
   kwargs = copy.deepcopy(kwargs)
   kwargs['payload']['source']['spans'] = [s for s in kwargs['payload']['source']['spans'] if s['text'].startswith('asset DEMO-01;')]
  return await super().complete(**kwargs)
r = asyncio.run(run_agent(data, DemoProvider()))
print(r.model_dump_json())
`], { cwd: repo, input: JSON.stringify(sourcePacket), encoding: "utf8", timeout: 30000 });
  let review = await importAgentReport(agentRaw, source);
  for (const row of review.rows) for (const field of FIELD_NAMES) if (row.fields[field].current.value !== null) {
    review = decide(review, source, row.id, field, "confirmed", row.fields[field].current,
      "SYNTHETIC AUTOMATED TEST RECORD - NOT HUMAN OR EXPERT REVIEW", row.fields[field].current.citation.page, true);
  }
  const restored = restoreReview(JSON.stringify(exportReview(review, source)), source);
  assert.equal(canonical(exportReview(restored, source)), canonical(exportReview(review, source)));
  const brief = await bindBrief({ schema_version: "design-brief/1", source_digest: source.sha256, review_content_digest: await digest(canonical(exportReview(review, source))), question: JSON.parse(agentRaw).input.question,
    arms: ["dose-A", "dose-B"].map((dose, i) => ({ id: `arm-${i + 1}`, source_dose: dose, observation_ids: review.rows.filter(r => r.fields.dose.current.value === dose).map(r => r.id) })),
    plans: [{id:"small",label:"Demo: 30 per arm",per_arm:30,rationale:"Invented comparison, not a sample-size recommendation"},{id:"large",label:"Demo: 60 per arm",per_arm:60,rationale:"Invented recruitment-burden alternative"}],
    scenarios: [{id:"plateau",label:"Synthetic plateau",response:[.3,.32],adverse_event:[.12,.25],adverse_event_penalty:.7,maximum_adverse_event_rate:.35,rationale:"Invented values; not estimated from the PDF",provenance:"user_declared_hypothetical"},
      {id:"unsafe",label:"Synthetic both unsafe",response:[.3,.4],adverse_event:[.6,.7],adverse_event_penalty:.7,maximum_adverse_event_rate:.35,rationale:"Invented stress test of abstention",provenance:"user_declared_hypothetical"}], seed:42,repetitions:1000 }, review, source);
  const args = {origin:"http://127.0.0.1:5173",consent:true,brief,review,source,pdf:new Blob([bytes]),attachments:{agentRaw,aiRaw:null,context:null},signal:AbortSignal.timeout(60000),fetcher:(url,options)=>fetch(new URL(url,"http://127.0.0.1:5173"),options)};
  const result = await executeLocalDesign(args);
  assert.equal(result.simulations.length,4); assert.equal(result.ai,null); assert.equal(result.raw.model_calls,0);
  let meeting = recordNote(newMeeting(result), result, "statistics", {status:"FOLLOW_UP",answer:"Synthetic meeting note, no expert contacted",owner:"Demo participant (fictional)",nextAction:"Independent statistical review is still required",reason:"Demonstrate a traceable open action"});
  const packet = packetJson(result, meeting), reopened = await restorePacket(packet, restored, source);
  assert.equal(reopened.result.reportKey,result.reportKey); assert.deepEqual(reopened.notes,meeting);
  const held = decide(review,source,review.rows[0].id,"dose","held",review.rows[0].fields.dose.current,"SYNTHETIC TEST: explicitly withhold this observation",null,false);
  const blockedBrief = {...brief,review_content_digest:await digest(canonical(exportReview(held,source)))};
  const blocked = await executeLocalDesign({...args,review:held,brief:blockedBrief,signal:AbortSignal.timeout(60000)});
  assert.equal(blocked.status,"BLOCKED_EVIDENCE_LINK");assert.equal(blocked.simulations.length,0);
  save("source-export.json",sourcePacket);save("original-agent.json",agentRaw);save("review.json",exportReview(review,source));save("design-brief.json",brief);
  save("report.json",result.raw);save("meeting.json",packet);save("meeting.md",packetMarkdown(result,meeting));
  save("held-review.json",exportReview(held,source));save("held-brief.json",blockedBrief);save("held-report.json",blocked.raw);
  const page = await pdf.getPage(1), viewport = page.getViewport({scale:1.3}), canvas = createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
  await page.render({canvas:null,canvasContext:canvas.getContext("2d"),viewport}).promise;
  writeFileSync(join(folder,"synthetic-pdf-qa.png"),canvas.toBuffer("image/png"),{mode:0o600,flag:"wx"});
  save("workflow-check.json",{mode:"SYNTHETIC_SCRIPTED_NOT_CLINICAL",real_pdf_parsed:true,pdf_pages:pages.length,source_observations:observations.length,
    restored_review:true,local_http_roundtrip:true,simulations:result.simulations.length,kol_questions:result.questions.length,meeting_roundtrip:true,held_blocks_simulation:true,model_calls:0,browser_interaction_tested:false});
  console.log(JSON.stringify({folder,source_observations:observations.length,simulations:result.simulations.length,kol_questions:result.questions.length,held_blocks_simulation:true,model_calls:0}));
} finally { await task.destroy(); }
