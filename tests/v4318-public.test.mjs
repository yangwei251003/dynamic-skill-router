import assert from 'node:assert/strict';
import {test} from 'node:test';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';
import {invocationConstraints,constrainCapability} from '../src/invocation-constraints.mjs';
import {planRecovery} from '../src/recovery-v4.mjs';
import {ROUTER_ROOT} from '../src/paths.mjs';

const opts={host:'generic',contractVersion:4,index:[],runtimeTools:[],capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false,routingMode:'full',dryRun:true};

test('a requested output directory does not make read-only references a global write ban',()=>{
  const r=routeTaskV4('制作离线网页，交付一个目录，入口为 home.html；参考资料只读。',opts);
  assert.equal(r.taskConstraints.readOnly,false);
  assert.equal(r.taskConstraints.preserveInputs,true);
  const host=routeTaskV4('交付一个目录，入口为 home.html。',{...opts,invocationContext:{readOnly:true}});
  assert.equal(host.taskConstraints.readOnly,true);
});

test('general position and control words do not establish a geographic map task',()=>{
  const base={sourceId:'fixture',availability:{discovered:true,readable:true,enabled:true,compatible:true},aliases:[],triggers:[]};
  const map={...base,id:'geo-sdk',nameZh:'geo-sdk',summaryZh:'用 JavaScript 地理地图 SDK 构造地图页面，设置初始位置和区域，用代码控制地图，展示城市路线与经纬度。'};
  const index=[map,...Array.from({length:80},(_,i)=>({...base,id:`fixture-${i}`,nameZh:`fixture-${i}`,summaryZh:`independent subject ${i}`}))];
  const run=q=>routeTaskV4(q,{...opts,index,limit:100}).consultCandidates.some(c=>c.id===map.id&&c.suggestedMode!=='skip');
  assert.equal(run('制作离线 Canvas 游戏，角色初始位置在目标区域，网页控件使用代码控制。'),false);
  assert.equal(run('请使用 geo-sdk 在地理地图上显示经纬度。'),true);
});

test('host search restrictions narrow actions without granting network access',()=>{
  const c=invocationConstraints({}, {invocationContext:{searchRestrictions:{prohibitedChannels:['web']}}});
  const tool={name:'web__run',description:'Search the web or open a supplied page.'};
  const card=constrainCapability({name:tool.name,decision:'use-now',effect:'read',intentMatches:['web-search','web-open'],gates:[]},c,tool);
  assert.deepEqual(card.intentMatches,['web-open']);assert.equal(card.decision,'check-scope');
  const offline=invocationConstraints({inferredConstraints:{networkForbidden:true}}, {invocationContext:{networkForbidden:false,searchRestrictions:{prohibitedChannels:['web']}}});
  assert.equal(offline.networkForbidden,true);
  assert.throws(()=>invocationConstraints({}, {invocationContext:{searchRestrictions:{prohibitedChannels:['invalid']}}}));
});

test('remote search restriction suppresses generated remote recovery queries',()=>{
  const query='Open https://example.invalid/leaf and find supporting documentation.';
  const assessment={...taskAssessment(query),rawText:query};
  const plan=planRecovery(assessment,{...opts,invocationContext:{searchRestrictions:{prohibitedChannels:['remote']}},recoveryContext:{confidence:'low',capabilityNeed:'layout standards'}});
  assert.equal(plan.networkForbidden,false);
  assert.deepEqual(plan.searchQueries,[]);
  assert.match(plan.steps.find(s=>s.id==='research').action,/Do not perform remote searches/);
});

test('the MCP interface declares and propagates current-stage search restrictions',async()=>{
  const client=new Client({name:'public-search-restrictions-test',version:'1.0.0'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROUTER_ROOT,'src/mcp-server.mjs')],stderr:'pipe'}));
    const tools=await client.listTools();
    for(const name of ['route_task','search_skills','search_capabilities','plan_recovery'])
      assert(tools.tools.find(t=>t.name===name)?.inputSchema?.properties?.invocationContext?.properties?.searchRestrictions,name);
    const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return r.structuredContent;};
    const query='Open https://example.invalid/leaf and inspect the page.';
    const common={host:'generic',invocationContext:{searchRestrictions:{prohibitedChannels:['remote']}},recoveryContext:{confidence:'low',capabilityNeed:'layout standards'}};
    const first=await call('route_task',{...common,query,contractVersion:4,dryRun:true,useFeedback:false,includeAgentContext:false});
    const next=await call('search_capabilities',{...common,query,routeId:first.routeId,phase:'discovery'});
    const recovery=await call('plan_recovery',{...common,query,routeId:first.routeId});
    assert.deepEqual(first.taskConstraints.searchRestrictions.prohibitedChannels,['remote']);
    assert.deepEqual(next.taskConstraints.searchRestrictions.prohibitedChannels,['remote']);
    assert.deepEqual(recovery.searchQueries,[]);
  }finally{await client.close();}
});
