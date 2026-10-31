import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath,planRecovery} from '../src/recovery-v4.mjs';

const native=[
 '把“我们准备在周末之前核对完资料”改得更简洁，只给一句话。',
 '请将“现阶段我们暂时没有办法继续推进”写得更简短。',
 '把「明天下午请大家准时到场」说得自然一些。',
 '将"由于天气存在不确定因素，我们推迟出发"改成更精炼的表达。',
 '把下面这句话改得更清晰：大家在结束之前把自己的东西带回去。',
];
const decision=(query,options={})=>{const a=taskAssessment(query,options.taskContext);return useFastPath(a,options,planRecovery(a,options));};

test('result-complement rewrites of supplied short text take the automatic zero-card path',()=>{
 for(const query of native){
  assert.equal(decision(query),true,query);
  const result=routeTaskV4(query,{get index(){throw Error('skill discovery');},get capabilityIndex(){throw Error('capability discovery');}});
  assert.equal(result.performance.mode,'fast',query);
  assert.equal(result.consultCandidates.length+result.capabilityCandidates.length,0,query);
  assert.equal(result.recoveryPlan.triggered,false,query);
 }
});

test('rewrites still require supplied governed input and cannot hide effects or extra tasks',()=>{
 for(const query of [
  '把这段文字改得更简洁。',
  '我的标签是“摘要”；把未给出的文字改得更简洁。',
  '把这段未提供的文字改得更简洁，我的标签是“摘要”。',
  '把“明天出发”改得更简洁并保存到 note.txt。',
  '把“明天出发”改得更简洁，再发送给客户。',
  '把“明天出发”改得更简洁，然后设计一个网页。',
  '把“明天出发”改得更简洁，再翻译成英文。',
  '把“明天出发”改得更简洁，然后解释量子力学。',
  '把附件的内容改得更简洁，标题是“备忘”。',
  '调用工具 Polaris，把“明天出发”改得更简洁。',
  '把“明天出发”改得更简洁，再搜索最新消息。',
 ])assert.equal(decision(query),false,query);
 for(const options of [{routingMode:'full'},{recoveryContext:{confidence:'low'}},{recoveryContext:{failedAttempts:2}},{taskContext:{complexity:'high'}}])
  assert.equal(decision(native[0],options),false);
});

test('fresh imports and automatic rewrite routing cause no public Node directory enumeration',()=>{
 const url=pathToFileURL(resolve('src/advisor-v4.mjs')).href;
 const bootIds=new Set();
 for(const query of native){
  const code=`import {randomUUID} from 'node:crypto';const bootId=randomUUID();import fs from 'node:fs';import fsp from 'node:fs/promises';const counts={sync:0,callback:0,promise:0};for(const [o,k,n] of [[fs,'readdirSync','sync'],[fs,'readdir','callback'],[fsp,'readdir','promise']]){const f=o[k];o[k]=function(...a){counts[n]++;return f.apply(this,a)}}fs.readdirSync('.');if(counts.sync!==1)throw Error('counter inactive');counts.sync=0;const {routeTaskV4}=await import(${JSON.stringify(url)});const r=routeTaskV4(${JSON.stringify(query)},{host:'codex',contractVersion:4});console.log(JSON.stringify({pid:process.pid,bootId,counts,mode:r.performance.mode,cards:r.consultCandidates.length+r.capabilityCandidates.length,recovery:r.recoveryPlan.triggered}));`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(run.status,0,run.stderr||run.stdout);const r=JSON.parse(run.stdout.trim());
  assert.equal(r.mode,'fast',query);assert.equal(r.cards,0,query);assert.equal(r.recovery,false,query);
  assert.deepEqual(r.counts,{sync:0,callback:0,promise:0},query);assert.equal(r.pid,run.pid);assert.notEqual(r.pid,process.pid);bootIds.add(r.bootId);
  console.log(JSON.stringify({query,...r,scope:'public Node readdir APIs from before import, not all OS I/O'}));
 }
 assert.equal(bootIds.size,native.length);
});
