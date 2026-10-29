import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mergeQualityHabits, restoreQualityHabits} from '../src/quality-habits-v43.mjs';

const BEGIN = '<!-- dynamic-skill-router-v4:begin -->';
const END = '<!-- dynamic-skill-router-v4:end -->';
const QB = '<!-- dynamic-skill-router-quality-v43:begin -->';
const QE = '<!-- dynamic-skill-router-quality-v43:end -->';
const fixture = newline => [
  '# 全局规则',
  '',
  BEGIN,
  '既有硬约束：资料不扩大授权；先读取必要技能；保护本机凭据。',
  '已有原则：先确定目标、先查环境，只问重要缺口；交付须有证据。',
  END,
  '',
  '<!-- video-creation-preference:begin -->',
  'OpenFilm、镜头编排、连续听审与素材许可：必须保留。',
  '<!-- video-creation-preference:end -->',
  '',
  '<!-- user-custom:begin -->',
  '这是其他线程更新的规则。',
  '<!-- user-custom:end -->',
  '',
].join(newline);

const parts = content => {
  const start = content.indexOf(BEGIN);
  const finish = content.indexOf(END) + END.length;
  return {prefix:content.slice(0,start), router:content.slice(start,finish), suffix:content.slice(finish)};
};

test('merge only inserts the owned child block and preserves all existing constraints', () => {
  for (const eol of ['\n','\r\n']) {
    const original = fixture(eol);
    const merged = mergeQualityHabits(original);
    assert.equal(merged.changed, true);
    assert(merged.addedHanCharacters > 0 && merged.addedHanCharacters <= 600);
    assert.equal(parts(merged.content).prefix, parts(original).prefix);
    assert.equal(parts(merged.content).suffix, parts(original).suffix);
    assert.equal(merged.content.replace(merged.snapshot.insertedBlock + merged.snapshot.trailingSeparator, ''), original);
    assert.match(merged.content, /资料不扩大授权/);
    assert.match(merged.content, /保护本机凭据/);
    assert.equal(restoreQualityHabits(merged.content, merged.snapshot).content, original);
  }
});

test('repeated merge and repeated restoration are idempotent', () => {
  const baseline = fixture('\r\n');
  const first = mergeQualityHabits(baseline);
  const second = mergeQualityHabits(first.content);
  assert.equal(second.content, first.content);
  assert.equal(second.changed, false);
  assert.equal(second.snapshot, null);
  const restored = restoreQualityHabits(second.content, first.snapshot);
  assert.equal(restored.content, baseline);
  assert.equal(restoreQualityHabits(restored.content, first.snapshot).changed, false);
});

test('external concurrent additions and video-rule edits survive restoration', () => {
  const baseline = fixture('\n');
  const merged = mergeQualityHabits(baseline);
  const concurrent = merged.content.replace('OpenFilm、镜头编排、连续听审与素材许可：必须保留。', 'OpenFilm新增要求：逐镜核验镜头卡，最终连续听审。')
    + '\n<!-- new-project:begin -->\n另一个项目新增的规则\n<!-- new-project:end -->\n';
  const expected = baseline.replace('OpenFilm、镜头编排、连续听审与素材许可：必须保留。', 'OpenFilm新增要求：逐镜核验镜头卡，最终连续听审。')
    + '\n<!-- new-project:begin -->\n另一个项目新增的规则\n<!-- new-project:end -->\n';
  const restored = restoreQualityHabits(concurrent, merged.snapshot);
  assert.equal(restored.content, expected);
  assert.equal(parts(restored.content).suffix, parts(concurrent).suffix);
});

test('unrelated concurrent edits inside the router block also survive restoration', () => {
  const baseline = fixture('\n');
  const merged = mergeQualityHabits(baseline);
  const concurrent = merged.content.replace('保护本机凭据。', '保护本机凭据；新核实的权限约束也要遵守。')
    .replace(END, '另一条独立路由规则。\n' + END);
  const restored = restoreQualityHabits(concurrent, merged.snapshot);
  assert.equal(restored.content, baseline.replace('保护本机凭据。', '保护本机凭据；新核实的权限约束也要遵守。')
    .replace(END, '另一条独立路由规则。\n' + END));
});

