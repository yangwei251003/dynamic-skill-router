import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4} from '../src/advisor-v4.mjs';
import {imageToolPurposes} from '../src/request-evidence.mjs';

// Synthetic metadata and examples; recommendations do not execute these tools.
const tools = [
  {name:'fiction__mixed', description:'Generate images from text or edit existing images.', available:true},
  {name:'fiction__create', description:'Generate new images from text. This tool cannot edit existing images.', available:true},
  {name:'fiction__edit', description:'Edit existing images. This tool does not generate new images.', available:true},
  {name:'fiction__search', description:'Search the internet for websites.', available:true},
  {name:'fiction__open', description:'Open and read a webpage at a supplied URL. This tool does not search the web.', available:true},
  {name:'fiction__both', description:'Search the internet and open web pages.', available:true},
];
const capabilityIndex = {revision:'public-synthetic',coverage:{},errors:[],capabilities:tools.map(t=>({id:`tool:${t.name}`,kind:'tool',name:t.name,description:t.description,enabled:true,callable:true,annotations:{}}))};
const opts = {host:'codex',contractVersion:4,index:[],runtimeTools:tools,capabilityIndex,useFeedback:false,dryRun:true};
const run = q => routeTaskV4(q,opts);
const get = (r,n) => r.capabilityCandidates.find(c=>c.name===n);
const actionable = c => c && ['use-now','check-scope'].includes(c.decision);
const edits = c => actionable(c) && c.intentMatches?.includes('image-edit');

test('editing an uploaded photo allows mixed editing without creating a new image',()=>{
  const r=run('不要新建全新图像；请编辑上传照片，调整颜色。');
  assert(edits(get(r,'fiction__mixed')));
  assert(edits(get(r,'fiction__edit')));
  assert(!actionable(get(r,'fiction__create')));
  assert(!get(r,'fiction__mixed').intentMatches.includes('image-create'));
});

test('a prohibited image-generation tool class excludes a mixed-purpose tool',()=>{
  const r=run('不要使用图片生成工具；请编辑上传的照片。');
  assert(!actionable(get(r,'fiction__mixed')));
  assert(!actionable(get(r,'fiction__create')));
  assert(edits(get(r,'fiction__edit')));
});

test('negated stated tool uses do not become capabilities and contrast is preserved',()=>{
  assert.deepEqual(imageToolPurposes('Generate images from text, but cannot edit existing images.'),{create:true,edit:false});
  assert.deepEqual(imageToolPurposes('This tool does not generate images, but edits existing images.'),{create:false,edit:true});
  assert.deepEqual(imageToolPurposes('Generate images from text or edit existing images.'),{create:true,edit:true});
});

test('an inquiry about the need to edit does not authorize an edit',()=>{
  const r=run('请评估是否需要编辑这张图片并给出理由。');
  assert(!actionable(get(r,'fiction__mixed')));
  assert(!actionable(get(r,'fiction__edit')));
  assert((r.capabilityCandidates||[]).every(c=>c.invocation?.automaticallyExecuted!==true));
});

test('a separately requested edit remains after an assessment question',()=>{
  const r=run('先判断是否需要编辑这张照片，然后编辑上传的照片。');
  assert(edits(get(r,'fiction__edit')));
});

test('a web-search tool ban preserves access to a supplied page',()=>{
  const r=run('直接打开 https://example.org/reference 这个网页并概述。不要调用网络搜索工具。');
  assert.equal(r.taskConstraints.networkForbidden,false);
  assert(!actionable(get(r,'fiction__search')));
  assert(!actionable(get(r,'fiction__both')));
  assert(actionable(get(r,'fiction__open')));
  assert(get(r,'fiction__open').intentMatches.includes('web-open'));
});

test('an actual offline instruction still prohibits network use',()=>{
  const r=run('不要联网；只根据给定材料解释价格波动。');
  assert.equal(r.taskConstraints.networkForbidden,true);
});

test('quoted prohibitions are not the current instruction',()=>{
  const r=run('示例中写着“不要使用网络搜索工具”。请联网搜索官方发布的近期天气资讯。');
  assert(actionable(get(r,'fiction__search')));
  assert(get(r,'fiction__search').intentMatches.includes('web-search'));
});
