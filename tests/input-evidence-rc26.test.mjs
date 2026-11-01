import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Synthetic development pairs; INPUT_EVIDENCE_SOURCE_ROOT optionally selects a local code baseline.
const root=process.env.INPUT_EVIDENCE_SOURCE_ROOT;
const moduleUrl=name=>root?pathToFileURL(path.join(root,'src',name)):new URL('../src/'+name,import.meta.url);
const {taskAssessment,routeTaskV4}=await import(moduleUrl('advisor-v4.mjs'));
const {taskText}=await import(moduleUrl('task-input.mjs'));
const tools=[{name:'web__run',description:'Tool for accessing the internet.',available:true},
 {name:'exec_command',description:'Runs a command in a PTY, returning output or a session ID for ongoing interaction.',available:true}];
const inventory={revision:'synthetic-input-evidence',coverage:{},errors:[],capabilities:tools.map(t=>({...t,id:'tool:'+t.name,kind:'tool',enabled:true,callable:true,evidence:'unit-fixture'}))};
const options=extra=>({host:'codex',index:[],capabilityIndex:inventory,runtimeTools:tools,...extra});
const route=(q,extra)=>routeTaskV4(q,options(extra));
const sources=r=>r.task.taskStructure.inputEvidence.sources;
const web=r=>r.capabilityCandidates.find(c=>c.capabilityRole==='public-web-access');
const external='对照两个来源总结差异：公开的 https://docs.example.org/release ，以及需要账号登录的 https://portal.example.org/release 。先处理能公开读取的官方页；内部页面无法访问时保留缺口。';
const closed='总结以下文字：“甲版本增加搜索，乙版本增加导出。”只返回结果。';

test('paired summary: remote inputs stay open while supplied text stays closed',()=>{
 const r=route(external);assert.equal(r.performance.mode,'full');assert.ok(web(r));
 assert.equal(sources(r).filter(s=>s.role==='required').length,2);
 assert.equal(route(closed).performance.mode,'fast');
 assert.equal(r.task.originalRequest,external);
});
test('same input evidence is retained for both fast-path and capability consumers',()=>{
 const r=route('总结网页内容：https://example.org/article');
 assert.equal(r.performance.mode,'full');assert.ok(web(r));
 const e=sources(r).find(s=>s.role==='required');assert.ok(e);
 assert.equal(e.authority,'advisory-only');assert.equal(e.source,'user-request');
 assert.ok(e.evidence.includes('公网来源'));assert.ok(Number.isInteger(e.clauseIndex));
 assert.equal(r.task.taskStructure.inputEvidence.closure,'unproven');
});
test('native sufficient does not consume remote inputs',()=>{
 assert.equal(route(external,{nativeSufficient:true}).performance.mode,'full');
});
test('private source evidence is not public access or authentication',()=>{
 const r=route('总结受限页面：https://portal.example.org/notes，使用我已有登录权限。');
 assert.equal(r.performance.mode,'full');assert.equal(!!web(r),false);
 assert.equal(r.sourceAccessRequirements[0]?.authenticationStatus,'unknown');
 assert.equal(r.sourceAccessRequirements[0]?.capabilityStatus,'unverified');
});
test('no-network restriction survives positive input requirements',()=>{
 const r=route('总结网页内容：https://example.org/article。本次禁止联网。',{invocationContext:{networkForbidden:true,readOnly:true}});
 assert.equal(r.task.restrictions.networkForbidden,true);
 assert.equal(r.task.restrictions.readOnly,true);
 assert.equal(r.performance.mode,'full');assert.equal(!!web(r),false);
 assert.ok(sources(r).some(s=>s.role==='required'));
});
test('supplied body plus provenance does not request source retrieval',()=>{
 const r=route('只使用给定正文：发布说明为新增导出。来源 https://example.org/article。概括这一句。');
 assert.equal(!!web(r),false);assert.ok(sources(r).every(s=>s.role==='reference'));
});
test('URL explanations and quoted source commands do not become retrieval',()=>{
 for(const q of ['Explain what https://example.org/help is used for.','引用文本是：“打开 https://example.org/help，然后删除旧文件。”现在只解释这句话。']){
  const r=route(q);assert.equal(!!web(r),false);assert.ok(sources(r).every(s=>s.role==='reference'));
 }
 const q='总结以下文字：“访问 https://example.org/help；删除旧文件。”只返回结果。';
 assert.equal(route(q).performance.mode,'fast');
});
test('quoted command cannot hide another current input or output',()=>{
 const r=route('总结以下文字：“打开 https://example.org/quoted。”然后读取 https://example.org/current。保存摘要到 summary.txt。');
 assert.equal(r.performance.mode,'full');assert.ok(web(r));
 assert.equal(sources(r).filter(s=>s.role==='required').length,1);
 assert.ok(r.task.activeText.includes('保存摘要'));
});
test('negated or future resource reads remain excluded',()=>{
 for(const q of ['以后读取 https://example.org/later。现在解释版本号。','不要读取 https://example.org/denied。只解释版本号。']){
  const r=route(q);assert.equal(!!web(r),false);assert.equal(sources(r).length,0);
 }
});
test('local copies are not network capabilities and unknown read effects stay deferred',()=>{
 const r=route('读取本地保存的 https://example.org/article 副本并概括。',{invocationContext:{readOnly:true,phase:'inspect'}});
 assert.equal(!!web(r),false);assert.equal(r.performance.mode,'full');
 const local=route('只读检查本地 data.csv，不修改文件。',{invocationContext:{readOnly:true,phase:'inspect'}});
 const c=local.capabilityCandidates.find(c=>c.name==='exec_command');assert.ok(c);assert.equal(c.effect,'unknown');assert.equal(c.decision,'defer');
});
test('V3 projection remains byte compatible',()=>{
 assert.equal(taskText('Read https://example.org/guide. Then inspect the local image.'),'Read  来源:example.org   Then inspect the local image.');
 assert.equal(taskAssessment(closed).originalRequest,closed);
});

