import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4} from '../src/advisor-v4.mjs';

// Fictional tasks and synthetic capability metadata; no external service is called.
const tools=[
  {name:'web__run',description:'Search the internet and open requested web pages.',available:true,annotations:{readOnlyHint:true}},
  {name:'image_gen__imagegen',description:'Generate an image from a text description and edit existing images.',available:true},
  {name:'image_reader__inspect',description:'Inspect uploaded images.',available:true,annotations:{readOnlyHint:true}},
];
const capabilities=tools.map(t=>({id:'tool:'+t.name,kind:'tool',...t,enabled:true,callable:true,evidence:'runtime-tool'}));
const options={host:'codex',routingMode:'full',index:[],capabilityIndex:{revision:'synthetic',capabilities,coverage:{},errors:[]},runtimeTools:tools,useFeedback:false,capabilityLimit:10};
const run=q=>routeTaskV4(q,options);
const intent=(r,name,kind)=>r.capabilityCandidates.some(c=>c.name===name&&c.intentMatches.includes(kind)&&!['skip','defer'].includes(c.decision));

test('a current quote request suggests search even without the word online',()=>{
  const r=run('请查询示例公司的最新股价。');
  assert(intent(r,'web__run','web-search'));
  assert(r.capabilityCandidates.every(c=>c.invocation.automaticallyExecuted===false));
});

test('historical explanation and offline supplied-only quote do not imply web search',()=>{
  for(const q of ['请解释历史股价波动的原因。','请仅根据给定资料查询最新股价，不要联网。'])
    assert(!intent(run(q),'web__run','web-search'));
});

test('a request to blur an uploaded photo background suggests image editing',()=>{
  assert(intent(run('请把上传的照片背景虚化。'),'image_gen__imagegen','image-edit'));
});

test('inspecting an existing background effect is reading rather than editing',()=>{
  const r=run('请查看上传照片背景的虚化效果。');
  assert(intent(r,'image_reader__inspect','image-read'));
  assert(!intent(r,'image_gen__imagegen','image-edit'));
});

test('a prohibited blur does not become an image editing suggestion',()=>{
  assert(!intent(run('不要虚化照片背景。'),'image_gen__imagegen','image-edit'));
});
