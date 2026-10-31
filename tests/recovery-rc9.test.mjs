import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath,planRecovery} from '../src/recovery-v4.mjs';
import {closedSuppliedTransformation} from '../src/native-closure.mjs';

// The first three are consumed RC8 development regressions, not a new holdout.
const supplied = [
 '给定“票号：K-73；状态：已取”，只输出票号，不查询任何系统。',
 '给定三个数9、4、6，求中位数，只输出这个数。',
 '把“蓝、红、蓝、绿、红”去重并保留首次出现顺序，只输出顿号分隔的颜色。',
 'Extract parcel from "parcel=M-24; phase=ready", return only the value.',
 '对“工具、插件、工具、搜索”去重，保留原顺序，只输出结果。',
];
const decision = (query,options={}) => {
 const a=taskAssessment(query,options.taskContext);
 return useFastPath(a,options,planRecovery(a,options));
};

test('bounded supplied records and lists form complete native operations without catalogue access',()=>{
 for(const query of supplied){
  assert.ok(closedSuppliedTransformation(query),query);
  const assessment=taskAssessment(query),before=JSON.stringify(assessment);
  assert.equal(useFastPath(assessment,{},planRecovery(assessment,{})),true,query);
  assert.equal(JSON.stringify(assessment),before,'closure must not mutate assessment');
  assert.equal(assessment.originalRequest,query);
  const result=routeTaskV4(query,{
   get index(){throw Error('skill catalogue was accessed');},
   get capabilityIndex(){throw Error('capability catalogue was accessed');},
  });
  assert.equal(result.performance.mode,'fast',query);
  assert.equal(result.consultCandidates.length+result.capabilityCandidates.length,0,query);
 }
});

test('closure needs complete supplied input and rejects external or composite requested work',()=>{
 for(const query of [
  '给定三个数9、4，求中位数，只输出这个数。',
  '给定三个数9、未知、6，求中位数，只输出这个数。',
  '给定三个数9、4、6，求中位数，再把另一个未提供的数加上。',
  '给定“状态：已取”，只输出票号，不查询任何系统。',
  '给定“票号：未知；状态：已取”，只输出票号，不查询任何系统。',
  '把“蓝、红、…”去重并保留首次出现顺序，只输出结果。',
  '给定三个数9、4、6，求中位数，然后查询今天的汇率。',
  '给定三个数9、4、6，求中位数并保存到 report.txt。',
  '给定“票号：K-73；状态：已取”，只输出票号，并核实是否已经领取。',
  '从附件中提取票号，只输出结果。',
  '使用 $data-analysis，给定三个数9、4、6，求中位数。',
  '请调用“data-analysis”，把“蓝、红、蓝”去重。',
  '把“蓝、红、蓝”去重，并解释颜色的心理学意义。',
  '对“工具、插件、工具”去重，然后调用工具搜索新闻。',
  '给定“药物剂量：9mg；状态：已取”，只输出药物剂量。',
 ])assert.equal(decision(query),false,query);
});

test('closure does not override recovery, full routing, complexity or explicit runtime capabilities',()=>{
 for(const options of [
  {routingMode:'full'},{recoveryContext:{confidence:'low'}},
  {recoveryContext:{failedAttempts:2}},{taskContext:{complexity:'high'}},
 ])assert.equal(decision(supplied[1],options),false);
 assert.equal(decision('使用 Calyx，给定三个数9、4、6，求中位数。',{
  runtimeTools:[{name:'Calyx'}],nativeSufficient:true,
 }),false);
});

test('fresh supplied-data routes have zero public Node directory enumeration',()=>{
 const url=pathToFileURL(resolve('src/advisor-v4.mjs')).href,pids=new Set();
 for(const query of supplied){
  const code=`import fs from 'node:fs';import fsp from 'node:fs/promises';const scans={sync:0,callback:0,promise:0};for(const [o,k,n] of [[fs,'readdirSync','sync'],[fs,'readdir','callback'],[fsp,'readdir','promise']]){const f=o[k];o[k]=function(...a){scans[n]++;return f.apply(this,a)}}fs.readdirSync('.');if(scans.sync!==1)throw Error('inactive tracer');scans.sync=0;const {routeTaskV4}=await import(${JSON.stringify(url)});const r=routeTaskV4(${JSON.stringify(query)},{host:'codex',contractVersion:4});console.log(JSON.stringify({pid:process.pid,scans,mode:r.performance.mode,cards:r.consultCandidates.length+r.capabilityCandidates.length,recovery:r.recoveryPlan.triggered}));`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.mode,'fast',query);assert.equal(result.cards,0,query);assert.equal(result.recovery,false,query);
  assert.deepEqual(result.scans,{sync:0,callback:0,promise:0},query);pids.add(result.pid);
  console.log(JSON.stringify({query,...result,scope:'public Node readdir APIs from before import; not all OS I/O'}));
 }
 assert.equal(pids.size,supplied.length);
});
