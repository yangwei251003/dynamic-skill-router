import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath,planRecovery} from '../src/recovery-v4.mjs';

const queries=[
 '把这句话翻译成英文：“我喜欢周末在公园散步。”',
 '把这句话翻译成自然英文，只给译文：窗外的雨停了，我们可以出发了。',
 '请把下面这段话译成适合初学者阅读的流畅法语：“我们明天再见。”',
 'Translate this sentence into French: "The meeting starts at nine."',
 'Translate this sentence into clear, natural English: "Nous partons demain."',
 '概括下面这段文字：“团队先制作样品，随后收集意见，最后修改成品。”只给一句话。',
 'Summarize this text: "Rain delayed the match. The players returned the next morning."',
 '从这段文字提取数字：“甲有18个，乙有25个，丙有6个。”',
 'Extract dates from this sentence: "We meet on 2026-03-02 and 2026-04-01."',
 '小林有18张贴纸，送出5张，又收到7张，现在有多少张？',
 'Mina had 24 marbles, gave 6 away and received 3. How many are left?',
 '每盒有6支铅笔，3盒一共有多少支？',
 'Convert 2.5 km to meters.',
 '把90分钟换算成小时。',
 'Convert 2500mg to grams.',
];
const decision=(query,options={})=>{const a=taskAssessment(query,options.taskContext);return useFastPath(a,options,planRecovery(a,options));};

test('complete short chat transformations and finite quantities need no catalogue or host sufficiency hint',()=>{
 for(const query of queries){
  assert.equal(decision(query),true,query);
  const r=routeTaskV4(query,{get index(){throw Error('catalogue read');},get capabilityIndex(){throw Error('capability read');}});
  assert.equal(r.performance.mode,'fast',query);
  assert.equal(r.consultCandidates.length+r.capabilityCandidates.length,0,query);
 }
});

test('missing inputs, unknown quantities, mixed tasks and external effects retain full routing',()=>{
 for(const query of [
  '请把这句话翻译成英文。','Translate the following sentence into French:',
  '把这句话翻译成别的语言；另外用英文解释语法：“我们走吧”。',
  'Translate this into an explanation in English: "你好".',
  'Translate this into Klingon; discuss English grammar: "Hello".',
  '总结前面没有贴出的段落。','Extract the important information.',
  '将“下午见”翻译成英文，再总结它。',
  'Translate this into English: "你好". Also explain quantum gravity.',
  '提取数字：“18、5、7”；再计算18 + 5。',
  '有18张贴纸，送出一些，又收到7张，现在有多少？',
  'Mina had 24 marbles and received an unknown amount. How many are left?',
  'Mina gave away 6 marbles and received 3. How many are left?',
  '送出5张贴纸又收到7张，现在有多少张？',
  'Convert 5 glorp to meters.','Convert 5 kg to meters.',
  '把这句话翻译成英文并保存到 result.txt：“下午见”。',
  'Translate the attached document into English.',
  '概括这段话并搜索最新事实：“气候发生变化”。',
  '计算今天美元汇率乘以18。','计算药物剂量18除以5。',
  'Calculate the legal tax owed on 18 units received.',
  '将18毫克换算成克并判断药物剂量是否安全。',
  'Convert 25mg into grams, then run Python to verify it.',
  '使用 $translator 翻译成英文：“下午见”。',
  '请调用工具 Aurora 翻译成英文：“下午见”。',
 ])assert.equal(decision(query),false,query);
 for(const options of [{recoveryContext:{confidence:'low'}},{recoveryContext:{failedAttempts:2}},{taskContext:{complexity:'high'}},{routingMode:'full'}])assert.equal(decision(queries[0],options),false);
});

test('fresh-process import and routing perform no directory discovery for supplied-only operations',()=>{
 const url=pathToFileURL(resolve('src/advisor-v4.mjs')).href,pids=new Set();
 for(const query of queries){
  const script=`import fs from 'node:fs';import fsp from 'node:fs/promises';const counts={sync:0,callback:0,promise:0};for(const [o,k,n] of [[fs,'readdirSync','sync'],[fs,'readdir','callback'],[fsp,'readdir','promise']]){const f=o[k];o[k]=function(...a){counts[n]++;return f.apply(this,a)}}fs.readdirSync('.');if(counts.sync!==1)throw Error('inactive counter');counts.sync=0;const {routeTaskV4}=await import(${JSON.stringify(url)});const r=routeTaskV4(${JSON.stringify(query)},{host:'codex',contractVersion:4});console.log(JSON.stringify({pid:process.pid,counts,mode:r.performance.mode,cards:r.consultCandidates.length+r.capabilityCandidates.length}));`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(run.status,0,run.stderr||run.stdout);const r=JSON.parse(run.stdout.trim());
  assert.equal(r.mode,'fast',query);assert.equal(r.cards,0,query);assert.deepEqual(r.counts,{sync:0,callback:0,promise:0},query);pids.add(r.pid);
  console.log(JSON.stringify({query,...r,scope:'patched public Node readdir APIs, not all OS I/O'}));
 }
 assert.equal(pids.size,queries.length);
});
