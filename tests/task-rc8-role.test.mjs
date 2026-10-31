import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';
import {semanticTaskText} from '../src/task-structure.mjs';
import {webImplementation,sourceCodeReview,latexSourceRepair,manualNeedKeys} from '../src/task-intents.mjs';
import {inferCapability} from '../src/skill-staging.mjs';

const manual=(id,summaryZh)=>({id,nameZh:id,summaryZh,sourceId:'fixture'});
const frontend=manual('frontend-patterns','Build functional browser interfaces with JavaScript code and interactive state.');
const repair=manual('tex-correction','Diagnose and fix LaTeX compilation errors, undefined references and math mode violations.');
// Classifier identity follows the format; purpose controls its coverage role.
repair.nameZh='latex correction';
const doctor=manual('latex-doctor','Detect TeX runtime availability and run small compile smoke tests.');
const polish=manual('latex-polish','Polish academic writing in LaTeX files while preserving references and math.');
const review=manual('changed-code-review','Review changed code against original specification intent and coding standards.');
const python=manual('python-patterns','Python idioms and best practices. Use when writing or reviewing Python code.');
const dart=manual('dart-code-review','Review Dart code for state management and correctness.');
const verify=manual('verification-loop','Verify a coding session before claiming completion through builds and tests.');
const cost=manual('cost','Analyze cost budgets and financial spending.');
const options={host:'codex',index:[frontend,repair,doctor,polish,review,python,dart,verify,cost],capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const cards=query=>routeTaskV4(query,options).consultCandidates;

for(const query of [
 '制作一个浏览器双人棋盘，交付可运行源码，能够落子和重开。',
 'Create a local browser puzzle with turn state; deliver runnable source code.',
 '搭建浏览器计时器，提供源码，按钮切换暂停状态。',
])test('browser artifact and runnable source establish implementation: '+query,()=>{
 assert(webImplementation(query));assert(cards(query).some(x=>x.id===frontend.id));
});
for(const query of ['只观察浏览器计时器，解释源码结构。','Inspect the browser puzzle and report issues with its source code.'])
 test('observing a browser artifact is not implementation: '+query,()=>assert(!webImplementation(query)));

for(const query of ['全程只读：审查给定Python补丁的默认参数和资源关闭行为。只报告依据与建议测试。','Please review the supplied Python diff for correctness; report findings only.'])
 test('source review gets review-purpose guidance without execution: '+query,()=>{
  assert(sourceCodeReview(query));const selected=cards(query);
  assert(selected.some(x=>[review.id,python.id].includes(x.id)));
  assert(!selected.some(x=>x.id===dart.id));
  assert.equal(manualNeedKeys(verify,inferCapability(verify),query).includes('source-code-review'),false);
 });
test('a new review application is creation, not a request for static review',()=>{
 assert(!sourceCodeReview('Build a Python code review application with an HTTP service.'));
});
for(const query of ['修复本地LaTeX项目的引用标签和控制序列，实际编译PDF。','Repair the TeX source project to resolve undefined references and deliver a compiled PDF.'])
 test('source repair remains distinct from a compiler readiness check: '+query,()=>{
  assert(latexSourceRepair(query));const selected=cards(query);
  assert(selected.some(x=>x.id===repair.id));
  assert(!selected.some(x=>x.id===polish.id));
  assert(!manualNeedKeys(doctor,inferCapability(doctor),query).includes('latex-source-repair'));
 });
test('environment-only diagnosis does not establish source modification need',()=>{
 assert(!latexSourceRepair('只检查LaTeX运行环境和编译器是否可用，报告版本。'));
 assert(!manualNeedKeys(repair,inferCapability(repair),'Detect TeX runtime availability.').includes('latex-source-repair'));
});
test('source identifier collisions do not supply a topical subject',()=>{
 for(const label of ['tab:cost','fig:finance','sec:medical'])assert(!semanticTaskText('LaTeX引用标签'+label+'不匹配').includes(label.split(':')[1]));
 assert(!cards('修复LaTeX项目引用标签tab:cost，使其能编译。').some(x=>x.id===cost.id));
});

test('cell ranges remain structured addressing rather than source labels',()=>{
 for(const range of ['B2:H90','D4:K38','AA1:BC200'])assert(semanticTaskText('读取Google Sheets '+range).includes(range));
});
test('qualified explicit names retain original authorization and identity',()=>{
 const skill=manual('source:cost','Analyze cost budgets.');
 const query='请使用 source:cost 完成这个任务';
 const result=routeTaskV4(query,{...options,index:[skill]});
 assert(result.consultCandidates.some(x=>x.id===skill.id&&x.explicit));
 assert.equal(taskAssessment(query).originalRequest,query);
});
