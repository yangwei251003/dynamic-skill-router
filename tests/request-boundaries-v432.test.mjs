import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4} from '../src/advisor-v4.mjs';

// Original synthetic examples: these do not contain user requests or logs.
const availability={discovered:true,readable:true,enabled:true,compatible:true,toolsAvailable:null};
const skills=[
  {id:'meeting-sample',nameZh:'会议管理',summaryZh:'查询腾讯会议的录制与会议状态。',triggers:['腾讯会议']},
  {id:'diagram-sample',nameZh:'流程图',summaryZh:'绘制并修改可编辑流程图。',triggers:['流程图']},
  {id:'docx',nameZh:'Word 文档',summaryZh:'Create and edit Word documents.',triggers:['Word','docx']},
  {id:'playwright',nameZh:'浏览器自动化',summaryZh:'使用 Playwright 测试网页交互。',triggers:['playwright']}
].map(x=>({...x,sourceId:'fixture',contentHash:'synthetic-'+x.id,availability}));
// Fixed unrelated entries exercise ranking against a nontrivial catalog.
for(let i=0;i<100;i++)skills.push({id:'fixture-unrelated-'+i,nameZh:'Unrelated '+i,
  summaryZh:'Unrelated catalog '+i,sourceId:'fixture',contentHash:'filler-'+i,availability});
const options={host:'generic',contractVersion:4,dryRun:true,useFeedback:false,routingMode:'full',
  index:{revision:'synthetic-boundaries-v432',coverage:{},errors:[],skills},
  runtimeTools:[],capabilityIndex:{capabilities:[],coverage:{},errors:[],revision:'synthetic-boundaries-v432'}};
const route=query=>routeTaskV4(query,options);
const suggested=(r,id)=>(r.consultCandidates||[]).find(x=>x.id===id&&x.suggestedMode!=='skip');

test('a named local input is an exclusive source when the user says so',()=>{
  const r=route('只使用当前目录 sales.csv 中的数据，离线制作摘要并另存为 summary.docx，原文件保持不变。');
  assert.equal(r.taskConstraints.sourceScope,'provided-only');
  assert.equal(r.taskConstraints.networkForbidden,true);
  assert.equal(r.taskConstraints.preserveInputs,true);
});

test('an output filename alone does not restrict the sources',()=>{
  const r=route('只把结果保存为 summary.csv，不限制使用其他来源。');
  assert.notEqual(r.taskConstraints.sourceScope,'provided-only');
});

test('negative skill instructions do not negate separately named skills',()=>{
  assert.equal(suggested(route('不使用 Playwright，请直接检查页面。'),'playwright'),undefined);
  const r=route('分别用 $playwright 和 $docx 检查网页与 Word 文档。');
  assert.equal(suggested(r,'playwright')?.explicit,true);
  assert.equal(suggested(r,'docx')?.explicit,true);
});

test('a current diagram about later steps differs from a task postponed until later',()=>{
  const current=route('请查询腾讯会议的录制，并绘制后续步骤流程图。');
  assert(suggested(current,'meeting-sample'));
  assert(suggested(current,'diagram-sample'));
  const deferred=route('请查询腾讯会议录制。以后再绘制流程图。');
  assert.equal(suggested(deferred,'diagram-sample'),undefined);
});

test('an offline modifier preserves the current task and its restriction',()=>{
  const r=route('制作无需联网的本地互动小游戏。');
  assert.match(r.task.activeText,/小游戏/);
  assert.equal(r.taskConstraints.networkForbidden,true);
});

test('supplied links can be opened when only additional searches are forbidden',()=>{
  const r=route('请打开给定链接 https://example.net/guide，不要联网搜索其他来源。');
  assert.equal(r.taskConstraints.sourceScope,'provided-only');
  assert.equal(r.taskConstraints.networkForbidden,false);
});
