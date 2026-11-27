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

Source `5548171b5dfca3a09519c53e4392ab916b6f77bc` is live in Render deployment `dep-dc4nu95bedkc73drmdrg`. GitHub CI passed: https://github.com/Shreshth114/Github-GRC/actions/runs/46003513762.

All **20 live checks passed**. The served HTML, JavaScript and CSS matched the tested files byte-for-byte. Both previously failing commit-lookup cases now return sanitized JSON 404. Malformed JSON returns 400 and oversized JSON returns 413. Secret/configuration and server source paths return 404.

The real GRC scan was pinned to that source commit: 26 files scanned, 0 skipped, 0 failed, 0 unprocessed, complete coverage within the declared limits. All 19 finding tuples and the heuristic score of 0 matched the same source files scanned locally. A zero score here reflects matches in the project's own illustrative samples, tests and source; it is not proof of 19 actual security vulnerabilities. The one request took approximately 4.79 seconds. A second real public repository scan read 2 files successfully in approximately 1.26 seconds. These timings are individual observations, not performance benchmarks.

| Live check | HTTP | Result |
| --- | --- | --- |
| served asset matches tested file / | 200 | Pass |
| served asset matches tested file /script.js | 200 | Pass |
| served asset matches tested file /style.css | 200 | Pass |
| protected file /.env | 404 | Pass |
| protected file /server.js | 404 | Pass |
| protected file /lib/scanner.js | 404 | Pass |
| empty scan | 400 | Pass |
| invalid URL | 400 | Pass |
| lookalike hostname | 400 | Pass |
| custom port | 400 | Pass |
| invalid commit | 400 | Pass |
| invalid branch | 400 | Pass |
| missing repository scan | 404 | Pass |
| missing repository commit | 404 | Pass |
| missing branch | 404 | Pass |
| default branch commit | 200 | Pass |
| malformed JSON | 400 | Pass |
| oversized JSON | 413 | Pass |
| GRC scan at exact committed revision | 200 | Pass |
| small public repository scan | 200 | Pass |

## Limits

This remains a heuristic public-repository scanner. It does not establish credential validity, compromise probability, full repository coverage beyond the stated limits, or compliance. Optional LLM triage remains disabled and was not live-tested. BrowserOS tools are unavailable; DOM interaction tests are not visual browser testing. No high-concurrency load or destructive quota-exhaustion test was run against GitHub or Render.

## Live API-backed DOM monitoring check

**Passed: all four live API-backed DOM flows.** The exact deployed HTML and script were loaded into jsdom (their bytes were checked against the tested files) and called the real deployed endpoints. This is distinct from the mocked frontend regressions and from visual browser verification.

1. Manual scan rendered the actual Node-Health-checkup repository.
2. Monitoring switched to Github-GRC and completed a fresh pinned baseline.
3. The real documentation commit was detected, rescanned at its exact SHA and displayed.
4. Stop restored the controls; no additional requests appeared during a 5.5-second observation, exceeding the normal five-second poll delay.

Baseline: `5548171b5dfca3a09519c53e4392ab916b6f77bc`. Observed/rescanned revision: `168c55bc0eec66431c76d171b72882b84425722c`.

| Real API request | HTTP | Commit requested |
| --- | --- | --- |
| /scan | 200 | — |
| /latest-commit | 200 | — |
| /scan | 200 | 5548171b5dfca3a09519c53e4392ab916b6f77bc |
| /latest-commit | 200 | — |
| /latest-commit | 200 | — |
| /latest-commit | 200 | — |
| /latest-commit | 200 | — |
| /latest-commit | 200 | — |
| /scan | 200 | 168c55bc0eec66431c76d171b72882b84425722c |

The first one-off harness attempt tried to inspect a script-private lexical variable and failed as a harness error. The corrected harness reads displayed repository/commit metadata; no application code was changed to expose internal state. All four flows above passed on that corrected run.

The runtime error-log query after deployment returned no error-level log entries. This is an observation for the queried interval, not a guarantee against every future failure. The live code remains source `5548171`; subsequent report-only commits use `[skip render]` and do not change the running application. No extra credentials were transferred, no LLM calls were made, and CampusDecoded remains unchanged.

