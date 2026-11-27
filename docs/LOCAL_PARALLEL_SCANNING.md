# Local scan throughput and quiet diagnostics — 27 November 2026

User requested hiding the noisy partial-scan/repeated-pattern text and fixing the incomplete scan. Work remains localhost-only; nothing was committed, pushed or deployed.

## Implementation

- Replaced serial file downloads with five bounded workers per scan. Files still use the same pinned commit, eligibility rules, 300-file cap, 300,000-byte size cap, 45-second budget and public-repository restriction. Findings are collected in source-tree order regardless of response completion order. At most two scans remain active.
- Retry a transient network timeout/reset or upstream 5xx once, with a short pause, only while the deadline permits. Authentication/permission/quota failures are not automatically retried. Once such a failure is observed, queued work stops; already-issued requests settle and are accounted for.
- Every selected file is counted as scanned, excluded, failed or unprocessed. Added sanitized failed-file details; response bodies, authorization headers and credentials are never included. Successfully retried files are counted once.
- Removed the long technical paragraph and repeated-pattern boilerplate from the intelligence summary. Incomplete scans retain a compact, collapsed `Partial scan · N files checked` notice. Opening it shows readable reasons, coverage counts and failed filenames. Internal codes such as `time_limit` and useless false-limit flags are not shown as prose. Complete scans hide this notice.
- Findings, source text, scanner patterns and severity scoring are unchanged by this round. The earlier localhost-only paginated findings and timeline improvements remain.

## Modified files this round

`server.js`, `public/index.html`, `public/script.js`, `public/style.css`, `tests/server.test.js`, `tests/frontend.test.js`, and this note. Previous uncommitted local UI work is retained.

## Automated verification

`npx --yes --package=node@24 -- npm test`: **41 passed, 0 failed, 0 skipped**. New regressions cover 239 synthetic files with overlapping reads (peak above one and no more than five), deterministic finding order, a transient failure retried once, safe permanent-error diagnostics, compact/readable coverage disclosure and its reset after a complete scan.

The existing serial rate-limit test was updated to test the worker implementation explicitly: five requests were already in flight when one received 429, no queued request was started afterwards, four files completed, one failed and five remained unprocessed. The severity gate and all other tests remain enabled.

`git diff --check`: passed. The local server was restarted on `127.0.0.1:3000` to load the backend change, using its existing environment without printing credential values.

## Live local verification

The local HTML, JavaScript and CSS returned HTTP 200 and matched the working files. A real, read-only scan of the public `Shreshth114/CampusDecoded` source repository, at commit `82098e9ae90fc4304c69f578969b124865a25fde`, returned HTTP 200 in approximately **26.49 seconds**:

- 239 files scanned; 0 skipped; 0 failed; 0 unprocessed.
- `complete: true`, `truncated: false`, no stop reason and no failed-file details.
- 29 heuristic findings. This is a pattern count, not a claim of 29 verified vulnerabilities.

This is a successful single local run, not a general performance benchmark or a guarantee for every repository. The target's public source was only read; its GitHub contents, deployed application, uploaded documents, institutional data and indexes were not modified. No LLM calls were made. Refresh http://localhost:3000/ and rerun the scan to replace an already-rendered older result.

## Limits

Parallel reads improve throughput, but do not guarantee completion for every repository or GitHub response time. Rate limits, unavailable files and the declared scan caps can still produce a partial result. Coverage remains visible on demand rather than being misrepresented as complete. BrowserOS tools are unavailable; UI state is DOM-tested rather than visually browser-verified.
