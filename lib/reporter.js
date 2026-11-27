/**
 * lib/reporter.js — Output Formatting for Security Findings
 *
 * Formats scan results into:
 * - JSON (for API/dashboard consumption)
 * - Markdown (for PR comments)
 * - SARIF (for GitHub Code Scanning integration)
 */

const { countBySeverity, calculateScore } = require("./scanner");

/**
 * Generates a Markdown summary suitable for PR comments.
 */
function generateMarkdownReport(issues, repoName) {
  const counts = countBySeverity(issues);
  const score = calculateScore(issues);

  let riskLabel = "SECURE";
  let riskEmoji = "🟢";
  if (counts.HIGH >= 1) { riskLabel = "CRITICAL"; riskEmoji = "🔴"; }
  else if (counts.MEDIUM >= 2) { riskLabel = "HIGH"; riskEmoji = "🟠"; }
  else if (counts.MEDIUM >= 1) { riskLabel = "MEDIUM"; riskEmoji = "🟡"; }
  else if (counts.LOW >= 1) { riskLabel = "LOW"; riskEmoji = "🟢"; }

  let md = `## 🔒 Security Agent Report\n\n`;
  md += `**Repository:** \`${repoName || "unknown"}\`\n`;
  md += `**Score:** ${score}/100 | **Risk:** ${riskEmoji} ${riskLabel}\n\n`;

  md += `| Severity | Count |\n`;
  md += `|----------|-------|\n`;
  md += `| 🔴 HIGH  | ${counts.HIGH} |\n`;
  md += `| 🟠 MEDIUM | ${counts.MEDIUM} |\n`;
  md += `| 🟡 LOW   | ${counts.LOW} |\n\n`;

  if (issues.length === 0) {
    md += `✅ **No security issues detected.** This PR looks clean.\n`;
    return md;
  }

  md += `### Findings\n\n`;

  // Group by file
  const byFile = {};
  for (const issue of issues) {
    if (!byFile[issue.file]) byFile[issue.file] = [];
    byFile[issue.file].push(issue);
  }

  for (const [file, fileIssues] of Object.entries(byFile)) {
    for (const issue of fileIssues) {
      const sevEmoji = issue.severity === "HIGH" ? "🔴" : issue.severity === "MEDIUM" ? "🟠" : "🟡";
      const lineRef = issue.line ? `:${issue.line}` : "";
      md += `#### ${sevEmoji} ${issue.message}\n`;
      md += `**File:** \`${file}${lineRef}\`\n`;
      if (issue.snippet) {
        md += `\`\`\`\n[Matched source omitted: may contain credentials]\n\`\`\`\n`;
      }
      md += `\n`;
    }
  }

  // Remediation guidance
  if (counts.HIGH > 0) {
    md += `---\n\n`;
    md += `### ⚠️ Action Required\n\n`;
    md += `This PR contains **${counts.HIGH} HIGH severity** finding(s). `;
    md += `These must be resolved before merging.\n\n`;
    md += `**Immediate steps:**\n`;
    md += `1. Remove hardcoded credentials from source code\n`;
    md += `2. Rotate any exposed secrets immediately\n`;
    md += `3. Use environment variables or a secrets manager\n`;
    md += `4. Add sensitive files to \`.gitignore\`\n`;
  }

  return md;
}

/**
 * Generates SARIF output for GitHub Code Scanning integration.
 * See: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
function generateSarifReport(issues) {
  const rules = [];
  const ruleIndex = {};
  const results = [];

  for (const issue of issues) {
    // Build unique rule entries
    if (!(issue.message in ruleIndex)) {
      ruleIndex[issue.message] = rules.length;
      rules.push({
        id: issue.message.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: issue.message,
        shortDescription: { text: issue.message },
        defaultConfiguration: {
          level: issue.severity === "HIGH" ? "error" : issue.severity === "MEDIUM" ? "warning" : "note"
        },
        properties: {
          "security-severity": issue.severity === "HIGH" ? "9.0" : issue.severity === "MEDIUM" ? "6.0" : "3.0"
        }
      });
    }

    results.push({
      ruleId: issue.message.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      ruleIndex: ruleIndex[issue.message],
      level: issue.severity === "HIGH" ? "error" : issue.severity === "MEDIUM" ? "warning" : "note",
      message: { text: issue.message },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: issue.file },
          region: {
            startLine: issue.line || 1,
            startColumn: 1
          }
        }
      }]
    });
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "security-agent",
          informationUri: "https://github.com/your-org/security-agent",
          version: "1.0.0",
          rules
        }
      },
      results
    }]
  };
}

/**
 * Generates a structured JSON report.
 */
function generateJsonReport(issues, meta) {
  const counts = countBySeverity(issues);
  const score = calculateScore(issues);

  return {
    timestamp: new Date().toISOString(),
    score,
    risk: counts.HIGH >= 1 ? "CRITICAL" : counts.MEDIUM >= 2 ? "HIGH" : counts.LOW >= 1 ? "LOW" : "SECURE",
    summary: counts,
    totalFindings: issues.length,
    findings: issues,
    meta: meta || {}
  };
}

module.exports = {
  generateMarkdownReport,
  generateSarifReport,
  generateJsonReport
};
