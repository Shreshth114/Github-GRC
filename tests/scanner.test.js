const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scanContent, scanContentWithLines, calculateScore, isLikelyTextFile } = require('../lib/scanner');
const { emitAnnotations } = require('../agent/annotator');
const { generateMarkdownReport, generateSarifReport } = require('../lib/reporter');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

test('shared scanner preserves scoring and line numbers', () => {
  const text = 'safe line\n' + 'password' + ' = example';
  assert.equal(scanContent(text, 'config.js')[0].severity, 'LOW');
  assert.equal(scanContentWithLines(text, 'config.js')[0].line, 2);
  assert.equal(calculateScore(scanContent(text, 'config.js')), 98);
  assert.equal(calculateScore(Array(10).fill({ severity: 'HIGH' })), 0);
});
test('file exclusions match dashboard behavior', () => {
  assert.equal(isLikelyTextFile('src/main.js'), true);
  for (const name of ['node_modules/x.js', 'dist/main.js', 'image.png', 'bundle.min.js']) {
    assert.equal(isLikelyTextFile(name), false);
  }
});
test('AWS rule still detects credentials without flagging its own definition', () => {
  for (const text of ['aws_secret_' + 'access_key', 'AK' + 'IA' + 'Z'.repeat(16)]) {
    assert.ok(scanContent(text, 'config.js').some(f => f.severity === 'HIGH'));
  }
  assert.equal(scanContent(readFileSync('lib/scanner.js', 'utf8'), 'lib/scanner.js').filter(f => f.severity === 'HIGH').length, 0);
});
test('CI reports and annotations do not reproduce matched credentials', () => {
  const sensitive = 'synthetic-sensitive-value';
  const issues = [{ severity: 'HIGH', file: 'config.js', line: 3, message: 'Credential pattern', snippet: sensitive }];
  const messages = [];
  emitAnnotations(issues, { error: msg => messages.push(msg) });
  assert.ok(!messages.join('').includes(sensitive));
  assert.ok(!generateMarkdownReport(issues, 'a/b').includes(sensitive));
  const sarif = generateSarifReport(issues);
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 3);
});
test('repository-controlled text is escaped for HTML rendering', () => {
  const source = readFileSync('public/script.js', 'utf8');
  const escape = source.match(/function escapeHTML\(value\) \{[\s\S]*?\n\}/)[0];
  const context = vm.createContext({});
  vm.runInContext(escape, context);
  assert.equal(context.escapeHTML('<img src=x onerror="evil()">'), '&lt;img src=x onerror=&quot;evil()&quot;&gt;');
  assert.ok(source.includes('${escapeHTML(issue.file)}'));
  assert.ok(source.includes('${escapeHTML(h.repo)}'));
  assert.ok(source.includes('${escapeHTML(msg)}'));
});
