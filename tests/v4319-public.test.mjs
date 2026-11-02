import assert from 'node:assert/strict';
import {test} from 'node:test';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {routeTaskV4,searchSkills} from '../src/advisor-v4.mjs';
import {ROUTER_ROOT} from '../src/paths.mjs';
import {ROUTER_VERSION} from '../src/version.mjs';

// All tools and addresses below are fictional. The test runner supplies an
// isolated data root and home directory; no business tool is called.
const browser={name:'browser__bridge',description:'Search the public web or open a provided page.',available:true,annotations:{readOnlyHint:true,openWorldHint:true}};
const alternate={name:'other__search',description:'Search the web for public documentation.',available:true,annotations:{readOnlyHint:true,openWorldHint:true}};
const runtimeTools=[browser,alternate];
const capabilities=runtimeTools.map(tool=>({id:`tool:${tool.name}`,kind:'tool',...tool,enabled:true,callable:true,evidence:'runtime-tool'}));
const base={host:'generic',contractVersion:4,index:[],runtimeTools,capabilityIndex:{capabilities,coverage:{},errors:[]},useFeedback:false,dryRun:true,routingMode:'full',capabilityLimit:10};
const scope={searchRestrictions:{prohibitedToolSearch:['browser__bridge']}};
const options={...base,invocationContext:scope};
const query='不要使用 browser__bridge 的 search_query；请用 browser__bridge 的 open 直接读取 https://example.invalid/spec。';
const cards=result=>[...(result.capabilityCandidates||result.candidates||[]),...(result.capabilityConsultations||[])];

test('the named open action remains consultable under an exact search restriction',()=>{
  const first=routeTaskV4(query,options);
  const phase=searchSkills(query,{...options,routeId:first.routeId});
  for(const result of [first,phase]){
    const card=cards(result).find(item=>item.name===browser.name&&item.intentMatches?.includes('web-open'));
    assert(card);assert(!card.intentMatches.includes('web-search'));
    assert(['check-scope','defer'].includes(card.decision));
    assert(card.gates.includes('host-prohibits-search-use-only-permitted-action'));
  }
  assert.equal(phase.routeId,first.routeId);
});

test('the dotted English form remains compatible',()=>{
  const english='Do not use browser__bridge.search_query; please use browser__bridge to open https://example.invalid/spec.';
  const card=cards(routeTaskV4(english,options)).find(item=>item.name===browser.name&&item.intentMatches?.includes('web-open'));
  assert(card);assert(!card.intentMatches.includes('web-search'));
  assert(['check-scope','defer'].includes(card.decision));
});

test('an absent or different exact search restriction cannot narrow a tool ban',()=>{
  for(const invocationContext of [{},{searchRestrictions:{prohibitedToolSearch:[alternate.name]}},{searchRestrictions:{prohibitedChannels:['web']}}]){
    const result=routeTaskV4(query,{...base,invocationContext});
    assert(!cards(result).some(item=>item.name===browser.name&&item.decision!=='skip'));
  }
});

test('whole-tool and combined action bans remain effective',()=>{
  const requests=[
    '不要使用 browser__bridge；请用 browser__bridge 的 open 读取 https://example.invalid/spec。',
    '不要使用 browser__bridge 的 search_query 和 open；请用 browser__bridge 的 open 读取 https://example.invalid/spec。',
    '不要使用 browser__bridge 的 search_query；也不要使用 browser__bridge；请用 browser__bridge 的 open 读取 https://example.invalid/spec。',
    '不要使用 browser__bridge 的 search_query；以后请用 browser__bridge 的 open 读取 https://example.invalid/spec。',
  ];
  for(const request of requests)assert(!cards(routeTaskV4(request,options)).some(item=>item.name===browser.name&&item.decision!=='skip'),request);
});

test('the exact search exception does not relax a host network ban',()=>{
  for(const restriction of [{networkForbidden:true},{allowedActions:['read']}]){
    const result=routeTaskV4(query,{...base,invocationContext:{...scope,...restriction}});
    assert.equal(result.taskConstraints.networkForbidden,true);
    const named=cards(result).filter(item=>item.name===browser.name);
    assert(!named.some(item=>item.decision==='use-now'));
    for(const item of named)assert(item.gates.includes('network-forbidden-or-effects-unverified'));
  }
});

test('isolated MCP preserves method and network boundaries across phases',async()=>{
  const client=new Client({name:'public-scoped-action-test',version:'1.0.0'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROUTER_ROOT,'src/mcp-server.mjs')],stderr:'pipe'}));
    const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert(!result.isError,JSON.stringify(result));return result.structuredContent;};
    const health=await call('health_check',{contractVersion:4});assert.equal(health.routerVersion,ROUTER_VERSION);
    const common={host:'generic',runtimeTools,invocationContext:scope,recoveryContext:{confidence:'low',capabilityNeed:'public documentation'}};
    const first=await call('route_task',{...common,query,contractVersion:4,dryRun:true,useFeedback:false,includeAgentContext:false,capabilityLimit:10});
    const skillPhase=await call('search_skills',{...common,query,routeId:first.routeId,phase:'discovery',capabilityLimit:10});
    const capabilityPhase=await call('search_capabilities',{...common,query,routeId:first.routeId,phase:'discovery',capabilityLimit:10});
    const recovery=await call('plan_recovery',{...common,query,routeId:first.routeId});
    for(const result of [first,skillPhase,capabilityPhase]){
      const card=cards(result).find(item=>item.name===browser.name&&item.intentMatches?.includes('web-open'));
      assert(card);assert(!card.intentMatches.includes('web-search'));
      assert(['check-scope','defer'].includes(card.decision));
    }
    assert.notEqual(recovery.searchTools?.web,browser.name);
    assert.deepEqual(recovery.taskConstraints.searchRestrictions.prohibitedToolSearch,[browser.name]);
    const blocked=await call('route_task',{...common,invocationContext:{...scope,networkForbidden:true},query,contractVersion:4,dryRun:true,useFeedback:false,includeAgentContext:false,capabilityLimit:10});
    assert.equal(blocked.taskConstraints.networkForbidden,true);
    assert(!cards(blocked).some(item=>item.name===browser.name&&item.decision==='use-now'));
  }finally{await client.close();}
});
