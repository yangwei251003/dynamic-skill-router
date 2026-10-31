import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath,planRecovery} from '../src/recovery-v4.mjs';
const decision=q=>{const a=taskAssessment(q);return useFastPath(a,{},planRecovery(a,{}));};
const arithmetic=['直接回答：71减去28等于多少？','请计算12加上8等于多少？','回答：9乘以6，给我结果。','算一下81除以9是多少？','What is 19 minus 7?','Calculate (8 plus 2) times 3.','计算 8 × 5 − 6，只输出结果。'];
const substitutions=['把“会议时间是今天下午三点”改成“今天下午三点开会”，只输出改后句子。','将「原文」替换为「新文」，只给结果。','把“甲”换成“乙”。','Replace "wait here" with "please wait here".','Change "old text" to "new text".'];
const modifierTranslations=[
 'Translate this sentence into clear, natural English: "Nous partons demain."',
 'Translate this into clear, concise, natural French: "The train is late."',
 '把这句话译成清晰，自然的英文：“我们明天出发。”',
];
test('closed arithmetic normalizes verbal operators with whole-expression grammar',()=>{for(const q of arithmetic)assert.equal(decision(q),true,q);});
test('explicit supplied source and replacement form a closed text operation',()=>{for(const q of substitutions)assert.equal(decision(q),true,q);});
test('translation target modifiers preserve comma continuations without joining separate tasks',()=>{
 for(const q of modifierTranslations)assert.equal(decision(q),true,q);
 for(const q of [
  'Translate this sentence into clear; natural English: "Nous partons demain."',
  'Translate this sentence into clear. Natural English: "Nous partons demain."',
  'Translate this sentence into Klingon; discuss English grammar: "Hello".',
  'Translate this into clear, natural English: "Bonjour". Also explain quantum gravity.',
  'Translate this into clear, natural English and save result.txt: "Bonjour".',
  'Translate this into an explanation, in English: "Bonjour".',
 ])assert.equal(decision(q),false,q);
});
test('closed operations do not swallow external needs or unrelated requested work',()=>{
 for(const q of ['回答：71减去未知数等于多少？','直接回答：3000000000减去1等于多少？','计算8乘以(2加3','计算8除以然后解释历史','计算今天汇率减去28等于多少','计算71减去28，然后发送给老师','直接回答71减去28，再讲一个故事','将这段未提供的文字替换为“新文”。','我的标签是“甲”；把未给出的文本改成“乙”。','把“甲”改成“乙”，然后解释核裂变','把“甲”改成“乙”，再翻译成英文','把“甲”改成“乙”并保存到 result.txt','请调用工具 Polaris，把“甲”改成“乙”','Replace the attached document with "new text".','把“甲”改成“乙”，然后联系客户','把“甲”改成“乙”，再发邮件','把“甲”改成“乙”，同时预订餐厅','先联系客户，再把“甲”改成“乙”'])assert.equal(decision(q),false,q);
});
test('fresh-process arithmetic and substitution have zero public directory enumeration',()=>{
 const url=pathToFileURL(resolve('src/advisor-v4.mjs')).href;const pids=new Set();
 for(const q of [...arithmetic,...substitutions,...modifierTranslations]){
  const code=`import fs from 'node:fs';import fsp from 'node:fs/promises';const scans={sync:0,callback:0,promise:0};for(const [o,k,n] of [[fs,'readdirSync','sync'],[fs,'readdir','callback'],[fsp,'readdir','promise']]){const f=o[k];o[k]=function(...a){scans[n]++;return f.apply(this,a)}}fs.readdirSync('.');if(scans.sync!==1)throw Error('inactive tracer');scans.sync=0;const {routeTaskV4}=await import(${JSON.stringify(url)});const r=routeTaskV4(${JSON.stringify(q)},{host:'codex',contractVersion:4});console.log(JSON.stringify({pid:process.pid,scans,mode:r.performance.mode,cards:r.consultCandidates.length+r.capabilityCandidates.length,recovery:r.recoveryPlan.triggered}));`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);const x=JSON.parse(r.stdout);assert.equal(x.mode,'fast',q);assert.equal(x.cards,0,q);assert.equal(x.recovery,false,q);assert.deepEqual(x.scans,{sync:0,callback:0,promise:0},q);pids.add(x.pid);console.log(JSON.stringify({query:q,...x}));
 }
 assert.equal(pids.size,arithmetic.length+substitutions.length+modifierTranslations.length);
});
