# Deployed GRC verification follow-up — 27 November 2026

User asked whether every feature and API call in the deployed GRC project was verified and working perfectly. This follow-up is a verification pass only; no application code or configuration was changed.

Live site: https://github-grc.onrender.com/

Render source: `cc3bc9b4b2946c84c92b890d0dc00d4a10c643cd`, deployment `dep-dc4nlcec6qcc73e9st90`, status live. The scanned GitHub source snapshot was `31dfe0d3b58b55725a8fbb5307b7473ab2c7f5af` (the later commit contains documentation only).

## Results

14 of 16 live checks passed. The prior 14 isolated regression tests and successful GitHub CI remain separate checks; this follow-up did not rerun them because it changed no application code.

| Check | Actual HTTP | Expected HTTP | Outcome |
| --- | --- | --- | --- |
| GET / | 200 | 200 | Pass |
| GET /script.js | 200 | 200 | Pass |
| GET /style.css | 200 | 200 | Pass |
| GET /.env | 404 | 404 | Pass |
| GET /server.js | 404 | 404 | Pass |
| empty scan input | 400 | 400 | Pass |
| invalid URL | 400 | 400 | Pass |
| lookalike GitHub hostname | 400 | 400 | Pass |
| invalid branch type | 400 | 400 | Pass |
| empty commit input | 400 | 400 | Pass |
| nonexistent repository scan | 404 | 404 | Pass |
| nonexistent repository commit | 500 | 404 | Fail |
| nonexistent branch | 500 | 404 | Fail |
| commit polling 1 | 200 | 200 | Pass |
| commit polling 2 | 200 | 200 | Pass |
| real GRC scan matches committed source | 200 | 200 | Pass |

## Real scan verification

A real POST to `/scan` scanned the public `Shreshth114/Github-GRC` source. It returned 23 scanned files, 0 skipped files, 0 failed files, no truncation, 16 heuristic findings and a score of 6. The finding tuples (file, message, severity) and score matched the same committed files scanned locally with the shared engine exactly. The request took approximately 5.57 seconds; this single observation is not a latency benchmark.

This establishes deployed-engine consistency, not security accuracy. Rule definitions, documentation and illustrative credentials can trigger heuristic matches. The risk score is not a validated probability or compliance assessment.

## Confirmed remaining bugs

The `/latest-commit` handler in `server.js` catches every upstream GitHub error and returns HTTP 500 with `Failed to fetch latest commit hash.` Both a nonexistent repository and a nonexistent branch reached this catch-all. These should have specific client/not-found responses; authentication, rate-limit and upstream failures also need distinct handling. No such fix was implemented during this verification pass.

Normal commit polling returned the expected SHA twice. `/scan` correctly returned HTTP 404 for the nonexistent repository. The service remained responsive and completed the subsequent real scan.

## Unverified areas

BrowserOS tools are unavailable, so no visual browser or end-to-end interaction check was performed for start/stop monitoring, copy/download buttons, scan history or responsive layout. Two successful commit API calls do not establish that the browser's change-triggered rescan flow works under all conditions. No actual new commit was created solely to trigger monitoring.

Concurrent load, GitHub quota exhaustion, prolonged monitoring, large/truncated repositories and optional LLM triage were not live-tested here. File caps and failures have isolated regression coverage, not broad production validation. Real private repository contents were not accessed; visibility rejection is covered by the earlier mocked tests.

No credentials were printed or added to this report. No keys were transferred during this follow-up. CampusDecoded was not accessed or modified. The service remains a functional public-repository scanning prototype, with the error-handling bugs and verification limits above.
