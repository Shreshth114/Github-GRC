# GitHub GRC deployment review — 27 November 2026

## Scope and source

User requested the same Render preparation, credential configuration, verification and GitHub About link setup as CampusDecoded, then explicitly requested reviewing and including unpublished local changes.

Original project: `/Users/shreshthagrawal/Documents/GIthub GRC`. Work was performed in `/Users/shreshthagrawal/Documents/DELL_DEMO/github-grc-deploy`; the original working tree was left untouched. Copied only `server.js`, `action.yml`, `agent/`, `lib/` and `.github/`. The original `.env`, installed packages and operating-system files were not copied.

Existing service reused: `Github-GRC`, free Node web service, Oregon, in the previously confirmed Shreshth workspace. No new paid resources or datastore were required. Repository: <https://github.com/Shreshth114/Github-GRC>. Website: <https://github-grc.onrender.com>.

## Review and necessary fixes

- Server uses the extracted shared scanner and preserves existing heuristic scoring.
- Both public routes check repository visibility before reading repository contents or commits. Unknown/private visibility fails closed. The server-side token cannot be used through these routes to inspect private repositories.
- GitHub URLs must use HTTPS and the exact github.com hostname. Repository-controlled filenames, history strings and activity messages are escaped before HTML insertion.
- Added actual scan counts and explicit partial-scan reporting. Missing files, oversized files and truncated trees cannot be reported as complete. Removed randomized file-count calculation and unconditional security/compliance claims for scans without findings.
- Server binds to the Render port on all interfaces; importing it for tests does not start a listener.
- Action loads the current ESM toolkit correctly, installs dependencies in CI, uses argument-based Git commands, and uses the push event's preceding SHA. The high-severity failure gate is retained. A single medium finding is labelled medium.
- CI annotations and Markdown reports omit raw matching source snippets, which may contain credentials.
- Node 24 runtime, lockfile and compatible dependency updates. A patched qs override addresses advisories in the Express dependency tree. Removed previously committed `node_modules` and `.DS_Store` from Git tracking in the deployment checkout; installation now supplies dependencies.
- Secrets, caches and generated reports are ignored. `.env.example` contains an empty credential field only.

## Verification before deployment

- `npx --yes --package=node@24 node --test tests/*.test.js`: 14 tests passed in the final run after the self-match regression was added. Includes real temporary Git-history tests for push scanning, high-finding rejection, redaction, public/private repository isolation, URL validation, default-branch lookup, file counters, truncation and static file protection.
- `npm audit --omit=dev`: zero known vulnerabilities after dependency updates.
- Baseline deployment: homepage/assets reachable, `.env` and server source return 404, invalid scan inputs return 400, latest-commit route works.
- The local project's `GITHUB_TOKEN` authenticated successfully with GitHub (HTTP 200). No token value or authorization header was printed or committed.

## Deployment and final checks

The first rollout became live. GitHub CI exposed one false positive: the AWS detector matched the literal spelling inside its own rule definition. The expression is now assembled from two strings with identical runtime matching behavior; a regression test verifies both credential detection and absence of this self-match. The high-severity CI gate was retained. Final rollout and functional results will be recorded below.

## Limits

This remains a heuristic prototype. False positives and false negatives are possible. UI confidence, exploit likelihood and attack paths are illustrative heuristics. Pattern co-occurrence does not establish that the same credential propagated. No production security certification is claimed.

Optional LLM triage is disabled and unverified; it is not enabled as part of this deployment. Its verdict validation, cache configuration and failure behavior need a dedicated review before production use. Generic remediation examples are not source-specific fixes. Browser polling, load behavior and abuse resistance have not been stress-tested. The scanner still has a 300-file and 300,000-byte per-file limit and serial GitHub requests; large scans may be slow. CI SARIF upload depends on the repository's GitHub Code Scanning availability. No visual browser verification has been performed yet.


## Final verified state

- Source deployment: `cc3bc9b4b2946c84c92b890d0dc00d4a10c643cd`.
- Render deploy `dep-dc4nlcec6qcc73e9st90`: **live**. Startup confirmed `GITHUB_TOKEN` present and listening on port 10000.
- With explicit user approval, transferred only this project's `GITHUB_TOKEN` from its original local `.env` into its existing Render service. Set `NODE_VERSION=24` and preserved other service environment variables. No credential values were printed, committed or recorded.
- The initial credential transfer was blocked by automatic approval review; no transfer succeeded until the user explicitly authorized this token and service. The subsequent transfer succeeded.
- The existing Render build/start settings remain `npm install` and `node server.js`; the committed lockfile and Node 24 setting were used. Local clean-install validation used `npm ci`.
- GitHub Actions passed for the deployed source: <https://github.com/Shreshth114/Github-GRC/actions/runs/46000859139>. The earlier run failed on the detector self-match described above; the failure was fixed without disabling the severity gate.
- GitHub About homepage verified as <https://github-grc.onrender.com>.
- CampusDecoded's repository, service, credentials and data were not changed by this work. No CampusDecoded keys were copied into GRC.

### Live functional checks

| Check | HTTP | Result |
| --- | --- | --- |
| GET / | 200 | Pass |
| GET /style.css | 200 | Pass |
| GET /script.js | 200 | Pass |
| GET /.env | 404 | Pass |
| GET /server.js | 404 | Pass |
| GET /lib/scanner.js | 404 | Pass |
| POST /scan | 400 | Pass |
| POST /scan | 400 | Pass |
| POST /latest-commit | 400 | Pass |
| POST /latest-commit | 200 | Pass |
| real public repository scan | 200 | Pass |

All 11 live checks passed. The real scan used the user's public `Node-Health-checkup` repository: 2 files scanned, 0 skipped, 0 failed, no truncation, 0 pattern matches, approximately 1.28 seconds for that one request. This is functional verification, not a load benchmark or a claim that the repository is secure. Private-repository rejection was tested with isolated mocked responses; no private repository contents were accessed.

No live LLM calls were made. BrowserOS tools were unavailable, so visual layout and interactive browser monitoring were not verified. No substitute browser was used. The service remains on the free plan; no paid resources were added.
