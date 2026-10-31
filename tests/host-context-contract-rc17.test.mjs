import assert from 'node:assert/strict';
import {test} from 'node:test';
import {capabilityRequestsSchema,normalizeCapabilityRequests} from '../src/host-context-contract.mjs';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {adviseCapabilities,discoverCapabilities} from '../src/capabilities-v4.mjs';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROUTER_ROOT} from '../src/paths.mjs';

const runtime=[
  {name:'local_runner',description:'Runs a command in a PTY, returning output or a session ID.',available:true},
  {name:'visual_maker',description:'The function enables image generation and editing.',available:true},
  {name:'image_reader',description:'View a local image file from the filesystem.',available:true},
  {name:'public_reader',description:'Tool for accessing the internet.',available:true,annotations:{readOnlyHint:true}},
  {name:'send_message',description:'Send a message to a remote workspace.',available:true},
];
const request=(role,extra={})=>({role,purpose:'补足当前交付所需能力',evidenceRefs:['request-goal'],...extra});
const context=(requests)=>({capabilityRequests:requests,evidence:[{source:'user',reference:'request-goal',claim:'宿主从完整请求判断的当前工作'}]});
const advice=(query,ctx,options={})=>{
  const tools=options.runtimeTools??runtime;
  const assessment=taskAssessment(query,ctx,options.invocationContext);
  const inventory=discoverCapabilities({host:'generic',runtimeTools:tools});
  return adviseCapabilities(assessment,{...options,taskContext:ctx,runtimeTools:tools,capabilityIndex:inventory});
};
const hostCards=result=>result.candidates.filter(card=>card.hostRequestMatches?.length);

test('shared contract rejects invalid and unbound evidence without discarding original request',()=>{
  for(const invalid of [{purpose:'x',evidenceRefs:['r']},request('made-up-role'),request('local-execution',{evidenceRefs:[]}),request('local-execution',{authorized:true})]){
    assert.equal(capabilityRequestsSchema.safeParse([invalid]).success,false);
    assert.equal(normalizeCapabilityRequests(context([invalid])).requests.length,0);
  }
  const ctx=context([request('local-execution',{evidenceRefs:['missing']})]);
  const query='在聊天中说明数据问题。';
  const assessment=taskAssessment(query,ctx);
  assert.equal(assessment.originalRequest,query);
  assert.equal(assessment.capabilityRequestIssues[0].reason,'unbound-evidence-reference');
  assert.equal(hostCards(advice(query,ctx)).length,0);
});

test('host local execution gap survives paraphrase and is never a user name or permission',()=>{
  const ctx=context([request('local-execution')]);
  for(const query of ['说明这份记录的异常。','Identify the discrepancy in these records.']){
    const [card]=hostCards(advice(query,ctx,{invocationContext:{readOnly:true}}));
    assert.equal(card.name,'local_runner');assert.equal(card.explicit,false);
    assert.equal(card.decision,'defer');assert.equal(card.effect,'unknown');
    assert.equal(card.hostRequestMatches[0].source,'host-context');
    assert.equal(card.invocation.automaticallyExecuted,false);
  }
});

test('precise image producer is retrieved from current runtime without changing user explicit names',()=>{
  const ctx=context([request('image-generation',{toolNames:['visual_maker']})]);
  const card=hostCards(advice('请制作一张海报。',ctx,{invocationContext:{phase:'implementation'}})).find(card=>card.name==='visual_maker');
  assert(card);assert.equal(card.explicit,false);assert.equal(card.effect,'write-or-unknown');
  assert.equal(card.decision,'check-scope');assert(card.gates.includes('respect-current-user-authorization'));
});

test('independent structured gaps keep local reading and image production in a small candidate budget',()=>{
  const ctx=context([request('local-execution'),request('image-generation')]);
  const result=advice('根据指定数据制作插图。',ctx,{capabilityLimit:2,invocationContext:{phase:'implementation'}});
  assert.deepEqual(hostCards(result).map(card=>card.name).sort(),['local_runner','visual_maker']);
  assert(result.hostCapabilityCoverage.requests.every(item=>item.status==='retrieved'));
});

test('unseen tool, disabled runtime, missing purpose and role mismatch remain unresolved',()=>{
  const trials=[
    {request:{purpose:'需要该工具',toolNames:['not_observed'],evidenceRefs:['request-goal']},tools:runtime,reason:'unobserved-runtime-tool'},
    {request:request('local-execution',{toolNames:['local_runner']}),tools:runtime.map(item=>({...item,available:false})),reason:'runtime-tool-unavailable'},
    {request:{purpose:'读取材料',toolNames:['empty_tool'],evidenceRefs:['request-goal']},tools:[{name:'empty_tool',available:true}],reason:'purpose-metadata-missing'},
    {request:request('image-generation',{toolNames:['local_runner']}),tools:runtime,reason:'role-or-purpose-mismatch'},
  ];
  for(const trial of trials){
    const result=advice('解释结果。',context([trial.request]),{runtimeTools:trial.tools});
    assert.equal(hostCards(result).length,0);
    assert(result.hostCapabilityCoverage.unresolved.some(item=>item.reason===trial.reason));
  }
});