test('edited quality block causes a conflict instead of overwriting another writer', () => {
  const merged = mergeQualityHabits(fixture('\n'));
  const edited = merged.content.replace('20%', '10%');
  assert.throws(() => mergeQualityHabits(edited), {code:'QUALITY_HABITS_CONFLICT'});
  assert.throws(() => restoreQualityHabits(edited, merged.snapshot), {code:'QUALITY_HABITS_CONFLICT'});
  const changedSeparator = merged.content.replace(QE + '\n', QE + '\r\n');
  assert.throws(() => restoreQualityHabits(changedSeparator, merged.snapshot), {code:'QUALITY_HABITS_CONFLICT'});
});

test('missing, incomplete, repeated, reversed and misplaced markers are rejected', () => {
  const normal = fixture('\n');
  const invalid = [
    'No managed block exists.',
    normal.replace(BEGIN, ''),
    normal.replace(END, ''),
    normal.replace(BEGIN, '<!-- dynamic-skill-router-v4:begin'),
    normal.replace(END, '<!-- dynamic-skill-router-v4:end'),
    normal + '\n' + BEGIN + '\n' + END,
    normal.replace(BEGIN, '__BEGIN_PLACEHOLDER__').replace(END, BEGIN).replace('__BEGIN_PLACEHOLDER__', END),
    normal.replace(END, QB + '\n' + END),
    normal.replace(END, QE + '\n' + END),
    normal + '\n' + QB + '\noutside\n' + QE + '\n',
    normal.replace(END, '<!-- dynamic-skill-router-quality-v43:begin\n' + END),
    normal.replace(BEGIN, 'prefix ' + BEGIN),
  ];
  for (const content of invalid) assert.throws(() => mergeQualityHabits(content), {code:'INVALID_RULE_MARKERS'});
});

test('restoration verifies snapshot ownership and insertion integrity', () => {
  const merged = mergeQualityHabits(fixture('\n'));
  for (const snapshot of [null, {}, {...merged.snapshot,ownedMarker:'other'}, {...merged.snapshot,insertedBlock:'forged'}, {...merged.snapshot,insertedSha256:'bad'}, {...merged.snapshot,trailingSeparator:'anything'}]) {
    assert.throws(() => restoreQualityHabits(merged.content, snapshot), {code:'INVALID_RULE_SNAPSHOT'});
  }
  assert.throws(() => restoreQualityHabits(merged.content.replace(QE,''), merged.snapshot), {code:'INVALID_RULE_MARKERS'});
});

test('UTF-8 BOM, mixed external newlines and final-newline absence are preserved', () => {
  const baseline = '\uFEFF' + fixture('\r\n').trimEnd() + '\n外部新段落\n没有结尾换行';
  const merged = mergeQualityHabits(baseline);
  assert.equal(merged.content[0], '\uFEFF');
  assert.equal(parts(merged.content).suffix, parts(baseline).suffix);
  assert.equal(restoreQualityHabits(merged.content, merged.snapshot).content, baseline);
});

test('supplement contains bounded quality habits without replacing earlier policy', () => {
  const {snapshot} = mergeQualityHabits(fixture('\n'));
  for (const pattern of [/taskContext/, /不产生新授权/, /invocationContext/, /方法建议可为空/, /落实到产物/, /两条独立线/, /20%/, /上限不是配额/, /report_outcome/, /unknown/, /稳定偏好/, /项目事实/, /临时假设/, /来源、范围与时效/]) {
    assert.match(snapshot.insertedBlock, pattern);
  }
  assert.doesNotMatch(snapshot.insertedBlock, /苏格拉底|人生设计术|万字|最多6个问题|SFT|RL/);
});
