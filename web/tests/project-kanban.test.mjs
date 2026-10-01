import test from "node:test";
import assert from "node:assert/strict";
import {kanbanColumn, groupIntoKanban, KANBAN_COLUMNS} from "../src/project-kanban.ts";

function receipt(overrides = {}) {
  return {
    project_id: "p1",
    revision: 1,
    title: "T",
    created_at: "2026-01-01T00:00:00Z",
    pdf_digest: "a".repeat(64),
    bundle_digest: "b".repeat(64),
    ...overrides,
  };
}

test("no session: everything is ready regardless of usage policy", () => {
  assert.equal(kanbanColumn(receipt(), false), "ready");
  assert.equal(kanbanColumn(receipt({usage_policy: {original_storage: "DENY"}}), false), "ready");
});

test("session with ALLOW storage is ready", () => {
  assert.equal(kanbanColumn(receipt({usage_policy: {original_storage: "ALLOW"}}), true), "ready");
});

test("session with DENY storage is restricted", () => {
  assert.equal(kanbanColumn(receipt({usage_policy: {original_storage: "DENY"}}), true), "restricted");
});

test("session with UNKNOWN or missing policy needs check", () => {
  assert.equal(kanbanColumn(receipt({usage_policy: {original_storage: "UNKNOWN"}}), true), "needs_check");
  assert.equal(kanbanColumn(receipt(), true), "needs_check");
});

test("groupIntoKanban covers every column exactly once per row, in a stable order", () => {
  const rows = [
    receipt({project_id: "a", usage_policy: {original_storage: "ALLOW"}}),
    receipt({project_id: "b", usage_policy: {original_storage: "DENY"}}),
    receipt({project_id: "c", usage_policy: {original_storage: "UNKNOWN"}}),
  ];
  const groups = groupIntoKanban(rows, true);
  assert.deepEqual(groups.map(g => g.key), KANBAN_COLUMNS.map(c => c.key));
  assert.equal(groups.find(g => g.key === "ready").items.length, 1);
  assert.equal(groups.find(g => g.key === "restricted").items.length, 1);
  assert.equal(groups.find(g => g.key === "needs_check").items.length, 1);
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  assert.equal(total, rows.length);
});

test("groupIntoKanban never drops or duplicates a row", () => {
  const rows = Array.from({length: 5}, (_, i) => receipt({project_id: `p${i}`, revision: i}));
  const groups = groupIntoKanban(rows, false);
  const seen = groups.flatMap(g => g.items.map(r => `${r.project_id}:${r.revision}`));
  assert.equal(new Set(seen).size, rows.length);
});

test("empty input yields all columns present with empty item lists", () => {
  const groups = groupIntoKanban([], true);
  assert.equal(groups.length, KANBAN_COLUMNS.length);
  assert.ok(groups.every(g => g.items.length === 0));
});
