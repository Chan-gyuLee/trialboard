import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PDF_LIMITS, validatePdfBytes, textBox, sourceStatus, attestSpan, evidenceExport, evidenceMarkdown } from "../src/pdf-contract.ts";
import { extractPages } from "../src/pdf-extract.ts";

const item = { str: "Dose comparison", transform: [10, 0, 0, 10, 20, 70], width: 40, dir: "ltr", fontName: "F1" };
const view = { width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100], rotation: 0 };
const box = textBox(item, { ascent: .8 }, view);
const source = { schemaVersion: "pdf-evidence/1", name: "source.pdf", sha256: "a".repeat(64), byteLength: 100,
  extractor: "test", status: "TEXT_EXTRACTED", coordinateSystem: "normalized_top_left_rotated_viewport",
  pages: [{ number: 1, width: 100, height: 100, rotation: 0, status: "TEXT_EXTRACTED", spans: [{ id: "p1-i0", item: 0, page: 1, text: item.str, box }] }] };
const note = () => attestSpan(source, "p1-i0", "Compare?", "Needs context", true, new Date("2026-09-13T00:00:00Z"));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("PDF signature and byte budget enforced before parser", () => {
  validatePdfBytes(new TextEncoder().encode("%PDF-1.7\n"));
  assert.throws(() => validatePdfBytes(new Uint8Array()));
  assert.throws(() => validatePdfBytes(new TextEncoder().encode("not PDF")));
  const bytes = new Uint8Array(PDF_LIMITS.bytes + 1); bytes.set(new TextEncoder().encode("%PDF-"));
  assert.throws(() => validatePdfBytes(bytes));
});
test("font-metric geometry transforms bottom-left into normalized top-left", () => {
  close(box.x, .2); close(box.y, .22); close(box.width, .4); close(box.height, .1);
});
test("rotated pages use rendered viewport coordinates", () => {
  const rotated = textBox(item, { ascent: .8 }, { ...view, transform: [0, 1, 1, 0, 0, 0] });
  close(rotated.x, .68); close(rotated.y, .2); close(rotated.width, .1); close(rotated.height, .4);
  const rotated180 = textBox(item, { ascent: .8 }, { ...view, transform: [-1, 0, 0, 1, 100, 0] });
  close(rotated180.x, .4); close(rotated180.y, .68);
});
test("crop-box translation and viewport scaling preserve locators", () => {
  const cropped = textBox(item, { ascent: .8 }, { width: 160, height: 160, transform: [2, 0, 0, -2, -20, 180] });
  close(cropped.x, .125); close(cropped.y, .15); close(cropped.width, .5);
});
for (const [name, changed, style] of [
  ["vertical", {}, { vertical: true }], ["rtl", { dir: "rtl" }, {}], ["zero width", { width: 0 }, {}],
  ["NaN", { width: NaN }, {}], ["off page", { transform: [10, 0, 0, 10, -30, 70] }, {}],
  ["skew", { transform: [10, 0, 2, 10, 20, 70] }, {}], ["invalid ascent", {}, { ascent: Infinity }],
]) test(`unsupported geometry ${name} cannot create a false highlight`, () => assert.equal(textBox({ ...item, ...changed }, style, view), null));
test("missing text is distinct from absence of clinical evidence", () => {
  assert.equal(sourceStatus([{ status: "NO_TEXT" }]), "NO_TEXT");
  assert.equal(sourceStatus([{ status: "NO_TEXT" }, { status: "TEXT_EXTRACTED" }]), "PARTIAL_NO_TEXT");
  assert.throws(() => sourceStatus([]));
});
test("attestation requires a present source location and explicit user confirmation", () => {
  assert.throws(() => attestSpan(source, "missing", "Q", "", true));
  assert.throws(() => attestSpan(source, "p1-i0", "Q", "", false));
  assert.throws(() => attestSpan(source, "p1-i0", " ", "", true));
  assert.throws(() => attestSpan(source, "p1-i0", "Q", "x".repeat(2001), true));
  assert.equal(note().meaningStatus, "NOT_ASSESSED");
  assert.equal(note().quote, item.str);
});
test("export rejects changed source, page, quote, box, status and duplicate notes", () => {
  for (const change of [{ sourceDigest: "b".repeat(64) }, { page: 2 }, { quote: "different" }, { box: { ...box, x: 0 } }, { meaningStatus: "APPROVED" }, { locationStatus: "AUTO_VERIFIED" }]) {
    assert.throws(() => evidenceExport(source, [{ ...note(), ...change }]));
  }
  assert.throws(() => evidenceExport(source, [note(), note()]));
  assert.equal(evidenceExport(source, [note()]).persisted, false);
});
test("Markdown export escapes untrusted PDF and reviewer text", () => {
  const s = structuredClone(source); s.name = "# fake<script>.pdf"; s.pages[0].spans[0].text = "[click](https://evil.test) <script>";
  const n = attestSpan(s, "p1-i0", "# title", "![x](https://evil.test)", true);
  const md = evidenceMarkdown(s, [n]);
  assert.ok(!md.includes("<script>")); assert.ok(md.includes("\\[click\\]"));
  assert.ok(md.includes(s.sha256)); assert.ok(md.includes("NOT_ASSESSED") === false);
  assert.ok(md.includes("임상적 판단 또는 전문가 승인 문서가 아닙니다"));
});

