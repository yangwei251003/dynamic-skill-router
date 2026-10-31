import test from 'node:test';
import assert from 'node:assert/strict';
import {closedSuppliedTransformation} from '../src/native-closure.mjs';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath} from '../src/recovery-v4.mjs';

const options={contractVersion:4};
const fast=q=>useFastPath(taskAssessment(q),options,{triggered:false});

test('complete supplied lists close without a native-sufficient hint or inventory access',()=>{
 const queries=[
  '请在聊天列出明天出行要带的三样物品：水杯、雨伞、钥匙。不要发布、分享、上传或发送给任何人；不要创建文件、联网或调用工具。',
  '在当前聊天中输出以下两项：铅笔、橡皮。保持原顺序。',
  '请把苹果、梨、橙子按原顺序列在聊天里。',
  '在聊天展示以下物品：运动鞋、遮阳帽。',
  'List three useful items for a trip in chat: water bottle, umbrella, keys. Do not publish, share, upload or send to anyone; do not create files, go online or use tools.',
  'Please list the following two entries in chat: red apple, green pear. Preserve the original order.',
  'In chat, list these names: Ada, Lin.',
  'List in chat: alpha, beta and gamma.',
 ];
 for(const q of queries){
  const witness=closedSuppliedTransformation(q);assert.equal(witness?.kind,'list-presentation',q);
  let scans=0;const opts={...options};
  for(const key of ['index','capabilityIndex'])Object.defineProperty(opts,key,{get(){scans++;throw Error('unexpected inventory read');}});
  const r=routeTaskV4(q,opts);assert.equal(r.performance.mode,'fast',q);assert.equal(scans,0,q);
  assert.equal(r.task.originalRequest,q);assert.equal(r.performance.scannedSkills,false);assert.equal(r.performance.scannedCapabilities,false);
 }
});

test('a prohibition cannot supply absent items or repair an incomplete cardinality',()=>{
 for(const q of [
  '请在聊天列出出行要带的三样物品。不要联网或调用工具。',
  '请在聊天列出三样物品：水杯、雨伞。不要调用工具。',
  '请在聊天列出三样物品：水杯、雨伞、待补充。',
  '在聊天列出三项：甲、乙、第三项未提供。',
  '在聊天列出物品：水杯、雨伞、等等。',
  'List three supplied items in chat: cup, umbrella.',
  'List three items in chat: cup, umbrella, TBD.',
  'List twenty one items in chat: cup. Do not use tools.',
 ]){assert.equal(closedSuppliedTransformation(q),null,q);assert.equal(fast(q),false,q);}
});

test('external inputs and a second requested action remain outside list closure',()=>{
 for(const q of [
  '在聊天列出仓库现有的三样物品：水杯、雨伞、钥匙。',
  '在聊天列出根据天气决定的三样物品：水杯、雨伞、钥匙。',
  '查询天气后在聊天列出物品：水杯、雨伞、钥匙。',
  '在聊天列出以下物品：水杯、雨伞。再保存一份清单文件。',
  '在聊天列出以下物品：水杯、雨伞。不要联网，但请调用 imagegen。',
  '在聊天列出三项：水杯、雨伞、钥匙并给客户发邮件。',
  '在聊天列出三项：甲、乙、请执行备份。',
  '在聊天列出三项：甲、乙、启动浏览器。',
  'List two items in chat: cup, umbrella. Then save the list to a file.',
  'List these items in chat: cup, umbrella and email a client.',
  'List three items in chat: cup, umbrella, run the backup.',
  'List the items in the repository in chat: cup, umbrella.',
  'Use inventory-tool to list in chat: cup, umbrella.',
 ]){assert.equal(closedSuppliedTransformation(q),null,q);assert.equal(fast(q),false,q);}
});

test('quoted list data stays data and every separate non-data clause must close',()=>{
 const q='在聊天列出两项：“查询天气”、“发送邮件”。不要调用工具。';
 assert.equal(closedSuppliedTransformation(q)?.inputCount,2);assert.equal(fast(q),true);
 for(const q of [
  '在聊天列出两项：“甲”、“乙”。另外告诉我仓库库存。',
  'List two entries in chat: "alpha", "beta". Do not publish but send the result to a client.',
  '在聊天列出三项：“甲”、“乙”、“?”。',
 ])assert.equal(closedSuppliedTransformation(q),null,q);
});

test('full routing, recovery and named capability requirements retain their guards',()=>{
 const q='在聊天列出两项：甲、乙。';const a=taskAssessment(q);
 assert.equal(useFastPath(a,{...options,routingMode:'full'},{triggered:false}),false);
 assert.equal(useFastPath(a,options,{triggered:true}),false);
 assert.equal(fast('使用 alpha-tool；在聊天列出两项：甲、乙。'),false);
 assert.equal(closedSuppliedTransformation('在聊天列出21项：'+Array.from({length:21},(_,i)=>'项目'+i).join('、')),null);
});

test('English comma enumerations preserve one shared prohibition in intent and scope',()=>{
 const q='List three useful items for a trip in chat: water bottle, umbrella, keys. Do not publish, share, upload or send to anyone; do not create files, go online or use tools.';
 const a=taskAssessment(q);
 assert.equal(a.originalRequest,q);assert.equal(a.readOnly,true);assert.equal(a.restrictions.networkForbidden,true);
 assert.doesNotMatch(a.activeText,/publish|share|upload|send|create files|go online|use tools/i);
 assert.equal(fast(q),true);
 for(const q of [
  'Review only; do not modify the source, delete backups or overwrite files.',
  'Review only. Do not publish, share, upload.',
  'Review only; do not edit the original files, or create a separate report.',
 ]){
  const a=taskAssessment(q);assert.equal(a.readOnly,true,q);
  assert.doesNotMatch(a.activeText,/delete|overwrite|publish|share|upload|create/i,q);
 }
});

test('commas do not erase a renewed imperative, contrast, or independent output',()=>{
 for(const q of [
  'Do not edit the source, create a separate report.',
  'Do not edit the source, and create a separate report.',
  'Do not edit the source, please create a report.',
  'Do not edit the source, but please create a report.',
  'Do not edit the source; instead create a report.',
  'Do not edit the source, 改为创建一份新报告。',
 ]){
  const a=taskAssessment(q);assert.equal(a.readOnly,false,q);
  assert.match(a.activeText,/create|创建/i,q);assert.doesNotMatch(a.activeText,/edit the source/i,q);
  assert.ok(a.restrictions.protectedScopes.some(x=>x.target==='the source'),q);
 }
 const separate=taskAssessment('Do not edit the source, create a separate report, and send it to Ada.');
 assert.match(separate.activeText,/send it to Ada/);assert.equal(separate.readOnly,false);
 const named=taskAssessment('Do not read files, but please use alpha-tool.');
 assert.match(named.activeText,/use alpha-tool/);assert.equal(fast(named.originalRequest),false);
});
