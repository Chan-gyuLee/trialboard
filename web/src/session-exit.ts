/** Best-effort browser exit warning; never persists or transmits document contents. */
export function guardSessionExit(target: EventTarget): () => void {
  const warn = (event: Event) => {
    event.preventDefault();
    // Legacy browser support. The browser chooses its own warning text.
    (event as BeforeUnloadEvent).returnValue = "";
  };
  target.addEventListener("beforeunload", warn);
  return () => target.removeEventListener("beforeunload", warn);
}
