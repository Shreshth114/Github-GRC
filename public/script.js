const repoInput = document.getElementById("repoUrl");
const scanBtn = document.getElementById("scanBtn");
const startMonBtn = document.getElementById("startMonBtn");
const stopMonBtn = document.getElementById("stopMonBtn");
const timelineSection = document.getElementById("timelineSection");
const resultsEl = document.getElementById("results");

const scoreValue = document.getElementById("scoreValue");
const scoreGauge = document.getElementById("scoreGauge");
const breachRiskLabel = document.getElementById("breachRiskLabel");
const exploitLikelihoodVal = document.getElementById("exploitLikelihoodVal");

const repoVisibility = document.getElementById("repoVisibility");
const repoStars = document.getElementById("repoStars");
const repoForks = document.getElementById("repoForks");
const ampFactorLabel = document.getElementById("ampFactorLabel");

const metricFiles = document.getElementById("metricFiles");
const metricTime = document.getElementById("metricTime");
const metricBranch = document.getElementById("metricBranch");

const summaryTotal = document.getElementById("summaryTotal");
const sumHigh = document.getElementById("sumHigh");
const sumMedium = document.getElementById("sumMedium");
const sumLow = document.getElementById("sumLow");

const intelSummary = document.getElementById("intelSummary");
const cicdCard = document.getElementById("cicdCard");
const cicdList = document.getElementById("cicdList");
const propCard = document.getElementById("propCard");
const propList = document.getElementById("propList");
const attackChainCard = document.getElementById("attackChainCard");
const attackChainWrapper = document.getElementById("attackChainWrapper");
const historyList = document.getElementById("historyList");
const issuesListEl = document.getElementById("issuesList");

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

// Monitoring Elements
const liveMonitoringPanel = document.getElementById("liveMonitoringPanel");
const monRepoName = document.getElementById("monRepoName");
const monLastSha = document.getElementById("monLastSha");
const activityFeed = document.getElementById("activityFeed");
const activeMonitorAlert = document.getElementById("activeMonitorAlert");

// Alert Banner
const liveAlertBanner = document.getElementById("liveAlertBanner");
const liveAlertText = document.getElementById("liveAlertText");
const closeAlertBtn = document.getElementById("closeAlertBtn");

let monitorInterval = null;
let monitoring = false;
let monitorSession = 0;
let monitorController = null;
let scanInProgress = false;
let currentRepoUrl = "";
let lastCommitSha = null;
let lastKnownIssues = []; // Cache to diff

closeAlertBtn.addEventListener("click", () => { liveAlertBanner.classList.add("hidden"); });

