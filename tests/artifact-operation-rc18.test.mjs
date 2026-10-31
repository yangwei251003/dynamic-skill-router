import test from 'node:test';
import assert from 'node:assert/strict';
import {taskStructure} from '../src/task-structure.mjs';
import {taskAssessment, routeTaskV4} from '../src/advisor-v4.mjs';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';
const tool=(name,description)=>({id:`tool:${name}`,kind:'tool',name,description,enabled:true,callable:true,evidence:'runtime-tool',annotations:{}});
const shell=tool('terminal','Runs a command in a local terminal.');
const writer=tool('canvas_runtime','Use this first-party JavaScript tool for persistent spreadsheet and presentation authoring and editing an existing bound canvas.');
const options={host:'codex',index:[],capabilityIndex:{capabilities:[shell,writer],coverage:{},errors:[]},useFeedback:false,dryRun:true,writeLog:false};
const advise=query=>adviseCapabilities(taskAssessment(query),options).candidates;

test('bare and filename output formats share roles without classifying explanations as files',()=>{
  for(const format of ['PPTX','DOCX','PDF','SVG','CSV']){
    const bare=taskStructure(`Create ${format}; the answer is 3/4.`);
    const named=taskStructure(`Create result.${format}; the answer is 3/4.`);
    assert.deepEqual(bare.artifacts.map(({format,role})=>({format,role})),named.artifacts.map(({format,role})=>({format,role})));
    assert.equal(bare.artifacts[0].role,'output');
  }
  assert.equal(taskStructure('Explain the difference between PPTX and PDF.').artifacts.length,0);
  assert.equal(taskStructure('Create a jsonParser function.').artifacts.length,0);
});

test('arithmetic contents do not consume a separately requested persisted deliverable',()=>{
  for(const query of ['做 4 页可编辑 PPT，结果为 2/3，交付 PPTX。','Create a CSV summary; the result is 9/4.','计算 12/4，导出 PDF。']){
    assert.equal(routeTaskV4(query,options).performance.mode,'full',query);
    assert.equal(routeTaskV4(query,{...options,nativeSufficient:true}).performance.mode,'full',query);
  }
  assert.equal(routeTaskV4('计算 12/4，只输出结果。',options).performance.mode,'fast');
  assert.equal(routeTaskV4('把“交付 PPTX、交付 PPTX、导出 PDF”去重，保留原顺序，只输出结果。',options).performance.mode,'fast');
});

test('a specialist offline engineering operation does not imply generic shell support',()=>{
  assert(!advise('在专用工程软件中制作离线工程，生成梯形图并编译保存。').some(x=>x.capabilityRole==='local-execution'));
  assert(!advise('在 TIA Portal V17 做离线教学工程，生成梯形图并编译保存，不连接真实 PLC，不下载，也不切 RUN。').some(x=>x.capabilityRole==='local-execution'));
  const cards=advise('Read local source.tex and saved.log files; repair source.tex and run its compiler.');
  const runtime=cards.find(x=>x.capabilityRole==='local-execution');
  assert(runtime);assert(runtime.operationEvidence.some(x=>/source\.tex/.test(x.clause)));
  assert.match(runtime.expectedBenefit,/source\.tex/);assert.equal(runtime.effect,'unknown');
  assert.equal(runtime.invocation.automaticallyExecuted,false);
});

test('a table inside a Word document does not request a spreadsheet authoring surface',()=>{
  for(const query of ['把下面内容做成一页可编辑的 Word 通知，时间地点用表格列出，交付 DOCX。','Create a Word document with a table; save report.docx.'])
    assert(!advise(query).some(x=>x.name===writer.name),query);
  assert(advise('Create a presentation with speaker notes.').some(x=>x.name===writer.name));
});

test('local evidence does not erase read-only and offline restrictions',()=>{
  const runtime=advise('只读检查本地 source.tex 文件，不联网，不修改。').find(x=>x.capabilityRole==='local-execution');
  assert(runtime);assert.equal(runtime.decision,'defer');assert.equal(runtime.scopeReadOnly,true);
  assert.equal(runtime.networkScope.forbidden,true);
  assert(runtime.operationEvidence.every(x=>x.source==='user-request'));
});
