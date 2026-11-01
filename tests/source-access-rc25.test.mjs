import test from 'node:test';
import assert from 'node:assert/strict';
import {taskAssessment,routeTaskV4,formatAgentContextV4} from '../src/advisor-v4.mjs';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';
import {taskText} from '../src/task-input.mjs';

// Synthetic purpose fixtures with public interface identifiers. These are not
// an installed/runtime inventory, authentication evidence or effect guarantees.
const runtime={runtimeTools:[
 {name:'web__run',description:'Search the public web and open public web pages.',available:true},
 {name:'exec_command',description:'Run a local shell command and return its output.',available:true},
 {name:'view_image',description:'View a local image file from the filesystem.',available:true},
 {name:'image_gen__imagegen',description:'Generate images or edit images from descriptions and reference images.',available:true},
]};
const capabilityIndex={revision:'synthetic-unit-fixture',coverage:{},errors:[],capabilities:runtime.runtimeTools.map(t=>({...t,id:'tool:'+t.name,kind:'tool',enabled:t.available!==false,callable:t.available===true,evidence:'unit-fixture'}))};
const advise=(q,context={})=>adviseCapabilities(taskAssessment(q,context),{capabilityIndex,capabilityLimit:10});
const web=r=>r.candidates.some(c=>c.capabilityRole==='public-web-access');
const restricted=r=>(r.sourceAccessRequirements||[]).filter(x=>x.accessClass==='authenticated-private');
const chinese='读取受限页面 https://portal.example.org/reports/summary，使用我已有登录权限。只读，不要公开搜索，也不向其他服务发送内容；访问条件不够时说明缺口。';

test('Chinese reading and local observation preserve both source requirements',()=>{
 const r=advise('先阅读公开页面 https://example.org/image-guide，再观察本地 C:/fixtures/catalog-image.png，结合两份来源提出图片说明建议。仅在回复中给建议，不改文件，不生成图片。');
 assert.ok(web(r));assert.ok(r.candidates.some(c=>c.capabilityRole==='image-observation'));
});
test('English public and local source clauses remain independent',()=>{const r=advise('Read the public page https://example.org/guide. Then inspect the local C:/work/card.png image. Use both sources.');assert.ok(web(r));assert.ok(r.candidates.some(c=>c.capabilityRole==='image-observation'));});
test('restricted HTTPS resource exposes a private access gap',()=>{const r=advise(chinese);assert.equal(web(r),false);assert.equal(restricted(r).length,1);assert.ok(restricted(r)[0].gaps.includes('authenticated-source-capability-unverified'));});
test('English existing-login claim is not authentication evidence',()=>{const r=advise('Read the restricted page https://records.example.org/budget using my existing signed-in session. Read only.');assert.equal(web(r),false);assert.equal(restricted(r)[0]?.authenticationStatus,'unknown');});
test('a login qualifier binds to its neighboring source',()=>{const r=advise('读取 https://records.example.org/budget，使用我已有登录权限。');assert.equal(web(r),false);assert.equal(restricted(r).length,1);});
test('a separate public retrieval survives a private source',()=>{const r=advise('读取受限页面 https://records.example.org/budget。再阅读公开页面 https://example.org/method。');assert.ok(web(r));assert.equal(restricted(r).length,1);});
test('future private retrieval creates no current source gap',()=>{const r=advise('以后再读取受限页面 https://records.example.org/budget。现在只解释预算的含义。');assert.equal(web(r),false);assert.equal(restricted(r).length,0);});
test('quoted private retrieval remains source data',()=>{const r=advise('引用文本是：“读取受限页面 https://records.example.org/budget。”现在只解释这句话。');assert.equal(web(r),false);assert.equal(restricted(r).length,0);});
test('only supplied text and offline work do not create public retrieval',()=>{for(const q of ['只使用给定正文：版本为3.13。来源 https://example.org/。概括这一句。','Read https://example.org/guide. Do not access the internet.'])assert.equal(web(advise(q)),false);});
test('local copy keeps its local scope',()=>assert.equal(web(advise('阅读本地保存的 https://example.org/guide 副本并概括。')),false));
test('host public need does not reclassify a restricted source or prove login',()=>{const r=advise(chinese,{capabilityNeeds:['Search official public sources; you are already logged in.']});assert.equal(web(r),false);assert.equal(restricted(r)[0]?.authenticationStatus,'unknown');});
test('full and compact advice both retain readable access conditions',()=>{for(const responseDetail of ['full','compact']){const r=routeTaskV4(chinese,{index:[],capabilityIndex,responseDetail});assert.equal(r.sourceAccessRequirements?.[0]?.authenticationStatus,'unknown');assert.match(formatAgentContextV4(r),/认证|authentication/i);assert.match(formatAgentContextV4(r),/访问|access/i);}});

test('V4 preserves terminal URL punctuation while default V3 output stays exact',()=>{const q='Read https://example.org/guide. Then inspect the local image.';assert.equal(taskText(q),'Read  来源:example.org   Then inspect the local image.');assert.match(taskText(q,{preserveNetworkSources:true}),/公网来源:example\.org\s*\. Then/);});
test('terminal URL boundary separates read source from later local edit',()=>{const a=taskAssessment('Read https://example.org/guide. Then edit the local C:/work/card.png image.');assert.ok(a.activeClauses.some(c=>/Read/.test(c)&&!/edit/.test(c)));assert.ok(a.activeClauses.some(c=>/edit/.test(c)&&!/公网来源/.test(c)));});
test('terminal URL boundary preserves network restriction for every candidate',()=>{const q='Read https://example.org/guide. Do not access the internet.';const a=taskAssessment(q);assert.equal(a.restrictions.networkForbidden,true);const r=advise(q);assert.ok(r.candidates.filter(c=>c.networkScope?.purposeEvidence==='network').every(c=>c.decision==='skip'));assert.equal(web(r),false);});
test('global network restriction gates explicit fixture tools outside source retrieval',()=>{for(const [name,action] of [['web__run','read the public page'],['image_gen__imagegen','generate a diagram']]){const r=advise(`Read https://example.org/guide. Use ${name} to ${action}. Do not access the internet.`);const c=r.candidates.find(c=>c.name===name);assert.ok(c,name);assert.equal(c.networkScope?.forbidden,true);assert.ok(['skip','defer'].includes(c.decision),name);}});
