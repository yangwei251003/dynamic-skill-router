import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {routeTaskV4, searchSkills, formatAgentContextV4} from '../src/advisor-v4.mjs';
import {computeFeedbackCalibrationV4, readFeedbackV4, validateOutcomeV4} from '../src/feedback-v4.mjs';

const availability = {discovered: true, readable: true, enabled: true, compatible: true, toolsAvailable: null};
const namespaced = routeTaskV4('请参考 `$ecc:database-migrations`。', {index:[{id:'ecc:database-migrations',nameZh:'迁移',availability}]});
assert(namespaced.consultCandidates.some(s=>s.id==='ecc:database-migrations' && s.explicit));
const index = {revision: 'test-revision', coverage: {sources: 1}, errors: [], skills: [
  {id: 'skill-stocktake', nameZh: '技能盘点', summaryZh: '审计技能库和技能路由器的覆盖与匹配', triggers: ['技能路由器', '技能'], sourceId: 'fixture', contentHash: 'hash-stock', phase: 'discovery', availability},
  {id: 'playwright', nameZh: '浏览器自动化', summaryZh: '使用浏览器自动化执行网页操作', triggers: ['浏览器自动化', 'playwright'], sourceId: 'fixture', contentHash: 'hash-browser', phase: 'implementation', availability},
  {id: 'code', nameZh: '代码', summaryZh: '代码实现和测试', triggers: ['代码'], sourceId: 'other', contentHash: 'hash-code', availability},
]};

const result = routeTaskV4('请升级技能路由器。以后可能加入 Playwright 浏览器自动化。', {index, host: 'codex', routeId: 'r1'});
assert.equal(result.contractVersion, 4);
assert.equal(result.registryRevision, 'test-revision');
assert(result.consultCandidates.some((item) => item.id === 'skill-stocktake'));
assert(!result.consultCandidates.some((item) => item.id === 'playwright'));
assert(!Object.hasOwn(result, 'selected'));
assert(!Object.hasOwn(result, 'potential'));
assert.equal(result.coordination.mode, 'single-agent');
assert.match(formatAgentContextV4(result), /advisory only/);

const quoted = routeTaskV4('升级技能路由器。示例：`用 playwright 点击按钮`。', {index});
assert(!quoted.consultCandidates.some((item) => item.id === 'playwright'));
const negative = routeTaskV4('升级技能路由器。不要使用 playwright。', {index});
assert(!negative.consultCandidates.some((item) => item.id === 'playwright'));
const mixedNegative = routeTaskV4('不要用 Playwright，审查 JS 代码', {index});
assert(mixedNegative.consultCandidates.some((item) => item.id === 'code'));
assert(!mixedNegative.consultCandidates.some((item) => item.id === 'playwright'));
const laterPositive = routeTaskV4('不要用 Playwright。现在用代码技能审查代码', {index});
assert(laterPositive.consultCandidates.some((item) => item.id === 'code'));
const explicit = routeTaskV4('使用 Playwright 做浏览器自动化验证。', {index});
assert(explicit.consultCandidates.some((item) => item.id === 'playwright'));
const backtickExplicit = routeTaskV4('使用 `$playwright` 做浏览器自动化验证。', {index});
assert(backtickExplicit.consultCandidates.some((item) => item.id === 'playwright' && item.explicit));
const descriptive = routeTaskV4('将 Playwright 写进文档，使用代码检查文档。', {index});
assert(!descriptive.consultCandidates.some((item) => item.id === 'playwright' && item.explicit));
assert(descriptive.consultCandidates.some((item) => item.id === 'code' && item.explicit));
const baseline = routeTaskV4('检查代码', {index, taskContext: {nativeApproach: 'Read the relevant files and inspect the diff.'}});
assert.equal(baseline.decisionBrief.nativeBaseline.kind, 'agent-proposed');
assert.equal(baseline.task.taskType, 'review');
assert(baseline.consultCandidates.find((item) => item.id === 'code')?.evidence?.[0]?.snippet);
const tiny = routeTaskV4('你好', {index});
assert.equal(tiny.consultCandidates.length, 0);
const bigCoverage = routeTaskV4('检查代码', {index: {...index, coverage: {sources: [{id: 'x', root: 'secret-path', count: 3}], entries: Array.from({length: 1000}, () => ({path: 'secret-path'}))}}});
assert(!JSON.stringify(bigCoverage.coverage).includes('secret-path'));
const blocked = routeTaskV4('使用 Playwright 做浏览器自动化验证', {index: {...index, skills: [{...index.skills[1], requiresTools: ['missing-tool'], status: 'degraded'}]}, runtimeCapabilities: {tools: ['other-tool']}});
assert(!blocked.consultCandidates.some((item) => item.id === 'playwright'));
const unavailableTool = routeTaskV4('使用 Playwright 做浏览器自动化验证', {index: {...index, skills: [{...index.skills[1], requiresTools: ['missing-tool']}]}, runtimeCapabilities: {tools: ['other-tool']}});
assert.equal(unavailableTool.consultCandidates[0].availability.toolsAvailable, false);
assert.equal(unavailableTool.consultCandidates[0].suggestedMode, 'skip');
const emptyTools = routeTaskV4('使用 Playwright 做浏览器自动化验证', {index: {...index, skills: [{...index.skills[1], requiresTools: ['missing-tool']}]}, runtimeCapabilities: {tools: []}});
assert.equal(emptyTools.consultCandidates[0].availability.toolsAvailable, false);
const filtered = searchSkills('升级技能路由器并检查代码', {index, source: 'fixture', limit: 1});
assert.equal(filtered.consultCandidates.length, 1);
assert.equal(filtered.consultCandidates[0].sourceId, 'fixture');

