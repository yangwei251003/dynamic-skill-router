import test from 'node:test';
import assert from 'node:assert/strict';
import {closedSuppliedFormatting} from '../src/native-closure.mjs';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath,planRecovery} from '../src/recovery-v4.mjs';

function closed(query){
 const witness=closedSuppliedFormatting(query);assert.ok(witness,query);
 for(const span of [...witness.sourceSpans,...witness.instructionSpans])assert.equal(query.slice(span.start,span.end),span.text);
 let inventoryReads=0;const options={contractVersion:4,dryRun:true};
 for(const name of ['index','capabilityIndex'])Object.defineProperty(options,name,{get(){inventoryReads++;throw Error('unexpected inventory read');}});
 const result=routeTaskV4(query,options);
 assert.equal(result.performance.mode,'fast');assert.equal(result.task.readOnly,true);
 assert.equal(result.task.originalRequest,query);assert.equal(inventoryReads,0);
 return witness;
}

test('consumed raw failures are repaired without host-provided classification',()=>{
 const first=closed('请在聊天里把下面的值班安排整理成三行，姓名和时段保持对应：上午小陈，下午小李，晚上小王。');
 assert.equal(first.presentation.rows,3);
 const second=closed('Here are the lunch orders: Priya — 2 sandwiches; Marco — 1 salad; Lee — 3 soups. Put them in a compact Name / Order table in this chat.');
 assert.deepEqual(second.presentation.columnLabels,['Name','Order']);
});

test('business reference, output shape and field labels vary independently',()=>{
 for(const noun of ['下面的交接记录','以下场地安排','这些给定的出席记录']){
  for(const shape of ['三行','三行两列表格','列表']){
   closed(`请把${noun}整理成${shape}，姓名和时段保持对应：早班甲，午班乙，晚班丙。`);
  }
 }
 for(const verb of ['Format','Arrange','Put'])for(const shape of ['a concise Owner / Count table','three lines','a numbered list']){
  closed(`The supplied counts: Ann = 2; Bo = 5; Cy = 4. ${verb} them in ${shape} in this chat.`);
 }
});

test('output attributes cannot consume an external action or absent source',()=>{
 for(const query of [
  'The supplied counts: Ann = 2; Bo = 5. Put them in a table and send it to the team.',
  'The supplied counts: counts.csv. Put them in a table in this chat.',
  '请把下面的出席记录整理成表格，然后保存文件：早班甲，晚班乙。',
  '请把官网上的值班安排整理成三行：上午小陈，下午小李，晚上小王。',
  'Here are the counts: Ann = 2; Bo = 5. Put the records from the database in a table.',
 ]){
  assert.equal(closedSuppliedFormatting(query),null,query);
  assert.equal(useFastPath(taskAssessment(query),{contractVersion:4},{triggered:false}),false,query);
 }
});

test('a host capability gap is not silently discarded by a conflicting native hint',()=>{
 assert.equal(useFastPath({activeText:'简短概括',capabilityRequests:[{purpose:'actual missing source'}]},
  {nativeSufficient:true},{triggered:false}),false);
});

test('host offline restriction reaches both assessment and recovery and cannot relax a user limit',()=>{
 const host=taskAssessment('研究数据的来源。',{}, {networkForbidden:true});
 assert.equal(host.restrictions.networkForbidden,true);
 const recovery=planRecovery(host,{recoveryContext:{confidence:'low'}});
 assert.equal(recovery.networkForbidden,true);assert.equal(recovery.externalResearchRequired,false);
 const user=taskAssessment('离线完成，不要联网。',{}, {networkForbidden:false});
 assert.equal(user.restrictions.networkForbidden,true);
});
