# GitHub Security Risk Scanner

Simple hackathon prototype to scan public GitHub repositories for risky secret patterns.

Live demo: [GitHub GRC](https://github-grc.onrender.com).

The public deployment accepts public repositories only. Scores and risk labels are heuristics, not a security audit, compliance certification or measured exploit probability. Illustrative remediation snippets are examples, not patches derived from repository source.

## Setup

Step 1  
Create a `.env` file in the project root.

Step 2  
Add your GitHub Personal Access Token:

```
GITHUB_TOKEN=your_token_here
```

Step 3  
Run the server again:

```bash
npm ci
npm start
```

Open the app at [http://localhost:3000](http://localhost:3000).

Use Node.js 24. Run `npm test` for isolated server, scanner and Action regression tests. Tests use mocked GitHub responses or temporary synthetic repositories; no real credentials are required.

## GitHub Action

The repository includes `action.yml`, reusable scanner/reporting modules under `lib/`, and the Action entry point under `agent/`. The workflow installs dependencies with `npm ci` before invoking the local Action. High findings fail the check. Push scans compare with the event's preceding commit; pull-request scans compare with the base branch.

LLM triage is disabled by default and has not been live-verified. The web dashboard uses the heuristic scanner, not an LLM. Groq and Gemini credentials are not used by this application. The optional Action triage currently targets OpenAI and requires a separate, explicit configuration. Do not upload unrelated provider keys.

## Deployment

Render runs this single Express service on the free plan. It reads the platform `PORT`, binds to `0.0.0.0` and serves `public/`. Store `GITHUB_TOKEN` only in Render's environment settings. Use a read-only, narrowly scoped token. Never commit `.env`, credentials or generated credential-bearing caches.

Scanning is limited to 300 eligible text files and files up to 300,000 bytes. Responses include actual scan counts and incomplete-scan indicators. Large repositories and GitHub rate limits can produce partial results. Browser monitoring uses polling, not webhooks or a durable background job. The free service can sleep when idle.

See [deployment review and verification](docs/RENDER_DEPLOYMENT.md).
