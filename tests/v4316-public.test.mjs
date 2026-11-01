import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inferUserConstraints} from '../src/request-evidence.mjs';
import {routeTaskV4} from '../src/advisor-v4.mjs';

test('explicit whole-request offline instructions remain restrictions',()=>{
  for(const query of ['整体工作务必保持离线。','Carry out all the work with no network connection.'])
    assert.equal(inferUserConstraints(query).networkForbidden,true,query);
});

test('exclusive supplied sources do not automatically forbid network use',()=>{
  const limits=inferUserConstraints('所有项目的资料仅能取自上传的文档。');
  assert.equal(limits.sourceScope,'provided-only');
  assert.equal(limits.networkForbidden,false);
});

test('a negated or explanatory statement does not itself impose a ban',()=>{
  for(const query of ['我没有说整体工作务必保持离线。','请解释整体工作务必保持离线的含义。'])
    assert.equal(inferUserConstraints(query).networkForbidden,false,query);
});

test('a citation limit does not automatically prohibit background reading',()=>{
  const limits=inferUserConstraints('整体工作的证据仅限来自所附文件；另外可搜索网络背景。');
  assert.equal(limits.sourceScope,null);
  assert.equal(limits.networkForbidden,false);
});

test('a recognized offline instruction survives initial route and defers a remote tool',()=>{
  const tool={name:'fixture__remote__search',description:'Search the web for external information.',available:true,annotations:{readOnlyHint:true,openWorldHint:true}};
  const entry={id:'tool:'+tool.name,kind:'tool',...tool,enabled:true,callable:true,evidence:'runtime-tool'};
  const query='整体工作务必保持离线，请搜索网页。';
  const result=routeTaskV4(query,{host:'generic',index:[],capabilityIndex:{capabilities:[entry],coverage:{},errors:[],revision:'public-fixture'},runtimeTools:[tool],useFeedback:false,dryRun:true,routingMode:'full'});
  assert.equal(result.taskConstraints.networkForbidden,true);
  const card=result.capabilityCandidates.find(item=>item.name===tool.name);
  assert(card);
  assert.equal(card.decision,'defer');
});
