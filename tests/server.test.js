const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, github, parseRepoUrl } = require('../server');

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
  github.get = async url => url.includes('/git/trees/')
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
