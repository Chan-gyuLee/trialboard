import test from "node:test";
import assert from "node:assert/strict";
import { installEvidenceTools, parseEvidenceId } from "../src/webmcp.ts";

test("tool IDs are validated with no state change for invalid inputs", () => {
  for (const value of [
    null,
    [],
    {},
    { evidenceId: "bad" },
    { evidenceId: "known", extra: true },
  ]) {
    assert.throws(() => parseEvidenceId(value, ["known"]));
  }
  assert.equal(parseEvidenceId({ evidenceId: "known" }, ["known"]), "known");
});

test("mock registry contract: read, navigate, abort", () => {
  const registered = [];
  let selected = null;
  const cleanup = installEvidenceTools(
    { registerTool: (tool, options) => registered.push({ tool, options }) },
    ["known"],
    (id) => ({ id, status: "not_expert_verified" }),
    (id) => {
      selected = id;
    },
  );
  assert.equal(registered.length, 2);
  assert.equal(registered[0].tool.annotations.readOnlyHint, true);
  assert.equal(registered[1].tool.annotations.readOnlyHint, false);
  assert.deepEqual(registered[0].tool.execute({ evidenceId: "known" }), {
    id: "known",
    status: "not_expert_verified",
  });
  assert.equal(selected, null);
  assert.throws(() => registered[1].tool.execute({ evidenceId: "bad" }));
  assert.equal(selected, null);
  registered[1].tool.execute({ evidenceId: "known" });
  assert.equal(selected, "known");
  cleanup();
  assert.ok(registered.every((r) => r.options.signal.aborted));
});

test("missing browser registry is supported", () => {
  assert.doesNotThrow(() =>
    installEvidenceTools(
      undefined,
      [],
      () => {},
      () => {},
    )(),
  );
});
