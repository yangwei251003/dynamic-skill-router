import assert from 'node:assert/strict';
import {test} from 'node:test';
import {taskAssessment} from '../src/advisor-v4.mjs';
import {adviseTaskMethods} from '../src/task-methods-v4.mjs';
import {experimentDesign} from '../src/task-intents.mjs';

const ids=(query,options={})=>adviseTaskMethods(taskAssessment(query),options).map(x=>x.id);
test('comma-continuations retain method needs without changing retrieval clauses',()=>{
 const pairs=[
  ['解释这项机制的小白版和专业版都要。','解释这项机制，小白版和专业版都要。','dual-explanation'],
  ['研究这项技术的发展历程并横向对比同类技术。','研究这项技术的发展历程，再横向对比同类技术。','longitudinal-comparison'],
  ['项目目标目前不明确。','项目目标，目前不明确。','socratic-questioning'],
 ];
 for(const [flat,comma,id] of pairs){
  assert(ids(flat).includes(id),flat);assert(ids(comma).includes(id),comma);
  assert(taskAssessment(comma).activeText.includes('\n'));
 }
});
test('method matching does not bridge sentences or excluded/partial clauses',()=>{
 for(const query of [
  '研究这个产品的发展历程。横向对比同类工作服。',
  '研究这个产品的发展历程，再横向对比同类工作服的尺码。',
  '研究这个产品的发展历程，再横向对比其他工作服的尺码。',
  '项目目标。名单暂不明确。',
  '解释这个术语，不要做小白版，专业版已有。',
  '解释这个术语，以后做小白版，专业版已有。',
  '解释这个术语，例如小白版，专业版已有。',
  '解释这个术语，“小白版”，专业版已有。',
  '请翻译：“研究产品的发展历程，再横向对比同类产品”。',
 ])assert.deepEqual(ids(query),[],query);
});
test('current explicit method prohibition also blocks implicit rematching',()=>{
 for(const query of [
  '不要用苏格拉底提问。项目目标不明确，依据现有材料判断。',
  '不用双向钢人。两个方案都有道理。',
  'Do not use fact checking. 核实这项数据是否属实。',
  '不能使用苏格拉底提问。项目目标不明确。',
  '不要用苏格拉底提问和双向钢人。项目目标不明确，两个方案都有道理。',
 ])assert.deepEqual(ids(query),[],query);
 assert(ids('以后不要用苏格拉底提问。项目目标不明确。').includes('socratic-questioning'));
 assert(ids('资料说：“不要用苏格拉底提问”。项目目标不明确。').includes('socratic-questioning'));
 assert(ids('原先不要用苏格拉底提问，现在请用苏格拉底提问帮我明确目标。').includes('socratic-questioning'));
 assert.deepEqual(ids('原先请用苏格拉底提问，现在不要用苏格拉底提问。项目目标不明确。'),[]);
 assert(ids('解释限制的含义，例如不要用苏格拉底提问。项目目标不明确。').includes('socratic-questioning'));
 assert(ids('不要使用最小实验。请用双向钢人比较方案。').includes('two-sided-steelman'));
});
test('ordinary requests for balanced arguments and reversible pilots need no method name',()=>{
 assert(ids('比较两种供货方案，解释各自最有力的支持与反对理由。').includes('two-sided-steelman'));
 assert(ids('关键吞吐未测，请写一个可逆的验证计划。').includes('minimal-experiment'));
 for(const query of ['介绍双向钢人和最小实验的来源。','介绍为什么要分别写出支持与反对理由。','介绍可逆验证计划的概念和适用条件。','列出数据来源和发布日期。','为读书会写通知。'])assert.deepEqual(ids(query),[]);
 assert.deepEqual(ids('请写可逆的验证计划。',{nativeSufficient:true}),[]);
 assert.deepEqual(ids('两个方案都有道理。',{fast:true}),[]);
});
test('fixed experiment execution does not create a design decision',()=>{
 for(const query of [
  '用固定随机种子17做蒙特卡洛数值实验，样本量为500，重复30次并保存误差。',
  '按既定方案执行试验，样本量1000，重复12次。',
  'Run the experiment using seed 9 and sample size 200; repeat 10 times.',
  '设计一个展示实验日志的网页。',
  'Design a homepage for a lab notebook.',
  '评估试验结果的可靠性并解释误差。',
  'Evaluate the experiment results and calculate uncertainty.',
 ])assert.equal(experimentDesign(taskAssessment(query).activeText),false,query);
 for(const query of [
  '设计一个随机分组对照实验，控制混杂，安排重复测量与复现。',
  '为温室规划试验，按地块随机分组。',
  'Assign subjects to treatment arms with blocking.',
  'Review the trial design for confounding.',
  '检查对照组是否存在混杂。',
  '安排试验并决定独立重复次数，避免伪重复。',
 ])assert.equal(experimentDesign(taskAssessment(query).activeText),true,query);
});
