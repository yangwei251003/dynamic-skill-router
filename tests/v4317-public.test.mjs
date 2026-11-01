import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4,searchSkills} from '../src/advisor-v4.mjs';
import {invocationConstraints} from '../src/invocation-constraints.mjs';

const base={sourceId:'fixture',availability:{discovered:true,readable:true,enabled:true,compatible:true},triggers:[],aliases:[]};
const index=[
  {...base,id:'json-canvas',nameZh:'json-canvas',summaryZh:'Create or edit JSON Canvas files with nodes, edges and connections.'},
  {...base,id:'video-link-reader',nameZh:'video-link-reader',summaryZh:'Read a local video or video URL with optional speech transcription and sampled frames.'},
];
const tool={name:'fixture__artifact__js',description:'Run JavaScript for a viewer-bound spreadsheet or presentation, or edit an existing bound canvas.',available:true,annotations:{readOnlyHint:false}};
const entry={id:'tool:'+tool.name,kind:'tool',...tool,enabled:true,callable:true,evidence:'runtime-tool'};
const options={host:'generic',contractVersion:4,index,capabilityIndex:{capabilities:[entry],coverage:{},errors:[],revision:'public-fixture'},runtimeTools:[tool],useFeedback:false,dryRun:true,routingMode:'full',limit:12};
const recommended=(r,id)=>r.consultCandidates.some(card=>card.id===id&&card.suggestedMode!=='skip');

test('host source restrictions combine and survive explicit stage reuse',()=>{
  const query='分析给出的资料。';
  const opts={...options,invocationContext:{sourceScopes:['provided-only','specified-site-only']}};
  const initial=routeTaskV4(query,opts),stage=searchSkills(query,{...opts,routeId:initial.routeId});
  for(const result of [initial,stage])assert.deepEqual(result.taskConstraints.sourceScopes,['provided-only','specified-site-only']);
  assert.equal(stage.routeId,initial.routeId);
});

test('empty arrays cannot remove restrictions and malformed scopes are rejected',()=>{
  const existing=invocationConstraints({}, {invocationContext:{sourceScope:'provided-only',sourceScopes:[]}});
  assert.deepEqual(existing.sourceScopes,['provided-only']);
  for(const invalid of [null,'provided-only',['unknown'],['provided-only','specified-site-only','provided-only']])
    assert.throws(()=>invocationConstraints({}, {invocationContext:{sourceScopes:invalid}}));
});

test('an HTML drawing game is distinct from an application-bound canvas',()=>{
  const result=routeTaskV4('请用 JavaScript 和 HTML Canvas 做一个离线弹球程序。',options);
  assert(!result.capabilityCandidates.some(card=>card.name===tool.name&&card.decision!=='skip'));
});

test('an editable .canvas document can consult its format manual',()=>{
  const result=routeTaskV4('请把草稿整理成 topic.canvas 并连接相关概念。',options);
  assert(recommended(result,'json-canvas'));
});

test('video transcription is distinct from audio-only work',()=>{
  assert(recommended(routeTaskV4('请转写本地 clip.mov 中的采访。',options),'video-link-reader'));
  assert(!recommended(routeTaskV4('请转写本地 meeting.wav 中的录音。',options),'video-link-reader'));
});

test('a source comparison must not add search to an allowed direct-open action',()=>{
  const web={name:'web__run',description:'Search the web or open a supplied page.',available:true,annotations:{readOnlyHint:true,openWorldHint:true}};
  const webEntry={id:'tool:'+web.name,kind:'tool',...web,enabled:true,callable:true,evidence:'runtime-tool'};
  const result=routeTaskV4('Compare the methods using official documents. Do not search the web; read https://example.net/brief instead.',
    {...options,index:[],runtimeTools:[web],capabilityIndex:{capabilities:[webEntry],coverage:{},errors:[]}});
  const card=result.capabilityCandidates.find(item=>item.name===web.name);
  assert(card?.intentMatches?.includes('web-open'));
  assert(!card?.intentMatches?.includes('web-search'));
});