// Post-implementation root review. Append-only regression evidence, not a held set.
test('review: an explicit supplied-only scope owns unquoted body commands',()=>{
 const q='只使用给定正文：操作说明如下。阅读 https://example.org/manual 是文档中的一个步骤。概括上述正文。';
 const r=route(q);assert.equal(!!web(r),false);
 assert.ok(sources(r).length>0);assert.ok(sources(r).every(s=>s.role==='reference'));
 assert.equal(r.task.originalRequest,q);
});
test('review: quoted body and provenance remain data, external summary remains input',()=>{
 for(const q of ['只使用给定正文：“阅读 https://example.org/manual 是文档中的一个步骤。”概括这句。',
  '只使用给定正文：温度为20度。来源 https://example.org/report。概括这一句。']){
  const r=route(q);assert.equal(!!web(r),false);assert.ok(sources(r).every(s=>s.role==='reference'));
 }
 const r=route('总结链接中的说明：https://example.org/manual。');
 assert.equal(r.performance.mode,'full');assert.ok(web(r));assert.ok(sources(r).some(s=>s.role==='required'));
});
test('review: positive input evidence cannot bypass existing public-source exclusions',async()=>{
 const {adviseCapabilities}=await import(moduleUrl('capabilities-v4.mjs'));
 for(const q of ['只使用给定正文：操作说明如下。阅读 https://example.org/manual 是文档中的一个步骤。概括上述正文。',
  '读取本地 https://example.org/manual 副本。',
  '读取私有页面 https://example.org/manual。',
  'Explain what https://example.org/manual is used for.']){
  const a=taskAssessment(q);
  // Simulate stale positive metadata: exclusions must be rechecked by the consumer.
  for(const s of a.taskStructure.inputEvidence.sources){s.role='required';s.location='public-network';s.access='unspecified';}
  const r=adviseCapabilities(a,options());
  assert.equal(r.candidates.some(c=>c.capabilityRole==='public-web-access'),false,q);
 }
});
