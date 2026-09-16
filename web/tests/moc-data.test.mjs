import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOC_FILES, isMocSource, loadMocFile } from "../src/moc-data.ts";

for (const name of Object.keys(MOC_FILES)) test(`MOC fixture verified and returned without reinterpretation: ${name}`, async () => {
  const bytes = readFileSync(new URL(`../public/data/moc/${name}`, import.meta.url));
  const file = await loadMocFile(name, new AbortController().signal, async (url, options) => {
    assert.equal(url, `/data/moc/${name}`); assert.equal(options.redirect, "error");
    return new Response(bytes);
  });
  assert.equal(file.name, name); assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
});
test("synthetic label requires exact known PDF digest, not filename", () => {
  assert.equal(isMocSource({sha256:MOC_FILES["SYNTHETIC-DEMO-NOT-CLINICAL.pdf"]}), true);
  assert.equal(isMocSource({sha256:"f".repeat(64),name:"SYNTHETIC-DEMO-NOT-CLINICAL.pdf"}), false);
  assert.equal(isMocSource(null), false);
});
test("unknown fixture and modified fixture fail closed", async () => {
  await assert.rejects(loadMocFile("../private.json", new AbortController().signal, () => { throw Error("must not fetch"); }), /등록되지/);
  await assert.rejects(loadMocFile("review.json", new AbortController().signal, async () => new Response("{}")), /변경/);
  await assert.rejects(loadMocFile("review.json", new AbortController().signal, async () => new Response(null,{status:404})), /불러오지/);
  await assert.rejects(loadMocFile("review.json", new AbortController().signal, async () => new Response(new Uint8Array(2_000_001))), /크기/);
});
