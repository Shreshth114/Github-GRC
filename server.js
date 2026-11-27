const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const githubToken = process.env.GITHUB_TOKEN ? process.env.GITHUB_TOKEN.trim() : "";
console.log("GITHUB_TOKEN status on startup:", githubToken ? "PRESENT" : "MISSING");
if (!githubToken) {
  console.warn("WARNING: GITHUB_TOKEN not found in environment variables. GitHub API requests will be unauthenticated and subject to strict rate limits.");
} else if (githubToken === "your_actual_token_here" || githubToken === "your_token_here" || githubToken.includes("your_token")) {
  console.warn("WARNING: GITHUB_TOKEN appears to be a placeholder value. Authentication may fail.");
}

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_API_BASE = "https://api.github.com";
const MAX_FILES_TO_SCAN = 300;
const MAX_FILE_SIZE_BYTES = 300000;

const githubHeaders = {
  "User-Agent": "github-grc-scanner",
  Accept: "application/vnd.github+json"
};

// Ensure the GitHub axios client always includes authentication headers
if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim() !== "") {
  githubHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
}

const github = axios.create({
  baseURL: GITHUB_API_BASE,
  headers: githubHeaders,
  timeout: 15000
});

app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, "public")));

const { isLikelyTextFile, scanContent, calculateScore } = require("./lib/scanner");

function parseRepoUrl(repoUrl) {
  try {
    const parsed = new URL(repoUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port || parsed.username || parsed.password) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !/^[A-Za-z0-9-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) return null;
    const repo = parts[1].replace(/\.git$/, "");
    if (!repo || repo === '.' || repo === '..') return null;
    return { owner: parts[0], repo };
  } catch (error) {
    return null;
  }
}

function githubFailure(error, context = 'repository') {
  const status = error.response?.status;
  const headers = error.response?.headers || {};
  const limited = status === 429 || (status === 403 &&
    (String(headers['x-ratelimit-remaining']) === '0' || /rate limit|abuse|secondary rate/i.test(error.response?.data?.message || '')));
  if (limited) {
    const delay = Number(headers['retry-after']);
    return { status: 429, code: 'github_rate_limited', error: 'GitHub rate limit reached. Try again later.', retryAfter: Number.isFinite(delay) && delay > 0 ? Math.min(Math.ceil(delay), 3600) : 60 };
  }
  if (status === 404 || (status === 422 && context === 'commit')) return { status: 404, code: 'not_found', error: context === 'commit' ? 'Repository or branch not found or inaccessible.' : 'Repository not found or inaccessible.' };
  if (status === 409) return { status: 422, code: 'empty_repository', error: 'This repository has no commits to scan.' };
  if (status === 401) return { status: 502, code: 'github_auth_failed', error: 'The server GitHub credential is invalid or expired.' };
  if (status === 403) return { status: 403, code: 'github_forbidden', error: 'GitHub denied access to this repository.' };
  if (status === 422) return { status: 400, code: 'invalid_reference', error: 'GitHub could not resolve that repository reference.' };
  if (['ECONNABORTED', 'ETIMEDOUT', 'SCAN_TIMEOUT'].includes(error.code)) return { status: 504, code: 'github_timeout', error: 'GitHub took too long to respond. Please retry.' };
  return { status: 502, code: 'github_unavailable', error: 'GitHub is temporarily unavailable. Please retry.' };
}

function sendGithubFailure(res, error, context) {
  const failure = githubFailure(error, context);
  if (failure.retryAfter) res.set('Retry-After', String(failure.retryAfter));
  return res.status(failure.status).json(failure);
}

