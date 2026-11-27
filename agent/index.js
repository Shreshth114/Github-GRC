/**
 * agent/index.js — GitHub Action Entry Point
 *
 * This is the main orchestrator for the Security Agent.
 * It runs inside GitHub Actions on push/PR events.
 *
 * Flow:
 * 1. Determine scan mode (diff-only vs full)
 * 2. Get list of files to scan
 * 3. Run security scanner on each file (with line-level precision)
 * 4. Filter findings based on diff (only annotate changed lines in diff mode)
 * 5. Emit inline annotations on the PR
 * 6. Post summary comment on the PR
 * 7. Optionally write SARIF output
 * 8. Exit with failure if threshold breached
 */

const path = require("path");
const fs = require("fs");

// Load the ESM Actions toolkit inside the async entry point.
let core;

const { isLikelyTextFile, scanContentWithLines, calculateScore, countBySeverity } = require("../lib/scanner");
const { generateSarifReport, generateMarkdownReport } = require("../lib/reporter");
const { emitAnnotations } = require("./annotator");
const { postPRComment } = require("./commenter");
const { getChangedFiles, getChangedLineMap, readFileContent } = require("./diff-parser");

// Severity ordering for threshold comparison
const SEVERITY_LEVELS = { LOW: 1, MEDIUM: 2, HIGH: 3 };

