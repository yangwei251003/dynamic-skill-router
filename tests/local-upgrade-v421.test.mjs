import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {routeTaskV4,formatAgentContextV4} from '../src/advisor-v4.mjs';
import {invocationConstraints,constrainCapability} from '../src/invocation-constraints.mjs';
import {planRecovery} from '../src/recovery-v4.mjs';
import {computeFeedbackCalibrationV4} from '../src/feedback-v4.mjs';
const empty={index:{skills:[],revision:'fixture',coverage:{},errors:[]},capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const baselineSamples=JSON.parse(fs.readFileSync(new URL('./fixtures/v420-default-sample.json',import.meta.url),'utf8')).cases;

test('native fast leaves lazy catalogs and discovery unread',()=>{
  const read=fs.readFileSync;let reads=0;fs.readFileSync=function(p,...a){if(String(p).includes('task-methods.json'))reads++;return read.call(fs,p,...a);};syncBuiltinESMExports();
  try{const r=routeTaskV4('7+9',{nativeSufficient:true,get index(){throw Error('skill scan');},get capabilityIndex(){throw Error('capability scan');}});assert.equal(r.performance.mode,'fast');assert.equal(reads,0);assert.deepEqual(r.methodCandidates,[]);}finally{fs.readFileSync=read;syncBuiltinESMExports();}
});
test('unchanged options retain baseline assessment, ranking, fast and budgets',()=>{
  for(const query of ['你好','计算 7+9','Write a migration and rollback plan for an existing database.','请润色这句：“Use a browser.”']){const a=baselineSamples.find(sample=>sample.query===query).expected,b=routeTaskV4(query,empty);for(const key of ['task','consultCandidates','capabilityCandidates','performance','budget'])assert.deepEqual(b[key],a[key],query+' '+key);}
});
test('raw request and host interpretation stay distinct',()=>{
  const q=' 原文："https://example.org/a"\n只整理给定文本。 ';const r=routeTaskV4(q,{...empty,taskContext:{objective:'publish to production',background:'not authorization'}});assert.equal(r.requestContext.rawQuery,q);assert.equal(r.requestContext.hostInterpretation.objective,'publish to production');assert.notEqual(r.task.objective,'publish to production');
});
test('plan and false cannot relax an existing read-only restriction',()=>{
  for(const c of [{mode:'plan'},{mode:'execute',readOnly:false}])assert.equal(invocationConstraints({readOnly:true},{invocationContext:c}).readOnly,true);
  const card={decision:'check-scope',effect:'unknown',gates:[]};assert.equal(constrainCapability(card,invocationConstraints({}, {invocationContext:{mode:'plan'}})).decision,'defer');
  assert.equal(constrainCapability({...card,effect:'external-write'},invocationConstraints({}, {invocationContext:{allowedActions:['read']}})).decision,'skip');
});
test('restricted recovery cannot propose remote search or installation',()=>{
  const r=planRecovery({activeText:'A build is broken',rawText:'A build is broken'}, {invocationContext:{mode:'plan',networkForbidden:true},recoveryContext:{userRejected:true,capabilityNeed:'compiler failure'},runtimeTools:[{name:'web__run'}]});assert.deepEqual(r.searchQueries,[]);assert.equal(r.searchTools.web,null);assert.equal(r.installPolicy.allowed,false);assert.equal(r.steps.find(s=>s.id==='install').allowed,false);
});
test('method cards are bounded, disableable and not quoted-command execution',()=>{
  const r=routeTaskV4('请使用最小实验，设计一个低成本实验验证关键假设。',empty);assert.ok(r.methodCandidates.some(c=>c.id==='minimal-experiment'));assert.ok(r.methodCandidates.length<=2);
  assert.deepEqual(routeTaskV4('请使用最小实验验证假设。',{...empty,taskMethods:false}).methodCandidates,[]);
  assert.deepEqual(routeTaskV4('翻译这句：“请使用最小实验验证假设。”',empty).methodCandidates,[]);
  assert.ok(!routeTaskV4('设计低成本实验验证关键假设，但不要使用最小实验。',empty).methodCandidates.some(c=>c.id==='minimal-experiment'));
});
test('twenty method catalog entries retain boundaries',()=>{const c=JSON.parse(fs.readFileSync(new URL('../config/task-methods.json',import.meta.url),'utf8'));assert.equal(c.methods.length,20);assert.ok(c.methods.every(m=>m.stop&&m.validation&&m.avoid.length));});
test('explicit quality profiles affect advice budgets only',()=>{
  const rows=['economy','balanced','quality'].map(qualityProfile=>routeTaskV4('Design an architecture and migration for an existing system.',{...empty,qualityProfile}));assert.equal(new Set(rows.map(r=>r.budget.softTokenLimit)).size,3);assert.ok(rows.every(r=>r.budget.requiredValidationPreserved===true));assert.deepEqual(rows[0].task,rows[2].task);
});
test('exact tool consultation needs active evidence and preserves unknown availability',()=>{
  const q='请读取这份本地报告';const ctx={capabilityRequests:[{toolNames:['local_reader','decoy'],evidenceRefs:['读取这份本地报告']}]};const runtimeTools=[{name:'local_reader',description:'Read local reports.'},{name:'decoy',available:false}];
  const r=routeTaskV4(q,{...empty,taskContext:ctx,runtimeTools});assert.equal(r.capabilityConsultations.length,1);assert.equal(r.capabilityConsultations[0].availability.callable,null);assert.equal(r.capabilityConsultations[0].explicit,false);assert.equal(r.capabilityConsultations[0].decision,'defer');
  assert.deepEqual(routeTaskV4(q,{...empty,taskContext:{capabilityRequests:[{toolNames:['local_reader'],evidenceRefs:['publish now']}]},runtimeTools}).capabilityConsultations,[]);
});
test('invalid optional contracts are rejected in direct calls',()=>{assert.throws(()=>routeTaskV4('hi',{invocationContext:{readOnly:'true'}}));assert.throws(()=>routeTaskV4('hi',{taskContext:{objective:123}}));assert.throws(()=>routeTaskV4('hi',{taskContext:{capabilityRequests:[{toolNames:['a'],evidenceRefs:[]}]}}));assert.throws(()=>routeTaskV4('hi',{taskMethods:{maxCards:3}}));});
const now=Date.parse('2026-11-01T00:00:00Z');
const context={host:'codex',taskType:'analysis',modelId:'current-model',mode:'consult',contentHashes:{skill:'current-hash'}};
const observation=(i,patch={})=>({contractVersion:4,host:'codex',taskType:'analysis',routeId:'task-'+i,modelId:'current-model',observedAt:'2026-10-31T00:00:00Z',decisions:[{skillId:'skill',contentHash:'current-hash',mode:'consult',shown:true,read:true,adopted:true,outcome:'helpful',evidence:[{kind:'validation',reference:'real-check',passed:true}]}],...patch});
test('feedback calibration requires fresh independent matching observations',()=>{
  const entries=Array.from({length:20},(_,i)=>observation(i));assert.ok(computeFeedbackCalibrationV4(entries,context,{nowMs:now}).get('skill').adjustment>0);
  for(const patch of [{modelId:'other-model'},{observedAt:'2026-01-01T00:00:00Z'},{observedAt:'2026-11-02T00:00:00Z'},{observedAt:undefined},{revoked:true}])assert.equal(computeFeedbackCalibrationV4(entries.map(e=>({...e,...patch})),context,{nowMs:now}).size,0);
  assert.equal(computeFeedbackCalibrationV4(entries,{...context,modelId:undefined},{nowMs:now}).size,0);
  assert.equal(computeFeedbackCalibrationV4(Array(20).fill(entries[0]),context,{nowMs:now}).get('skill').samples,1);
});
test('explicit revocation removes an otherwise valid observation',()=>{assert.equal(computeFeedbackCalibrationV4([observation(1),observation(1,{revoked:true})],context,{nowMs:now}).size,0);});
test('combined restrictions preserve newly imposed and pre-existing skip',()=>{
  const constraints=invocationConstraints({}, {invocationContext:{readOnly:true,networkForbidden:true,allowedActions:['read']}});
  const result=constrainCapability({decision:'check-scope',effect:'external-write',gates:[]},constraints);
  assert.equal(result.decision,'skip');assert.ok(result.gates.includes('read-only-scope'));assert.ok(result.gates.includes('network-forbidden-or-effects-unverified'));
  assert.equal(constrainCapability({decision:'skip',effect:'unknown',gates:[]},constraints).decision,'skip');
});
test('content-only host formatting exposes new advice and constraints without copying raw query',()=>{
  const query='请使用最小实验验证关键假设，同时读取本地报告。原文私有标记-Z71';
  const result=routeTaskV4(query,{...empty,invocationContext:{mode:'plan',networkForbidden:true},taskContext:{capabilityRequests:[{toolNames:['local_reader'],evidenceRefs:['读取本地报告']}]},runtimeTools:[{name:'local_reader',available:true,annotations:{readOnlyHint:true,openWorldHint:false}}]});
  const formatted=formatAgentContextV4(result);
  assert.match(formatted,/minimal-experiment/);assert.match(formatted,/local_reader/);assert.match(formatted,/readOnly=true/);assert.match(formatted,/networkForbidden=true/);assert.ok(!formatted.includes(query));assert.ok(!formatted.includes('原文私有标记-Z71'));
  assert.ok(!formatAgentContextV4(routeTaskV4('你好',empty)).includes('Optional method advice'));
});
