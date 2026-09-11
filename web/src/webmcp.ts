type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
export type ModelContext = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

export function parseEvidenceId(input: unknown, validIds: string[]): string {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected an object");
  const data = input as Record<string, unknown>;
  if (
    Object.keys(data).length !== 1 ||
    typeof data.evidenceId !== "string" ||
    !validIds.includes(data.evidenceId)
  ) {
    throw new Error(
      "A known evidenceId is required; additional fields are not allowed",
    );
  }
  return data.evidenceId;
}

export function installEvidenceTools(
  context: ModelContext | undefined,
  ids: string[],
  read: (id: string) => unknown,
  show: (id: string) => void,
): () => void {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const inputSchema = {
    type: "object",
    properties: { evidenceId: { type: "string", enum: ids } },
    required: ["evidenceId"],
    additionalProperties: false,
  };
  const tools: Tool[] = [
    {
      name: "read_trialboard_evidence",
      title: "Read source-bound evidence",
      description:
        "Read a developer-curated public-source excerpt, its scope, and interpretation limits. Does not assert expert verification.",
      inputSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => read(parseEvidenceId(input, ids)),
    },
    {
      name: "show_trialboard_evidence",
      title: "Open evidence in workspace",
      description:
        "Navigate to the evidence tab and select an existing source excerpt. Does not run an analysis or change evidence.",
      inputSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => {
        const id = parseEvidenceId(input, ids);
        show(id);
        return { selectedEvidenceId: id, tab: "evidence" };
      },
    },
  ];
  for (const tool of tools) {
    try {
      Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Unsupported experimental registry must not break the normal interface. */
    }
  }
  return () => lifecycle.abort();
}