const classificationDict = {
  "AWS secret detected": {
    type: "Cloud Credential", impact: "CRITICAL", baseConf: 95,
    attackPaths: ["Cloud Login", "S3 Storage Exploit", "Data Exfiltration"],
    detected: 'const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE"',
    suggested: 'const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY;',
    recom: ["Identify leaked key via AWS IAM Console", "Revoke access immediately", "Rotate compromised credentials", "Purge from .git history"]
  },
  "Private key exposed": {
    type: "Cryptographic Key", impact: "CRITICAL", baseConf: 99,
    attackPaths: ["Extract private key", "Spoof Identity", "Man-in-the-Middle Attack"],
    detected: 'const pkey = "-----BEGIN PRIVATE KEY-----..."',
    suggested: 'const pkey = loadSecureKeyFromHSM();',
    recom: ["Revoke the compromised certificate/key", "Generate new keys via secure terminal", "Implement Hardware Security Module (HSM)"]
  },
  "Public SSH key reference": {
    type: "Public Key Reference", impact: "LOW", baseConf: 30,
    attackPaths: ["Review intended access", "Confirm key ownership"],
    detected: 'ssh-rsa AAAAB3NzaC1... user@host',
    suggested: '// Key correctly moved out of application logic',
    recom: ["Public keys are not private credentials", "Confirm that the key is intended and its access remains appropriate"]
  },
  "Firebase API key pattern detected": {
    type: "Service Credential", impact: "HIGH", baseConf: 88,
    attackPaths: ["API key extraction", "Bypass frontend rules", "Mass database dump"],
    detected: 'apiKey: "AIzaSyB-EXAMPLE_KEY_12345"',
    suggested: 'apiKey: process.env.FIREBASE_API_KEY,',
    recom: ["Rotate Firebase Key in Google Cloud Panel", "Implement strict Realtime/Firestore Security Rules", "Leverage App Check"]
  },
  "API key found in code": {
    type: "Service Credential", impact: "HIGH", baseConf: 65,
    attackPaths: ["API quota hijacking", "Unauthorized platform actions", "Lateral pivoting"],
    detected: 'const apiKey = "sk_live_1234567890"',
    suggested: 'const apiKey = getSecretManager("API_KEY");',
    recom: ["Audit provider logs for suspicious activity", "Invalidate and regenerate key", "Add IP restrictions to new key"]
  },
  "Token assignment detected": {
    type: "Auth Token", impact: "CRITICAL", baseConf: 60,
    attackPaths: ["Token discovery", "Session Hijacking", "Privilege Escalation"],
    detected: 'const authToken = "eyJh...123"',
    suggested: 'const authToken = await refreshAuthSession();',
    recom: ["Terminate active session mappings immediately", "Lower global token expiration limits", "Verify IP binding if applicable"]
  },
  "Password variable detected": {
    type: "Hardcoded Secret", impact: "CRITICAL", baseConf: 55,
    attackPaths: ["Password extraction", "Direct Admin Portal Login", "Complete System Ownership"],
    detected: 'const dbPassword = "SuperSecretPassword123!"',
    suggested: 'const dbPassword = process.env.DB_PASSWORD;',
    recom: ["Reset administrative password", "Implement salted hashing algorithms", "Deploy multi-factor authentication (MFA)"]
  },
  "Secret variable detected": {
    type: "Hardcoded Secret", impact: "MEDIUM", baseConf: 45,
    attackPaths: ["Secret parsing", "Cryptographic seed tampering", "Application logic subversion"],
    detected: 'const secret = "my_secret_sauce"',
    suggested: 'const secret = process.env.APP_SECRET;',
    recom: ["Identify the context of the generic secret", "Rotate sequence logic", "Avoid hardcoding any strings labeled 'secret'"]
  },
  ".env reference found": {
    type: "Configuration Reference", impact: "LOW", baseConf: 30,
    attackPaths: ["Review the referenced configuration"],
    detected: 'A .env reference was matched; this alone does not establish an exposed file',
    suggested: '# Add .env to .gitignore\\nnode_modules/\\n.env',
    recom: ["Check whether the reference points to a committed secret file or documentation", "Keep real credential files out of Git", "Rotate credentials only if exposure is confirmed"]
  }
};

const defaultClassification = {
  type: "Anomaly", impact: "MEDIUM", baseConf: 40,
  attackPaths: ["System profiling", "Targeted exploit generation"],
  detected: 'const data = "anomalous_string"',
  suggested: 'const data = env.SECURE;',
  recom: ["Conduct deep manual code review", "Abstract sensitive material"]
};

function getClassification(message) { return classificationDict[message] || defaultClassification; }

function updateGauge(score) {
  let color = "var(--red)";
  let label = "CRITICAL RISK";
  if (score >= 90) { color = "var(--green)"; label = "SECURE"; }
  else if (score >= 70) { color = "var(--yellow)"; label = "LOW RISK"; }
  else if (score >= 50) { color = "var(--orange)"; label = "MODERATE RISK"; }
  else if (score >= 30) { color = "var(--orange)"; label = "HIGH RISK"; }
  
  scoreValue.textContent = score;
  scoreValue.style.color = color;
  scoreGauge.style.background = `conic-gradient(${color} ${score * 3.6}deg, var(--bg-glass) 0deg)`;
}

function renderTimeline() {
  timelineSection.classList.remove("hidden");
}

function attachFixHandlers(buttonId, snippet) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (buttonId.includes("copy")) {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(snippet);
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy example"; }, 2000);
      } catch {
        showFeedback('Could not copy to the clipboard. You can select the displayed example or download it.', true);
      }
    } else {
      try {
        const blob = new Blob([snippet], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'remediation_example.txt';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch { showFeedback('Could not download the example. You can select the displayed text.', true); }
    }
  });
}

