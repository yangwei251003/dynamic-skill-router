import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath,planRecovery} from '../src/recovery-v4.mjs';

const decision=(query,options={})=>{
 const a=taskAssessment(query,options.taskContext);
 return useFastPath(a,options,planRecovery(a,options));
};
const nativeQueries=[
 '请计算 24 * 17，用一句话解释结果。',
 'Calculate (12 + 8) / 4 and briefly explain the steps.',
 '将这些数字按升序排列：8, -2, 11, 3。只给排列后的数字。',
 'Sort these numbers in descending order: 3.5, -4, 10, 0.',
 '请把这句话改写得更简洁：“因为有下雨的可能性，所以我们决定将活动推迟到明天。”',
 'Rewrite this sentence more concisely: "At this point in time we are unable to proceed."',
];

test('auto recognizes bounded operations on supplied text without a sufficiency hint',()=>{
 for(const query of nativeQueries){
  assert.equal(decision(query),true,query);
  const options={get index(){throw Error('lazy catalogue must not be read');},get capabilityIndex(){throw Error('capabilities must not be scanned');}};
  const result=routeTaskV4(query,options);
  assert.equal(result.performance.mode,'fast',query);
  assert.equal(result.consultCandidates.length,0);
  assert.equal(result.performance.scannedSkills,false);
 }
});

test('external inputs, high stakes and unrelated actions cannot borrow the closed operation shortcut',()=>{
 for(const query of [
  '计算 report.csv 中这些数字的总和，然后写回文件。',
  'Sort the numbers from the attached spreadsheet.',
  '改写浏览器当前页面这段文字并保存。',
  '计算今天美元汇率乘以 100 的结果。',
  'Calculate the medication dosage as 5 * 7 and explain.',
  '计算 3 * 8，然后建立一个网页展示结果。',
  '把这些数字排序：8, 2, 5。同时制作一段视频。',
  '请先计算 5 * 3，再发送给客户。',
  '计算 2 * 9，再研究哪种课程安排最好。',
  '计算 6 + 7，查找一手资料核实其中的历史背景。',
  'Sort 8, 4, 2 then fetch the latest weather.',
 ])assert.equal(decision(query),false,query);
 for(const options of [{recoveryContext:{confidence:'low'}},{recoveryContext:{failedAttempts:2}},{taskContext:{complexity:'high'}},{routingMode:'full'}])
  assert.equal(decision(nativeQueries[0],options),false,JSON.stringify(options));
});

test('sufficiency hints do not erase explicitly requested entities or external actions',()=>{
 const options={nativeSufficient:true,routingMode:'fast',runtimeSkills:[{id:'paint-helper'},{id:'imagegen'},{id:'sentence-polish',name:'句子润色助手'}]};
 for(const query of ['请使用内置的 imagegen 画一朵花。','Use the recently installed paint-helper to repaint this image.','请借助你已配置好的句子润色助手改写这句话：“大家好”。','使用工具 Polaris 计算 5 + 3。','从 budget.csv 计算 5 + 3 并写回文件。'])
  assert.equal(decision(query,options),false,query);
 assert.equal(decision('Use three short bullets to summarize this sentence',options),true);
 assert.equal(decision('Use Python to calculate 5 * 3',options),true);
});

test('fresh-process synchronous and promise readdir instrumentation observes zero discovery in auto mode',()=>{
 const url=pathToFileURL(resolve('src/advisor-v4.mjs')).href;
 const bootIds=new Set();
 for(const query of nativeQueries){
  for(let repeat=0;repeat<3;repeat++){
  const code=`import {randomUUID} from 'node:crypto';const bootId=randomUUID();import fs from 'node:fs'; import fsp from 'node:fs/promises';
    let calls=0;
    for(const obj of [fs,fsp])for(const key of ['readdir','readdirSync'])if(typeof obj[key]==='function'){
      const original=obj[key];obj[key]=function(...args){calls++;return original.apply(this,args)};
    }
    fs.readdirSync('.'); if(calls!==1)throw Error('counter inactive');calls=0;
    const {routeTaskV4}=await import(${JSON.stringify(url)});
    const r=routeTaskV4(${JSON.stringify(query)},{contractVersion:4});
    console.log(JSON.stringify({pid:process.pid,bootId,mode:r.performance.mode,calls,nativeHintPassed:false,cards:r.consultCandidates.length}));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const evidence=JSON.parse(result.stdout.trim());
  assert.equal(evidence.mode,'fast',query);assert.equal(evidence.calls,0,query);assert.equal(evidence.cards,0);
  assert.equal(evidence.pid,result.pid);assert.notEqual(evidence.pid,process.pid);bootIds.add(evidence.bootId);
  console.log(JSON.stringify({scope:'fresh process; patched fs readdir APIs, not all OS I/O',repeat,...evidence}));
  }
 }
 assert.equal(bootIds.size,nativeQueries.length*3);
});
