import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {applyHostRulesV4, restoreHostRulesV4} from '../src/host-rules-v4.mjs';
import {mergeQualityHabits, restoreQualityHabits} from '../src/quality-habits-v43.mjs';

const BEGIN = '<!-- dynamic-skill-router-v4:begin -->';
const END = '<!-- dynamic-skill-router-v4:end -->';
const QB = '<!-- dynamic-skill-router-quality-v43:begin -->';
const QE = '<!-- dynamic-skill-router-quality-v43:end -->';
const external = [
  '<!-- video-creation-preference:begin -->',
  '保留 OpenFilm、镜头卡、完整听审与许可检查。',
  '<!-- video-creation-preference:end -->',
  '<!-- computer-noninterference:begin -->',
  '用户新添：后台操作优先，不中断前台，不移动用户窗口。',
  '<!-- computer-noninterference:end -->',
].join('\n');
const outerFixture = eol => ['# 未管理的前言', BEGIN, 'OLD ROUTER CONTENT', END, external.replace(/\n/g,eol), '未管理的结尾'].join(eol);
const quality = content => content.match(/<!-- dynamic-skill-router-quality-v43:begin -->[\s\S]*?<!-- dynamic-skill-router-quality-v43:end -->/)?.[0];

function workspace(t, codexText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-host-quality-'));
  const homeDir = path.join(root,'home');
  const globalRoot = path.join(root,'global');
  const file = path.join(homeDir,'.codex','AGENTS.md');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if (codexText !== null) fs.writeFileSync(file,codexText,'utf8');
  t.after(() => {
    const resolved = path.resolve(root);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  return {root,homeDir,globalRoot,file};
}

test('Codex regeneration retains the owned quality block and exact external sections', t => {
  const initial = mergeQualityHabits(outerFixture('\r\n'));
  const env = workspace(t,initial.content);
  const changes = applyHostRulesV4(env);
  const current = fs.readFileSync(env.file,'utf8');
  assert.equal(quality(current), quality(initial.content));
  assert(current.includes(external.replace(/\n/g,'\r\n')));
  assert.match(current,/contractVersion: 4/);
  assert(!current.includes('OLD ROUTER CONTENT'));
  // A previously created quality-only snapshot remains usable after regeneration.
  const qualityRemoved = restoreQualityHabits(current,initial.snapshot).content;
  assert(!qualityRemoved.includes(QB));
  assert(qualityRemoved.includes(external.replace(/\n/g,'\r\n')));
  assert.equal(applyHostRulesV4(env).length,0);
  restoreHostRulesV4(changes);
  assert.equal(fs.readFileSync(env.file,'utf8'),initial.content);
});

test('first installation preserves unmarked prologues, new computer rules and BOM', t => {
  const baseline = '\uFEFF私人前言不可删除\r\n' + external + '\n其它规则。';
  const env = workspace(t,baseline);
  const planned = applyHostRulesV4({...env,dryRun:true});
  assert.equal(fs.readFileSync(env.file,'utf8'),baseline);
  assert(planned.find(change => change.file === env.file).after.includes(QB));
  const changes = applyHostRulesV4(env);
  const installed = fs.readFileSync(env.file,'utf8');
  assert.equal(installed[0],'\uFEFF');
  assert(installed.includes('私人前言不可删除\r\n' + external + '\n其它规则。'));
  restoreHostRulesV4(changes);
  assert.equal(fs.readFileSync(env.file,'utf8'),baseline);
});

test('restoring a replacement keeps concurrent changes outside the router block', t => {
  const baseline = outerFixture('\n');
  const env = workspace(t,baseline);
  const changes = applyHostRulesV4(env);
  const added = '\n<!-- additional-user-rule:begin -->\n新的偏好\n<!-- additional-user-rule:end -->';
  const installed = fs.readFileSync(env.file,'utf8');
  fs.writeFileSync(env.file,installed.replace('完整听审','再次完整听审') + added,'utf8');
  restoreHostRulesV4(changes);
  const expected = baseline.replace('完整听审','再次完整听审') + added;
  assert.equal(fs.readFileSync(env.file,'utf8'),expected);
  restoreHostRulesV4(changes);
  assert.equal(fs.readFileSync(env.file,'utf8'),expected);
});

test('restoring a first insertion removes only owned text and keeps later user additions', t => {
  const baseline = external;
  const env = workspace(t,baseline);
  const changes = applyHostRulesV4(env);
  const added = '\n保留其他线程新增的镜头要求。';
  fs.appendFileSync(env.file,added,'utf8');
  restoreHostRulesV4(changes);
  assert.equal(fs.readFileSync(env.file,'utf8'),baseline + added);
  restoreHostRulesV4(changes);
  assert.equal(fs.readFileSync(env.file,'utf8'),baseline + added);
});

test('a created rules file is not deleted if another writer later adds content', t => {
  const env = workspace(t,null);
  const changes = applyHostRulesV4(env);
  fs.appendFileSync(env.file,'USER ADDED RULE\n','utf8');
  restoreHostRulesV4(changes);
  assert.equal(fs.readFileSync(env.file,'utf8'),'USER ADDED RULE\n');
  assert(!fs.existsSync(path.join(env.homeDir,'.claude','CLAUDE.md')));
});

test('edited quality blocks and malformed markers explicitly fail before any write', t => {
  const initial = mergeQualityHabits(outerFixture('\n')).content;
  const edited = initial.replace('20%','10%');
  const env = workspace(t,edited);
  assert.throws(() => applyHostRulesV4(env),{code:'QUALITY_HABITS_CONFLICT'});
  assert.equal(fs.readFileSync(env.file,'utf8'),edited);
  assert(!fs.existsSync(path.join(env.homeDir,'.claude','CLAUDE.md')));
  for (const invalid of [initial.replace(QE,''), initial.replace(END,''), initial + '\n' + BEGIN + '\n' + END]) {
    fs.writeFileSync(env.file,invalid,'utf8');
    assert.throws(() => applyHostRulesV4(env),{code:'INVALID_RULE_MARKERS'});
    assert.equal(fs.readFileSync(env.file,'utf8'),invalid);
  }
});

test('rollback conflict is checked for all files before restoring any target', t => {
  const env = workspace(t,outerFixture('\n'));
  const changes = applyHostRulesV4(env);
  const current = fs.readFileSync(env.file,'utf8').replace('20%','15%');
  fs.writeFileSync(env.file,current,'utf8');
  const claude = path.join(env.homeDir,'.claude','CLAUDE.md');
  const claudeBefore = fs.readFileSync(claude,'utf8');
  assert.throws(() => restoreHostRulesV4(changes),{code:'HOST_RULES_CONFLICT'});
  assert.equal(fs.readFileSync(env.file,'utf8'),current);
  assert.equal(fs.readFileSync(claude,'utf8'),claudeBefore);
});

test('write preflight detects a concurrent change after planning', t => {
  const baseline = outerFixture('\n');
  const env = workspace(t,baseline);
  const originalRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function(file,...args) {
    if (String(file) === env.file && ++reads === 2) fs.appendFileSync(env.file,'\nCONCURRENT USER RULE','utf8');
    return originalRead.call(fs,file,...args);
  };
  try {
    assert.throws(() => applyHostRulesV4(env),{code:'HOST_RULES_CONFLICT'});
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.equal(fs.readFileSync(env.file,'utf8'),baseline + '\nCONCURRENT USER RULE');
  assert(!fs.existsSync(path.join(env.homeDir,'.claude','CLAUDE.md')));
});

test('legacy Gemini migration remains reversible without replacing appended external text', t => {
  const env = workspace(t,outerFixture('\n'));
  const file = path.join(env.homeDir,'.gemini','GEMINI.md');
  const baseline = 'KEEP PREFS\n在着手任何设计或编码工作前，必须完成前期调研并厘清所有疑点。\n\n## 动态技能路由器\nOLD ROUTER\n';
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,baseline,'utf8');
  const changes = applyHostRulesV4(env);
  fs.appendFileSync(file,'\nKEEP CONCURRENT GEMINI RULE','utf8');
  restoreHostRulesV4(changes);
  assert.equal(fs.readFileSync(file,'utf8'),baseline + '\nKEEP CONCURRENT GEMINI RULE');
});
