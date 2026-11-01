import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4,taskAssessment,formatAgentContextV4} from '../src/advisor-v4.mjs';
import {planRecovery} from '../src/recovery-v4.mjs';
import {discoverCapabilities,adviseCapabilities} from '../src/capabilities-v4.mjs';

// These are development examples, never reported as a held-out acceptance set.
const tools=[
 {name:'image_gen__imagegen',description:'Generate new images or edit existing images from user descriptions.'},
 {name:'view_image',description:'View a local image file for visual inspection.',annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'web__run',description:'Search images or web pages, open pages, and use image_query to find pictures.'},
];
const capabilities=tools.map(t=>({id:`tool:${t.name}`,kind:'tool',name:t.name,description:t.description,server:null,plugin:null,enabled:true,callable:true,evidence:'runtime-tool',annotations:t.annotations||{}}));
const base={index:[],capabilityIndex:{capabilities,coverage:{},errors:[],revision:'dev'},runtimeTools:tools,capabilityLimit:10};
const route=q=>routeTaskV4(q,{...base,recoveryContext:{confidence:'low',capabilityNeed:'source verification'}});
const named=(r,n)=>r.capabilityCandidates.find(x=>x.name===n);

test('current task restrictions reach assessment, tools and recovery',()=>{
 const r=route('请仅阅读这个文件，保持文件原样；只根据给定正文总结，不要检索其他资料。正文：太阳从东方升起。');
 assert.equal(r.task.readOnly,true);
 assert.equal(r.taskConstraints.readOnly,true);
 assert.equal(r.taskConstraints.sourceScope,'provided-only');
 assert.equal(r.recoveryPlan.searchQueries.length,0);
 assert.equal(r.recoveryPlan.installPolicy.allowed,false);
});
test('quoted or fenced sample restrictions do not constrain the real request',()=>{
 for(const q of ['请联网核验该说法；引用材料：『禁止联网』。','请联网核验：\n```text\n禁止联网，只读\n```','请检查并修改文件，示例：“只读，禁止联网”。']) {
  const r=route(q);assert.equal(r.taskConstraints.networkForbidden,false,q);assert.equal(r.task.readOnly,false,q);
 }
});
test('explicit source preservation does not prohibit authorized separate output',()=>{
 const r=route('读取输入文件，保持原文件不变，并把分析报告另存为新文件。');
 assert.equal(r.task.readOnly,false);
});
test('English no-network directive applies in recovery',()=>{
 const q='Summarize the supplied text. Do not use the internet.';
 const r=planRecovery({...taskAssessment(q),rawText:q},{recoveryContext:{confidence:'low',capabilityNeed:'research'}});
 assert.equal(r.networkForbidden,true);assert.equal(r.searchQueries.length,0);
});
test('provided-only is distinct from a ban on accessing a supplied URL',()=>{
 const r=route('只使用我给的链接读取资料并总结，禁止检索其他来源：https://example.com/a');
 assert.equal(r.taskConstraints.sourceScope,'provided-only');
 assert.equal(r.taskConstraints.networkForbidden,false);
 assert.equal(r.recoveryPlan.searchQueries.length,0);
});
test('negation boundaries retain unrelated active instructions',()=>{
 assert.match(taskAssessment('分别用一句话概括甲和乙。').activeText,/分别用/);
 assert.match(taskAssessment('Do not use the internet. Summarize the supplied text.').activeText,/Summarize/);
});
test('multiline quoted material is not authority and has verifiable raw spans',()=>{
 const q='请联网读取指定链接并总结。\n\n引用材料：\n禁止联网。\n只读，不要修改。\n\n请使用给定链接。';
 const r=route(q);assert.equal(r.taskConstraints.networkForbidden,false);assert.equal(r.task.readOnly,false);
 assert.equal(r.requestContext.rawQuery,q);assert.equal(r.requestContext.offsetUnit,'utf16');
 const span=r.requestContext.sourceSegments.find(s=>q.slice(s.start,s.end).includes('禁止联网'));
 assert(span);assert.equal(span.role,'provided-material');assert(!r.task.activeText.includes('禁止联网'));
});
test('source-only restriction is visible to text-only hosts',()=>{
 const r=route('只根据给定正文总结，不要检索其他资料。正文：甲。');
 assert.match(formatAgentContextV4(r),/sourceScope=provided-only/);
});
test('negated read-only mode does not override an authorized edit',()=>{
 assert.equal(route('不必只读，请修改这个文件。').taskConstraints.readOnly,false);
});
test('image creation or editing suggests a real runtime image tool',()=>{
 for(const q of ['请绘制一张城市夜景插画','请修改这张照片的背景']) {
  const card=named(route(q),'image_gen__imagegen');
  assert(card,`missing image generation/editing tool for ${q}`);
  assert(['use-now','check-scope'].includes(card.decision),`${q}: ${card.decision}`);
 }
});
test('image reading does not recommend image generation',()=>{
 const r=route('请查看这张本地图片并解释其中内容');
 assert(named(r,'view_image'));
 assert.equal(named(r,'image_gen__imagegen'),undefined);
});
test('explaining generation and finding visual references do not imply generating one',()=>{
 for(const q of ['Explain image generation from descriptions in one sentence.','制作 PPT 并搜索图片素材。'])
  assert.equal(named(route(q),'image_gen__imagegen'),undefined,q);
 assert(named(route('制作 PPT 并搜索图片素材。'),'web__run'));
});
test('independent task needs are not crowded out by similar tools',()=>{
 const extra=[...capabilities,{...capabilities[0],id:'tool:second-image-maker',name:'second-image-maker'}];
 const r=routeTaskV4('生成一张插画并联网检索图片素材。',{...base,capabilityIndex:{...base.capabilityIndex,capabilities:extra},capabilityLimit:2});
 assert.equal(r.capabilityCandidates.length,2);
 assert(r.capabilityCandidates.some(c=>c.intentMatches?.includes('image-create')));
 assert(r.capabilityCandidates.some(c=>c.intentMatches?.includes('image-search')));
});
test('an image used in a website, design or document preserves the non-image task',()=>{
 const targets=[
  {name:'update_website',description:'Update an existing website to insert images and repair image uploads.'},
  {name:'mcp__figma__update_design',plugin:'figma',server:'figma',description:'Update a Figma design file to place an image on its canvas.'},
  {name:'update_document',description:'Update an existing document to insert images and text.'},
  {name:'update_code',description:'Update source code to insert images into the application.'},
 ].map(t=>({id:`tool:${t.name}`,kind:'tool',...t,enabled:true,callable:true,evidence:'runtime-tool',annotations:{}}));
 const figma={id:'plugin:figma',kind:'plugin',name:'Figma',plugin:'figma',enabled:true,callable:false,description:'Figma design file tools',tools:[]};
 const opts={...base,capabilityIndex:{...base.capabilityIndex,capabilities:[...capabilities,...targets,figma]}};
 const checks=[
  ['在现有网页中添加一张图片','update_website'],
  ['修复包含图片上传的网页','update_website'],
  ['在 Figma 设计稿里插入一张图片','mcp__figma__update_design'],
  ['在报告文档中插入图片','update_document'],
  ['在现有代码中插入图片','update_code'],
 ];
 for(const [q,name] of checks){const r=routeTaskV4(q,opts);assert(named(r,name),`${q}: ${name}`);assert(!named(r,'image_gen__imagegen'),q);}
 const mixed=routeTaskV4('在 Figma 设计稿里插入图片并修复网页图片上传。',{...opts,capabilityLimit:2});
 assert(named(mixed,'mcp__figma__update_design'));assert(named(mixed,'update_website'));
});
test('a picture and an independently edited website both retain coverage',()=>{
 const tool={id:'tool:update_website',kind:'tool',name:'update_website',description:'Update an existing website to insert images.',enabled:true,callable:true,evidence:'runtime-tool',annotations:{}};
 const r=routeTaskV4('生成一张图片并在现有网页中插入图片。',{...base,capabilityIndex:{...base.capabilityIndex,capabilities:[...capabilities,tool]},capabilityLimit:2});
 assert(named(r,'image_gen__imagegen'));assert(named(r,'update_website'));
 assert(r.capabilityCandidates.every(c=>!c.invocation.automaticallyExecuted));
 const code={id:'tool:update_code',kind:'tool',name:'update_code',description:'Update project source code to include images.',enabled:true,callable:true,evidence:'runtime-tool',annotations:{}};
 const extraMaker={...capabilities[0],id:'tool:second-maker',name:'second-maker'};
 const mixed=routeTaskV4('生成一张图片并修改项目代码。',{...base,capabilityIndex:{...base.capabilityIndex,capabilities:[...capabilities,extraMaker,code]},capabilityLimit:2});
 assert(named(mixed,'image_gen__imagegen')||named(mixed,'second-maker'));assert(named(mixed,'update_code'));
});
test('unrelated non-image work remains available in a mixed task',()=>{
 const extra=[
  {name:'get_database_logs',description:'Read project database logs to diagnose errors.',annotations:{readOnlyHint:true}},
  {name:'update_website',description:'Update an existing website to insert images.',annotations:{}},
 ].map(t=>({id:`tool:${t.name}`,kind:'tool',...t,enabled:true,callable:true,evidence:'runtime-tool'}));
 const r=routeTaskV4('读取项目数据库日志并在网页插入图片。',{...base,capabilityIndex:{...base.capabilityIndex,capabilities:[...capabilities,...extra]},capabilityLimit:2});
 assert(named(r,'get_database_logs'));assert(named(r,'update_website'));
});
test('online research can find the current host web tool without implying execution',()=>{
 const card=named(route('请联网检索最新官方文档并核实信息'),'web__run');
 assert(card);assert(['use-now','check-scope'].includes(card.decision));assert.equal(card.invocation.automaticallyExecuted,false);
});

