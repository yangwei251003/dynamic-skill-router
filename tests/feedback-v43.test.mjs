import test from 'node:test';
import assert from 'node:assert/strict';
import {computeFeedbackCalibrationV4,validateOutcomeV4} from '../src/feedback-v4.mjs';
const now=Date.parse('2026-10-29T00:00:00Z');
const sample=i=>({contractVersion:4,host:'codex',taskType:'development',routeId:'task-'+i,modelId:'runtime-model-a',observedAt:'2026-10-28T00:00:00Z',decisions:[{skillId:'fixture',contentHash:'v1',mode:'consult',shown:true,read:true,adopted:true,outcome:'helpful',evidence:[{kind:'validation',reference:'checks/report.json',passed:true}]}]});
const rows=Array.from({length:20},(_,i)=>sample(i));
const context={host:'codex',taskType:'development',modelId:'runtime-model-a',mode:'consult',contentHashes:{fixture:'v1'}};
const run=(entries,ctx=context)=>computeFeedbackCalibrationV4(entries,ctx,{nowMs:now});
test('verified independent observations calibrate within the existing bound',()=>assert(run(rows).get('fixture').adjustment>0));
test('different or unknown model evidence cannot leak into a known model',()=>{
  assert.equal(run(rows,{...context,modelId:'runtime-model-b'}).size,0);
  assert.equal(run(rows.map(({modelId,...row})=>row)).size,0);
});
test('expired and future dated records stay out of calibration',()=>{
  assert.equal(run(rows.map(r=>({...r,observedAt:'2020-01-01'}))).size,0);
  assert.equal(run(rows.map(r=>({...r,observedAt:'2027-01-01'}))).size,0);
});
test('revocations remove the observation regardless of event order',()=>{
  const revoked=rows.map(r=>({...r,revoked:true}));
  assert.equal(run([...revoked,...rows]).size,0);
  assert.equal(run([...rows,...revoked]).size,0);
});
test('self praise and unknown outcomes do not become learned preferences',()=>{
  assert.equal(run(rows.map(r=>({...r,decisions:r.decisions.map(d=>({...d,evidence:[{kind:'self',reference:'looks good'}]}))}))).size,0);
  assert.equal(run(rows.map(r=>({...r,decisions:r.decisions.map(d=>({...d,outcome:'unknown'}))}))).size,0);
});
test('repeated reports do not create independent evidence',()=>{
  assert.equal(run(Array(20).fill(rows[0])).get('fixture').samples,1);
});
test('malformed dates and model metadata are rejected',()=>{
  assert(!validateOutcomeV4({...sample(1),observedAt:'not a date'}).ok);
  assert(!validateOutcomeV4({...sample(1),modelId:''}).ok);
});