test('unknown runtime availability is not upgraded by an exact host tool suggestion',()=>{
  const result=advice('分析记录。',context([request('local-execution')]),{runtimeTools:runtime.map(item=>({...item,available:undefined}))});
  const card=hostCards(result)[0];assert(card);assert.equal(card.availability.callable,false);
  assert.equal(card.decision,'discover-first');
});

test('stronger read-only and offline restrictions never become weaker due to host advice',()=>{
  const ctx=context([request('image-generation'),request('public-web-access')]);
  const base=advice('制作海报并读取官网。',ctx,{invocationContext:{phase:'implementation'}});
  assert(hostCards(base).length===2);
  const strict=advice('制作海报并读取官网。',ctx,{invocationContext:{phase:'implementation',readOnly:true,networkForbidden:true}});
  for(const card of hostCards(strict))assert.equal(card.decision,'skip',card.name);
  const forbidden=advice('不要联网。解释给定资料。',context([request('public-web-access')]),{invocationContext:{networkForbidden:false}});
  assert.equal(hostCards(forbidden)[0]?.decision,'skip');
});

test('host communication suggestion does not authorize sending or bypass plan mode',()=>{
  const ctx=context([{toolNames:['send_message'],purpose:'可选发送结果',evidenceRefs:['request-goal']}]);
  for(const invocationContext of [{phase:'delivery'},{mode:'plan',phase:'delivery'}]){
    const card=hostCards(advice('在聊天里概括给定文字。',ctx,{invocationContext}))[0];
    assert(card);assert.equal(card.explicit,false);assert.equal(card.decision,'skip');
    assert.equal(card.invocation.automaticallyExecuted,false);
  }
});

test('quoted host evidence is traceability, not authority to generate an unrelated image',()=>{
  const query='解释这句话：“生成一张海报”。';
  const ctx={capabilityRequests:[request('image-generation',{evidenceRefs:['quote']})],
    evidence:[{source:'reference',reference:'quote',claim:'生成一张海报'}]};
  const card=hostCards(advice(query,ctx,{invocationContext:{phase:'implementation',readOnly:true}}))[0];
  assert.equal(card.decision,'skip');assert.equal(card.explicit,false);
});

test('raw read-only source operation reuses restriction and input roles without host context',()=>{
  const query='请只读 C:/fixtures/stock.csv，在聊天里列出数量少于5的物品及数量，不改原文件。';
  const result=advice(query,{});
  const card=result.candidates.find(card=>card.name==='local_runner');
  assert(card);assert.equal(card.decision,'defer');
  assert.equal(taskAssessment(query).readOnly,true);
  assert.equal(hostCards(result).length,0);
});

test('a source attribute in a quoted explanation does not create an execution need',()=>{
  for(const query of ['解释“C:/fixtures/stock.csv原文件只读”的含义。','Explain the phrase “read-only source.csv”.']){
    const result=advice(query,{});
    assert(!result.candidates.some(card=>card.name==='local_runner'));
  }
});

test('valid unmet host capability requests cannot be swallowed by native fast hints',()=>{
  const ctx=context([request('local-execution')]);
  const result=routeTaskV4('分析给定记录。',{taskContext:ctx,nativeSufficient:true,dryRun:true,index:{skills:[],coverage:{}},
    runtimeTools:runtime,capabilityIndex:discoverCapabilities({host:'generic',runtimeTools:runtime})});
  assert.equal(result.performance.mode,'full');
  assert(result.capabilityCandidates.some(card=>card.name==='local_runner'));
  assert.equal(result.hostCapabilityCoverage.requests[0].status,'retrieved');
});

