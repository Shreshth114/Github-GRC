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
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const { isLikelyTextFile, scanContent, calculateScore } = require("./lib/scanner");

function parseRepoUrl(repoUrl) {
  try {
    const parsed = new URL(repoUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !/^[A-Za-z0-9-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch (error) {
    return null;
  }
}

async function fetchRepoFiles(owner, repo, branch) {
  const treeUrl = `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const treeResp = await github.get(treeUrl);
  const treeItems = treeResp.data.tree || [];
  const files = treeItems.filter((item) => item.type === "blob" && isLikelyTextFile(item.path));
  const selected = files.slice(0, MAX_FILES_TO_SCAN);
  selected.truncated = Boolean(treeResp.data.truncated) || files.length > MAX_FILES_TO_SCAN;
  return selected;
}

app.post("/scan", async (req, res) => {
  const { repoUrl } = req.body || {};

  if (!repoUrl || typeof repoUrl !== "string") {
    return res.status(400).json({ error: "repoUrl is required." });
  }

  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ error: "Invalid GitHub repository URL." });
  }

  try {
    const repoMetaUrl = `/repos/${parsed.owner}/${parsed.repo}`;
    const repoResp = await github.get(repoMetaUrl);
    if (repoResp.data.private || repoResp.data.visibility !== "public") {
      return res.status(403).json({ error: "This public demo only scans public repositories." });
    }
    const branch = repoResp.data.default_branch || "main";
    const stars = repoResp.data.stargazers_count || 0;
    const forks = repoResp.data.forks_count || 0;
    const visibility = repoResp.data.visibility || (repoResp.data.private ? "private" : "public");

    const files = await fetchRepoFiles(parsed.owner, parsed.repo, branch);
    const issues = [];
    let filesScanned = 0;
    let filesSkipped = 0;
    let filesFailed = 0;

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) { filesSkipped++; continue; }
      try {
        const blobUrl = `/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(branch)}`;
        const fileResp = await github.get(blobUrl);
        if (fileResp.data && fileResp.data.type === "file" && fileResp.data.content) {
          const decoded = Buffer.from(fileResp.data.content, "base64").toString("utf8");
          const fileIssues = scanContent(decoded, file.path);
          filesScanned++;
          issues.push(...fileIssues);
        } else { filesSkipped++; }
      } catch (error) {
        filesFailed++;
      }
    }

    const score = calculateScore(issues);

    return res.json({ score, issues, repoMeta: { branch, stars, forks, visibility },
      scanMeta: { filesScanned, filesSkipped, filesFailed, maxFiles: MAX_FILES_TO_SCAN,
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES, complete: filesFailed === 0 && filesSkipped === 0 && !files.truncated,
        truncated: Boolean(files.truncated) } });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.status(404).json({ error: "Repository not found or inaccessible." });
    }
    if (error.response && error.response.status === 403) {
      return res.status(403).json({
        error: "GitHub API rate limit reached. Check if GITHUB_TOKEN is set correctly.",
        details: error.response.data?.message || "No additional details from GitHub API."
      });
    }
    return res.status(500).json({ error: "Failed to scan repository." });
  }
});

app.post("/latest-commit", async (req, res) => {
  const { repoUrl, branch } = req.body || {};
  if (!repoUrl || typeof repoUrl !== "string") return res.status(400).json({ error: "repoUrl required" });
  if (branch !== undefined && (typeof branch !== "string" || !branch.trim())) return res.status(400).json({ error: "Invalid branch" });
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
    return res.status(500).json({ error: "Failed to fetch latest commit hash." });
  }
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app, github, parseRepoUrl };
