/** Bounded, deterministic checks of a submitted aggregate table. No clinical inference. */
export const MAX_BYTES = 262144;
export const HEADERS = ["asset", "indication", "study", "dose", "metric", "events", "total", "population", "window", "definition"] as const;
export const METRICS = { response: "반응", adverse_event: "이상반응", dose_reduction: "감량", discontinuation: "중단" } as const;
export type Metric = keyof typeof METRICS;
export const metricLabel = (value: string): string => Object.hasOwn(METRICS, value) ? METRICS[value as Metric] : value;
export type Question = "compare" | "safety" | "brief";
export const QUESTIONS: { id: Question; title: string; description: string }[] = [
  { id: "compare", title: "두 용량의 결과를 같은 기준으로 비교할 수 있나?", description: "분모, 평가집단, 관찰기간과 평가 정의를 대조합니다." },
  { id: "safety", title: "안전성 검토를 위해 어떤 자료를 더 확인해야 하나?", description: "이상반응·감량·중단 요약의 제출 여부와 불일치를 확인합니다." },
  { id: "brief", title: "개발 회의 전에 무엇부터 확인해야 하나?", description: "표의 오류와 추가 확인 항목을 회의용 기록으로 정리합니다." },
];
export type Row = Record<typeof HEADERS[number], string> & { line: number; raw: string };
export type Table = { name: string; text: string; digest: string; rows: Row[]; origin: "synthetic_example" | "user_file" };
export type Finding = { id: string; level: "issue" | "missing"; title: string; reason: string; action: string; owner: string; lines: number[]; metric?: Metric };
export type IntakeReport = {
  schema: "table-review/0.1"; sourceDigest: string; question: Question;
  findings: Finding[]; validLines: number[]; notAssessed: string[];
  status: "FOLLOW_UP_REQUIRED" | "TABLE_CHECKS_PASSED";
};