function renderUI(data, durationMs, repoUrl, isSilent) {
  const score = data.score || 0;
  updateGauge(score);
  
  // --- First pass: count severities for risk logic ---
  let high = 0, medium = 0, low = 0;
  data.issues.forEach(issue => {
    if (issue.severity === "HIGH") high++;
    else if (issue.severity === "MEDIUM") medium++;
    else low++;
  });

  // --- Breach Risk: count-based, not score-based ---
  let riskAssessment = "NO MATCHES";
  if (high >= 1) { riskAssessment = "CRITICAL"; breachRiskLabel.className = "glow-val red"; }
  else if (medium >= 2) { riskAssessment = "HIGH"; breachRiskLabel.className = "glow-val orange"; }
  else if (medium >= 1) { riskAssessment = "MEDIUM"; breachRiskLabel.className = "glow-val yellow"; }
  else if (low >= 1) { riskAssessment = "LOW"; breachRiskLabel.className = "glow-val green"; }
  else { breachRiskLabel.className = "glow-val green"; }
  breachRiskLabel.textContent = riskAssessment;

  // --- Exploit Likelihood: deterministic formula ---
  let exploitVal = Math.min(100, (high * 40) + (medium * 15) + (low * 3));
  exploitLikelihoodVal.textContent = exploitVal + "/100";

  let vis = "Public", st = 0, fk = 0, branchName = "main";
  if (data.repoMeta) { vis = data.repoMeta.visibility; st = data.repoMeta.stars; fk = data.repoMeta.forks; branchName = data.repoMeta.branch; }
  repoVisibility.textContent = vis; repoStars.textContent = st; repoForks.textContent = fk;
  
  let ampClass = "green", ampLabel = "LOW";
  let visScore = vis.toLowerCase() === "public" ? 50 : 0;
  if ((visScore + st + (fk*2)) > 100) { ampLabel = "HIGH"; ampClass = "red"; }
  else if ((visScore + st) > 50) { ampLabel = "MEDIUM"; ampClass = "orange"; }
  ampFactorLabel.textContent = ampLabel; ampFactorLabel.className = `glow-val ${ampClass}`;

  if (metricFiles) metricFiles.textContent = data.scanMeta?.filesScanned ?? "Unavailable";
  if (metricTime) metricTime.textContent = (durationMs/1000).toFixed(2) + "s";
  if (metricBranch) metricBranch.textContent = branchName;

  issuesListEl.innerHTML = "";
  
  const propagationMap = {}; 
  const cicdMatches = [];
  const attackChains = new Set();
  let aiInsightsHTML = "";

  if (data.issues.length === 0) {
    issuesListEl.innerHTML = "<div class='glass-card' style='text-align:center;color:var(--green);'>No matching patterns found in the scanned files. This does not establish security or compliance.</div>";
    aiInsightsHTML += "<p>No heuristic matches found in scanned files.</p>";
  }
  if (data.scanMeta && !data.scanMeta.complete) {
    aiInsightsHTML += `<p>Partial scan: ${data.scanMeta.filesScanned} files scanned, ${data.scanMeta.filesSkipped} skipped, ${data.scanMeta.filesFailed} failed, ${data.scanMeta.filesUnprocessed || 0} not processed. File or tree limits reached: ${Boolean(data.scanMeta.truncated)}. ${escapeHTML(data.scanMeta.stopReason || '')}</p>`;
  }

  // Delta Warning Generation during Live Monitor
  if (isSilent) {
     const newItems = data.issues.filter(i => !lastKnownIssues.some(old => old.file === i.file && old.message === i.message));
     if(newItems.length > 0) {
        liveAlertText.textContent = `New ${newItems[0].message} detected in ${newItems[0].file} at commit ${data.repoMeta.commitSha.substring(0,7)}.`;
        liveAlertBanner.classList.remove("hidden");
     }
  }
  lastKnownIssues = data.issues;

  data.issues.forEach((issue, idx) => {
    // (counts already computed above)
    
    if(!propagationMap[issue.message]) propagationMap[issue.message] = new Set();
    propagationMap[issue.message].add(issue.file);

    const lowerFile = issue.file.toLowerCase();
    if (lowerFile.includes(".github/workflows") || lowerFile.includes(".gitlab-ci") || lowerFile.includes("jenkinsfile") || lowerFile.includes("circleci") || lowerFile.includes("azure-pipelines")) {
      cicdMatches.push(`${issue.file} [${issue.severity}]`);
    }

    const classification = getClassification(issue.message);

    // Only build attack chains for HIGH/MEDIUM findings
    if (issue.severity !== "LOW") {
      let chainStr = [classification.type, ...classification.attackPaths].join("||");
      attackChains.add(chainStr);
    }

    let conf = classification.baseConf;
    if (lowerFile.endsWith(".json") || lowerFile.endsWith(".env") || lowerFile.includes("config")) conf += 12;

    // Demote LOW findings in test/demo/example files
    let isDevPlaceholder = false;
    if (issue.severity === "LOW" && (lowerFile.includes("test") || lowerFile.includes("demo") || lowerFile.includes("example") || lowerFile.includes("sample"))) {
      conf = Math.min(conf, 25);
      isDevPlaceholder = true;
    }
    if (conf > 99) conf = 99;

    const card = document.createElement("div");
    card.className = "issue-card";
    
    // Map impact label to match severity
    let displayImpact = "LOW";
    let shadowVar = "var(--glow-green)"; let impactColor = "green";
    if(issue.severity === "HIGH") { shadowVar = "var(--glow-red)"; impactColor = "red"; displayImpact = "CRITICAL"; }
    if(issue.severity === "MEDIUM") { shadowVar = "var(--glow-orange)"; impactColor = "orange"; displayImpact = "HIGH"; }
    if(issue.severity === "LOW") { shadowVar = "var(--glow-yellow)"; impactColor = "yellow"; displayImpact = "LOW"; }
    card.style.boxShadow = shadowVar;
    
    const hdr = document.createElement("div");
    hdr.className = "issue-card-header";
    hdr.innerHTML = `
      <div class="issue-header-wrap">
        <h3 class="issue-title">${escapeHTML(issue.message)}</h3>
        <div class="issue-primary">
          <span class="badge glow-${issue.severity.toLowerCase()}">${issue.severity} Severity</span>
          <span class="issue-type">${classification.type}</span>
        </div>
      </div>
      <div class="confidence-block">
        Rule weight: <span class="confidence-val" style="border-color:${conf>85?'var(--green)':'var(--orange)'};">${conf}/100</span>
      </div>
    `;

    let recList = classification.recom.map((r, i) => `<li>${i+1}. ${r}</li>`).join("");

    const body = document.createElement("div");
    body.className = "issue-card-body";
    body.innerHTML = `
      <div class="issue-file">Source: ${escapeHTML(issue.file)}</div>
      <div class="metrics-row">
        <div class="explanation-block">
          <h4>Potential Impact</h4>
          <p class="impact-high" style="color:var(--${impactColor})!important">${isDevPlaceholder ? 'LOW (Dev Placeholder)' : displayImpact}</p>
          ${isDevPlaceholder ? '<p style="color:var(--text-muted);font-size:13px;margin-top:6px;">This appears to be a development example rather than an exposed credential.</p>' : ''}
        </div>
        <div class="explanation-block">
          <h4>Revocation Assistant</h4>
          <ol style="margin-top:0">${recList}</ol>
        </div>
      </div>
      <div class="code-suggestion-block">
        <h5>Illustrative remediation — not source code or an automatic patch</h5>
        <div class="code-diff">
          <div class="code-line detected">${escapeHTML(classification.detected)}</div>
          <div class="code-line secure">${escapeHTML(classification.suggested)}</div>
        </div>
        <div class="automation-actions">
           <button class="btn-sm" id="copyFix_${idx}">Copy example</button>
           <button class="btn-sm" id="dlPatch_${idx}">Download example</button>
        </div>
      </div>
    `;

    card.appendChild(hdr);
    card.appendChild(body);
    issuesListEl.appendChild(card);
    
    attachFixHandlers(`copyFix_${idx}`, classification.suggested);
    attachFixHandlers(`dlPatch_${idx}`, classification.suggested);
  });

  summaryTotal.textContent = `${data.issues.length} Findings`;
  sumHigh.textContent = high; sumMedium.textContent = medium; sumLow.textContent = low;

  cicdList.innerHTML = "";
  if (cicdMatches.length > 0) {
    cicdCard.classList.remove("hidden"); cicdCard.classList.add("glow-card");
    cicdMatches.slice(0, 4).forEach(c => { const li = document.createElement("li"); li.textContent = c; cicdList.appendChild(li); });
    aiInsightsHTML += `<p><span style="color:var(--red)">CI/CD review:</span> Patterns matched in pipeline files. Review the source before classifying them as leaked credentials.</p>`;
  } else { cicdCard.classList.add("hidden"); }

  propList.innerHTML = "";
  let propagationFound = false;
  Object.keys(propagationMap).forEach(key => {
    let files = Array.from(propagationMap[key]);
    if (files.length > 1) { 
      propagationFound = true;
      const root = document.createElement("div"); root.className = "prop-root"; root.textContent = key; propList.appendChild(root);
      files.forEach(f => { const leaf = document.createElement("div"); leaf.className = "prop-leaf"; leaf.textContent = f; propList.appendChild(leaf); });
    }
  });
  if (propagationFound) {
    propCard.classList.remove("hidden");
    aiInsightsHTML += `<p><span style="color:var(--orange)">Repeated patterns:</span> The same rule matched multiple files. This does not establish that the same credential was reused.</p>`;
  } else { propCard.classList.add("hidden"); }

  attackChainWrapper.innerHTML = "";
  if (attackChains.size > 0) {
    attackChainCard.classList.remove("hidden");
    Array.from(attackChains).slice(0,2).forEach(chainStr => {
      let parts = chainStr.split("||");
      const d = document.createElement("div"); d.style.display = "flex"; d.style.flexDirection = "column"; d.style.gap = "8px"; d.style.marginBottom = "20px";
      parts.forEach((p, idx) => {
        let node = document.createElement("div"); node.className = `chain-node ${idx===0 ? 'origin' : ''}`; node.textContent = p; d.appendChild(node);
        if (idx !== parts.length - 1) { let arrow = document.createElement("div"); arrow.className = "chain-arrow"; arrow.innerHTML = "▼"; d.appendChild(arrow); }
      });
      attackChainWrapper.appendChild(d);
    });
    aiInsightsHTML += `<p><span style="color:var(--yellow)">Illustrative attack paths:</span> These are generic scenarios for review, not verified exploits.</p>`;
  } else { attackChainCard.classList.add("hidden"); }
  
  if(ampLabel === "HIGH") { aiInsightsHTML += `<p>Repository popularity contributes to the heuristic exposure indicator; it does not measure compromise likelihood.</p>`; }

  // Improved intelligence summary for LOW-only results
  if (high === 0 && medium === 0 && low > 0 && aiInsightsHTML === "") {
    aiInsightsHTML = `<p><span style="color:var(--green)">Minor Patterns:</span> Minor development credential patterns detected. No confirmed credential leaks. These findings are informational and represent low-confidence matches commonly found in documentation, test suites, or placeholder configurations.</p>`;
  }

  intelSummary.innerHTML = aiInsightsHTML || '<p>Review the matched patterns against their source files.</p>';
  document.getElementById('resultsSource').textContent = `${repoUrl} · commit ${data.repoMeta.commitSha}`;

  if (!isSilent) saveHistory(repoUrl, score);
}

