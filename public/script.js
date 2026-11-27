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
  "Potential private SSH key detected": {
    type: "Cryptographic Key", impact: "HIGH", baseConf: 85,
    attackPaths: ["Acquire SSH credentials", "Bypass server auth mechanisms", "Remote executing (RCE)"],
    detected: 'ssh-rsa AAAAB3NzaC1... user@host',
    suggested: '// Key correctly moved out of application logic',
    recom: ["Remove `authorized_keys` entry mapping to this key", "Deploy an SSH certificate authority", "Ban key fingerprint across fleets"]
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
    type: "Config Exposure", impact: "CRITICAL", baseConf: 99,
    attackPaths: ["Index configuration files", "Mass extraction of credentials", "Total Environment Takeover"],
    detected: 'File: .env (committed to repo)',
    suggested: '# Add .env to .gitignore\\nnode_modules/\\n.env',
    recom: ["Delete file from Git tracking (`git rm --cached .env`)", "Assess EVERY key inside .env as compromised", "Mass-rotate all variables"]
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
  const steps = [
    document.getElementById("step1"), document.getElementById("step2"),
    document.getElementById("step3"), document.getElementById("step4")
  ];
  steps.forEach(s => { s.classList.remove("active", "done"); });
  return new Promise(resolve => {
    steps[0].classList.add("active");
    setTimeout(() => { steps[0].classList.replace("active", "done"); steps[1].classList.add("active"); }, 800);
    setTimeout(() => { steps[1].classList.replace("active", "done"); steps[2].classList.add("active"); }, 1600);
    setTimeout(() => { steps[2].classList.replace("active", "done"); steps[3].classList.add("active"); }, 2400);
    setTimeout(() => { steps[3].classList.replace("active", "done"); setTimeout(() => resolve(), 300); }, 3200);
  });
}

