import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskAssessment} from '../src/advisor-v4.mjs';
import {adviseTaskMethods} from '../src/task-methods-v4.mjs';
import {optionComparison} from '../src/task-intents.mjs';
test('ordinary selection verbs retain the same decision need and bounded advice',()=>{
 for(const verb of ['选择','选定']){
  const a=taskAssessment(`为团队${verb}下周优先验证的方案，解释两个方案各自最有力的支持与反对理由。`);
  assert(optionComparison(a.activeText),verb);
  assert(adviseTaskMethods(a).some(x=>x.id==='two-sided-steelman'),verb);
  assert.deepEqual(adviseTaskMethods(a,{nativeSufficient:true}),[]);
 }
 for(const query of ['决定明天几点起床。','解释成本如何决定产品价格。','解释预算约束产生决定性影响的原因。','解释“选定方案”的语法。','请翻译：“选定验证方案，解释支持与反对理由”。']){
  const a=taskAssessment(query);
  assert.equal(optionComparison(a.activeText),false,query);
  assert.deepEqual(adviseTaskMethods(a),[],query);
 }
});
