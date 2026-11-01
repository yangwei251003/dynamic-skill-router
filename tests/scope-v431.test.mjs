import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4} from '../src/advisor-v4.mjs';

// Synthetic development examples, not held-out or real user requests.
const tools=[{name:'web__run',description:'Search web pages and open supplied URLs.'}];
const capabilities=tools.map(t=>({
  id:`tool:${t.name}`,kind:'tool',name:t.name,description:t.description,
  server:null,plugin:null,enabled:true,callable:true,evidence:'runtime-tool',annotations:{}
}));
const options={
  index:[],capabilityIndex:{capabilities,coverage:{},errors:[],revision:'synthetic'},
  runtimeTools:tools,capabilityLimit:10,useFeedback:false,
  recoveryContext:{confidence:'low',capabilityNeed:'verify'}
};
const route=query=>routeTaskV4(query,options);

test('limited supplied sources remove unbounded recovery searches',()=>{
  const r=route('请只依据附件，不要参考其他来源。');
  assert.equal(r.taskConstraints.sourceScope,'provided-only');
  assert.equal(r.recoveryPlan.externalResearchRequired,false);
  assert.deepEqual(r.recoveryPlan.searchQueries,[]);
});

test('not restricting to the attachment permits further research',()=>{
  const r=route('不仅使用附件，也请联网补充其他来源。');
  assert.notEqual(r.taskConstraints.sourceScope,'provided-only');
  assert.equal(r.taskConstraints.networkForbidden,false);
});

test('opening a supplied URL is separate from searching for more sources',()=>{
  const r=route('只用给定链接 https://example.net/docs 读取内容，不要搜索其他来源。');
  assert.equal(r.taskConstraints.sourceScope,'provided-only');
  assert.equal(r.taskConstraints.networkForbidden,false);
  assert.deepEqual(r.recoveryPlan.searchQueries,[]);
  const card=r.capabilityCandidates.find(c=>c.name==='web__run');
  assert(card);
  assert(card.intentMatches.includes('web-open'));
  assert(!card.intentMatches.includes('web-search'));
  assert.equal(card.invocation.automaticallyExecuted,false);
  const explicit=route('请打开给定的链接 https://example.net/help，不要上网搜索其他资料。');
  assert.equal(explicit.taskConstraints.sourceScope,'provided-only');
  assert.equal(explicit.taskConstraints.networkForbidden,false);
  assert.deepEqual(explicit.recoveryPlan.searchQueries,[]);
});

test('specified site restricts recovery until its domain is confirmed',()=>{
  const r=route('请只在示例官网查询公开信息。');
  assert.equal(r.taskConstraints.sourceScope,'specified-site-only');
  assert.deepEqual(r.recoveryPlan.searchQueries,[]);
  assert.equal(r.recoveryPlan.searchTools.marketplace,null);
  assert.equal(r.recoveryPlan.searchTools.repositories,null);
});

test('advice remains read-only and separate output preserves the input',()=>{
  const advice=route('仅审阅这份文件，列出修改建议。');
  assert.equal(advice.taskConstraints.readOnly,true);
  assert.equal(advice.recoveryPlan.installPolicy.allowed,false);
  const saved=route('只读检查原文，再把分析建议输出到新文件。');
  assert.equal(saved.taskConstraints.readOnly,false);
  assert.equal(saved.taskConstraints.preserveInputs,true);
});

test('offline requests and negated prohibitions stay distinct',()=>{
  const offline=route('请不联网分析本地资料。');
  assert.equal(offline.taskConstraints.networkForbidden,true);
  assert.deepEqual(offline.recoveryPlan.searchQueries,[]);
  const absolute=route('禁止联网。请打开我给的链接 https://example.net/offline。');
  assert.equal(absolute.taskConstraints.networkForbidden,true);
  assert.deepEqual(absolute.recoveryPlan.searchQueries,[]);
  const online=route('不要禁止联网，请上网查询。');
  assert.equal(online.taskConstraints.networkForbidden,false);
});