/** Quoted CSV with physical source line tracking. Reject malformed or oversized input. */
export function parseCSV(text: string): Row[] {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("파일은 256 KB 이하로 준비해 주세요.");
  const input = text.replace(/^\uFEFF/, "");
  if (input.includes("\0")) throw new Error("텍스트 CSV 파일이 아닙니다.");
  const records: { cells: string[]; line: number; raw: string }[] = [];
  let cells: string[] = [], cell = "", line = 1, startLine = 1, start = 0;
  let quoted = false, closed = false;
  const endCell = () => { cells.push(cell.trim()); cell = ""; closed = false; };
  const endRow = (end: number) => {
    endCell();
    if (cells.some(Boolean)) records.push({ cells, line: startLine, raw: input.slice(start, end) });
    cells = [];
    if (records.length > 501) throw new Error("최대 500개 데이터 행을 지원합니다.");
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else { cell += c; if (c === "\n" || (c === "\r" && input[i + 1] !== "\n")) line++; }
      continue;
    }
    if (c === '"') {
      if (cell || closed) throw new Error(`${line}행: 따옴표 형식이 잘못되었습니다.`);
      quoted = true;
    } else if (c === ",") endCell();
    else if (c === "\n" || c === "\r") {
      endRow(i);
      if (c === "\r" && input[i + 1] === "\n") i++;
      line++; startLine = line; start = i + 1;
    } else {
      if (closed) throw new Error(`${line}행: 닫는 따옴표 뒤에 쉼표가 필요합니다.`);
      cell += c;
    }
    if (cell.length > 2000) throw new Error(`${line}행: 한 셀은 2,000자를 넘을 수 없습니다.`);
  }
  if (quoted) throw new Error("닫히지 않은 따옴표가 있습니다.");
  if (cell || cells.length || closed) endRow(input.length);
  const header = records.shift()?.cells;
  if (!header || header.length !== HEADERS.length || new Set(header).size !== header.length || HEADERS.some(h => !header.includes(h)))
    throw new Error(`양식의 열 이름을 사용해 주세요: ${HEADERS.join(", ")}`);
  if (!records.length) throw new Error("열 이름 아래에 용량별 요약 자료를 넣어 주세요.");
  return records.map(record => {
    if (record.cells.length !== header.length) throw new Error(`${record.line}행: 열 개수가 맞지 않습니다.`);
    if (record.cells.some(c => c.length > 2000)) throw new Error(`${record.line}행: 셀 길이 제한을 넘었습니다.`);
    return { ...Object.fromEntries(header.map((h, i) => [h, record.cells[i]])), line: record.line, raw: record.raw } as Row;
  });
}
export async function digestText(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export async function prepareTable(text: string, name: string, origin: Table["origin"]): Promise<Table> {
  const rows = parseCSV(text);
  return { name: name.slice(0, 180), text, rows, digest: await digestText(text), origin };
}
export function numeric(row: Row): { events: number; total: number } | null {
  if (!/^\d+$/.test(row.events) || !/^\d+$/.test(row.total)) return null;
  const events = Number(row.events), total = Number(row.total);
  return Number.isSafeInteger(events) && Number.isSafeInteger(total) && total > 0 && events <= total ? { events, total } : null;
}
export function reviewTable(table: Table, question: Question): IntakeReport {
  if (!QUESTIONS.some(q => q.id === question)) throw new Error("검토할 질문을 선택해 주세요.");
  const findings: Finding[] = [];
  const invalid = new Set<number>();
  const add = (f: Omit<Finding, "id">) => findings.push({ ...f, id: `finding-${findings.length + 1}` });
  for (const row of table.rows) {
    const missing = HEADERS.filter(h => !row[h]);
    if (missing.length) { invalid.add(row.line); add({ level: "missing", title: `${row.line}행의 필수 정보가 비어 있습니다`, reason: `미입력 열: ${missing.join(", ")}`, action: "원본 요약표에서 빈 필드를 확인하고 다시 제출하세요. 빈 값은 0으로 해석하지 않습니다.", owner: "자료 담당자", lines: [row.line] }); }
    if (!(Object.hasOwn(METRICS, row.metric))) { invalid.add(row.line); add({ level: "issue", title: `${row.line}행의 평가 항목을 읽을 수 없습니다`, reason: `지원 항목: ${Object.keys(METRICS).join(", ")}`, action: "지원하는 평가 항목으로 분류하세요. 다른 지표는 이 검토의 범위에 포함되지 않습니다.", owner: "자료 담당자", lines: [row.line] }); }
    if (!numeric(row)) { invalid.add(row.line); add({ level: "issue", title: `${row.line}행의 사건 수·분모를 확인하세요`, reason: "사건 수와 분모는 정수여야 하며, 분모는 0보다 크고 사건 수 이상이어야 합니다.", action: "원본 집계와 사건 수·분모를 대조해 수정하세요. 현재 행의 비율은 계산하지 않습니다.", owner: "자료 담당자", lines: [row.line] }); }
  }
  // Never pool different assets, indications, or studies, even if dose labels match.
  const contexts = new Set(table.rows.map(r => JSON.stringify([r.asset, r.indication, r.study])));
  if (contexts.size > 1) add({ level: "issue", title: "후보물질·적응증·시험이 섞여 있습니다", reason: "이 검토는 한 후보물질·적응증·시험 내의 자료만 대조합니다.", action: "파일을 같은 시험의 자료로 나누세요. 서로 다른 시험의 결과를 합치지 않았습니다.", owner: "임상 개발 담당자", lines: table.rows.map(r => r.line) });
  const doses = [...new Set(table.rows.map(r => r.dose).filter(Boolean))];
  if (doses.length < 2) add({ level: "missing", title: "비교할 두 번째 용량의 자료가 없습니다", reason: `제출된 용량: ${doses.join(", ") || "없음"}`, action: "다른 용량의 요약을 추가하거나 단일 용량 자료라는 범위를 명시하세요.", owner: "임상 개발 담당자", lines: [] });
  for (const metric of Object.keys(METRICS) as Metric[]) {
    if (question === "compare" && !["response", "adverse_event"].includes(metric)) continue;
    if (question === "safety" && metric === "response") continue;
    for (const dose of doses) {
      const rows = table.rows.filter(r => r.dose === dose && r.metric === metric);
      if (!rows.length) add({ level: "missing", title: `${dose}의 ${METRICS[metric]} 요약이 없습니다`, reason: "제출된 표에 해당 항목이 없습니다. 사건이 없다는 뜻은 아닙니다.", action: "사건 수, 평가 분모, 환자군, 관찰기간과 정의를 포함한 요약을 확인하세요.", owner: metric === "response" ? "임상 개발 담당자" : "안전성 담당자", lines: [], metric });
      if (rows.length > 1) {
        rows.forEach(r => invalid.add(r.line));
        add({ level: "issue", title: `${dose}의 ${METRICS[metric]} 행이 여러 개입니다`, reason: "상충·중복·서로 다른 분석집단일 수 있습니다. 자동으로 합산하지 않았습니다.", action: "같은 집계인지 원자료에서 확인하고 분석집단별로 나누세요.", owner: "자료 담당자", lines: rows.map(r => r.line), metric });
      }
    }
    const rows = table.rows.filter(r => r.metric === metric && !invalid.has(r.line));
    if (contexts.size === 1 && rows.length >= 2) {
      for (const [field, label] of [["population", "평가집단"], ["window", "관찰기간"], ["definition", "평가 정의"]] as const) {
        if (new Set(rows.map(r => r[field])).size > 1) add({ level: "issue", title: `${METRICS[metric]}의 ${label}이 일치하지 않습니다`, reason: rows.map(r => `${r.dose}: ${r[field]} (${r.line}행)`).join(" / "), action: "같은 기준인지 확인하거나 기준을 맞춘 집계를 요청하세요. 문구가 다른 경우 동의어인지 사람의 확인이 필요합니다.", owner: "임상·통계 담당자", lines: rows.map(r => r.line), metric });
      }
    }
  }
  return { schema: "table-review/0.1", sourceDigest: table.digest, question, findings,
    validLines: table.rows.filter(r => !invalid.has(r.line)).map(r => r.line),
    status: findings.length ? "FOLLOW_UP_REQUIRED" : "TABLE_CHECKS_PASSED",
    notAssessed: ["원본 임상 문서와의 일치·입력 수치의 진위", "PK/PD·노출–반응과 장기 내약성", "환자 수준 중복·추적 탈락·시험의 편향", "권장 용량·권장 표본수·규제 적합성"],
  };
}
export const EXAMPLE = HEADERS.join(",") + "\n" + [
  "DEMO-01,합성 적응증,DEMO-STUDY,용량 A,response,6,20,전체 평가집단,12주,확인된 반응",
  "DEMO-01,합성 적응증,DEMO-STUDY,용량 B,response,7,20,전체 평가집단,8주,확인된 반응",
  "DEMO-01,합성 적응증,DEMO-STUDY,용량 A,adverse_event,2,20,안전성 집단,12주,3등급 이상 이상반응",
  "DEMO-01,합성 적응증,DEMO-STUDY,용량 B,adverse_event,5,20,안전성 집단,12주,3등급 이상 이상반응",
].join("\n") + "\n";

export function intakeMarkdown(table: Table, report: IntakeReport): string {
  const safe = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replace(/[\\`*_[\]{}()#!|]/g, "\\$&").replace(/[\r\n]+/g, " ");
  const question = QUESTIONS.find(q => q.id === report.question)!;
  const lines = ["# TrialBoard 자료 검토 기록", "", `검토 질문: ${question.title}`, "",
    `자료: ${safe(table.name)} · ${table.origin === "synthetic_example" ? "합성 예제" : "사용자 제출 / 진위 미검증"}`,
    `원문 SHA-256: ${table.digest}`, "",
    "이 기록은 제출된 CSV의 규칙 기반 점검입니다. 임상적 타당성·원자료의 진위·권장 용량을 판단하지 않았습니다.", "",
    "## 추가 확인 항목", ""];
  if (!report.findings.length) lines.push("설정된 표 점검에서 불일치를 찾지 못했습니다. 자료 충분성을 뜻하지 않습니다.", "");
  for (const finding of report.findings) lines.push(`### ${safe(finding.title)}`, "",
    safe(finding.reason), "", `- 다음 행동: ${safe(finding.action)}`,
    `- 확인 담당 제안: ${safe(finding.owner)}`,
    `- 원본 위치: ${finding.lines.length ? finding.lines.join(", ") + "행" : "해당 행 없음"}`, "");
  lines.push("## 아직 평가하지 않은 것", "", ...report.notAssessed.map(s => `- ${s}`), "",
    "파일과 검토 기록은 서버에 저장되지 않습니다. 재현하려면 원문·검토 기록 JSON도 보관하세요.", "");
  return lines.join("\n");
}