const reviewIndex = {revision: 'review-fixture', coverage: {}, errors: [], skills: [
  {id: 'library:database-migrations', nameZh: 'database-migrations', summaryZh: 'Database migration for schema changes, rollbacks and zero-downtime deployment.', availability},
  {id: 'library:debug-workflow', nameZh: 'debug-workflow', summaryZh: 'Structured debugging and diagnosis of production failures.', availability},
  {id: 'library:product-lens', nameZh: 'product-lens', summaryZh: 'Validate why to build a product and pressure-test direction before adding features.', availability},
  {id: 'library:generic-writing', nameZh: 'generic-writing', summaryZh: 'Write a professional response with a list, evidence, and clear explanation.', availability},
]};
const migrationAdvice = routeTaskV4('Rename a column in production while old and new deployments coexist; plan rollback and validation.', {index: reviewIndex});
assert.equal(migrationAdvice.consultCandidates[0].id, 'library:database-migrations');
const diagnosticAdvice = routeTaskV4('Requests are slow after a release. Give diagnostic checks and a reversible mitigation without assuming the cause.', {index: reviewIndex});
assert.equal(diagnosticAdvice.consultCandidates[0].id, 'library:debug-workflow');
const productAdvice = routeTaskV4('The real goal is fewer missed assignments. Assess which features make a minimal useful product.', {index: reviewIndex});
assert.equal(productAdvice.consultCandidates[0].id, 'library:product-lens');
assert(!productAdvice.consultCandidates.some((item) => item.id === 'library:generic-writing'));
const tinyFunction = routeTaskV4('Export clamp(value,min,max): require finite numbers and return the clamped value.', {index: reviewIndex});
assert.equal(tinyFunction.consultCandidates.length, 0);
assert.equal(tinyFunction.task.selfContainedFunction, true);