const fakePage = (items = [item]) => ({ getViewport: () => view, getTextContent: async () => ({ items, styles: { F1: { ascent: .8 } } }), cleanup() {} });
test("extraction retains exact item text, item indices and blank-page coverage", async () => {
  const pdf = { numPages: 2, getPage: async n => fakePage(n === 1 ? [{ type: "beginMarkedContent" }, item] : []) };
  const progress = [];
  const pages = await extractPages(pdf, n => progress.push(n));
  assert.deepEqual(progress, [1,2]); assert.equal(pages[0].spans[0].id, "p1-i1");
  assert.equal(pages[0].spans[0].text, item.str); assert.equal(pages[1].status, "NO_TEXT");
});
test("too many pages rejected before reading and cancellation stops extraction", async () => {
  await assert.rejects(extractPages({ numPages: 41, getPage() { assert.fail("should not read"); } }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(extractPages({ numPages: 1 }, () => {}, controller.signal), { name: "AbortError" });
});
test("character and item limits reject partial documents rather than truncating silently", async () => {
  await assert.rejects(extractPages({ numPages: 1, getPage: async () => fakePage([{ ...item, str: "x".repeat(PDF_LIMITS.characters + 1) }]) }));
  await assert.rejects(extractPages({ numPages: 1, getPage: async () => fakePage(Array(PDF_LIMITS.items + 1).fill({ ...item, str: "" })) }));
});
for (const [hash, anchor, page] of [
  ["2a8afcae85c9e37576979af49571a1f87a2baa00aff6c4f43270b00ec20da9d9", "960", 4],
  ["13b25858865d8b26db65f51cfa05eaaeed69094a7bc33099b75e5d16d248d0e3", "dosage", 9],
]) {
  const path = new URL(`../../data/snapshots/${hash}.pdf`, import.meta.url);
  test(`real pinned FDA PDF extracts text and on-page bounds (${hash.slice(0,8)})`, { skip: !existsSync(path) }, async () => {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = new Uint8Array(readFileSync(path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    const task = getDocument({ data: bytes, stopAtErrors: true, useSystemFonts: false, verbosity: 0,
      standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)) });
    try {
      const pdf = await task.promise;
      const pages = await extractPages(pdf);
      assert.equal(pages.length, pdf.numPages);
      const spans = pages[page - 1].spans;
      assert.ok(spans.some(s => s.text.toLowerCase().includes(anchor) && s.box));
      assert.ok(spans.every(s => !s.box || s.box.y >= 0 && s.box.y + s.box.height <= 1));
    } finally { await task.destroy(); }
  });
}
