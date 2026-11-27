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

- `npx --yes --package=node@24 node --test tests/*.test.js`: 13 tests passed. Includes real temporary Git-history tests for push scanning, high-finding rejection, redaction, public/private repository isolation, URL validation, default-branch lookup, file counters, truncation and static file protection.
- `npm audit --omit=dev`: zero known vulnerabilities after dependency updates.
- Baseline deployment: homepage/assets reachable, `.env` and server source return 404, invalid scan inputs return 400, latest-commit route works.
- The local project's `GITHUB_TOKEN` authenticated successfully with GitHub (HTTP 200). No token value or authorization header was printed or committed.

## Deployment and final checks

Pending final rollout and live functional checks. Results will be recorded after the service is live.

## Limits

This remains a heuristic prototype. False positives and false negatives are possible. UI confidence, exploit likelihood and attack paths are illustrative heuristics. Pattern co-occurrence does not establish that the same credential propagated. No production security certification is claimed.

Optional LLM triage is disabled and unverified; it is not enabled as part of this deployment. Its verdict validation, cache configuration and failure behavior need a dedicated review before production use. Generic remediation examples are not source-specific fixes. Browser polling, load behavior and abuse resistance have not been stress-tested. The scanner still has a 300-file and 300,000-byte per-file limit and serial GitHub requests; large scans may be slow. CI SARIF upload depends on the repository's GitHub Code Scanning availability. No visual browser verification has been performed yet.
