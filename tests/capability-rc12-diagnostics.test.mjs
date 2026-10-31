import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities,discoverCapabilities} from '../src/capabilities-v4.mjs';

const name='mcp__codex_app__compile_latex_document';
// Original synthetic metadata for a local diagnostic compiler. No actual
// runtime inventory is bundled; descriptions do not verify effects.
const purpose='Compile a saved TeX document or local multifile project to return diagnostics. Reads source content without changing it; returns diagnostics without exporting any document.';
const overview='Manage a sample desktop app: organize chats and open local project panels.';
const compiler={name,available:true,description:`${overview}\n\n${purpose}`};
const shell={name:'exec_command',available:true,description:'Runs a command in a local terminal.'};
const query='请对保存好的 main.tex 只做一次内置 LaTeX 编译诊断，在聊天列出诊断信息。不要改源文件、导出 PDF、创建项目或打开编辑器。不联网、不安装、不更改配置。';
const advise=(activeText,tools=[compiler,shell],extra={})=>adviseCapabilities({activeText,
  activeClauses:activeText.split(/[\n。；;，,]/),readOnly:true,restrictions:{networkForbidden:true},...extra},
  {capabilityIndex:discoverCapabilities({host:'generic',runtimeTools:tools}),capabilityLimit:10}).candidates;

test('built-in compilation diagnostics are discovered from their own purpose without fabricating verified effects',()=>{
 const cards=advise(query);
 assert.deepEqual(cards.map(x=>x.name),[name]);
 const card=cards[0];
 assert.equal(card.capabilityRole,'compilation-diagnostics');assert.equal(card.phase,'validation');
 assert.equal(card.effect,'unknown');assert.equal(card.decision,'defer');
 assert.equal(card.explicit,false);assert.equal(card.availability.callable,true);
 assert(card.gates.includes('verify-read-only-effect-before-invocation'));
 assert.equal(card.networkScope.purposeEvidence,'local');
 assert.equal(card.invocation.automaticallyExecuted,false);
 assert.match(card.description,/^Compile a saved TeX/);
});

test('diagnostic discovery follows the source object and purpose, independently of provider names',()=>{
 const alternate={name:'mcp__inspection__compile_source',available:true,description:purpose};
 const wrongObject={name:'mcp__inspection__compile_styles',available:true,
  description:purpose.replaceAll('TeX','Sass').replaceAll('LaTeX','Sass')};
 const cards=advise('Run compilation diagnostics on the saved local LaTeX document.',[alternate,wrongObject]);
 assert.deepEqual(cards.map(x=>x.name),[alternate.name]);
 assert.equal(cards[0].effect,'unknown');
});

test('compilers that write artifacts and compilers with unspecified effects do not become read-only diagnostics',()=>{
 for(const description of ['Compile a saved TeX document and write a PDF plus auxiliary files; return diagnostics.',
  'Compile a saved TeX document and return diagnostics.']){
  const tool={name:'mcp__build__compile_latex',available:true,description,annotations:{readOnlyHint:true}};
  const card=advise(`Use ${tool.name} for a local LaTeX compilation check.`,[tool])[0];
  assert.equal(card?.effect,'write-or-unknown');assert.equal(card?.decision,'skip');
  assert(card.gates.includes('read-only-scope'));
 }
 const writer={name:'mcp__build__compile_latex',available:true,description:'Compile a saved TeX document and write a PDF.'};
 const permitted=advise(`Use ${writer.name} to compile the local LaTeX source and export a PDF.`,[writer],{readOnly:false})[0];
 assert.equal(permitted?.effect,'write-or-unknown');assert.notEqual(permitted?.decision,'use-now');
 const conflicting={name:'mcp__build__compile_and_export',available:true,description:purpose,annotations:{readOnlyHint:true}};
 const blocked=advise(`Use ${conflicting.name} for a local LaTeX compilation check.`,[conflicting])[0];
 assert.equal(blocked?.effect,'write-or-unknown');assert.equal(blocked?.decision,'skip');
});

test('other operations cannot borrow a diagnostic compiler contract from workflow instructions',()=>{
 const create={name:'mcp__codex_app__create_latex_project',available:true,
  description:`${overview}\n\nCreate a new local LaTeX project directory containing main.tex. ${purpose}`};
 const exportPdf={name:'mcp__codex_app__export_pdf',available:true,
  description:`${overview}\n\nExport a PDF from a local LaTeX project. ${purpose}`};
 const cards=advise(query,[compiler,create,exportPdf]);
 assert.deepEqual(cards.map(x=>x.name),[name]);
});

test('explaining diagnostics, reading logs, or prohibiting compilation creates no compiler execution need',()=>{
 for(const text of ['解释内置 LaTeX 编译诊断如何工作。','只读检查 LaTeX 编译日志，不编译源文件。',
  'Explain compilation diagnostics for a local LaTeX document.',
  'Read the saved LaTeX log; do not compile the document.']){
  assert(!advise(text,[compiler]).length,text);
 }
});

test('offline scope blocks remote compilation and retains uncertainty when locality is not described',()=>{
 const remote={...compiler,name:'mcp__cloud__compile_source',description:purpose.replace('saved TeX document or local multifile project','remote TeX document')};
 assert(!advise(query,[remote]).length);
 const named=advise(`Use ${remote.name} for LaTeX compilation diagnostics.`,[remote])[0];
 assert.equal(named?.decision,'skip');assert(named.gates.includes('network-forbidden'));
 const unknown={...compiler,name:'mcp__unknown__compile_source',description:purpose.replace('saved TeX document or local multifile project','saved TeX document')};
 const card=advise('Run compilation diagnostics for the saved LaTeX document.',[unknown])[0];
 assert.equal(card?.networkScope.purposeEvidence,'unknown');assert.equal(card?.decision,'defer');
 assert(card.gates.includes('verify-no-network-before-invocation'));
});

test('a separately requested local script can coexist with the dedicated diagnostic operation',()=>{
 const cards=advise('运行本地脚本检查引用清单，并对保存好的 main.tex 做内置 LaTeX 编译诊断。');
 assert(cards.some(x=>x.name===name));assert(cards.some(x=>x.name===shell.name));
 assert(cards.every(x=>x.invocation.automaticallyExecuted===false));
});
