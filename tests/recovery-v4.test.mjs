import assert from 'node:assert/strict';
import {test} from 'node:test';
import {performance} from 'node:perf_hooks';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';
import {planRecovery} from '../src/recovery-v4.mjs';
const empty={index:[],capabilityIndex:{capabilities:[],coverage:{},errors:[],revision:'fixture'}};
const plan=(query,context,extra={})=>planRecovery({...taskAssessment(query),rawText:query},{recoveryContext:context,...extra});

test('trivial tasks avoid skill and capability discovery entirely',()=>{
 const options={get index(){throw Error('skill scan happened');},get capabilityIndex(){throw Error('capability scan happened');}};
 for(const query of ['计算 2+2','你好','thanks']){
  const r=routeTaskV4(query,options);assert.equal(r.performance.mode,'fast');assert.equal(r.registryRevision,null);assert.equal(r.coverage.discoveredSkills,null);
 }
});
test('native confidence signal saves work but cannot suppress blockers or explicit tools',()=>{
 const normal=routeTaskV4('把按钮文字改成保存',{...empty,nativeSufficient:true});assert.equal(normal.performance.mode,'fast');
 for(const context of [{confidence:'low'},{userRejected:true},{blocked:true},{failedAttempts:2}]){
  const r=routeTaskV4('把按钮文字改成保存',{...empty,nativeSufficient:true,routingMode:'fast',recoveryContext:context});
  assert.equal(r.performance.mode,'full');assert(r.recoveryPlan.triggered);
 }
 const named=routeTaskV4('使用 $figma 插件',{...empty,nativeSufficient:true});assert.equal(named.performance.mode,'full');
});
test('rejection and low confidence require research, not indiscriminate installation',()=>{
 for(const context of [{userRejected:true},{confidence:'low'},{failedAttempts:2}]){
  const r=plan('修复 PDF 中文渲染', {...context,capabilityNeed:'PDF Chinese font rendering'});
  assert(r.externalResearchRequired);assert.equal(r.searchQueries.length,3);
  assert.equal(r.steps.find(x=>x.id==='install').required,false);assert.match(r.steps.find(x=>x.id==='install').condition,/necessary|adds necessary/);
  assert.equal(r.steps.at(-1).id,'return-and-verify');assert.equal(r.automaticallyExecuted,false);
 }
 assert(plan('效果不行',{}).externalResearchRequired);
 assert(!plan('写一份用户说效果不行时的处理规则',{}).triggered);
});
test('known local fix can precede research, network prohibition is preserved',()=>{
 assert(!plan('修复构建错误',{blocked:true,confidence:'high'}).externalResearchRequired);
 const result=plan('不要联网。修复构建错误',{confidence:'low',capabilityNeed:'build error'});
 assert(result.networkForbidden);assert(!result.externalResearchRequired);assert(result.networkBlocker);assert.equal(result.searchQueries.length,0);
});
test('search planning uses real tool names and removes common private identifiers',()=>{
 const result=plan('修复',{confidence:'low',capabilityNeed:'PDF render C:\\private\\file token=SECRET person@example.com sk-secret123 https://private.example/x'},
  {runtimeTools:[{name:'web__run'},{name:'mcp__catalog__search_plugins'},{name:'mcp__github__search_repositories'}]});
 assert.equal(result.searchTools.web,'web__run');assert.equal(result.searchTools.marketplace,'mcp__catalog__search_plugins');
 assert(!/SECRET|private|person@example|sk-secret/.test(JSON.stringify(result.searchQueries)));
 const unavailable=plan('修复',{confidence:'low'},{runtimeTools:[{name:'web__run',available:false}]});assert.equal(unavailable.searchTools.web,null);
});
test('fast-path measured locally; no network or installation on successful native tasks',()=>{
 const times=[];
 for(let i=0;i<30;i++){const start=performance.now();const r=routeTaskV4('计算 2+2',empty);times.push(performance.now()-start);assert(!r.recoveryPlan.triggered);}
 times.sort((a,b)=>a-b);console.log(JSON.stringify({fastPathMedianMs:times[15],fastPathP95Ms:times[28],samples:30,scope:'module routing only; excludes host/model latency'}));
});
