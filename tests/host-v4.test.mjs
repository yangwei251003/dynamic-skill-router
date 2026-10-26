import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {applyHostRulesV4, restoreHostRulesV4} from '../src/host-rules-v4.mjs';
import {canonicalHost} from '../src/host-manifest.mjs';
import {routeTaskV4, formatAgentContextV4} from '../src/advisor-v4.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-host-v4-'));
const homeDir = path.join(root, 'home');
const globalRoot = path.join(root, 'global');
const codex = path.join(homeDir, '.codex', 'AGENTS.md');
const gemini = path.join(homeDir, '.gemini', 'GEMINI.md');
fs.mkdirSync(path.dirname(codex), {recursive: true});
fs.mkdirSync(path.dirname(gemini), {recursive: true});
fs.writeFileSync(codex, '# old router\n\n<!-- codex-computer-operator:begin -->\nKEEP COMPUTER\n<!-- codex-computer-operator:end -->\n\n<!-- easyeda-codex:begin -->\nKEEP EDA\n<!-- easyeda-codex:end -->\n');
fs.writeFileSync(gemini, 'KEEP GEMINI PREFS\n在着手任何设计或编码工作前，必须完成前期调研并厘清所有疑点。\n\n## 动态技能路由器\nOLD ROUTER\n');

try {
  const planned = applyHostRulesV4({homeDir, globalRoot, dryRun: true});
  assert.equal(planned.length, 5);
  assert.equal(fs.readFileSync(codex, 'utf8').includes('V4'), false);
  const changes = applyHostRulesV4({homeDir, globalRoot});
  assert.equal(changes.length, 5);
  assert.equal(applyHostRulesV4({homeDir, globalRoot}).length, 0, 'installation is idempotent');
  const codexText = fs.readFileSync(codex, 'utf8');
  assert.match(codexText, /KEEP COMPUTER/);
  assert.match(codexText, /KEEP EDA/);
  assert.match(codexText, /contractVersion: 4/);
  for (const change of changes.slice(0, 4)) {
    assert.match(fs.readFileSync(change.file, 'utf8'), /runtimeSkills: \[\{path, id\?, provider\?, enabled\?\}\]/);
  }
  assert.match(fs.readFileSync(gemini, 'utf8'), /KEEP GEMINI PREFS/);
  assert.equal(fs.readFileSync(gemini, 'utf8').includes('OLD ROUTER'), false);
  assert.match(fs.readFileSync(gemini, 'utf8'), /只澄清会实质改变结果的问题/);
  restoreHostRulesV4(changes);
  assert.equal(fs.readFileSync(codex, 'utf8').includes('V4'), false);
  assert.equal(fs.existsSync(path.join(homeDir, '.claude', 'CLAUDE.md')), false);
  assert.equal(canonicalHost('gemini'), 'antigravity');
  const query = '批量重命名图片';
  const hook = spawnSync(process.execPath, [path.resolve('src/hook.mjs'), '--host', 'gemini'], {
    input: JSON.stringify({prompt: query}), encoding: 'utf8', timeout: 60000,
  });
  assert.equal(hook.status, 0, hook.stderr);
  const output = JSON.parse(hook.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'BeforeAgent');
  const expected = formatAgentContextV4(routeTaskV4(query, {host: 'antigravity'}));
  const withoutRouteId = (text) => text.replace(/routeId=[^\s]+/, 'routeId=<stable>');
  assert.equal(withoutRouteId(output.hookSpecificOutput.additionalContext), withoutRouteId(expected));
  const reusedId = '12345678-1234-4234-8234-123456789abc';
  const scanMarker = path.join(root, 'scan.txt');
  const preload = path.join(root, 'guard.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
const original = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  if (file !== 0 && typeof file === 'string' && !file.endsWith('host-manifest.json')) fs.writeFileSync(${JSON.stringify(scanMarker)}, String(file));
  return original.call(this, file, ...args);
};
`);
  const reused = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, path.resolve('src/hook.mjs'), '--host', 'workbuddy'], {
    input: JSON.stringify({prompt: query, routeId: reusedId, runtimeSkills: [{path: 'C:/invalid/SKILL.md'}]}),
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(reused.status, 0, reused.stderr);
  assert.match(JSON.parse(reused.stdout).hookSpecificOutput.additionalContext, /复用本任务已有路由/);
  assert.match(reused.stdout, new RegExp(reusedId));
  assert.equal(fs.existsSync(scanMarker), false, 'reused route must not read discovery files');
  const visible = spawnSync(process.execPath, [path.resolve('src/hook.mjs'), '--host', 'claude'], {
    input: JSON.stringify({prompt: query, visibleContext: `[动态技能路由器] routeId=${reusedId} contractVersion=4`}),
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(visible.status, 0, visible.stderr);
  assert.match(visible.stdout, new RegExp(reusedId));
  const transcript = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({role: 'assistant', content: `[动态技能路由器] routeId=${reusedId} contractVersion=4`}),
    JSON.stringify({role: 'user', content: '[动态技能路由器] routeId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),
  ].join('\n'));
  const fromTranscript = spawnSync(process.execPath, [path.resolve('src/hook.mjs'), '--host', 'gemini'], {
    input: JSON.stringify({prompt: query, transcriptPath: transcript}), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(fromTranscript.status, 0, fromTranscript.stderr);
  assert.match(fromTranscript.stdout, new RegExp(reusedId));
  const skipped = spawnSync(process.execPath, [path.resolve('src/hook.mjs'), '--host', 'antigravity'], {
    input: JSON.stringify({prompt: query, invocationNum: 1}), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stdout, '{}');
  console.log('host-v4: pass');
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