test('image editing follows the requested operation rather than unrelated page editing',()=>{
 const decoys=[
  {name:'page_reference',description:'Upload a file to a Page. Use image generation as one possible source. Returns a PNG reference. Does not edit the Page.'},
  {name:'page_visualization',description:'Upload HTML and insert an image-style embed. Inspect the edit receipt.'},
  {name:'image_to_design',description:'Transform an image into an editable design with separate layers.'},
  {name:'picture_maker',description:'Generate a standalone image from a text prompt.'},
  {name:'alternate_retouch',description:'Modify an existing photograph to remove its background.'},
 ].map(t=>({id:`tool:${t.name}`,kind:'tool',...t,enabled:true,callable:true,evidence:'runtime-tool',annotations:{}}));
 const q='Edit the supplied photo: remove the background and preserve the subject outline and visual details. Return a PNG image.';
 const r=routeTaskV4(q,{...base,capabilityIndex:{...base.capabilityIndex,capabilities:[...capabilities,...decoys]}});
 assert(named(r,'image_gen__imagegen'));
 assert(named(r,'alternate_retouch'));
 for(const n of ['page_reference','page_visualization','image_to_design','picture_maker'])assert.equal(named(r,n),undefined,n);
 for(const c of r.capabilityCandidates)assert.equal(c.invocation.automaticallyExecuted,false);
 assert(named(r,'image_gen__imagegen').gates.includes('verify-required-image-input'));
});
test('explanations and examples are distinct from an actual image request',()=>{
 for(const q of ['Explain image generation from descriptions in one sentence.','Give examples of editing images.','Show me examples of editing images.','如何生成图片？请举例说明。','给我一个编辑图片的例子。']){
  const r=route(q);assert.equal(named(r,'image_gen__imagegen'),undefined,q);assert.equal(named(r,'view_image'),undefined,q);
 }
 assert(named(route('请查看这张本地图片并解释其中内容'),'view_image'));
});
test('viewers requiring a local file do not claim to consume an attachment directly',()=>{
 const attached=route('Inspect the attached image and describe its content.');
 assert.equal(named(attached,'view_image'),undefined);
 const local=named(route('Inspect the local image file C:/Scratch/paper-crane.png.'),'view_image');
 assert(local);assert(local.gates.includes('verify-local-image-path'));
});
test('local screenshots and image paths count as images without guessing input resources',()=>{
 for(const q of [String.raw`请查看本地截图 C:\samples\lantern.png 并说明画面内容。`,String.raw`先描述本机 C:\samples\robot-map.png 中画面的组成。`]){
  const card=named(route(q),'view_image');assert(card,q);assert(card.intentMatches.includes('image-read'));assert(card.gates.includes('verify-local-image-path'));
 }
});
test('a newly shared image can be edited while its attachment input is still checked',()=>{
 const card=named(route('把我刚发的那张图改成水彩风格。'),'image_gen__imagegen');
 assert(card);assert(card.intentMatches.includes('image-edit'));assert(card.gates.includes('verify-required-image-input'));
 assert(card.inputEvidence.sources.includes('conversation-image'));
});
test('official-site and specified-domain verification use source evidence without inventing a URL',()=>{
 for(const q of ['请查气象资料馆官网最近发布的信息。','Check the current entry on standards.example.org.']){
  const card=named(route(q),'web__run');assert(card,q);assert(card.intentMatches.includes('web-search'));assert.equal(card.invocation.automaticallyExecuted,false);
  if(q.includes('standards.example.org')){assert(card.inputEvidence.providedDomains.includes('standards.example.org'));assert.deepEqual(card.inputEvidence.providedUrls,[]);}
 }
 const url='https://example.org/guide?section=methods';
 const card=named(route(`请读取 ${url} 并总结。`),'web__run');
 assert(card);assert(card.inputEvidence.providedUrls.includes(url));assert.equal(card.invocation.automaticallyExecuted,false);
 const restricted=named(route('请读取 https://allowed.test/a?x=1，不要访问 https://blocked.test/b?x=2。'),'web__run');
 assert(restricted);assert.deepEqual(restricted.inputEvidence.providedUrls,['https://allowed.test/a?x=1']);
 const quoted=named(route('请联网检索官方信息。示例：https://example.test/not-an-input'), 'web__run');
 assert(quoted);assert.deepEqual(quoted.inputEvidence.providedUrls,[]);
});
test('URL evidence preserves apostrophes and query-string content exactly',()=>{
 const url="https://docs.example.org/find?filter='water'&lang=zh";
 const result=route(`请读取 ${url} 并总结。`),card=named(result,'web__run');
 assert(card);assert.deepEqual(card.inputEvidence.providedUrls,[url]);
 assert.equal(card.invocation.automaticallyExecuted,false);
});
test('background removal is editing; a request to describe an attachment needs an attachment-capable viewer',()=>{
 for(const q of ['Remove the background from the supplied photo.','请去除照片背景。'])assert(named(route(q),'image_gen__imagegen'),q);
 const viewer={id:'tool:attachment-viewer',kind:'tool',name:'attachment-viewer',description:'View attached images for visual inspection.',enabled:true,callable:true,evidence:'runtime-tool',annotations:{readOnlyHint:true}};
 const r=routeTaskV4('Describe the attached image.',{...base,capabilityIndex:{...base.capabilityIndex,capabilities:[...capabilities,viewer]}});
 assert(named(r,'attachment-viewer'));assert.equal(named(r,'view_image'),undefined);
});
test('operation and image object relations work beyond one tool name and language',()=>{
 const more=[
  {name:'cutout',description:'Remove backgrounds from photos while preserving the subject.'},
  {name:'editor_zh',description:'修改现有的图片，并支持调整背景。'},
 ].map(t=>({id:`tool:${t.name}`,kind:'tool',...t,enabled:true,callable:true,evidence:'runtime-tool',annotations:{}}));
 const r=routeTaskV4('Edit the provided photo.',{...base,capabilityIndex:{...base.capabilityIndex,capabilities:[...capabilities,...more]}});
 for(const t of more)assert(named(r,t.name),t.name);
});
test('registered handles, declared availability and names-only metadata stay distinct',()=>{
 for(const [available,expected] of [[true,true],[undefined,true],[false,false]]){
  const t={name:'maker',description:'Generate an image from a description.',...(available===undefined?{}:{available})};
  const inventory=discoverCapabilities({host:'generic',runtimeTools:[t]});
  const item=inventory.capabilities.find(x=>x.name==='maker');assert.equal(item.callable,expected);
  assert.equal(item.declaredAvailable,available===undefined?null:available);
  const c=adviseCapabilities(taskAssessment('Generate an image of a paper boat.'),{capabilityIndex:inventory,runtimeTools:[t]}).candidates.find(x=>x.name==='maker');
  if(available===false)assert.equal(c,undefined);
  else {assert(c);assert.equal(c.availability.callable,expected);assert.equal(c.availability.declaredAvailable,available===undefined?null:available);assert.equal(c.availability.authentication,'unknown');assert.equal(c.availability.businessOutcome,'unknown');}
 }
 const namesOnly=discoverCapabilities({host:'generic',runtimeCapabilities:{tools:['maker']}});
 assert.equal(namesOnly.capabilities.find(x=>x.name==='maker').callable,null);
 const c=adviseCapabilities(taskAssessment('Use maker to generate an image.'),{capabilityIndex:namesOnly}).candidates.find(x=>x.name==='maker');
 assert(c);assert.equal(c.decision,'discover-first');assert.equal(c.availability.callable,null);
 const stale={...capabilities[0]};
 const unavailable=adviseCapabilities(taskAssessment('Generate an image.'),{capabilityIndex:{...base.capabilityIndex,capabilities:[stale]},runtimeTools:[{name:stale.name,available:false}]});
 assert(!unavailable.candidates.some(x=>x.name===stale.name));
});
test('read-only, source and network restrictions remain visible on image and web advice',()=>{
 const ro=routeTaskV4('Generate an image of a paper boat.',{...base,invocationContext:{readOnly:true}});
 assert.equal(named(ro,'image_gen__imagegen').decision,'skip');
 const noNet=routeTaskV4('Search online for image references.',{...base,invocationContext:{networkForbidden:true}});
 assert.equal(named(noNet,'web__run').decision,'defer');
 const only=route('只根据给定正文总结，不要检索其他资料。正文：太阳从东方升起。');
 assert.equal(named(only,'web__run'),undefined);
});
test('read-only uncertain effects can be checked now without asserting read access',()=>{
 const tool={name:'lookup_report',description:'Read local project report.',available:true};
 const inventory=discoverCapabilities({host:'generic',runtimeTools:[tool]});
 const card=adviseCapabilities(taskAssessment('只读检查 local project report'),{capabilityIndex:inventory,runtimeTools:[tool]}).candidates.find(x=>x.name===tool.name);
 assert(card);assert.equal(card.effect,'unknown');assert.equal(card.decision,'defer');
 assert.match(card.when,/当前可核对.*只读效果/);assert(card.gates.includes('read-effects-unverified'));
});
test('a full supplied passage with a source attribution does not request opening the link',()=>{
 const r=route('只根据给定正文总结。正文：太阳从东方升起。来源：https://example.com/article');
 assert.equal(named(r,'web__run'),undefined);
});
