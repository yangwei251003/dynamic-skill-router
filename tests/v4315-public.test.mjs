import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4} from '../src/advisor-v4.mjs';

const compile={name:'fixture__latex__compile',description:'Compile a saved TeX document or local project and return diagnostics without exporting a PDF.',available:true};
const create={name:'fixture__latex__create_project',description:'Create a new local LaTeX project directory containing main.tex. Use for a new TeX file or document.',available:true};
const entries=[compile,create].map(tool=>({id:'tool:'+tool.name,kind:'tool',...tool,enabled:true,callable:true,evidence:'runtime-tool'}));
const options={host:'generic',index:[],capabilityIndex:{capabilities:entries,coverage:{},errors:[],revision:'public-fixture'},runtimeTools:[compile,create],useFeedback:false,dryRun:true,routingMode:'full'};
const names=query=>routeTaskV4(query,options).capabilityCandidates.map(item=>item.name);

test('an existing TeX project needs a compiler, not a new project',()=>{
  const found=names('请编译现有 TeX 工程并列出诊断。');
  assert(found.includes(compile.name));
  assert(!found.includes(create.name));
});

test('a request for a new LaTeX document is distinct from compilation',()=>{
  const found=names('请新建一份 LaTeX 文档。');
  assert(found.includes(create.name));
  assert(!found.includes(compile.name));
});

test('an explanation or existing log does not itself request compilation',()=>{
  for(const query of ['解释如何编译 LaTeX 文件。','查看已有的 TeX 编译日志，不要再次编译。'])
    assert(!names(query).includes(compile.name),query);
});

test('a future action differs from a deadline for a current request',()=>{
  assert(!names('Compile draft.tex next month. Describe it today.').includes(compile.name));
  assert(names('Compile draft.tex by next month.').includes(compile.name));
});

test('a fresh report can be created without compiling it',()=>{
  const found=names('Start a fresh TeX report under a separate folder; never compile it.');
  assert(found.includes(create.name));
  assert(!found.includes(compile.name));
});
