import test from 'node:test';
import assert from 'node:assert/strict';
import {closedSuppliedPresentation} from '../src/native-closure.mjs';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath} from '../src/recovery-v4.mjs';

const consumed=[
 'Return these items as three separate lines, in the same order: amber, cedar, linen. Reply here only; do not look anything up, create files, send messages, or use tools.',
 '以下四项已经全部给出：胶带、剪刀、尺子、橡皮。请按原顺序在聊天中列成四行，不补充内容。不要读文件、联网、创建文件或调用工具。',
];

function assertClosed(q,n){
 const witness=closedSuppliedPresentation(q);assert.equal(witness?.inputCount,n,q);
 assert.equal(witness?.presentation.operation,'identity-presentation',q);
 let scans=0;const options={contractVersion:4};
 for(const key of ['index','capabilityIndex'])Object.defineProperty(options,key,{get(){scans++;throw Error('unexpected inventory read');}});
 const r=routeTaskV4(q,options);assert.equal(r.performance.mode,'fast',q);assert.equal(scans,0,q);
 assert.equal(r.task.readOnly,true,q);assert.equal(r.task.originalRequest,q);
 assert.equal(r.performance.scannedSkills,false);assert.equal(r.performance.scannedCapabilities,false);
 assert.deepEqual(r.consultCandidates,[]);assert.deepEqual(r.capabilityCandidates,[]);
}

test('consumed failures bind supplied data, presentation and restrictions consistently',()=>{
 consumed.forEach((q,i)=>assertClosed(q,i===0?3:4));
 const a=taskAssessment(consumed[0]);
 assert.doesNotMatch(a.activeText,/look|create|send|tools/i);
 assert.ok(a.negativeRequests.some(x=>/create files/.test(x)));
 assert.ok(a.negativeRequests.some(x=>/send messages/.test(x)));
});

test('data order and output wording vary independently of the supplied nouns',()=>{
 const zh=['蓝笔、纸盒、书签','石子、松果、叶片'];
 for(const data of zh)for(const q of [
  `在聊天中逐行列出以下三项：${data}。`,
  `以下三项已经全部给出：${data}。请按原顺序分行呈现。`,
  `请在聊天列成三行。给定三项：${data}。`,
  `以下三项：${data}。请每项单独一行。`,
  `三个物品已全部提供：${data}。请按原顺序逐行输出。`,
 ])assertClosed(q,3);
 const en=['ruby, moss, cotton','oak, maple, pine'];
 for(const data of en)for(const q of [
  `Return these three items one per line: ${data}. Reply here only.`,
  `The following three items are all supplied: ${data}. In the same order, display these items on separate lines.`,
  `Please return these items as three individual lines. Given three items: ${data}.`,
  `These three items are provided: ${data}. Each item on its own line.`,
  `All three items have already been provided: ${data}. Return the items line by line.`,
 ])assertClosed(q,3);
});

test('missing data, cardinality contradictions and additional work cannot close',()=>{
 for(const q of [
  '请按原顺序在聊天中列成四行，不补充内容。不要调用工具。',
  '以下四项已经全部给出：甲、乙、丙。请列成四行。',
  '以下三项已经全部给出：甲、乙、待补充。请分行列出。',
  '以下三项：甲、乙、丙。请在聊天列成四行。',
  '以下三项：甲、乙、丙。请分行列出；再写入 result.txt。',
  '以下三项：甲、乙、丙。使用 alpha-tool 分行呈现。',
  '以下三项：甲、乙、丙。查仓库后分行列出。',
  'Return the current weather as three lines. Reply here only; do not use tools.',
  'Return these items as three lines: amber, cedar. Do not look anything up.',
  'Given three items: amber, cedar, missing. Return these items on separate lines.',
  'Given three items: amber, cedar, linen. Return these as lines; then email the list.',
  'Return these items as three lines: amber, cedar, linen. Do not use tools, but please save a report.',
 ]){
  assert.equal(closedSuppliedPresentation(q),null,q);
  assert.equal(useFastPath(taskAssessment(q),{contractVersion:4},{triggered:false}),false,q);
 }
});

test('full negative lists are recognized before independent-output exceptions',()=>{
 const denied=taskAssessment('Review only; do not read source files, create separate files, send messages, or use tools.');
 assert.equal(denied.readOnly,true);assert.doesNotMatch(denied.activeText,/create|send|use tools/);
 for(const q of [
  'Do not edit the source, create a separate report.',
  'Do not edit the source, and create a separate report.',
  'Do not edit the source, please create a report.',
  'Do not edit the source, but please create a report.',
  'Do not edit the source, 改为创建新报告。',
 ]){
  const a=taskAssessment(q);assert.equal(a.readOnly,false,q);assert.match(a.activeText,/create|创建/i,q);
  assert.ok(a.restrictions.protectedScopes.some(x=>x.target==='the source'),q);
 }
});