async function fetchRepoFiles(owner, repo, branch, options = {}) {
  const treeUrl = `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const treeResp = await github.get(treeUrl, options);
  const treeItems = treeResp.data.tree || [];
  const files = treeItems.filter((item) => item.type === "blob" && isLikelyTextFile(item.path));
  const selected = files.slice(0, MAX_FILES_TO_SCAN);
  selected.truncated = Boolean(treeResp.data.truncated) || files.length > MAX_FILES_TO_SCAN;
  return selected;
}

let activeScans = 0;
app.post("/scan", async (req, res) => {
  const { repoUrl, commitSha } = req.body || {};

  if (!repoUrl || typeof repoUrl !== "string") {
    return res.status(400).json({ error: "repoUrl is required." });
  }

  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ error: "Invalid GitHub repository URL." });
  }
  if (commitSha !== undefined && (typeof commitSha !== 'string' || !/^[a-f0-9]{40}$/i.test(commitSha))) {
    return res.status(400).json({ error: 'Invalid commit SHA.' });
  }
  if (activeScans >= 2) return res.set('Retry-After', '5').status(429).json({ code: 'scan_busy', error: 'Two scans are already running. Please retry shortly.' });
  activeScans++;
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const deadline = Date.now() + 45000;
  const options = () => ({ signal: controller.signal, timeout: Math.max(1, Math.min(15000, deadline - Date.now())) });
  let context = 'repository';

  try {
    const repoMetaUrl = `/repos/${parsed.owner}/${parsed.repo}`;
    const repoResp = await github.get(repoMetaUrl, options());
    if (repoResp.data.private || repoResp.data.visibility !== "public") {
      return res.status(403).json({ error: "This public demo only scans public repositories." });
    }
    const branch = repoResp.data.default_branch || "main";
    const stars = repoResp.data.stargazers_count || 0;
    const forks = repoResp.data.forks_count || 0;
    const visibility = repoResp.data.visibility || (repoResp.data.private ? "private" : "public");

    context = 'commit';
    const revision = await github.get(`/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(commitSha || branch)}`, options());
    const indexedCommit = revision.data.sha;
    if (typeof indexedCommit !== 'string' || !/^[a-f0-9]{40}$/i.test(indexedCommit)) throw new Error('Invalid upstream revision');
    const files = await fetchRepoFiles(parsed.owner, parsed.repo, indexedCommit, options());
    const issues = [];
    let filesScanned = 0;
    let filesSkipped = 0;
    let filesFailed = 0;
    let stopReason = null;

    for (const file of files) {
      if (controller.signal.aborted) return;
      if (Date.now() >= deadline) { stopReason = 'time_limit'; break; }
      if (file.size > MAX_FILE_SIZE_BYTES) { filesSkipped++; continue; }
      try {
        const blobUrl = `/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(file.path)}?ref=${indexedCommit}`;
        const fileResp = await github.get(blobUrl, options());
        if (fileResp.data?.type === "file" && typeof fileResp.data.content === 'string') {
          const decoded = Buffer.from(fileResp.data.content, "base64").toString("utf8");
          const fileIssues = scanContent(decoded, file.path);
          filesScanned++;
          issues.push(...fileIssues);
        } else { filesSkipped++; }
      } catch (error) {
        filesFailed++;
        const failure = githubFailure(error);
        if ([401, 403, 429].includes(error.response?.status)) {
          if (!filesScanned) throw error;
          stopReason = failure.code;
          break;
        }
      }
    }

    const score = calculateScore(issues);

    return res.json({ score, issues, repoMeta: { branch, stars, forks, visibility, commitSha: indexedCommit },
      scanMeta: { filesScanned, filesSkipped, filesFailed, maxFiles: MAX_FILES_TO_SCAN,
        filesUnprocessed: files.length - filesScanned - filesSkipped - filesFailed, stopReason,
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES, complete: !stopReason && filesFailed === 0 && filesSkipped === 0 && !files.truncated,
        truncated: Boolean(files.truncated) } });
  } catch (error) {
    if (!res.destroyed) return sendGithubFailure(res, error, context);
  } finally { activeScans--; }
});

app.post("/latest-commit", async (req, res) => {
  const { repoUrl, branch } = req.body || {};
  if (!repoUrl || typeof repoUrl !== "string") return res.status(400).json({ error: "repoUrl required" });
  if (branch !== undefined && (typeof branch !== "string" || !branch.trim() || branch.length > 255)) return res.status(400).json({ error: "Invalid branch" });
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return res.status(400).json({ error: "Invalid URL" });
  
  try {
    const repoResp = await github.get(`/repos/${parsed.owner}/${parsed.repo}`);
    if (repoResp.data.private || repoResp.data.visibility !== "public") {
      return res.status(403).json({ error: "This public demo only scans public repositories." });
    }
    const targetBranch = branch || repoResp.data.default_branch;
    const commitUrl = `/repos/${parsed.owner}/${parsed.repo}/commits?sha=${encodeURIComponent(targetBranch)}&per_page=1`;
    const resp = await github.get(commitUrl);
    if (resp.data && resp.data.length > 0) {
      return res.json({ sha: resp.data[0].sha });
    }
    return res.status(404).json({ error: "No commits found." });
  } catch (error) {
    return sendGithubFailure(res, error, 'commit');
  }
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'invalid_json', error: 'Request body must be valid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ code: 'request_too_large', error: 'Request body is too large.' });
  return res.status(500).json({ code: 'internal_error', error: 'Unexpected server error.' });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, github, parseRepoUrl };
