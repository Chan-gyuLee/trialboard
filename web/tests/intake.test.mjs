import test from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE, HEADERS, MAX_BYTES, parseCSV, prepareTable, reviewTable, numeric, metricLabel, intakeMarkdown } from "../src/intake.ts";

test("example is actually parsed and finds the mismatched response window at exact source lines", async () => {
  const table = await prepareTable(EXAMPLE, "example.csv", "synthetic_example");
  const report = reviewTable(table, "compare");
  assert.equal(table.rows.length, 4);
  assert.equal(report.findings.length, 1);
  assert.match(report.findings[0].title, /관찰기간/);
  assert.deepEqual(report.findings[0].lines, [2,3]);
  assert.equal(table.rows[0].raw, EXAMPLE.split("\n")[1]);
  assert.equal(report.status, "FOLLOW_UP_REQUIRED");
  assert.equal(report.sourceDigest, table.digest);
});
test("changing the submitted data changes findings; no stored report selection", async () => {
  const table = await prepareTable(EXAMPLE.replace(",8주,", ",12주,"), "fixed.csv", "user_file");
  assert.deepEqual(reviewTable(table, "compare").findings, []);
  assert.equal(reviewTable(table, "compare").status, "TABLE_CHECKS_PASSED");
  assert.equal(reviewTable(table, "compare").notAssessed.length, 4);
  assert.notEqual(table.digest, (await prepareTable(EXAMPLE, "same.csv", "user_file")).digest);
});
test("safety question reports missing reduction and discontinuation, not zero events", async () => {
  const report = reviewTable(await prepareTable(EXAMPLE, "example.csv", "synthetic_example"), "safety");
  assert.equal(report.findings.length, 4);
  assert.ok(report.findings.every(f => f.level === "missing" && !f.lines.length));
  assert.ok(report.findings.every(f => f.reason.includes("사건이 없다는 뜻은 아닙니다")));
});
test("meeting question combines checked inconsistencies and missing summaries", async () => {
  assert.equal(reviewTable(await prepareTable(EXAMPLE, "example.csv", "synthetic_example"), "brief").findings.length, 5);
});
test("same text and question are deterministic; filename never changes source digest", async () => {
  const a = await prepareTable(EXAMPLE, "a.csv", "user_file");
  const b = await prepareTable(EXAMPLE, "b.csv", "user_file");
  assert.equal(a.digest, b.digest);
  assert.deepEqual(reviewTable(a, "brief"), reviewTable(b, "brief"));
});
for (const [events, total] of [["", "20"], ["-1", "20"], ["1.5", "20"], ["21", "20"], ["1", "0"], ["NaN", "20"], ["1", "Infinity"], ["1e1", "20"], ["9007199254740992", "9007199254740992"]]) {
  test(`invalid counts ${events}/${total} are flagged and never converted to a rate`, async () => {
    assert.equal(numeric({ events, total }), null);
    const table = await prepareTable(EXAMPLE.replace(",6,20,", `,${events},${total},`), "counts.csv", "user_file");
    const report = reviewTable(table, "compare");
    assert.ok(report.findings.some(f => f.title.includes("사건 수·분모")));
    assert.ok(!report.validLines.includes(2));
  });
}
test("duplicate rows are flagged and not summed", async () => {
  const table = await prepareTable(EXAMPLE + EXAMPLE.split("\n")[1] + "\n", "duplicate.csv", "user_file");
  const report = reviewTable(table, "compare");
  assert.ok(report.findings.some(f => f.title.includes("행이 여러 개")));
  assert.ok(!report.validLines.includes(2));
  assert.ok(!report.validLines.includes(6));
});
test("different trials are never pooled or treated as comparable", async () => {
  const table = await prepareTable(EXAMPLE.replace("DEMO-STUDY,용량 B", "OTHER-STUDY,용량 B"), "mixed.csv", "user_file");
  const report = reviewTable(table, "compare");
  assert.ok(report.findings.some(f => f.title.includes("시험이 섞여")));
  assert.ok(!report.findings.some(f => f.title.includes("관찰기간")));
});
test("single-dose and absent endpoint are visible missingness", async () => {
  const text = HEADERS.join(",") + "\n" + EXAMPLE.split("\n")[1];
  const report = reviewTable(await prepareTable(text, "single.csv", "user_file"), "compare");
  assert.ok(report.findings.some(f => f.title.includes("두 번째 용량")));
  assert.ok(report.findings.some(f => f.title.includes("이상반응 요약")));
});
test("UTF-8 BOM, CRLF and quoted commas preserve physical locators", () => {
  const text = "\uFEFF" + EXAMPLE.replace("확인된 반응", '"확인된, 반응"').replaceAll("\n", "\r\n");
  const rows = parseCSV(text);
  assert.equal(rows[0].definition, "확인된, 반응");
  assert.equal(rows[1].line, 3);
  assert.ok(rows[0].raw.endsWith('"확인된, 반응"'));
});
test("multiline escaped quotes preserve source start line", () => {
  const rows = parseCSV(EXAMPLE.replace("확인된 반응", '"확인된\n""반응"""'));
  assert.equal(rows[0].definition, '확인된\n"반응"');
  assert.equal(rows[1].line, 4);
});
for (const [name, text] of [
  ["empty", ""], ["headers only", HEADERS.join(",")], ["bad headers", EXAMPLE.replace("asset", "other")],
  ["unclosed quotes", EXAMPLE + '"bad'], ["short row", EXAMPLE + "one,two"],
  ["binary", EXAMPLE + "\0"], ["oversized", "x".repeat(MAX_BYTES + 1)],
  ["bad suffix", EXAMPLE.replace("DEMO-01", '"DEMO"junk')],
  ["duplicate header", EXAMPLE.replace("asset", "study")],
  ["large cell", EXAMPLE.replace("DEMO-01", "x".repeat(2001))],
]) test(`malformed ${name} rejected before review`, () => assert.throws(() => parseCSV(text)));
test("500 row bound is enforced", () => {
  const row = EXAMPLE.split("\n")[1];
  assert.equal(parseCSV(HEADERS.join(",") + "\n" + Array(500).fill(row).join("\n")).length, 500);
  assert.throws(() => parseCSV(HEADERS.join(",") + "\n" + Array(501).fill(row).join("\n")));
});
test("unknown metric and prototype property names remain plain untrusted strings", async () => {
  for (const value of ["__proto__", "constructor", "<script>alert(1)</script>"]) {
    assert.equal(metricLabel(value), value);
    const table = await prepareTable(EXAMPLE.replace("response", value), "metric.csv", "user_file");
    assert.ok(reviewTable(table, "compare").findings.some(f => f.title.includes("읽을 수 없습니다")));
  }
});
test("invalid questions cannot be used", async () => {
  const table = await prepareTable(EXAMPLE, "x.csv", "user_file");
  assert.throws(() => reviewTable(table, "prescribe"));
});

test("readable document references the same input and escapes untrusted labels", async () => {
  const table = await prepareTable(EXAMPLE.replaceAll("용량 A", "<script>alert(1)</script>"), "# fake.md", "user_file");
  const report = reviewTable(table, "brief");
  const markdown = intakeMarkdown(table, report);
  assert.ok(markdown.includes(table.digest));
  assert.ok(markdown.includes("다음 행동"));
  assert.ok(markdown.includes("원본 위치"));
  assert.ok(!markdown.includes("<script>"));
  assert.ok(markdown.includes("\\# fake.md"));
});