const decision = (outcome, evidence = [{kind: 'validation', reference: 'focused test', passed: true}]) => ({
  skillId: 'skill-stocktake', contentHash: 'hash-stock', mode: 'adapt', shown: true, read: true, adopted: true, outcome, evidence,
});
let taskSequence = 0;
const feedbackPolicy = {nowMs: Date.parse('2026-11-01T00:00:00Z')};
const feedbackContext = {host:'codex',taskType:'complex',modelId:'fixture-model',contentHashes:{'skill-stocktake':'hash-stock'}};
const calibrate = (entries, context = {}) => computeFeedbackCalibrationV4(entries, {...feedbackContext,...context}, feedbackPolicy);
const entry = (outcome, evidence) => ({routeId: `test-task-${++taskSequence}`, contractVersion: 4, taskType: 'complex', host: 'codex', modelId:'fixture-model', observedAt:'2026-10-31T00:00:00Z', decisions: [decision(outcome, evidence)]});
assert.equal(validateOutcomeV4(entry('helpful')).ok, true);
assert.equal(validateOutcomeV4({contractVersion: 4, decisions: []}).ok, false);
const positive = calibrate(Array.from({length: 12}, () => entry('helpful')), {mode:'adapt'});
assert(positive.get('skill-stocktake').adjustment > 0);
const negativeFeedback = calibrate(Array.from({length: 5}, () => entry('wrong')), {mode: 'adapt'});
assert.equal(negativeFeedback.get('skill-stocktake').adjustment, -3);
const mixedModes = calibrate([...Array.from({length: 12}, () => entry('helpful')), ...Array.from({length: 5}, () => ({...entry('wrong'), decisions: [{...decision('wrong'), mode: 'execute'}]}))]);
assert.equal(mixedModes.get('skill-stocktake').adjustment, 0);
assert(mixedModes.get('skill-stocktake').byMode.adapt.adjustment > 0);
assert.equal(mixedModes.get('skill-stocktake').byMode.execute.adjustment, -3);
const changedHash = {...entry('wrong'), decisions: [{...decision('wrong'), contentHash: 'different-hash'}]};
const hashEntries = [...Array.from({length: 12}, () => entry('helpful')), ...Array.from({length: 5}, (_, i) => ({...changedHash, routeId: `changed-${i}`}))];
// 4.2.1 intentionally requires the current hash: an unbound mixed-hash
// history is audit-only, rather than a calibrated ambiguous-hash result.
assert.equal(calibrate(hashEntries,{mode:'adapt',contentHashes:undefined}).size,0);
const mixedHashes = calibrate(hashEntries,{mode:'adapt'}).get('skill-stocktake');
assert.equal(mixedHashes.contentHash,'hash-stock');assert.equal(mixedHashes.samples,12);assert(mixedHashes.adjustment>0);
const changedCurrent = calibrate(hashEntries,{mode:'adapt',contentHashes:{'skill-stocktake':'different-hash'}}).get('skill-stocktake');
assert.equal(changedCurrent.samples,5);assert.equal(changedCurrent.adjustment,-3);
assert.equal(calibrate([entry('helpful', [{kind: 'self', reference: 'felt good'}])]).size, 0);
assert.equal(calibrate([entry('helpful', [{kind: 'validation', reference: 'failed', passed: false}])]).size, 0);
assert.equal(calibrate([entry('helpful', [{kind: 'validation', reference: 'unverified'}])]).size, 0);
assert.equal(calibrate([{selectedIds: ['skill-stocktake'], outcome: 'helpful'}]).size, 0);
assert.equal(calibrate([entry('helpful')], {contentHashes: {'skill-stocktake': 'new-hash'}}).size, 0);
assert.equal(calibrate([{...entry('helpful'),observedAt:undefined}]).size,0);
assert.equal(calibrate([{...entry('helpful'),modelId:undefined}]).size,0);
assert.equal(calibrate([entry('helpful')],{modelId:undefined}).size,0);
assert.equal(calibrate([entry('helpful')],{contentHashes:undefined}).size,0);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-v4-'));
try {
  const feedbackPath = path.join(dir, 'feedback.jsonl');
  fs.writeFileSync(feedbackPath, `${JSON.stringify(entry('helpful'))}\n`);
  const before = fs.readFileSync(feedbackPath, 'utf8');
  assert.equal(readFeedbackV4({...feedbackContext,mode:'adapt'}, feedbackPolicy, feedbackPath).get('skill-stocktake').samples, 1);
  routeTaskV4('升级技能路由器', {index, feedbackPath, useFeedback: true,currentModel:'fixture-model',feedbackPolicy});
  assert.equal(fs.readFileSync(feedbackPath, 'utf8'), before);
} finally { fs.rmSync(dir, {recursive: true, force: true}); }

console.log('advisor-v4 tests passed');
