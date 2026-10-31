import test from 'node:test';
import assert from 'node:assert/strict';
import {closedSuppliedFormatting} from '../src/native-closure.mjs';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath} from '../src/recovery-v4.mjs';

const q1='办公室文具库存：记号笔 4 支、便利贴 3 本、订书机 1 个。请在聊天里整理成“物品 / 数量”两列表格。';
const q2='Please format these supplied notes as three bullets in this chat: Breakfast is at 08:00. The workshop starts at 10:30. Lunch is at 12:15.';
function fastReadonly(q){
 const w=closedSuppliedFormatting(q);assert.equal(w?.kind,'supplied-text-formatting',q);
 for(const span of [...w.sourceSpans,...w.instructionSpans])assert.equal(q.slice(span.start,span.end),span.text);
 let scans=0;const options={contractVersion:4};
 for(const key of ['index','capabilityIndex'])Object.defineProperty(options,key,{get(){scans++;throw Error('unexpected inventory access');}});
 const r=routeTaskV4(q,options);assert.equal(r.performance.mode,'fast',q);assert.equal(r.task.readOnly,true,q);assert.equal(scans,0);
 assert.equal(r.task.originalRequest,q);return w;
}

test('delivery location and bounded source phrases compose before operation recognition',()=>{
 fastReadonly(q1);fastReadonly(q2);
 for(const q of [
  '分工记录：小明发送文档、小华整理链接、小雨采购纸张。在当前聊天中请整理成表格。',
  '请在这里把以下记录整理成表格：灯泡 4 个，插座 2 个，开关 1 个。',
  'Please in this chat format these short supplied excerpts as three bullets: One meeting is at 09:00. Another is at 11:00. The last is at 14:00.',
  'Please format the provided schedule notes as a list in your reply here: Setup is at 08:15. Doors open at 09:00.',
 ])fastReadonly(q);
});

test('table columns and supplied record rows are separate cardinalities',()=>{
 const a=fastReadonly(q1);assert.equal(a.presentation.rows,null);assert.equal(a.presentation.columns,2);assert.deepEqual(a.presentation.columnLabels,['物品','数量']);
 const b=fastReadonly('库存记录：钢笔 2 支、信纸 5 张、胶水 1 瓶。请在聊天中整理成“物品 / 数量”三行两列表格。');
 assert.equal(b.presentation.rows,3);assert.equal(b.presentation.columns,2);
 const c=fastReadonly('Ari is bringing cups, Bea is bringing juice, Cal is bringing plates. Please format these supplied notes as a three-row two-column table with Person and Item columns in this chat.');
 assert.equal(c.presentation.rows,3);assert.equal(c.presentation.columns,2);
});

test('ordinary read and conversational requests infer read-only without claiming closed inputs',()=>{
 for(const q of [
  '请查苏州博物馆官网，告诉我现在的开放时间和闭馆日，并在聊天里附上官网链接。',
  '查询公开页面，告诉我营业时间，并在聊天中附上来源。',
  '请检查这个项目，说明它的用途。',
  'Search the official website and tell me the opening hours.',
 ]){
  const a=taskAssessment(q);assert.equal(a.readOnly,true,q);assert.equal(a.restrictions.canGrantPermission,false);
  assert.equal(useFastPath(a,{contractVersion:4},{triggered:false}),false,q);
 }
});

test('independent artifacts and unknown effects are not erased by conversational inference',()=>{
 for(const q of [
  '源文件只读，给我做个游戏。',
  '源文件只读，写段代码文件。',
  '在聊天里生成一张图片文件。',
  '查阅资料，然后保存一份新的报告文件。',
  '检查目录，然后删除备份。',
  '检查项目并运行修复命令。',
  'Read-only source documents; orchestrate the deliverable',
  'Inspect the project and make a game.',
  '在聊天里给我做个网页。',
 ])assert.equal(taskAssessment(q).readOnly,false,q);
 const unknown=taskAssessment('处理这项工作。');assert.equal(unknown.restrictions.canGrantPermission,false);assert.equal(unknown.readOnly,false);
 assert.equal(taskAssessment('Only read the create.new.log file and describe the result').readOnly,true);
 assert.equal(taskAssessment('在聊天给一段内联代码，不创建文件。').readOnly,true);
});

test('normalization cannot consume an extra action or bind an external source',()=>{
 for(const q of [
  '请在聊天中整理成表格：input.csv。',
  '库存记录：钢笔 2 支、信纸 5 张。请在聊天中整理成表格，然后发送给客户。',
  'Please format these notes from the website as three bullets in this chat: See the attachment.',
  'Please format these attached notes as a list in this chat: The data is in my account.',
  '记录：甲 2 件、乙数量未提供。请在聊天里整理成两列表格。',
 ]){
  assert.equal(closedSuppliedFormatting(q),null,q);
  assert.equal(useFastPath(taskAssessment(q),{contractVersion:4},{triggered:false}),false,q);
 }
});
