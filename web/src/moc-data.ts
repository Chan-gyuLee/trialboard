/** Public, invented demo fixtures only. Never infer synthetic provenance from a filename. */
export const MOC_FILES = {
  "SYNTHETIC-DEMO-NOT-CLINICAL.pdf": "a3d85c77f31193e04eef53b891d4e51a57e24ea23ba64bf4b342a7b9169d09a1",
  "original-agent.json": "1e33ee7fe9fd2f1fd66ccc23e7facfea7881ffca8ab1c57b272b9afa6a29703b",
  "review.json": "47129162a25e4ce45ea894622715f7df8fcdce69ec1f46faa417177d7d910585",
  "design-brief.json": "5cbe81dfe73c36f1b30ca4744f1af83003094fc41494084d2b00ff44ac8d8921",
} as const;
export type MocFile = keyof typeof MOC_FILES;
export const isMocSource = (source: { sha256: string } | null | undefined) =>
  source?.sha256 === MOC_FILES["SYNTHETIC-DEMO-NOT-CLINICAL.pdf"];
export async function loadMocFile(name: MocFile, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<File> {
  if (!Object.hasOwn(MOC_FILES, name)) throw new Error("등록되지 않은 MOC 예제입니다.");
  const response = await fetcher(`/data/moc/${name}`, { signal, redirect: "error" });
  if (!response.ok) throw new Error("MOC 예제를 불러오지 못했습니다.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2_000_000) throw new Error("MOC 예제 크기를 초과했습니다.");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== MOC_FILES[name]) throw new Error("MOC 예제 파일이 변경되었습니다. 불러오기를 중단합니다.");
  return new File([bytes], name, { type: name.endsWith(".pdf") ? "application/pdf" : "application/json" });
}
