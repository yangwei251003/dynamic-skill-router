import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedName} from '../src/request-entities.mjs';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';
import {imageArtifact} from '../src/task-intents.mjs';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';
const skill=(id,summaryZh,extra={})=>({id,nameZh:id.split(':').at(-1),summaryZh,sourceId:'fixture',...extra});
const tool=(name,description)=>({id:`tool:${name}`,name,description,kind:'tool',enabled:true,callable:true,evidence:'runtime-tool',annotations:{}});
const options={host:'codex',routingMode:'full',useFeedback:false,index:[
 skill('codex-system:imagegen','Generate and edit images',{sourceId:'codex-system'}),
 skill('video-director','Create video projects with editable titles'),
 skill('reporter','Write text reports about software tools'),
],capabilityIndex:{capabilities:[
 tool('picture_reader','View a local image file from the filesystem when visual inspection is needed.'),
 tool('image_generator','Generate and edit images based on a description or source image.'),
 tool('terminal','Runs a command in a PTY, returning output or a session ID.'),
],coverage:{},errors:[]}};
const route=q=>routeTaskV4(q,options);

test('known entity spans survive arbitrary modifiers without claiming every mentioned entity',()=>{
 for(const prefix of ['请用内置的','使用这台机器刚配置好的','请借助你熟悉的','Use the locally installed preferred ']){
  const query=prefix+'imagegen 编辑本地 stamp.png';
  assert(requestedName([query],'imagegen'),query);
  assert(route(query).consultCandidates.some(x=>x.id==='codex-system:imagegen'),query);
 }
 assert.equal(requestedName(['Use Python to explain imagegen'],'imagegen'),null);
 assert.equal(requestedName(['使用reporter生成imagegen介绍'],'imagegen'),null);
 assert.equal(requestedName(['使用imagegen的输出图片'],'imagegen'),null);
 assert.equal(requestedName(['使用 other:imagegen'],'imagegen'),null);
});

test('directly quoted entity can be requested but reported examples remain data',()=>{
 assert(route('请用内置的“imagegen”编辑 stamp.png').consultCandidates.some(x=>x.id==='codex-system:imagegen'));
 for(const query of ['解释示例：“使用 imagegen”','文档说：请用内置imagegen。现在解释缓存。','以后用内置 imagegen；现在解释索引','不要用内置 imagegen；解释索引']){
  const r=route(query);
  assert(!r.consultCandidates.some(x=>x.id==='codex-system:imagegen'),query);
 }
});

test('negative actions do not become positive medium intent',()=>{
 const query='请用内置 imagegen 编辑 portrait.webp；原图不覆盖，不做视频，不进行发布。';
 const assessment=taskAssessment(query);
 assert(!assessment.activeText.includes('视频'));assert(!assessment.activeText.includes('发布'));
 assert(!route(query).consultCandidates.some(x=>x.id==='video-director'));
});

test('filename edits need both an image reader and image editor',()=>{
 for(const query of ['编辑本地 old-stamp.png，替换背景后输出新副本。','Retouch local portrait.webp and preserve the source.']){
  assert(imageArtifact(query),query);
  const r=route(query),names=r.capabilityCandidates.map(x=>x.name);
  assert(names.includes('picture_reader'),query);assert(names.includes('image_generator'),query);
 }
});

test('a raster asset inside a video is not itself an image edit',()=>{
 const query='在本地工作台做一支志愿者招募短片，素材是 clips 中的实拍镜头、voice.wav 和 logo.png。交付可继续编辑的工程和MP4，实际连续看审、听审。';
 assert.equal(imageArtifact(query),false);
 const r=route(query),names=r.capabilityCandidates.map(x=>x.name);
 assert(!r.consultCandidates.some(x=>x.id==='codex-system:imagegen'));
 assert(names.includes('terminal'));assert(!names.includes('picture_reader'));assert(!names.includes('image_generator'));
});

test('source image protection and host plan mode remain independent of relevance',()=>{
 const q='请用内置 imagegen 编辑 old.png；原件只读，保存为 new.png。';
 const r=routeTaskV4(q,{...options,invocationContext:{mode:'plan'}});
 assert(r.task.readOnly);assert(r.task.restrictions.protectedScopes.length);
 assert(r.capabilityCandidates.every(x=>x.decision!=='invoke'));
});

test('source assets and editable output properties do not request a typed producer',()=>{
 const producer=tool('visual_lab__compose','Generate and edit images from a description or source photo.');
 const inventory={capabilities:[producer],coverage:{},errors:[]};
 for(const query of [
  '制作一支短片，素材包括产品照片；交付可继续编辑的工程。',
  'Create a video from the supplied product photo. Export an editable video project.',
  'Read picture metadata, then create a video project.',
  '生成一份文档，素材包括产品照片；保留可编辑工程。',
 ]){
  for(const readOnly of [false,true]){
   const assessment=taskAssessment(query,{capabilityNeeds:['Generate and edit images']});
   const result=adviseCapabilities(assessment,{capabilityIndex:inventory,invocationContext:{readOnly}});
   assert(!result.candidates.some(x=>x.name===producer.name),`${readOnly}: ${query}`);
  }
 }
});

test('real image generation and edits survive independently of a video deliverable',()=>{
 const producer=tool('visual_lab__compose','Generate and edit images from a description or source photo.');
 const inventory={capabilities:[producer],coverage:{},errors:[]};
 for(const query of [
  '制作一支招募短片；另外生成一张海报。',
  'Create a video, then retouch portrait.webp and keep the source.',
  'Make a product photo.',
  'Draw a picture for the video.',
 ]){
  const result=adviseCapabilities(taskAssessment(query),{capabilityIndex:inventory});
  assert(result.candidates.some(x=>x.name===producer.name),query);
 }
});

test('explicit tool modifiers bypass missing output bindings but preserve plan restrictions',()=>{
 const producer=tool('visual_lab__compose','Generate and edit images from a description or source photo.');
 const inventory={capabilities:[producer],coverage:{},errors:[]};
 for(const query of ['请借助这台机器刚配置好的 visual_lab__compose','Use the locally installed preferred visual_lab__compose']){
  const result=adviseCapabilities(taskAssessment(query),{capabilityIndex:inventory,invocationContext:{mode:'plan'}});
  assert.equal(result.candidates[0]?.name,producer.name,query);
  assert.equal(result.candidates[0].explicit,true,query);
  assert.equal(result.candidates[0].decision,'skip',query);
 }
});