test('actual MCP schema and phase-search entry preserve structured needs and restrictive context',async()=>{
  const client=new Client({name:'host-contract-test',version:'1.0.0'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROUTER_ROOT,'src/mcp-server.mjs')],stderr:'pipe'}));
    const listed=await client.listTools();
    const input=listed.tools.find(tool=>tool.name==='search_capabilities').inputSchema;
    assert(input.properties.taskContext.properties.capabilityRequests);
    assert(input.properties.invocationContext.properties.networkForbidden);
    const args={query:'分析这份材料。',routeId:'host-contract-test',host:'generic',runtimeTools:runtime,
      taskContext:context([request('local-execution'),request('public-web-access')]),
      invocationContext:{phase:'validation',readOnly:true,networkForbidden:true}};
    const result=await client.callTool({name:'search_capabilities',arguments:args});
    assert(!result.isError,JSON.stringify(result));
    assert.equal(result.structuredContent.routeId,args.routeId);
    const cards=hostCards(result.structuredContent);
    assert.equal(cards.find(card=>card.name==='local_runner').decision,'defer');
    assert.equal(cards.find(card=>card.name==='public_reader').decision,'skip');
    const bad=await client.callTool({name:'search_capabilities',arguments:{...args,
      taskContext:context([request('local-execution',{authorized:true})])}});
    assert(bad.isError,'server and direct callers reject the same forbidden fields');
  }finally{await client.close();}
});

test('session adapter provenance is preserved without being used as a visibility allowlist',async()=>{
  const history={capabilities:[],coverage:{},errors:[],revision:'adapter-fixture'};
  const tool={name:'paint',description:'The function enables image generation and editing.',inputSchema:{type:'object',properties:{}}};
  const observation={schemaVersion:1,source:'current-session-mcp-status',threadId:'fixture-thread',routeId:'fixture-route',
    profile:['visual'],servers:[{name:'visual',authStatus:'notApplicable',tools:{paint:tool}}]};
  // A local integration run supplies the real adapter; portable regression
  // runs replay its public output shape without embedding private paths.
  const adapter=process.env.SKILL_ROUTER_TEST_RUNTIME_ADAPTER;
  const source={method:'mcpServerStatus/list',threadId:'fixture-thread',serverName:'visual',toolName:'paint',
    observationSha256:'fixture-observation',scope:'current registration only; business execution and remote authorization unverified'};
  const projected=adapter?(await import(pathToFileURL(adapter).href)).projectRuntimeContext(history,observation,'fixture-observation'):{
    runtimeTools:[{...tool,name:'mcp__visual__paint',server:'visual',available:true,observationSource:source}],
    capabilityIndex:{...history,capabilities:[{id:'tool:mcp__visual__paint',kind:'tool',name:'mcp__visual__paint',
      description:tool.description,server:'visual',enabled:true,callable:true,runtimeAvailable:true,
      evidence:'current-session-mcp-tool-registration',callabilityEvidence:source}]}};
  const ctx=context([request('image-generation',{toolNames:['mcp__visual__paint']})]);
  const result=adviseCapabilities(taskAssessment('请制作海报。',ctx),{...projected,taskContext:ctx,invocationContext:{phase:'implementation'}});
  const card=hostCards(result)[0];assert.equal(card.name,'mcp__visual__paint');assert.equal(card.availability.callable,true);
  const original=projected.capabilityIndex.capabilities.find(entry=>entry.name===card.name);
  assert.deepEqual(card.availability.callabilityEvidence,original.callabilityEvidence);
  assert.equal(card.availability.evidence,'current-session-mcp-tool-registration');
  assert.equal(card.explicit,false);assert.equal(card.invocation.automaticallyExecuted,false);
  const stale=adviseCapabilities(taskAssessment('解释记录。',ctx),{capabilityIndex:projected.capabilityIndex,taskContext:ctx});
  assert.equal(hostCards(stale).length,0);assert(stale.hostCapabilityCoverage.unresolved.length>0);
});

test('current unavailable or unknown metadata overrides a previously callable inventory row without relaxing gates',()=>{
  const ctx=context([request('local-execution',{toolNames:['local_runner']})]);
  const inventory=discoverCapabilities({host:'generic',runtimeTools:runtime});
  const raw='请只读 C:/fixtures/stock.csv，在聊天里列出记录，不改原文件。';
  const assessment=taskAssessment(raw,ctx);
  const options={taskContext:ctx,capabilityIndex:inventory,invocationContext:{readOnly:true,networkForbidden:true}};
  const unknown=adviseCapabilities(assessment,{...options,runtimeTools:runtime.map(item=>({...item,available:undefined}))});
  const card=hostCards(unknown)[0];assert(card);assert.equal(card.availability.callable,false);
  assert.equal(card.availability.runtimeAvailable,null);assert.equal(card.decision,'defer');
  assert(card.gates.includes('verify-read-only-effect-before-invocation'));
  assert(card.gates.includes('verify-no-network-before-invocation'));
  const absent=adviseCapabilities(assessment,{...options,runtimeTools:runtime.map(item=>({...item,available:false}))});
  assert(!absent.candidates.some(card=>card.name==='local_runner'));
  assert(absent.hostCapabilityCoverage.unresolved.some(item=>item.reason==='runtime-tool-unavailable'));
});
