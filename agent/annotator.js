/**
 * agent/annotator.js — GitHub Check Annotations
 *
 * Maps security findings to GitHub Actions annotation commands.
 * These appear inline on the "Files Changed" tab of PRs.
 */

/**
 * Emits GitHub Actions annotation commands for each finding.
 * Annotations appear inline on the PR diff view.
 *
 * @param {Array} issues - Findings with { severity, file, line, message, snippet }
 * @param {Object} core - @actions/core module (or compatible shim)
 */
function emitAnnotations(issues, core) {
  for (const issue of issues) {
    const file = issue.file;
    const line = issue.line || 1;
    const title = `[${issue.severity}] ${issue.message}`;
    const msg = issue.message;

    const properties = { file, startLine: line, title };

    if (issue.severity === "HIGH") {
      core.error(msg, properties);
    } else if (issue.severity === "MEDIUM") {
      core.warning(msg, properties);
    } else {
      core.notice(msg, properties);
    }
  }
}

/**
 * Standalone annotation emitter (no @actions/core dependency).
 * Uses GitHub Actions workflow commands directly via stdout.
 *
 * @param {Array} issues
 */
function emitAnnotationsRaw(issues) {
  for (const issue of issues) {
    const file = issue.file;
    const line = issue.line || 1;
    const title = `[${issue.severity}] ${issue.message}`;
    const msg = issue.message;

    let level = "notice";
    if (issue.severity === "HIGH") level = "error";
    else if (issue.severity === "MEDIUM") level = "warning";

    // GitHub Actions workflow command format
    console.log(`::${level} file=${file},line=${line},title=${title}::${msg}`);
  }
}

module.exports = {
  emitAnnotations,
  emitAnnotationsRaw
};
