/** Pure grouping logic for the project card board, kept separate from rendering so it is unit-testable. */
import type {ProjectReceipt} from "./project-checkpoint.ts";

export type KanbanColumnKey = "ready" | "needs_check" | "restricted";

export const KANBAN_COLUMNS: {key: KanbanColumnKey; label: string}[] = [
  {key: "ready", label: "검토 가능"},
  {key: "needs_check", label: "확인 필요"},
  {key: "restricted", label: "접근 제한"},
];

export type KanbanGroup = {key: KanbanColumnKey; label: string; items: ProjectReceipt[]};

/** Mirrors the same `blocked` rule ProjectShelf already uses for the list view (row.usage_policy). */
export function kanbanColumn(row: ProjectReceipt, hasSession: boolean): KanbanColumnKey {
  if (!hasSession) return "ready"; // Local-only mode has no usage-policy gate to confirm.
  const storage = row.usage_policy?.original_storage;
  if (storage === "ALLOW") return "ready";
  if (storage === "DENY") return "restricted";
  return "needs_check"; // UNKNOWN or missing policy
}

export function groupIntoKanban(rows: ProjectReceipt[], hasSession: boolean): KanbanGroup[] {
  return KANBAN_COLUMNS.map(column => ({
    ...column,
    items: rows.filter(row => kanbanColumn(row, hasSession) === column.key),
  }));
}
