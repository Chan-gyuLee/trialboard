import test from "node:test";
import assert from "node:assert/strict";
import { guardSessionExit } from "../src/session-exit.ts";

function exitEvent() {
  const event = new Event("beforeunload", { cancelable: true });
  // Node's Event.returnValue differs from a browser BeforeUnloadEvent.
  Object.defineProperty(event, "returnValue", { value: "initial", writable: true });
  return event;
}

test("loaded session requests an exit warning, without canceling ordinary events", () => {
  const target = new EventTarget();
  const cleanup = guardSessionExit(target);
  const event = exitEvent();
  assert.equal(target.dispatchEvent(event), false);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, "");
  assert.equal(target.dispatchEvent(new Event("visibilitychange", { cancelable: true })), true);
  cleanup();
});

test("clear/unmount removes warning and repeated mount does not retain old handlers", () => {
  const target = new EventTarget();
  const cleanup = guardSessionExit(target);
  cleanup(); cleanup();
  assert.equal(target.dispatchEvent(exitEvent()), true);
  const nextCleanup = guardSessionExit(target);
  assert.equal(target.dispatchEvent(exitEvent()), false);
  nextCleanup();
  assert.equal(target.dispatchEvent(exitEvent()), true);
});
