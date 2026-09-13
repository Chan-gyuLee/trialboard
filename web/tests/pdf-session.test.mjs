import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openPdfSession } from "../src/pdf-session.ts";
const file = () => new File(["%PDF-1.7\nfixture"], "name.pdf");
function fixture() {
  let destroyed = 0, received;
  const task = { destroy: async () => { destroyed++; } };
  task.promise = Promise.resolve({ numPages: 1, loadingTask: task, getPage: async () => ({
    getViewport: () => ({ width: 100, height: 100, rotation: 0, transform: [1, 0, 0, -1, 0, 100] }),
    getTextContent: async () => ({ items: [], styles: {} }), cleanup() {},
  }) });
  return { task, create: args => { received = args; return task; }, get destroyed() { return destroyed; }, get received() { return received; } };
}
test("session hashes original bytes, has no source URL and releases owned worker", async () => {
  const f = fixture(), input = file();
  const loaded = await openPdfSession(input, new AbortController().signal, () => {}, f.create, "test");
  assert.equal(loaded.source.sha256, createHash("sha256").update(new Uint8Array(await input.arrayBuffer())).digest("hex"));
  assert.equal(loaded.source.status, "NO_TEXT"); assert.equal(f.destroyed, 0);
  assert.equal(f.received.url, undefined); assert.equal(f.received.enableXfa, false);
  assert.equal(f.received.cMapUrl, "/pdf-assets/cmaps/");
  await loaded.destroy(); assert.equal(f.destroyed, 1);
});
test("oversized and malformed files never start parser", async () => {
  const f = fixture();
  await assert.rejects(openPdfSession({ size: 6000000 }, new AbortController().signal, () => {}, f.create, "test"));
  await assert.rejects(openPdfSession(new File(["no"], "fake.pdf"), new AbortController().signal, () => {}, f.create, "test"));
  assert.equal(f.received, undefined);
});
test("cancel before reading never creates a worker", async () => {
  const f = fixture(), c = new AbortController(); c.abort();
  await assert.rejects(openPdfSession(file(), c.signal, () => {}, f.create, "test"), { name: "AbortError" });
  assert.equal(f.received, undefined);
});
test("in-flight cancellation destroys worker and rejects, never publishing a result", async () => {
  const f = fixture(), c = new AbortController();
  f.task.promise = new Promise(() => {});
  const pending = openPdfSession(file(), c.signal, () => {}, args => { const task = f.create(args); queueMicrotask(() => c.abort()); return task; }, "test");
  await assert.rejects(pending, { name: "AbortError" }); assert.ok(f.destroyed >= 1);
});
test("deadline destroys stalled parser", async () => {
  const f = fixture(); f.task.promise = new Promise(() => {});
  await assert.rejects(openPdfSession(file(), new AbortController().signal, () => {}, f.create, "test", 50), /제한 시간/);
  assert.ok(f.destroyed >= 1);
});
test("late file read after deadline cannot create a new worker", async () => {
  const f = fixture(); let finish;
  const input = { size: 10, name: "late.pdf", arrayBuffer: () => new Promise(resolve => { finish = resolve; }) };
  await assert.rejects(openPdfSession(input, new AbortController().signal, () => {}, f.create, "test", 10));
  finish(await file().arrayBuffer()); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.received, undefined);
});
for (const name of ["PasswordException", "InvalidPDFException", "UnknownErrorException"]) {
  test(`${name} cleans up and never leaks parser error text`, async () => {
    const f = fixture();
    const create = args => { const task = f.create(args); task.promise = Promise.reject(Object.assign(new Error("SECRET DOCUMENT CONTENT"), { name })); return task; };
    await assert.rejects(openPdfSession(file(), new AbortController().signal, () => {}, create, "test"), e => !e.message.includes("SECRET"));
    assert.ok(f.destroyed >= 1);
  });
}