async function run() {
  try {
    core = await import("@actions/core");
    // --- Read inputs ---
    const severityThreshold = (core.getInput("severity-threshold") || "HIGH").toUpperCase();
    const scanMode = core.getInput("scan-mode") || "diff-only";
    const failOnFindings = (core.getInput("fail-on-findings") || "true") === "true";
    const sarifOutput = core.getInput("sarif-output") || "";

    // LLM Inputs
    const llmEnabled = (core.getInput("llm-enabled") || "false") === "true";
    const llmProvider = core.getInput("llm-provider") || "openai";
    const llmApiKey = core.getInput("llm-api-key") || process.env.LLM_API_KEY || "";

    core.info("=== Security Agent ===");
    core.info(`Scan mode: ${scanMode}`);
    core.info(`Severity threshold: ${severityThreshold}`);
    core.info(`Fail on findings: ${failOnFindings}`);
    core.info(`AI Agent Enabled: ${llmEnabled} (Provider: ${llmProvider})`);

    // --- Determine files to scan ---
    let filesToScan = [];
    let changedLineMap = {};

    if (scanMode === "diff-only") {
      let baseBranch = process.env.GITHUB_BASE_REF
        ? `origin/${process.env.GITHUB_BASE_REF}`
        : "HEAD~1";
      if (!process.env.GITHUB_BASE_REF && process.env.GITHUB_EVENT_PATH) {
        const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        if (/^[a-f0-9]{40}$/.test(event.before || '') && !/^0+$/.test(event.before)) {
          baseBranch = event.before;
        }
      }

      core.info(`Base branch for diff: ${baseBranch}`);
      filesToScan = getChangedFiles(baseBranch);
      changedLineMap = getChangedLineMap(baseBranch);
      core.info(`Changed files: ${filesToScan.length}`);
    } else {
      // Full scan: walk the entire repo
      filesToScan = walkDirectory(process.cwd());
      core.info(`Total files found: ${filesToScan.length}`);
    }

    // Filter to scannable files
    filesToScan = filesToScan.filter(f => isLikelyTextFile(f));
    core.info(`Scannable files: ${filesToScan.length}`);

    // --- Scan each file ---
    const allIssues = [];

    for (const filePath of filesToScan) {
      const content = readFileContent(filePath);
      if (!content) continue;

      const issues = scanContentWithLines(content, filePath);

      // In diff-only mode, keep only findings on changed lines
      if (scanMode === "diff-only" && changedLineMap[filePath]) {
        const changedLines = new Set(changedLineMap[filePath]);
        const filtered = issues.filter(i => changedLines.has(i.line));
        allIssues.push(...filtered);
      } else if (scanMode === "diff-only" && !changedLineMap[filePath]) {
        // File is changed but no specific line info — include all findings
        allIssues.push(...issues);
      } else {
        allIssues.push(...issues);
      }
    }

    core.info(`\nTotal raw findings: ${allIssues.length}`);

    let finalIssues = allIssues;

    // --- AI Context Triage ---
    if (llmEnabled && allIssues.length > 0) {
      core.info("\n--- Initializing AI Agent Analysis ---");
      const { analyzeFindingsWithLLM } = require("../lib/llm-analyzer");

      finalIssues = await analyzeFindingsWithLLM(allIssues, {
        provider: llmProvider,
        apiKey: llmApiKey,
        enableCache: true,
        verbose: true
      });
      core.info(`AI agent filtered findings from ${allIssues.length} down to ${finalIssues.length}`);
    } else if (llmEnabled && allIssues.length === 0) {
      core.info("\n--- No findings to analyze with AI ---");
    }

    // --- Compute metrics ---
    const score = calculateScore(finalIssues);
    const counts = countBySeverity(finalIssues);

    core.info(`Score: ${score}/100`);
    core.info(`HIGH: ${counts.HIGH} | MEDIUM: ${counts.MEDIUM} | LOW: ${counts.LOW}`);

    // --- Set outputs ---
    core.setOutput("score", score.toString());
    core.setOutput("total-findings", finalIssues.length.toString());
    core.setOutput("high-count", counts.HIGH.toString());
    core.setOutput("medium-count", counts.MEDIUM.toString());
    core.setOutput("low-count", counts.LOW.toString());

    const riskLevel = counts.HIGH >= 1 ? "CRITICAL" : counts.MEDIUM >= 2 ? "HIGH" : counts.MEDIUM >= 1 ? "MEDIUM" : counts.LOW >= 1 ? "LOW" : "SECURE";
    core.setOutput("risk-level", riskLevel);

    // --- Emit inline annotations ---
    emitAnnotations(finalIssues, core);

    // --- Post PR comment ---
    const githubToken = process.env.GITHUB_TOKEN || "";
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const repository = process.env.GITHUB_REPOSITORY || "";

    if (githubToken && eventPath && repository) {
      try {
        const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
        const prNumber = event.pull_request?.number || event.number;
        const [owner, repo] = repository.split("/");

        if (prNumber && owner && repo) {
          await postPRComment({
            token: githubToken,
            owner,
            repo,
            prNumber,
            issues: finalIssues,
            repoName: repository
          });
        } else {
          core.info("[agent] Not a PR event — skipping PR comment.");
        }
      } catch (err) {
        core.info(`[agent] Could not post PR comment: ${err.message}`);
      }
    }

    // --- Write SARIF output ---
    if (sarifOutput) {
      const sarif = generateSarifReport(finalIssues);
      fs.writeFileSync(sarifOutput, JSON.stringify(sarif, null, 2));
      core.info(`SARIF report written to: ${sarifOutput}`);
    }

    // --- Determine pass/fail ---
    const thresholdLevel = SEVERITY_LEVELS[severityThreshold] || 3;
    const breached = finalIssues.some(i => (SEVERITY_LEVELS[i.severity] || 0) >= thresholdLevel);

    if (breached && failOnFindings) {
      core.setFailed(
        `Security scan failed: Found findings at or above ${severityThreshold} severity. ` +
        `Score: ${score}/100 | HIGH: ${counts.HIGH} | MEDIUM: ${counts.MEDIUM} | LOW: ${counts.LOW}`
      );
    } else {
      core.info(`\n✅ Security scan completed. Score: ${score}/100`);
    }

  } catch (error) {
    if (core) core.setFailed(`Security Agent error: ${error.message}`);
    else { console.error("Security Agent toolkit could not be loaded."); process.exitCode = 1; }
  }
}

/**
 * Recursively walks a directory for full-scan mode.
 */
function walkDirectory(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(process.cwd(), fullPath);

    if (entry.isDirectory()) {
      // Skip hidden dirs and common excluded dirs
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      walkDirectory(fullPath, fileList);
    } else {
      fileList.push(relativePath);
    }
  }
  return fileList;
}

run();