function readHistory() {
  try {
    const hist = JSON.parse(localStorage.getItem('scanHistory') || '[]');
    return Array.isArray(hist) ? hist.filter(h => h && typeof h.repo === 'string' &&
      Number.isFinite(h.score) && h.score >= 0 && h.score <= 100).slice(0, 5) : [];
  } catch { return []; }
}

function saveHistory(repo, score) {
  let hist = readHistory();
  hist = hist.filter(h => h.repo !== repo);
  hist.unshift({ repo, score });
  if (hist.length > 5) hist.pop();
  try { localStorage.setItem("scanHistory", JSON.stringify(hist)); } catch { /* History is optional. */ }
  renderHistory();
}

function renderHistory() {
  let hist = readHistory();
  historyList.innerHTML = "";
  if (hist.length === 0) { historyList.innerHTML = "<li style='color:var(--text-muted)'>No previous scans stored.</li>"; return; }
  hist.forEach(h => {
    const li = document.createElement("li");
    let c = "var(--green)";
    if(h.score < 40) c = "var(--red)"; else if(h.score < 70) c = "var(--orange)"; else if(h.score < 90) c = "var(--yellow)";
    let shortName = h.repo.replace("https://github.com/", ""); if(shortName.length > 20) shortName = shortName.substring(0, 20) + "...";
    li.innerHTML = `<span class="repo-name" title="${escapeHTML(h.repo)}">${escapeHTML(shortName)}</span> <span class="score-badge" style="color:${c}">${escapeHTML(h.score)}</span>`;
    historyList.appendChild(li);
  });
}
renderHistory();

