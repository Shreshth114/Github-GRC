/**
 * lib/llm-analyzer.js — Central Engine for Contextual LLM Triage
 *
 * Uses native fetch() to avoid requiring the 'openai' or '@anthropic' SDK dependencies.
 * Processes an array of raw heuristic findings and augments them with LLM JSON classifications.
 */

const fs = require("fs");
const { SYSTEM_PROMPT, buildFindingPrompt } = require("./prompts");
const { loadCache, saveCache, hashFinding } = require("./cache");

/**
 * Analyzes a single finding against OpenAI's API.
 *
 * @param {Object} finding
 * @param {string} apiKey
 * @returns {Object|null} The parsed JSON verdict, or null if failed.
 */
async function queryOpenAI(finding, apiKey, model = "gpt-4o-mini") {
  const url = "https://api.openai.com/v1/chat/completions";

  const payload = {
    model,
    temperature: 0.1, // Deterministic logic, fewer hallucinations
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildFindingPrompt(finding) }
    ],
    response_format: { type: "json_object" }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[LLM] OpenAI API Error (${response.status}):`, errorBody);
    return null;
  }

  const jsonResponse = await response.json();
  const rawContent = jsonResponse.choices[0].message.content;

  try {
    return JSON.parse(rawContent);
  } catch (err) {
    console.error("[LLM] Failed to parse OpenAI JSON output:", rawContent);
    return null;
  }
}

/**
 * Amplifies an array of findings with AI context logic.
 * Drops findings classified as FALSE_POSITIVE.
 *
 * @param {Array} rawFindings
 * @param {Object} options
 * @returns {Array} Processed, context-aware findings
 */
async function analyzeFindingsWithLLM(rawFindings, options) {
  const { provider = "openai", apiKey, model, enableCache = true, verbose = true } = options;

  if (!apiKey) {
    console.warn("⚠️  LLM API key missing. Falling back to dumb regex output.");
    return rawFindings;
  }

  const cache = enableCache ? loadCache() : {};
  let cacheWrites = 0;
  let apiCalls = 0;

  const validFindings = [];

  for (const finding of rawFindings) {
    const hash = hashFinding(finding);

    // Check Cache Hit
    if (enableCache && cache[hash]) {
      if (verbose) console.log(`[LLM Cache Hit] ${finding.message} in ${finding.file}`);

      const cachedVerdict = cache[hash];
      if (cachedVerdict.status === "FALSE_POSITIVE") {
        continue; // Drop the false positive
      }

      // Override finding with cached verdict
      validFindings.push({
        ...finding,
        severity: cachedVerdict.severity || finding.severity,
        message: `${finding.message} (${cachedVerdict.provider || "Service"} Credential)`,
        snippet: finding.snippet,
        explanation: cachedVerdict.reasoning,
        suggestedFix: cachedVerdict.remediation,
        confidence: cachedVerdict.confidence || 80
      });
      continue;
    }

    if (verbose) process.stdout.write(`[LLM Analysis] Scanning ${finding.file}:${finding.line || "?"}... `);

    // Call API (throttle slightly if queueing massively)
    let verdict = null;
    try {
      if (provider.toLowerCase() === "openai") {
        verdict = await queryOpenAI(finding, apiKey, model || "gpt-4o-mini");
        apiCalls++;
      } else {
        console.warn(`\n[LLM] Unsupported provider: ${provider}. Use 'openai'.`);
        break;
      }
    } catch(err) {
      console.error("\n[LLM] Network failure:", err.message);
    }

    if (verdict) {
      if (verbose) console.log(`Verdict: ${verdict.status} (${verdict.severity})`);

      // Cache success
      if (enableCache) {
        cache[hash] = verdict;
        cacheWrites++;
      }

      if (verdict.status === "TRUE_POSITIVE") {
        validFindings.push({
          ...finding,
          severity: verdict.severity || finding.severity,
          message: `${finding.message} (${verdict.provider || "Service"} Credential)`,
          explanation: verdict.reasoning,
          suggestedFix: verdict.remediation,
          confidence: verdict.confidence || 90
        });
      }
    } else {
      if (verbose) console.log("Fallback to regex.");
      // Fallback
      validFindings.push(finding);
    }

    // Mini throttle to prevent aggressive 429s (200ms per finding)
    await new Promise(r => setTimeout(r, 200));
  }

  if (enableCache && cacheWrites > 0) {
    saveCache(cache);
    if (verbose) console.log(`[LLM Cache] Wrote ${cacheWrites} new verdicts to disk.`);
  }

  return validFindings;
}

module.exports = {
  analyzeFindingsWithLLM
};
