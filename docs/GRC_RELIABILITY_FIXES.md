# GRC reliability fixes — 27 November 2026

## Scope

User requested fixing the gaps found by deployed verification. Changes apply only to GitHub GRC in `/Users/shreshthagrawal/Documents/DELL_DEMO/github-grc-deploy`, repository `Shreshth114/Github-GRC`, Render service `srv-d76h7ehaae7s73c4u3kg`. CampusDecoded and the original local GRC working tree were not modified. Credentials and provider configuration were not changed.

## Changes

- `server.js`: shared sanitized GitHub failure mapping for both routes. Missing repositories/branches return 404; empty repositories 422; permission failures 403; invalid server credentials 502; rate limits 429 with Retry-After; timeouts 504; upstream outages 502. Upstream bodies, credentials and authorization headers are not returned. Invalid JSON returns JSON 400; oversized requests return JSON 413. Repository URL validation rejects custom ports and empty repository names.
- Each scan resolves one commit, then reads its tree and contents at that same SHA. Optional `commitSha` is strictly validated for monitoring scans. Existing response fields are retained; `repoMeta.commitSha` and explicit unprocessed/stop-reason fields are added.
- Two active scans maximum, 45-second scan budget, per-request timeouts, cancellation on disconnect, and explicit partial coverage. Rate-limited file loops stop instead of repeatedly exhausting the quota. Empty text files count as scanned.
- `public/script.js`: fresh monitor baseline for every repository/session, one scheduled poll after completion, stop/abort and stale-response checks, exact-commit rescans, failed-scan retries without advancing the baseline, Retry-After handling and visible fatal errors. New findings after an initially clean scan now alert and cite the correct new commit. Transient partial scans remain visible and retry; permanent file/tree exclusions remain labelled partial.
- Manual scan/loading/error controls recover after failures. Corrupt, unavailable or malformed browser history cannot break scans. Clipboard success is awaited; failures are displayed. Downloads append/click/remove an anchor and revoke object URLs after dispatch. Exported snippets are explicitly examples in a text file, not automatic repository patches.
- `public/index.html` and `public/style.css`: real loading state replaces simulated timed stages, accessible inline status, displayed repository/commit identity, and clear heuristic/example labels. Pattern co-occurrence is not described as verified credential propagation; no invented exploit probability is presented. Reduced-motion preference is supported.
- `lib/scanner.js`: generic PKCS#8 private-key headers are detected alongside RSA/EC/DSA/OpenSSH. Public SSH keys are classified as low-severity public-key references, not private secrets. Other heuristic scores and detections remain.
- Tests expanded in `tests/server.test.js`, `tests/scanner.test.js`, and new `tests/frontend.test.js`. `package.json`/`package-lock.json` add jsdom as a development-only dependency. `README.md` documents the runtime limits and behavior.
- `docs/LIVE_VERIFICATION_FOLLOWUP.md` preserves the preceding 14/16 live verification, including the two failures this round fixes. It is historical evidence, not a claim about the new deployment.

## Local verification

`npx --yes --package=node@24 -- npm test`: **31 passed, 0 failed, 0 skipped**. Includes existing Action tests plus missing repository/branch, authentication/quota/permission/outage/timeout mapping, malformed/oversized inputs, source revision pinning, empty text, mid-scan quota exhaustion, concurrency release and time-budget accounting. Frontend tests execute the real script against the actual HTML with jsdom, mocked fetch and controlled timers: monitoring, failed/partial retries, new findings, stop/restart races, corrupt/blocked history, clipboard failure and text downloads.

`npm audit`: **0 known vulnerabilities**, including development dependencies at the time of the check.

No real GitHub credential or LLM key is used by these tests. No additional LLM calls were made. Existing tests and the CI high-severity gate remain enabled.

## Deployment verification

Pending rollout of the tested source and live rechecks. Actual results will be appended after Render is live.

## Limits

This remains a heuristic public-repository scanner. It does not establish credential validity, compromise probability, full repository coverage beyond the stated limits, or compliance. Optional LLM triage remains disabled and was not live-tested. BrowserOS tools are unavailable; DOM interaction tests are not visual browser testing. No high-concurrency load or destructive quota-exhaustion test was run against GitHub or Render.
