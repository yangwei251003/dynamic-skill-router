import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {taskAssessment} from '../src/advisor-v4.mjs';
import {useFastPath,planRecovery} from '../src/recovery-v4.mjs';
const decide=q=>{const a=taskAssessment(q);return useFastPath(a,{},planRecovery(a,{}));};
const positive=[
 '比较7/12和5/8，只输出较大的分数。',
 '比较 -0.25 与 2/9，只返回结果。',
 'Compare 9/11 and 0.8, output only the larger fraction.',
 'Which is smaller: -3/4 or -0.7?',
 '把pear、apple、kiwi按英文字母顺序排列，只输出逗号分隔的词。',
 '将zebra，cobalt，apple按字母降序排列。',
 'Sort pear, apple, kiwi alphabetically, return comma-separated words.',
];
test('bounded literal order comparisons are native without catalog evidence',()=>{for(const q of positive)assert.equal(decide(q),true,q);});
test('missing values, singular denominators and external actions are not closed ordering',()=>{
 for(const q of [
  '比较7/0和5/8，只输出较大的分数。','比较7/x和5/8，只输出较大的分数。',
  '比较10000000000和1，只输出结果。','比较这两个方案的价格，只输出结果。',
  'Compare 9/11 and 0.8, then save result.txt.',
  'Sort the attached words alphabetically.','把pear、apple、kiwi按英文字母顺序排列，然后发送给客户。',
  '把pear、apple、kiwi按英文字母顺序排列，并介绍Apple最新产品。',
  '请调用工具，把pear、apple、kiwi按英文字母顺序排列。',
  '开发一个按字母顺序排列单词的浏览器应用。',
 ])assert.equal(decide(q),false,q);
});
test('fresh literal ordering route bypasses all public directory enumeration',()=>{
 const url=pathToFileURL(resolve('src/advisor-v4.mjs')).href;
 for(const q of positive){
  const code=`import fs from 'node:fs';import fsp from 'node:fs/promises';const scans={sync:0,callback:0,promise:0};for(const [o,k,n] of [[fs,'readdirSync','sync'],[fs,'readdir','callback'],[fsp,'readdir','promise']]){const f=o[k];o[k]=function(...a){scans[n]++;return f.apply(this,a)}}fs.readdirSync('.');if(scans.sync!==1)throw Error('inactive tracer');scans.sync=0;const {routeTaskV4}=await import(${JSON.stringify(url)});const r=routeTaskV4(${JSON.stringify(q)},{host:'codex',contractVersion:4});console.log(JSON.stringify({pid:process.pid,scans,mode:r.performance.mode,cards:r.consultCandidates.length+r.capabilityCandidates.length}));`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(run.status,0,run.stderr);const r=JSON.parse(run.stdout);assert.equal(r.mode,'fast',q);assert.equal(r.cards,0,q);assert.deepEqual(r.scans,{sync:0,callback:0,promise:0});
 }
});
