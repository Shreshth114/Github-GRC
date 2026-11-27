/**
 * lib/cache.js — Disk-based LLM Finding Cache
 *
 * Hashes inputs and caches LLM responses in a local `.security-cache.json` file.
 * This saves AI API costs when running CI on untouched lines/files across PR rebases.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CACHE_FILE = path.join(process.cwd(), ".security-cache.json");

/**
 * Loads the cache from disk if it exists.
 */
function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch (e) {
      console.error("[cache] Failed to parse cache file. Starting fresh.", e.message);
      return {};
    }
  }
  return {};
}

/**
 * Saves the cache object to disk.
 */
function saveCache(cacheData) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
  } catch (e) {
    console.error("[cache] Failed to write cache file.", e.message);
  }
}

/**
 * Computes a SHA-256 hash representing a specific finding instance.
 * @param {Object} finding
 * @returns {string} HEX encoded hash
 */
function hashFinding(finding) {
  const hash = crypto.createHash("sha256");
  hash.update(finding.file || "");
  hash.update(finding.snippet || "");
  hash.update(finding.message || "");
  return hash.digest("hex");
}

module.exports = {
  loadCache,
  saveCache,
  hashFinding
};
