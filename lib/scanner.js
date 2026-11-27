/**
 * lib/scanner.js — Core Security Detection Engine
 *
 * Extracted from server.js to be reusable across:
 * - Express dashboard (server.js)
 * - GitHub Action agent (agent/index.js)
 * - CLI usage
 */

const patterns = [
  {
    severity: "HIGH",
    message: "AWS secret detected",
    // Split the rule's own spelling so scanning this source does not flag the detector itself.
    regex: new RegExp('(?:aws_secret_' + 'access_key|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|A3T[A-Z0-9]{16})', 'i')
  },
  {
    severity: "HIGH",
    message: "Private key exposed",
    regex: /-----BEGIN (?:RSA|EC|DSA|OPENSSH|PRIVATE) PRIVATE KEY-----/
  },
  {
    severity: "MEDIUM",
    message: "Firebase API key pattern detected",
    regex: /AIza[0-9A-Za-z\-_]{35}/
  },
  {
    severity: "MEDIUM",
    message: "API key found in code",
    regex: /\b(?:api[_-]?key|apikey)\b\s*[:=]\s*["'][^"']{8,}["']/i
  },
  {
    severity: "MEDIUM",
    message: "Token assignment detected",
    regex: /\b(?:token|auth[_-]?token|access[_-]?token)\b\s*[:=]\s*["'][^"']{8,}["']/i
  },
  {
    severity: "LOW",
    message: "Password variable detected",
    regex: /\bpassword\b\s*[:=]/i
  },
  {
    severity: "LOW",
    message: "Secret variable detected",
    regex: /\bsecret\b\s*[:=]/i
  },
  {
    severity: "LOW",
    message: ".env reference found",
    regex: /\.env\b/i
  },
  {
    severity: "HIGH",
    message: "Potential private SSH key detected",
    regex: /\bssh-rsa\s+[A-Za-z0-9+/=]+/
  }
];

const severityDeduction = {
  HIGH: 25,
  MEDIUM: 10,
  LOW: 2
};

const EXCLUDED_DIRS = ["node_modules/", "dist/", "build/", "vendor/"];
const EXCLUDED_EXTENSIONS = [".min.js"];

const ALLOWED_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".rb", ".go", ".php", ".cs",
  ".cpp", ".c", ".h", ".hpp", ".swift", ".kt", ".rs", ".scala", ".sh", ".bash",
  ".zsh", ".env", ".json", ".yaml", ".yml", ".toml", ".ini", ".xml", ".html",
  ".css", ".scss", ".md", ".txt", ".conf", ".config", ".sql", ".properties"
];

const BLOCKED_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf", ".zip",
  ".tar", ".gz", ".jar", ".war", ".exe", ".dll", ".so", ".dylib", ".mp3",
  ".mp4", ".mov", ".avi", ".woff", ".woff2", ".ttf", ".eot", ".class"
];

/**
 * Determines if a file should be scanned based on its path/extension.
 */
function isLikelyTextFile(filePath) {
  const lower = filePath.toLowerCase();

  if (EXCLUDED_DIRS.some(dir => lower.includes(dir))) return false;
  if (EXCLUDED_EXTENSIONS.some(ext => lower.endsWith(ext))) return false;
  if (BLOCKED_EXTENSIONS.some(ext => lower.endsWith(ext))) return false;
  if (ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
  return !lower.includes(".");
}

/**
 * Scans file content against all patterns.
 * Returns file-level findings (one per matched pattern).
 */
function scanContent(content, filePath) {
  const issues = [];
  for (const pattern of patterns) {
    if (pattern.regex.test(content)) {
      issues.push({
        severity: pattern.severity,
        file: filePath,
        message: pattern.message
      });
    }
  }
  return issues;
}

/**
 * Scans file content with LINE-LEVEL precision.
 * Returns findings with exact line numbers for CI/CD annotations.
 */
function scanContentWithLines(content, filePath) {
  const lines = content.split("\n");
  const issues = [];

  for (const pattern of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.regex.test(lines[i])) {
        issues.push({
          severity: pattern.severity,
          file: filePath,
          line: i + 1,
          message: pattern.message,
          snippet: lines[i].trim().substring(0, 120)
        });
      }
    }
  }
  return issues;
}

/**
 * Calculates the security score from a list of issues.
 */
function calculateScore(issues) {
  let score = 100;
  for (const issue of issues) {
    score -= severityDeduction[issue.severity] || 0;
  }
  return Math.max(0, score);
}

/**
 * Counts findings by severity.
 */
function countBySeverity(issues) {
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const issue of issues) {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
  }
  return counts;
}

module.exports = {
  patterns,
  severityDeduction,
  isLikelyTextFile,
  scanContent,
  scanContentWithLines,
  calculateScore,
  countBySeverity
};
