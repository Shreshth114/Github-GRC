/**
 * agent/commenter.js — PR Comment Generator
 *
 * Posts a structured Markdown summary comment on the PR.
 * Uses the GitHub REST API via @actions/github or raw fetch.
 */

const { generateMarkdownReport } = require("../lib/reporter");

/**
 * Posts a summary comment on the pull request.
 * If a previous comment from this bot exists, it updates the existing one.
 *
 * @param {Object} options
 * @param {string} options.token - GitHub token
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {Array} options.issues - Security findings
 * @param {string} options.repoName - Display name for the report
 */
async function postPRComment({ token, owner, repo, prNumber, issues, repoName }) {
  const markdown = generateMarkdownReport(issues, repoName);
  const commentTag = "<!-- security-agent-report -->";
  const body = `${commentTag}\n${markdown}`;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    // Check for existing comment to update
    const listRes = await fetch(`${baseUrl}/issues/${prNumber}/comments?per_page=100`, { headers });
    const comments = await listRes.json();

    const existing = Array.isArray(comments)
      ? comments.find(c => c.body && c.body.includes(commentTag))
      : null;

    if (existing) {
      // Update existing comment
      await fetch(`${baseUrl}/issues/comments/${existing.id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body })
      });
      console.log(`[commenter] Updated existing PR comment #${existing.id}`);
    } else {
      // Create new comment
      await fetch(`${baseUrl}/issues/${prNumber}/comments`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body })
      });
      console.log(`[commenter] Posted new PR comment on #${prNumber}`);
    }
  } catch (err) {
    console.error(`[commenter] Failed to post PR comment: ${err.message}`);
  }
}

module.exports = { postPRComment };