function attachFixHandlers(buttonId, snippet) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (buttonId.includes("copy")) {
      navigator.clipboard.writeText(snippet);
      btn.textContent = "Copied!"; setTimeout(() => btn.textContent = "Copy Fix", 2000);
    } else {
      const blob = new Blob([snippet], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'remediation_patch.js'; a.click(); URL.revokeObjectURL(url);
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
  let riskAssessment = "SECURE";
  if (high >= 1) { riskAssessment = "CRITICAL"; breachRiskLabel.className = "glow-val red"; }
  else if (medium >= 2) { riskAssessment = "HIGH"; breachRiskLabel.className = "glow-val orange"; }
  else if (medium >= 1) { riskAssessment = "MEDIUM"; breachRiskLabel.className = "glow-val yellow"; }
  else if (low >= 1) { riskAssessment = "LOW"; breachRiskLabel.className = "glow-val green"; }
  else { breachRiskLabel.className = "glow-val green"; }
  breachRiskLabel.textContent = riskAssessment;

  // --- Exploit Likelihood: deterministic formula ---
  let exploitVal = Math.min(100, (high * 40) + (medium * 15) + (low * 3));
  exploitLikelihoodVal.textContent = exploitVal + "%";

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
    aiInsightsHTML += `<p>Partial scan: ${data.scanMeta.filesScanned} files scanned, ${data.scanMeta.filesSkipped} skipped, ${data.scanMeta.filesFailed} failed. File or tree limits reached: ${Boolean(data.scanMeta.truncated)}.</p>`;
  }

  // Delta Warning Generation during Live Monitor
  if (isSilent && lastKnownIssues.length > 0) {
     const newItems = data.issues.filter(i => !lastKnownIssues.some(old => old.file === i.file && old.message === i.message));
     if(newItems.length > 0) {
        liveAlertText.textContent = `New ${newItems[0].message} detected in ${newItems[0].file} after commit ${lastCommitSha ? lastCommitSha.substring(0,6) : 'unknown'}.`;
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
        Conf: <span class="confidence-val" style="border-color:${conf>85?'var(--green)':'var(--orange)'};">${conf}%</span>
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
        <h5>Code Fix Generator</h5>
        <div class="code-diff">
          <div class="code-line detected">${classification.detected}</div>
          <div class="code-line secure">${classification.suggested}</div>
        </div>
        <div class="automation-actions">
           <button class="btn-sm" id="copyFix_${idx}">Copy Fix</button>
           <button class="btn-sm" id="dlPatch_${idx}">Download Patch</button>
        </div>
      </div>
    `;

    card.appendChild(hdr);
    card.appendChild(body);
    issuesListEl.appendChild(card);
    
    setTimeout(() => {
       attachFixHandlers(`copyFix_${idx}`, classification.suggested);
       attachFixHandlers(`dlPatch_${idx}`, classification.suggested);
    }, 0);
  });

  summaryTotal.textContent = `${data.issues.length} Findings`;
  sumHigh.textContent = high; sumMedium.textContent = medium; sumLow.textContent = low;

  cicdList.innerHTML = "";
  if (cicdMatches.length > 0) {
    cicdCard.classList.remove("hidden"); cicdCard.classList.add("glow-card");
    cicdMatches.slice(0, 4).forEach(c => { const li = document.createElement("li"); li.textContent = c; cicdList.appendChild(li); });
    aiInsightsHTML += `<p><span style="color:var(--red)">CI/CD Vulnerability:</span> Secrets found within deployment pipeline configurations, risking mass leakage in build logs.</p>`;
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
    aiInsightsHTML += `<p><span style="color:var(--orange)">Propagation Risk:</span> The same credential pattern was flagged across multiple separate files, indicating systemic poor secret management.</p>`;
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
    aiInsightsHTML += `<p><span style="color:var(--yellow)">Exploit Vector:</span> Attack paths verify that attackers tracking these exposures could easily pivot into deep infrastructure.</p>`;
  } else { attackChainCard.classList.add("hidden"); }
  
  if(ampLabel === "HIGH") { aiInsightsHTML += `<p><span style="color:var(--orange)">Exposure Amplifier:</span> High reputation public repository implies an exponentially larger attacker discovery window.</p>`; }

  // Improved intelligence summary for LOW-only results
  if (high === 0 && medium === 0 && low > 0 && aiInsightsHTML === "") {
    aiInsightsHTML = `<p><span style="color:var(--green)">Minor Patterns:</span> Minor development credential patterns detected. No confirmed credential leaks. These findings are informational and represent low-confidence matches commonly found in documentation, test suites, or placeholder configurations.</p>`;
  }

  if(aiInsightsHTML !== "") intelSummary.innerHTML = aiInsightsHTML;

  if (!isSilent) saveHistory(repoUrl, score);
}

function saveHistory(repo, score) {
  let hist = JSON.parse(localStorage.getItem("scanHistory") || "[]");
  hist = hist.filter(h => h.repo !== repo);
  hist.unshift({ repo, score });
  if (hist.length > 5) hist.pop();
  localStorage.setItem("scanHistory", JSON.stringify(hist));
  renderHistory();
}

function renderHistory() {
  let hist = JSON.parse(localStorage.getItem("scanHistory") || "[]");
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

async function doSilentScan() {
  const startTime = performance.now();
  try {
    const response = await fetch("/scan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoUrl: currentRepoUrl })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderUI(data, performance.now() - startTime, currentRepoUrl, true);
  } catch(e) { logActivity(`Scan error: ${e.message}`); }
}

async function pollCommit() {
  try {
    const response = await fetch("/latest-commit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoUrl: currentRepoUrl })
    });
    const data = await response.json();
    if (response.ok && data.sha) {
      if (!lastCommitSha) {
        lastCommitSha = data.sha;
        monLastSha.textContent = data.sha.substring(0, 7);
        logActivity(`Initial commit established: ${data.sha.substring(0, 7)}`);
      } else if (data.sha !== lastCommitSha) {
        logActivity(`New commit detected: ${data.sha.substring(0, 7)}`);
        logActivity(`Security scan started...`);
        lastCommitSha = data.sha;
        monLastSha.textContent = data.sha.substring(0, 7);
        await doSilentScan();
      } else {
        logActivity("No new commits detected.");
      }
    } else { logActivity("Failed to resolve commit data."); }
  } catch(e) { 
    console.error(e);
    logActivity("Monitoring error but continuing..."); 
  }
}

async function startLiveMonitoring() {
  if (monitorInterval) return;
  const repoUrl = repoInput.value.trim();
  if (!repoUrl) { alert("Target URL required to start monitoring."); return; }
  
  // Set UI state
  currentRepoUrl = repoUrl;
  let shortName = repoUrl.replace("https://github.com/", ""); if(shortName.length > 25) shortName = shortName.substring(0, 25) + "...";
  monRepoName.textContent = shortName;
  
  startMonBtn.classList.add("hidden");
  stopMonBtn.classList.remove("hidden");
  activeMonitorAlert.classList.remove("hidden");
  liveMonitoringPanel.classList.remove("hidden");
  scanBtn.disabled = true;
  
  activityFeed.innerHTML = "";
  logActivity("Monitoring started.");
  lastCommitSha = null;
  
  // Run an initial scan if we don't have results visible
  if (resultsEl.classList.contains("hidden")) {
      await scanRepository();
  } else {
      await pollCommit(); // Grab the SHA immediately
  }
  
  // Interval Loop
  monitorInterval = setInterval(pollCommit, 2000);
}

function stopLiveMonitoring() {
  if (monitorInterval) clearInterval(monitorInterval);
  monitorInterval = null;
  logActivity("Monitoring stopped.");
  
  startMonBtn.classList.remove("hidden");
  stopMonBtn.classList.add("hidden");
  activeMonitorAlert.classList.add("hidden");
  scanBtn.disabled = false;
  liveAlertBanner.classList.add("hidden");
  
  document.getElementById("monStatusLbl").textContent = "Stopped";
  document.getElementById("monStatusLbl").style.color = "var(--text-muted)";
}

// -------------------------------------------------------------
// Manual Action Trigger
// -------------------------------------------------------------
async function scanRepository() {
  const repoUrl = repoInput.value.trim();
  if (!repoUrl) { alert("Target URL required for intelligence gathering."); return; }

  scanBtn.disabled = true;
  resultsEl.classList.add("hidden");
  
  const startTime = performance.now();
  await renderTimeline();

  try {
    const response = await fetch("/scan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoUrl })
    });
    const data = await response.json();
    const durationMs = performance.now() - startTime;
    if (!response.ok) throw new Error(data.error || "Reconnaissance failed");

    renderUI(data, durationMs, repoUrl, false);
    resultsEl.classList.remove("hidden");
  } catch (error) {
    alert(`Intelligence Gathering Error: ${error.message}`);
  } finally {
    timelineSection.classList.add("hidden");
    if(!monitorInterval) scanBtn.disabled = false;
  }
}

scanBtn.addEventListener("click", scanRepository);
startMonBtn.addEventListener("click", startLiveMonitoring);
stopMonBtn.addEventListener("click", stopLiveMonitoring);
