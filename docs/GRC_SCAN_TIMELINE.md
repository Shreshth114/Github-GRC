# GRC scan timeline — 27 November 2026

User requested restoring the richer three/four-step loading experience instead of the single-line spinner.

## Implemented

Four connected stages: **Prepare scan → Scan source → Build report → Results ready**. Includes numbered markers, animated active rings, completion ticks, a moving workflow rail, status text, a brief report transition and result entrance animation. The completed timeline stays visible above the report instead of disappearing abruptly. Narrow screens use a two-column layout. Reduced-motion preference skips the presentation delay and disables CSS animations.

The API request starts immediately. The initial 180 ms transition introduces the pending request; the source-scanning stage remains active until the real response arrives. It does not simulate file completion or display a fabricated completion percentage. The rail represents workflow stages only. After a valid response and report construction, a 360 ms presentation transition reveals results. Partial results remain labelled as partial. Errors and Stop cancel pending animations; stale completion callbacks cannot reveal a stopped scan.

## Files changed

- `public/index.html`: four-step accessible workflow markup.
- `public/style.css`: connected markers, animated rail, responsive layout, completion and result transitions.
- `public/script.js`: presentation state, cancellable timers and completion transition; existing API and monitoring logic retained.
- `tests/frontend.test.js`: preserves the existing behavioral tests and adds actual animated-flow, reduced-motion/partial-report and Stop-during-transition coverage.
- `docs/GRC_SCAN_TIMELINE.md`: this record.

No backend files, API contracts, scanner rules, provider credentials or CampusDecoded files changed.

## Validation

`npx --yes --package=node@24 -- npm test`: **34 passed, 0 failed, 0 skipped**. `git diff --check`: passed. Existing error, isolation, retry, cancellation, history and Action tests remain enabled.

BrowserOS tools remain unavailable; state transitions are verified using the actual HTML/script in DOM tests, not a visual browser walkthrough. Live rollout and served-file verification will be recorded once deployment completes.