// -------------------------------------------------------------
// Live Monitoring API
// -------------------------------------------------------------

function logActivity(msg) {
  const d = new Date();
  const timeStr = d.toTimeString().split(' ')[0];
  const el = document.createElement("div");
  el.className = "feed-entry";
  el.innerHTML = `<span class="feed-time">${timeStr}</span> <span class="feed-msg">— ${escapeHTML(msg)}</span>`;
  activityFeed.appendChild(el);
  activityFeed.scrollTop = activityFeed.scrollHeight;
}

function showFeedback(message, isError = false) {
  const el = document.getElementById('scanFeedback');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = !message;
}

async function requestJSON(route, payload, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 60000);
  try {
    const response = await fetch(route, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('The service returned an invalid response. Please retry.'); }
    if (!data || typeof data !== 'object') throw new Error('The service returned an invalid response. Please retry.');
    if (!response.ok) {
      const error = new Error(data.error || 'Request failed. Please retry.');
      error.status = response.status;
      error.code = data.code;
      error.retryAfter = Number(response.headers?.get('Retry-After')) || 0;
      throw error;
    }
    if (route === '/scan' && (!Array.isArray(data.issues) || !data.issues.every(issue => issue &&
        ['LOW', 'MEDIUM', 'HIGH'].includes(issue.severity) && typeof issue.file === 'string' && typeof issue.message === 'string') ||
        !Number.isFinite(data.score) || data.score < 0 || data.score > 100 ||
        !/^[a-f0-9]{40}$/i.test(data.repoMeta?.commitSha || ''))) {
      throw new Error('The service returned incomplete scan data. Please retry.');
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError' && !signal?.aborted) throw new Error('The request timed out. Please retry.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function setMonitorStatus(text) {
  document.getElementById('monStatusLbl').textContent = text;
  document.getElementById('monStatusLbl').style.color = monitoring ? 'var(--green)' : 'var(--text-muted)';
}

async function doSilentScan(sha, session) {
  const started = performance.now();
  renderTimeline();
  setMonitorStatus('Scanning');
  const data = await requestJSON('/scan', { repoUrl: currentRepoUrl, commitSha: sha }, monitorController.signal);
  if (!monitoring || session !== monitorSession) return;
  if (data.repoMeta.commitSha !== sha) throw new Error('The scan revision did not match the requested commit. Retrying.');
  renderUI(data, performance.now() - started, currentRepoUrl, lastCommitSha !== null);
  resultsEl.classList.remove('hidden');
  if (data.scanMeta?.filesFailed || data.scanMeta?.filesUnprocessed) {
    const error = new Error('Scan incomplete. Partial results are shown; this commit will be retried.');
    error.retryAfter = 60;
    throw error;
  }
  // Advance the baseline only after a successful scan of that exact revision.
  lastCommitSha = sha;
  monLastSha.textContent = sha.substring(0, 7);
  showFeedback(data.scanMeta?.complete ? 'Scan complete. Monitoring for new commits.' : 'Partial coverage: some files were excluded by scan limits.');
}

async function pollCommit(session = monitorSession) {
  if (!monitoring || session !== monitorSession) return;
  let delay = 5000;
  try {
    const data = await requestJSON('/latest-commit', { repoUrl: currentRepoUrl }, monitorController.signal);
    if (!monitoring || session !== monitorSession) return;
    if (!/^[a-f0-9]{40}$/i.test(data.sha || '')) throw new Error('The service returned an invalid commit reference.');
    if (data.sha !== lastCommitSha) {
      logActivity(`${lastCommitSha ? 'New commit' : 'Initial commit'}: ${data.sha.substring(0, 7)}. Scanning...`);
      await doSilentScan(data.sha, session);
      if (!monitoring || session !== monitorSession) return;
      logActivity(`Scan finished for ${data.sha.substring(0, 7)}.`);
    } else {
      logActivity('No new commits detected.');
    }
    setMonitorStatus('Monitoring');
  } catch (error) {
    if (!monitoring || session !== monitorSession) return;
    showFeedback(error.message, true);
    logActivity(error.message);
    delay = Math.max(delay, error.retryAfter * 1000 || 10000);
    setMonitorStatus('Waiting to retry');
    if ([403, 404, 422].includes(error.status) || error.code === 'github_auth_failed') stopLiveMonitoring();
  } finally {
    if (session === monitorSession) timelineSection.classList.add('hidden');
    if (monitoring && session === monitorSession) {
      // Schedule after completion; slow scans cannot overlap subsequent polls.
      monitorInterval = setTimeout(() => pollCommit(session), delay);
    }
  }
}

async function startLiveMonitoring() {
  if (monitoring || scanInProgress) return;
  const repoUrl = repoInput.value.trim();
  if (!repoUrl) { showFeedback('Enter a public GitHub repository URL.', true); return; }
  monitoring = true;
  const session = ++monitorSession;
  monitorController = new AbortController();
  currentRepoUrl = repoUrl;
  lastCommitSha = null;
  lastKnownIssues = [];
  monLastSha.textContent = '—';
  monRepoName.textContent = repoUrl.replace('https://github.com/', '');
  resultsEl.classList.add('hidden');
  liveAlertBanner.classList.add('hidden');
  startMonBtn.classList.add('hidden');
  stopMonBtn.classList.remove('hidden');
  activeMonitorAlert.classList.remove('hidden');
  liveMonitoringPanel.classList.remove('hidden');
  scanBtn.disabled = true;
  repoInput.disabled = true;
  activityFeed.innerHTML = '';
  showFeedback('');
  setMonitorStatus('Starting');
  logActivity('Monitoring started.');
  await pollCommit(session);
}

function stopLiveMonitoring() {
  monitoring = false;
  monitorSession++;
  if (monitorInterval !== null) clearTimeout(monitorInterval);
  monitorInterval = null;
  monitorController?.abort();
  logActivity('Monitoring stopped.');
  startMonBtn.classList.remove('hidden');
  stopMonBtn.classList.add('hidden');
  activeMonitorAlert.classList.add('hidden');
  liveAlertBanner.classList.add('hidden');
  timelineSection.classList.add('hidden');
  scanBtn.disabled = false;
  repoInput.disabled = false;
  setMonitorStatus('Stopped');
}

async function scanRepository() {
  if (monitoring || scanInProgress) return;
  const repoUrl = repoInput.value.trim();
  if (!repoUrl) { showFeedback('Enter a public GitHub repository URL.', true); return; }
  scanInProgress = true;
  scanBtn.disabled = true;
  startMonBtn.disabled = true;
  repoInput.disabled = true;
  resultsEl.classList.add('hidden');
  liveAlertBanner.classList.add('hidden');
  lastKnownIssues = [];
  showFeedback('');
  renderTimeline();
  const started = performance.now();
  try {
    const data = await requestJSON('/scan', { repoUrl });
    renderUI(data, performance.now() - started, repoUrl, false);
    resultsEl.classList.remove('hidden');
    showFeedback(data.scanMeta?.complete ? 'Scan complete.' : 'Partial scan: review the coverage details in the summary.');
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    scanInProgress = false;
    scanBtn.disabled = false;
    startMonBtn.disabled = false;
    repoInput.disabled = false;
    timelineSection.classList.add('hidden');
  }
}

scanBtn.addEventListener('click', scanRepository);
startMonBtn.addEventListener('click', startLiveMonitoring);
stopMonBtn.addEventListener('click', stopLiveMonitoring);
