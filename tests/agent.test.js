const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const agent = path.resolve('agent/index.js');

function environment(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('INPUT_') || key.startsWith('GITHUB_') || key === 'LLM_API_KEY') delete env[key];
  }
  return { ...env, ...extra, 'INPUT_LLM-ENABLED': 'false' };
}
test('Action full scan gates high findings and redacts matched source from output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grc-agent-'));
  try {
    const synthetic = 'AK' + 'IA' + 'Z'.repeat(16);
    fs.writeFileSync(path.join(dir, 'config.js'), `const credential = "${synthetic}";`);
    const result = spawnSync(process.execPath, [agent], { cwd: dir, encoding: 'utf8', env: environment({ 'INPUT_SCAN-MODE': 'full' }) });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /HIGH: 1/);
    assert.ok(!(result.stdout + result.stderr).includes(synthetic));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Action push scan uses event before SHA and scans changed lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grc-diff-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Test Fixture');
    fs.writeFileSync(path.join(dir, 'config.js'), 'const safe = true;\n');
    git('add', '.'); git('commit', '-m', 'fixture base');
    const before = git('rev-parse', 'HEAD');
    const synthetic = 'AK' + 'IA' + 'Z'.repeat(16);
    fs.appendFileSync(path.join(dir, 'config.js'), `const credential = "${synthetic}";\n`);
    git('add', '.'); git('commit', '-m', 'fixture change');
    const event = path.join(dir, 'event.json'); fs.writeFileSync(event, JSON.stringify({ before }));
    const result = spawnSync(process.execPath, [agent], { cwd: dir, encoding: 'utf8', env: environment({
      'INPUT_SCAN-MODE': 'diff-only', GITHUB_EVENT_PATH: event
    }) });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /HIGH: 1/);
    assert.match(result.stdout, /Changed files: 1/);
    assert.ok(!(result.stdout + result.stderr).includes(synthetic));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
