const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const HTML = readFileSync('public/index.html', 'utf8');
const SCRIPT = readFileSync('public/script.js', 'utf8');
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const repoA = 'https://github.com/owner/first', repoB = 'https://github.com/owner/second';
const finding = { severity: 'LOW', message: 'Password variable detected', file: 'config.js' };
function scan(sha = A, issues = []) {
  return { score: 98, issues, repoMeta: { commitSha: sha, branch: 'main', visibility: 'public', stars: 0, forks: 0 },
    scanMeta: { complete: true, filesScanned: 1, filesSkipped: 0, filesFailed: 0, filesUnprocessed: 0, truncated: false } };
}
function response(data, status = 200, retry = '0') {
  return { ok: status < 400, status, json: async () => data, headers: { get: () => retry } };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function setup(handler, prepare) {
  const dom = new JSDOM(HTML, { url: 'https://github-grc.onrender.com/', runScripts: 'outside-only' });
  const w = dom.window, calls = [], timers = new Map();
  let id = 0;
  w.setTimeout = (fn, delay) => { timers.set(++id, { fn, delay }); return id; };
  w.clearTimeout = key => timers.delete(key);
  w.matchMedia = () => ({ matches: true });
  w.fetch = async (route, options) => {
    const call = { route, body: JSON.parse(options.body), signal: options.signal };
    calls.push(call);
    return handler(call);
  };
  prepare?.(w);
  w.eval(SCRIPT);
  w.document.getElementById('repoUrl').value = repoA;
  const el = name => w.document.getElementById(name);
  const next = async delay => {
    const entry = [...timers.entries()].find(([, t]) => t.delay === delay);
    assert.ok(entry, `Expected a ${delay}ms timer`);
    timers.delete(entry[0]); await entry[1].fn(); await settle();
  };
  return { dom, w, calls, timers, el, next };
}

test('manual scan renders results and restores controls; corrupt history cannot break it', async () => {
  const t = setup(() => response(scan()), w => w.localStorage.setItem('scanHistory', '{corrupt'));
  try {
    await t.w.scanRepository();
    assert.equal(t.el('results').classList.contains('hidden'), false);
    assert.match(t.el('resultsSource').textContent, /owner\/first/);
    assert.equal(t.el('scanBtn').disabled, false);
    assert.equal(t.el('startMonBtn').disabled, false);
    assert.match(t.el('scanFeedback').textContent, /complete/i);
    assert.equal(JSON.parse(t.w.localStorage.getItem('scanHistory')).length, 1);
  } finally { t.dom.window.close(); }
});
test('blocked history storage and malformed history records do not break scans', async () => {
  const t = setup(() => response(scan()), w => {
    Object.defineProperty(w, 'localStorage', { get() { throw new Error('Blocked storage'); } });
  });
  try { await t.w.scanRepository(); assert.equal(t.el('results').classList.contains('hidden'), false); }
  finally { t.dom.window.close(); }
  const malformed = setup(() => response(scan()), w => w.localStorage.setItem('scanHistory', '[null,{"repo":3},{}]'));
  try { assert.match(malformed.el('historyList').textContent, /No previous scans/); }
  finally { malformed.dom.window.close(); }
});
test('manual failures and invalid API responses show errors and unlock controls', async () => {
  for (const reply of [response({ error: 'Repository not found.' }, 404),
    { ok: true, status: 200, json: async () => { throw new Error('HTML'); } }, response({}), response(null)]) {
    const t = setup(() => reply);
    try {
      await t.w.scanRepository();
      assert.ok(t.el('scanFeedback').classList.contains('error'));
      assert.equal(t.el('scanBtn').disabled, false);
      assert.equal(t.el('results').classList.contains('hidden'), true);
    } finally { t.dom.window.close(); }
  }
});
test('monitor scans a fresh baseline and retries failed commits before advancing', async () => {
  let sha = A, failed = false;
  const t = setup(call => {
    if (call.route === '/latest-commit') return response({ sha });
    if (call.body.commitSha === B && !failed) { failed = true; return response({ error: 'Temporary error' }, 502); }
    return response(scan(call.body.commitSha, call.body.commitSha === B ? [finding] : []));
  });
  try {
    await t.w.startLiveMonitoring();
    assert.equal(t.calls[1].body.commitSha, A);
    assert.equal(t.el('monLastSha').textContent, A.slice(0, 7));
    sha = B;
    await t.next(5000);
    assert.equal(t.el('monLastSha').textContent, A.slice(0, 7));
    await t.next(10000);
    assert.equal(t.el('monLastSha').textContent, B.slice(0, 7));
    assert.equal(t.el('liveAlertBanner').classList.contains('hidden'), false);
    assert.match(t.el('liveAlertText').textContent, /New Password/);
    assert.ok(t.el('liveAlertText').textContent.includes(B.slice(0, 7)));
  } finally { t.w.stopLiveMonitoring(); t.dom.window.close(); }
});
test('stop cancels a slow scan; restart does not reuse results or show stale responses', async () => {
  let finish;
  const t = setup(call => {
    if (call.route === '/latest-commit') return response({ sha: call.body.repoUrl === repoA ? A : B });
    if (call.body.repoUrl === repoA) return new Promise(resolve => { finish = resolve; });
    return response(scan(B));
  });
  try {
    const initial = t.w.startLiveMonitoring();
    await settle();
    assert.equal(t.calls.length, 2);
    assert.equal([...t.timers.values()].some(timer => timer.delay === 5000), false);
    await t.w.startLiveMonitoring();
    assert.equal(t.calls.length, 2);
    const oldSignal = t.calls[1].signal;
    t.w.stopLiveMonitoring();
    assert.equal(oldSignal.aborted, true);
    t.el('repoUrl').value = repoB;
    await t.w.startLiveMonitoring();
    finish(response(scan(A, [finding])));
    await initial;
    assert.match(t.el('resultsSource').textContent, /owner\/second/);
    assert.equal(t.el('monLastSha').textContent, B.slice(0, 7));
    assert.equal(t.el('liveAlertBanner').classList.contains('hidden'), true);
    assert.equal([...t.timers.values()].filter(timer => timer.delay === 5000).length, 1);
  } finally { t.w.stopLiveMonitoring(); t.dom.window.close(); }
});
test('monitor honors rate-limit retry timing and stops for missing repositories', async () => {
  const t = setup(() => response({ error: 'Rate limited', code: 'github_rate_limited' }, 429, '60'));
  try {
    await t.w.startLiveMonitoring();
    assert.ok([...t.timers.values()].some(timer => timer.delay === 60000));
    assert.match(t.el('monStatusLbl').textContent, /retry/);
  } finally { t.w.stopLiveMonitoring(); t.dom.window.close(); }
  const missing = setup(() => response({ error: 'Repository not found' }, 404));
  try {
    await missing.w.startLiveMonitoring();
    assert.equal(missing.el('monStatusLbl').textContent, 'Stopped');
    assert.equal(missing.el('repoUrl').disabled, false);
    assert.equal(missing.timers.size, 0);
  } finally { missing.dom.window.close(); }
});
test('incomplete rescans show partial results and retry the same revision', async () => {
  let attempts = 0;
  const t = setup(call => {
    if (call.route === '/latest-commit') return response({ sha: A });
    const data = scan(A); attempts++;
    if (attempts === 1) Object.assign(data.scanMeta, { complete: false, filesFailed: 1 });
    return response(data);
  });
  try {
    await t.w.startLiveMonitoring();
    assert.equal(t.el('monLastSha').textContent, '—');
    assert.equal(t.el('results').classList.contains('hidden'), false);
    await t.next(60000);
    assert.equal(attempts, 2);
    assert.equal(t.el('monLastSha').textContent, A.slice(0, 7));
  } finally { t.w.stopLiveMonitoring(); t.dom.window.close(); }
});
test('copy and download operate on the labelled example; clipboard failures are visible', async () => {
  let copied, downloaded, revoked;
  const t = setup(() => response(scan(A, [finding])), w => {
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
    w.URL.createObjectURL = () => 'blob:fixture';
    w.URL.revokeObjectURL = url => { revoked = url; };
    w.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
  });
  try {
    await t.w.scanRepository();
    t.el('copyFix_0').click(); await settle();
    assert.equal(copied, 'const dbPassword = process.env.DB_PASSWORD;');
    t.el('dlPatch_0').click(); await t.next(0);
    assert.equal(downloaded, 'remediation_example.txt');
    assert.equal(revoked, 'blob:fixture');
    t.w.navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
    t.el('copyFix_0').click(); await settle();
    assert.match(t.el('scanFeedback').textContent, /Could not copy/);
  } finally { t.dom.window.close(); }
});

test('four-step timeline advances without marking the server scan complete before its response', async () => {
  let finish;
  const t = setup(() => new Promise(resolve => { finish = resolve; }), w => {
    w.matchMedia = () => ({ matches: false });
  });
  try {
    const pending = t.w.scanRepository();
    assert.equal(t.el('timelineSection').querySelectorAll('[data-scan-step]').length, 4);
    assert.equal(t.el('timelineSection').querySelector('[aria-current="step"]').dataset.scanStep, '0');
    assert.equal(t.calls.length, 1, 'API starts immediately, independently of animation');
    await t.next(180);
    assert.equal(t.el('timelineSection').querySelector('[aria-current="step"]').dataset.scanStep, '1');
    assert.equal(t.el('results').classList.contains('hidden'), true);
    await t.next(10000);
    assert.match(t.el('scanStageDetail').textContent, /Still scanning/);
    assert.equal(t.el('timelineSection').querySelectorAll('.done').length, 1);
    finish(response(scan())); await settle();
    assert.equal(t.el('timelineSection').querySelector('[aria-current="step"]').dataset.scanStep, '2');
    assert.equal(t.el('results').classList.contains('hidden'), true);
    await t.next(360); await pending;
    assert.equal(t.el('timelineSection').querySelectorAll('.done').length, 4);
    assert.equal(t.el('timelineSection').querySelectorAll('[aria-current]').length, 0);
    assert.equal(t.el('results').classList.contains('hidden'), false);
    assert.equal(t.el('timelineSection').classList.contains('hidden'), false);
    assert.equal(t.el('scanProgressBadge').textContent, 'Complete');
    assert.equal(t.timers.size, 0);
  } finally { t.dom.window.close(); }
});

test('reduced motion skips the report animation and partial reports remain explicit', async () => {
  const data = scan(); data.scanMeta.complete = false;
  const t = setup(() => response(data));
  try {
    await t.w.scanRepository();
    assert.equal(t.el('timelineSection').querySelectorAll('.done').length, 4);
    assert.equal(t.el('scanProgressBadge').textContent, 'Partial report');
    assert.match(t.el('scanStageDetail').textContent, /Partial scan/);
    assert.equal(t.timers.size, 0);
  } finally { t.dom.window.close(); }
});

test('Stop during the report transition cancels animations and discards the delayed completion', async () => {
  const t = setup(call => response(call.route === '/scan' ? scan() : { sha: A }), w => {
    w.matchMedia = () => ({ matches: false });
  });
  try {
    const pending = t.w.startLiveMonitoring(); await settle();
    assert.ok([...t.timers.values()].some(timer => timer.delay === 360));
    t.w.stopLiveMonitoring(); await pending;
    assert.equal(t.el('timelineSection').classList.contains('hidden'), true);
    assert.equal(t.el('results').classList.contains('hidden'), true);
    assert.equal(t.el('monLastSha').textContent, '—');
    assert.equal(t.timers.size, 0);
  } finally { t.dom.window.close(); }
});
