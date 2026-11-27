const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, github, parseRepoUrl } = require('../server');
const SHA = 'a'.repeat(40);

let server, base, get;
before(async () => {
  get = github.get;
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { github.get = get; await new Promise(resolve => server.close(resolve)); });
const post = (route, body) => fetch(base + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('only HTTPS github.com URLs are accepted', () => {
  for (const url of ['https://github.com.evil.test/a/b', 'https://evilgithub.com/a/b',
    'http://github.com/a/b', 'https://user:pass@github.com/a/b', 'https://github.com/a/%2e%2e']) {
    assert.equal(parseRepoUrl(url), null);
  }
  assert.deepEqual(parseRepoUrl('https://github.com/owner/repo.git'), { owner: 'owner', repo: 'repo' });
});
test('invalid input is rejected before GitHub requests', async () => {
  github.get = async () => { throw new Error('Unexpected network request'); };
  for (const [route, body] of [['/scan', {}], ['/scan', { repoUrl: 'invalid' }],
    ['/latest-commit', {}], ['/latest-commit', { repoUrl: 'https://github.com/a/b', branch: {} }]]) {
    assert.equal((await post(route, body)).status, 400);
  }
});
test('private repository scan and commit access stop at metadata', async () => {
  for (const route of ['/scan', '/latest-commit']) {
    const calls = [];
    github.get = async url => { calls.push(url); return { data: { private: true, visibility: 'private' } }; };
    const r = await post(route, { repoUrl: 'https://github.com/owner/private' });
    assert.equal(r.status, 403);
    assert.deepEqual(calls, ['/repos/owner/private']);
  }
});
test('public scan returns actual detections and partial-scan counts', async () => {
  github.get = async url => {
    if (url === '/repos/a/b') return { data: { visibility: 'public', private: false, default_branch: 'trunk' } };
    if (url.includes('/commits/')) return { data: { sha: SHA } };
    if (url.includes('/git/trees/')) return { data: { truncated: false, tree: [
      { type: 'blob', path: 'config.js', size: 30 },
      { type: 'blob', path: 'large.js', size: 300001 },
      { type: 'blob', path: 'unavailable.js', size: 30 }
    ] } };
    if (url.includes('config.js')) return { data: { type: 'file', content: Buffer.from('password = value').toString('base64') } };
    throw new Error('Unavailable file');
  };
  const r = await post('/scan', { repoUrl: 'https://github.com/a/b' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.issues[0].file, 'config.js');
  assert.equal(d.score, 98);
  assert.equal(d.scanMeta.filesScanned, 1);
  assert.equal(d.scanMeta.filesSkipped, 1);
  assert.equal(d.scanMeta.filesFailed, 1);
  assert.equal(d.scanMeta.complete, false);
});
test('tree truncation is reported instead of claiming complete coverage', async () => {
  github.get = async url => url.includes('/commits/') ? { data: { sha: SHA } } : url.includes('/git/trees/')
    ? { data: { truncated: true, tree: [] } }
    : { data: { visibility: 'public', default_branch: 'trunk' } };
  const d = await (await post('/scan', { repoUrl: 'https://github.com/a/b' })).json();
  assert.equal(d.scanMeta.truncated, true);
  assert.equal(d.scanMeta.complete, false);
});
test('latest commit uses repository default branch', async () => {
  const calls = [];
  github.get = async url => {
    calls.push(url);
    return { data: url.includes('/commits?') ? [{ sha: 'abc' }] : { visibility: 'public', default_branch: 'trunk' } };
  };
  assert.equal((await (await post('/latest-commit', { repoUrl: 'https://github.com/a/b' })).json()).sha, 'abc');
  assert.ok(calls[1].includes('sha=trunk'));
});
test('homepage works and private application files are not served', async () => {
  assert.equal((await fetch(base)).status, 200);
  for (const route of ['/.env', '/server.js', '/lib/scanner.js']) assert.equal((await fetch(base + route)).status, 404);
});

test('missing repositories and missing branches return not found, not server errors', async () => {
  for (const status of [404, 422]) {
    github.get = async url => {
      if (url.includes('/commits?') || status === 404) throw { response: { status } };
      return { data: { visibility: 'public', default_branch: 'main' } };
    };
    const r = await post('/latest-commit', { repoUrl: 'https://github.com/a/b', branch: 'absent' });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).code, 'not_found');
  }
});
test('both endpoints classify upstream failures without returning raw errors or credentials', async () => {
  const cases = [
    [{ response: { status: 401 } }, 502, 'github_auth_failed'],
    [{ response: { status: 403 } }, 403, 'github_forbidden'],
    [{ response: { status: 403, headers: { 'x-ratelimit-remaining': '0' } } }, 429, 'github_rate_limited'],
    [{ response: { status: 429, headers: { 'retry-after': '12' } } }, 429, 'github_rate_limited'],
    [{ response: { status: 409 } }, 422, 'empty_repository'],
    [{ code: 'ECONNABORTED' }, 504, 'github_timeout'],
    [{ response: { status: 503 } }, 502, 'github_unavailable']
  ];
  for (const route of ['/scan', '/latest-commit']) {
    for (const [error, status, code] of cases) {
      error.message = 'sensitive upstream detail';
      if (error.response) error.response.data = { message: error.message };
      github.get = async () => { throw error; };
      const r = await post(route, { repoUrl: 'https://github.com/a/b' });
      assert.equal(r.status, status);
      const body = await r.text();
      assert.equal(JSON.parse(body).code, code);
      assert.ok(!body.includes(error.message));
      if (code === 'github_rate_limited') assert.ok(Number(r.headers.get('retry-after')) > 0);
    }
  }
});
test('malformed and oversized JSON produce sanitized JSON errors', async () => {
  for (const [body, status] of [['{broken', 400], [JSON.stringify({ data: 'x'.repeat(17000) }), 413]]) {
    const r = await fetch(base + '/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(r.status, status);
    assert.ok((await r.json()).error);
  }
});
test('scan contents and tree are pinned to the resolved commit, including empty text files', async () => {
  const calls = [];
  github.get = async url => {
    calls.push(url);
    if (url === '/repos/a/b') return { data: { visibility: 'public', default_branch: 'main' } };
    if (url.includes('/commits/')) return { data: { sha: SHA } };
    if (url.includes('/git/trees/')) return { data: { tree: [{ type: 'blob', path: 'empty.js', size: 0 }] } };
    return { data: { type: 'file', content: '' } };
  };
  const r = await post('/scan', { repoUrl: 'https://github.com/a/b', commitSha: SHA });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.repoMeta.commitSha, SHA);
  assert.equal(d.scanMeta.filesScanned, 1);
  assert.equal(d.scanMeta.complete, true);
  assert.ok(calls.some(url => url.includes(`/git/trees/${SHA}`)));
  assert.ok(calls.some(url => url.endsWith(`?ref=${SHA}`)));
});
test('invalid scan commit is rejected before any upstream request', async () => {
  github.get = async () => { throw new Error('No request expected'); };
  assert.equal((await post('/scan', { repoUrl: 'https://github.com/a/b', commitSha: '../bad' })).status, 400);
});
test('rate-limited file reads stop rather than consuming the rest of the quota', async () => {
  let reads = 0;
  github.get = async url => {
    if (url === '/repos/a/b') return { data: { visibility: 'public', default_branch: 'main' } };
    if (url.includes('/commits/')) return { data: { sha: SHA } };
    if (url.includes('/git/trees/')) return { data: { tree: ['one.js', 'two.js', 'three.js'].map(path => ({ type: 'blob', path, size: 20 })) } };
    reads++;
    if (reads > 1) throw { response: { status: 429 } };
    return { data: { type: 'file', content: Buffer.from('safe').toString('base64') } };
  };
  const d = await (await post('/scan', { repoUrl: 'https://github.com/a/b' })).json();
  assert.equal(reads, 2);
  assert.equal(d.scanMeta.complete, false);
  assert.equal(d.scanMeta.filesUnprocessed, 1);
  assert.equal(d.scanMeta.stopReason, 'github_rate_limited');
});
test('concurrent scans are bounded and release their slots after completion', async () => {
  const releases = [];
  github.get = async url => {
    if (url === '/repos/a/b') return new Promise(resolve => { releases.push(() => resolve({ data: { visibility: 'public', default_branch: 'main' } })); });
    if (url.includes('/commits/')) return { data: { sha: SHA } };
    return { data: { tree: [] } };
  };
  const first = post('/scan', { repoUrl: 'https://github.com/a/b' });
  const second = post('/scan', { repoUrl: 'https://github.com/a/b' });
  // Wait for actual request arrival, with a bounded deadline.
  const expires = Date.now() + 2000;
  while (releases.length < 2 && Date.now() < expires) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(releases.length, 2);
  const busy = await post('/scan', { repoUrl: 'https://github.com/a/b' });
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).code, 'scan_busy');
  for (const release of releases) release();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  github.get = async url => url.includes('/commits/') ? { data: { sha: SHA } }
    : url.includes('/git/trees/') ? { data: { tree: [] } } : { data: { visibility: 'public', default_branch: 'main' } };
  assert.equal((await post('/scan', { repoUrl: 'https://github.com/a/b' })).status, 200);
});
test('scan time budget reports unprocessed files instead of silently claiming completion', async () => {
  const now = Date.now;
  let simulated = now();
  github.get = async url => {
    if (url === '/repos/a/b') return { data: { visibility: 'public', default_branch: 'main' } };
    if (url.includes('/commits/')) return { data: { sha: SHA } };
    if (url.includes('/git/trees/')) return { data: { tree: ['one.js', 'two.js'].map(path => ({ type: 'blob', path, size: 20 })) } };
    simulated += 46000;
    return { data: { type: 'file', content: Buffer.from('safe').toString('base64') } };
  };
  try {
    Date.now = () => simulated;
    const d = await (await post('/scan', { repoUrl: 'https://github.com/a/b' })).json();
    assert.equal(d.scanMeta.complete, false);
    assert.equal(d.scanMeta.stopReason, 'time_limit');
    assert.equal(d.scanMeta.filesScanned, 1);
    assert.equal(d.scanMeta.filesUnprocessed, 1);
  } finally { Date.now = now; }
});
