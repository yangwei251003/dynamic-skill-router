import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {routeTaskV4, compactAdviceV4} from '../src/advisor-v4.mjs';
import {computeFeedbackCalibrationV4} from '../src/feedback-v4.mjs';

const availability = {discovered:true,readable:true,enabled:true,compatible:true};
const skills = [
  {id:'playwright', name:'Playwright', description:'Browser automation', availability},
  {id:'db-manual', description:'Database schema migration rollback compatibility', availability, contentHash:'db-v1'},
  {id:'debug-manual', description:'Debug diagnostic failures', availability},
  {id:'transaction-manual', description:'Database transaction concurrency atomic operations', availability},
  {id:'experiment-log', description:'为实验保存可复现记录', availability},
  {id:'stock', description:'研究股票方案和对比风险', availability},
];
const run = query => routeTaskV4(query, {index:skills,host:'codex',retrievalProfile:'experimental'});
for (const query of ['使用“Playwright”', '使用「Playwright」', 'use "Playwright"', 'use `Playwright`']) {
  assert(run(query).consultCandidates.some(card=>card.id==='playwright' && card.explicit), query);
}
for (const query of ['不要使用“Playwright”', '例如使用“Playwright”', '以后使用“Playwright”', '> 使用“Playwright”', '示例：使用“Playwright”', '他说“使用 Playwright”', '```text\n使用“Playwright”\n```']) {
  assert(!run(query).consultCandidates.some(card=>card.id==='playwright'), query);
}
for (const query of ['请为未来三个月制定数据库迁移计划', '制定未来三个月数据库迁移方案', '规划数据库结构迁移并准备回滚', 'Plan database schema migration rollback']) {
  assert.equal(run(query).consultCandidates[0]?.id, 'db-manual', query);
}
for (const query of ['以后再进行数据库结构迁移与回滚', '不要进行数据库迁移', '示例：数据库迁移与回滚', '未来可能需要数据库迁移', '以后制定数据库迁移方案', '未来可能制定数据库迁移方案', '将来编写数据库迁移计划']) {
  assert.equal(run(query).consultCandidates.length, 0, query);
}
assert(!run('研究 GitHub 技能路由器，对比可复现缺陷和优化方案').consultCandidates.some(card=>['experiment-log','stock'].includes(card.id)));
assert.equal(run('处理数据库并发事务').consultCandidates[0]?.id, 'transaction-manual');
assert.equal(run('你好').consultCandidates.length, 0);
const huge = routeTaskV4('使用 db-manual', {index:[{...skills[1],description:'database '.repeat(12000)}]});
const compact = compactAdviceV4(huge);
assert.deepEqual(compact.consultCandidates.map(x=>x.id), huge.consultCandidates.map(x=>x.id));
assert.deepEqual(compact.consultCandidates.map(x=>x.score), huge.consultCandidates.map(x=>x.score));
assert(JSON.stringify(compact).length < 8000);
assert.equal(compact.consultCandidates[0].contentHash,'db-v1');
assert.equal(compact.consultCandidates[0].detailsAvailable,true);

const decision = {skillId:'db-manual',contentHash:'db-v1',mode:'adapt',shown:true,read:true,adopted:true,outcome:'helpful',evidence:[{kind:'validation',reference:'focused-test',passed:true}]};
const entry = {contractVersion:4,routeId:'one-task',host:'codex',taskType:'development',decisions:[decision]};
const ctx = {host:'codex', taskType:'development', mode:'adapt'};
const repeated = computeFeedbackCalibrationV4(Array.from({length:12},()=>entry),ctx).get('db-manual');
assert.equal(repeated.samples,1); assert.equal(repeated.adjustment,0);
assert.equal(computeFeedbackCalibrationV4([{...entry,routeId:undefined}],ctx).size,0);
const conflicting = {...entry,decisions:[{...decision,outcome:'wrong'}]};
assert.equal(computeFeedbackCalibrationV4([entry,conflicting],ctx).size,0);
assert.equal(computeFeedbackCalibrationV4([conflicting,entry],ctx).size,0);
const independent = Array.from({length:12},(_,i)=>({...entry,routeId:`task-${i}`}));
assert(computeFeedbackCalibrationV4(independent,ctx).get('db-manual').adjustment>0);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'router-feedback-test-'));
try {
  const feedbackPath=path.join(temp,'feedback.jsonl');
  fs.writeFileSync(feedbackPath,independent.map(x=>JSON.stringify(x)).join('\n'));
  const options={index:skills,host:'codex',feedbackPath,useFeedback:true,retrievalProfile:'experimental'};
  const result=routeTaskV4('规划数据库迁移并准备回滚',options);
  assert(result.consultCandidates[0].calibrationByMode.adapt.adjustment>0);
  const without=routeTaskV4('规划数据库迁移并准备回滚',{...options,useFeedback:false});
  assert.equal(result.consultCandidates[0].score,without.consultCandidates[0].score,'adapt outcomes must not change consult ranking');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
console.log('research hardening regressions passed');
