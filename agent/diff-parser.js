/**
 * agent/diff-parser.js — Git Diff Parser
 *
 * Parses `git diff` output to extract changed files and their line mappings.
 * Used in diff-only scan mode to avoid scanning the entire repo.
 */

const { execFileSync } = require("child_process");
const path = require("path");

/**
 * Gets the list of files changed in this PR/push.
 * @param {string} baseBranch - The base branch to diff against (e.g., "origin/main")
 * @returns {string[]} Array of changed file paths
 */
function getChangedFiles(baseBranch) {
  try {
    const output = execFileSync(
      "git", ["diff", "--name-only", "--diff-filter=ACMR", `${baseBranch}...HEAD`, "--"],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    return output.trim().split("\n").filter(Boolean);
  } catch (err) {
    // Fallback: diff against HEAD~1 if baseBranch fails
    try {
      const output = execFileSync(
        "git", ["diff", "--name-only", "--diff-filter=ACMR", "HEAD~1", "--"],
        { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
      );
      return output.trim().split("\n").filter(Boolean);
    } catch (e) {
      console.error("[diff-parser] Could not determine changed files:", e.message);
      return [];
    }
  }
}

/**
 * Parses the unified diff output to map changed line numbers per file.
 * Returns a map: { "src/config.js": [10, 11, 12, 45, 46] }
 * @param {string} baseBranch
 * @returns {Object.<string, number[]>}
 */
function getChangedLineMap(baseBranch) {
  const lineMap = {};

  try {
    const diffOutput = execFileSync(
      "git", ["diff", "-U0", `${baseBranch}...HEAD`, "--"],
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    );

    let currentFile = null;

    for (const line of diffOutput.split("\n")) {
      // Match diff header: +++ b/path/to/file
      if (line.startsWith("+++ b/")) {
        currentFile = line.substring(6);
        if (!lineMap[currentFile]) lineMap[currentFile] = [];
        continue;
      }

      // Match hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      if (line.startsWith("@@") && currentFile) {
        const match = line.match(/\+(\d+)(?:,(\d+))?/);
        if (match) {
          const start = parseInt(match[1], 10);
          const count = parseInt(match[2] || "1", 10);
          for (let i = start; i < start + count; i++) {
            lineMap[currentFile].push(i);
          }
        }
      }
    }
  } catch (err) {
    console.error("[diff-parser] Could not parse diff:", err.message);
  }

  return lineMap;
}

/**
 * Reads a file from the working directory.
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileContent(filePath) {
  const fs = require("fs");
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(fullPath, "utf8");
  } catch (err) {
    return null;
  }
}

module.exports = {
  getChangedFiles,
  getChangedLineMap,
  readFileContent
};
