# TrialBoard review workspace

React + Material UI + Vite. Node 24 is used for validation; Vite requires Node 20.19+ or 22.12+.

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

With Node 24: `node --test tests/*.test.mjs`. The 61 tests cover CSV parsing, rule findings, original-line locators,
hashes, data-dependent result changes, export escaping, simulation inputs, API-client and WebMCP mock contracts.
They are not browser UI tests.
`npm run build` checks TypeScript and produces the deployable output.
The MUI client-component directives cause Rollup warnings in this client-only Vite build; output still builds successfully.
The current bundle is about 530 kB uncompressed / 167 kB gzip and triggers Vite's 500 kB chunk warning.
Browser interaction, visual layout and screen-reader behavior have not yet been manually verified.
