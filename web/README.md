# TrialBoard review workspace

React + Material UI + Vite. Node 24 is used for validation; Vite requires Node 20.19+ or 22.12+.

PDF.js 6.3.289 is pinned and requires Node >=22.13 or >=24; use Node 24 for this project.

## Local PDF source inspection (2026-09-13)

Under 자료 검토, choose PDF 원문 확인. This lazy-loaded workspace reads a selected PDF locally,
extracts page text items and approximate font-metric bounds, renders the page, and lets the user attest
that a selected quote matches the displayed original. Attested quotes, questions and reviewer comments
can be exported with the original SHA-256, page, item ID and box as Markdown or source-text-inclusive JSON.
No source upload endpoint, LLM, OCR, table/clinical-field inference, CSV cross-check or persistence is added.
An attestation is not authenticated expert approval or semantic validation.

The **필드 검토** pane supports manual observations or imported local agent 3.2 PDF reports.
It verifies the input digest and every source span against the loaded PDF, starts all fields unreviewed,
and records source-linked confirmation/correction/hold histories. Confirmation/correction requires a rendered
source location and explicit attestation. Original values remain unchanged. Markdown/JSON exports are
unauthenticated and require downstream revalidation; editing does not rerun the agent.
One citation per field is supported, not table/header/footnote bundles. There is no saved-review reimport yet.
See [field-review workflow](../docs/FIELD_REVIEW_UI.md). No additional model calls were made for this change.

**수정 후 재검증** imports the offline Python `field-revalidation/1` report without overwriting the current review.
It matches PDF spans and review content, checks effective/excluded/remaining observations and finding deltas,
and displays current/added/no-longer-emitted/unchanged findings with field navigation. Draft edits or a changed
history hide the prior result. This is structural consistency, not proof of an authentic Python run or clinical approval.
The Python process remains a manual local step. Reload recovery and AI critique reruns remain unsupported.
See [result-view workflow](../docs/REVALIDATION_RESULT_UI.md).

Limits: 5 MiB, 40 pages, 20,000 text items, 250,000 characters, 20-second read budget, 10-second render
budget, 100 notes. Field review: 12 observations, 40 revisions per field, 2 MB imported result JSON.
Cancellation/failed replacement keeps the previous source; successful replacement clears notes and field review after a warning.
Empty-text pages remain visible. Unsupported geometry cannot be attested. Resource limits are best-effort UI/worker
bounds, not a hardened sandbox against hostile compressed PDFs. Only permitted, non-sensitive sources are in scope.

The worker is bundled locally. `pdf-assets.mjs` serves/builds PDF.js CMaps, fonts and decoders from the same origin
with their included notices; no CDN or source URL is passed to the PDF parser. File content is not sent to these asset paths.
The PDF code is loaded only after selecting the PDF mode. This change has not been redeployed to the existing hosted preview.
See [workflow and QA](../docs/PDF_WORKFLOW.md).

## Document-first table review

The first screen now accepts one aggregate UTF-8 CSV, or an explicitly synthetic built-in example.
Required columns: asset, indication, study, dose, metric, events, total, population, window, definition.
Supported metrics: response, adverse_event, dose_reduction, discontinuation.
Limits: 256 KB, 500 data rows, 2,000 characters per cell. PDF/HWPX and patient-level records are not supported.

Files are decoded and parsed in the browser; there is no file upload endpoint, persistence, or external model call.
The parsed source stays in React memory across workspace navigation and is lost on reload/removal.
The user confirms the displayed fields, chooses a review question, and explicitly runs deterministic checks.
Findings reference physical source line numbers and an exact UTF-8 source digest. They can be inspected in the original row.
Markdown review notes and source-inclusive JSON exports are available. Invalid replacement files preserve the prior source.

Checks cover missing fields, integer counts/denominators, unsupported metrics, repeated dose/metric rows,
mixed asset/indication/study contexts, differing population/window/definition text, and absent endpoint summaries.
Different trial contexts are never pooled. Counts alone do not imply truth or scientific comparability.
Text equivalence is literal after trimming, not semantic equivalence. Clinical validity, recommendation, external source
verification, bias, PK/PD and long-term tolerability are not evaluated. See the explicit limitations in every result.

The built-in example contains a deliberate 12-week vs 8-week response-window mismatch. This result is computed,
not loaded from a saved report. The same input can be edited in a CSV and reloaded to make that finding disappear.

## Local live computation

From the parent Python project, start `uv run trialboard-api --port 8000`.
In this directory, run `npm ci` and `npm run dev`. Open `http://127.0.0.1:5173`.
The development server proxies `/api` to the loopback Python service. It does not expose that service publicly.

The separate assumption-experiment screen starts with labeled saved simulations. Editing does not automatically calculate.
After an explicit run succeeds, the UI displays the new server report and compares it with the prior result.
Failed runs preserve the prior report. Dirty inputs are visibly marked as not reflected in the result.
Changing fixture/scenario resets drafts and comparison history; the UI states this beside the selector.
Reports and complete live-run JSON can be downloaded. No execution is persisted on the server.

## Hosted preview

`npm run build` creates a static hosted application. The new table review runs directly in the browser on this build.
It never contacts a visitor's localhost. The separate simulation screen still supports saved scenarios only in production.
That screen's run button is disabled and explains that simulation recomputation requires the local version.
Remote Python hosting/authentication remains a separate step; this site does not fake server results.

## Tests

With Node 24: `node --test tests/*.test.mjs`. The 311 tests cover CSV parsing, rule findings, original-line locators,
hashes, data-dependent result changes, export escaping, simulation inputs, API-client, WebMCP mock contracts,
PDF geometry, provenance/attestation integrity, source budgets, cancellation and timeouts, field review,
report import identity checks, bounded JSON parsing, immutable correction/hold history, revalidation-result
references/effective inputs/delta consistency, stale-result detection and strict field-review backup/restoration.
New AI recritique-result tests invoke the Python producer with synthetic data and a scripted provider;
the parent project's `uv` environment is required. They check version/request digests, concern references,
candidate/withheld sets, failures/budgets and draft-aware stale results without calling a real model.
Use **AI 재검토 결과 불러오기** for a locally produced recritique report; it does not run AI in the browser.
See [AI result UI limitations](../docs/RECRITIQUE_RESULT_UI.md).
Use **저장한 검토 이어하기** after opening the same PDF to restore an exported review JSON.
This preserves recorded decisions without authenticating the reviewer or invoking AI; it is not automatic storage.
See [recovery contract and limitations](../docs/FIELD_REVIEW_RECOVERY.md).
`node scripts/check-field-review-bridge.mjs` additionally checks the Python-to-web contract with synthetic
export-shaped data and a scripted provider; it requires the parent project's `uv` environment, not a model login.
Two PDF tests use pinned local FDA snapshots and are explicitly skipped if those snapshots are unavailable.
They are not browser UI tests.
`npm run build` checks TypeScript and produces the deployable output.
The MUI client-component directives cause Rollup warnings in this client-only Vite build; output still builds successfully.
The main bundle is about 533 kB uncompressed / 168 kB gzip and triggers Vite's 500 kB chunk warning.
The PDF workspace is a separate roughly 475 kB / 144 kB gzip chunk, plus a 1.27 MB worker and on-demand support assets.
Browser interaction, visual layout and screen-reader behavior have not yet been manually verified.
