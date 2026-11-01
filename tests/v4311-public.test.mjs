import assert from 'node:assert/strict';
import {test} from 'node:test';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {routeTaskV4, taskAssessment, formatAgentContextV4} from '../src/advisor-v4.mjs';
import {requestSegments} from '../src/request-evidence.mjs';
import {constrainCapability, invocationConstraints, prohibitedObjectOperation} from '../src/invocation-constraints.mjs';
import {ROUTER_ROOT} from '../src/paths.mjs';

// Every request, identifier, tool and document here is invented for this suite.
// A recommendation is inspected as data; no fixture tool is ever invoked.
const fixtureTools = [
  {name:'fixture__reminder_update',description:'Manage and update scheduled reminders.',available:true},
  {name:'fixture__paper_read',description:'Read full text passages from identified papers.',available:true,annotations:{readOnlyHint:true}},
  {name:'fixture__share_file',description:'Share a document file.',available:true},
  {name:'fixture__edit_file',description:'Edit an existing document file.',available:true},
];
const capabilities=fixtureTools.map(t=>({id:`tool:${t.name}`,kind:'tool',...t,enabled:true,callable:true,evidence:'runtime-tool'}));
const options={host:'generic',contractVersion:4,index:[],useFeedback:false,dryRun:true,routingMode:'full',
  runtimeTools:fixtureTools,capabilityIndex:{capabilities,revision:'invented-fixture',coverage:{runtimeProvided:true},errors:[]},capabilityLimit:10};
const route=(query,extra={})=>routeTaskV4(query,{...options,...extra});
const card=(result,name)=>result.capabilityCandidates.find(item=>item.name===name);

test('the isolated wrapper ignores an inherited data-root override',()=>{
  const wrapper=path.join(ROUTER_ROOT,'scripts','isolated-node.mjs');
  const probe='import {GLOBAL_ROOT} from "./src/paths.mjs"; process.stdout.write(GLOBAL_ROOT);';
  const customRoot=path.join(ROUTER_ROOT,'fictional-outside-data');
  const child=spawnSync(process.execPath,[wrapper,'--input-type=module','-e',probe],{
    cwd:ROUTER_ROOT,encoding:'utf8',timeout:30000,
    env:{...process.env,SKILL_ROUTER_DATA_ROOT:customRoot},
  });
  assert.equal(child.status,0,child.stderr);
  assert.equal(child.stdout,path.join(ROUTER_ROOT,'examples','data'));
  const direct=spawnSync(process.execPath,[path.join(ROUTER_ROOT,'src','cli.mjs'),'health','--host','generic','--contract-version','4'],{
    cwd:ROUTER_ROOT,encoding:'utf8',timeout:30000,env:{...process.env,SKILL_ROUTER_DATA_ROOT:customRoot},
  });
  assert.equal(direct.status,0,direct.stderr);
  const legacy=JSON.parse(direct.stdout).coverage.sources.find(source=>source.id==='legacy');
  assert.equal(legacy.root,path.join(customRoot,'skills'));
  assert.equal(legacy.present,false);
});

test('requested examples remain instructions while supplied quotations remain material',()=>{
  const query='请生成一个示例：汇总仓储记录，写入新文件，不要覆盖原始文件。';
  const assessment=taskAssessment(query);
  assert.match(assessment.activeText,/汇总仓储记录/);
  assert.match(assessment.activeText,/写入新文件/);
  const limits=route(query).taskConstraints;
  assert.equal(limits.preserveInputs,true);
  assert.equal(limits.readOnly,false);
  const quoted='给定内容：“不要联网”，请概括这段话。';
  assert(requestSegments(quoted).spans.some(span=>span.role==='quoted-material'));
  assert.equal(route(quoted).taskConstraints.networkForbidden,false);
});

test('future and explanatory restrictions are not promoted into present prohibitions',()=>{
  const future=route('请总结文档；以后如果需要，不要查找外部资料。').taskConstraints;
  assert.notEqual(future.sourceScope,'provided-only');
  const explanation=route('请解释不要覆盖原始文件的原因。').taskConstraints;
  assert.notEqual(explanation.preserveInputs,true);
  assert.equal(explanation.readOnly,false);
});

test('host and user source restrictions intersect regardless of their order',()=>{
  const cases=[
    ['只使用提供的资料整理标题。','specified-site-only'],
    ['只在 https://example.org 网站上查找资料。','provided-only'],
  ];
  for(const [query,sourceScope] of cases){
    const result=route(query,{invocationContext:{sourceScope,preserveInputs:true},
      recoveryContext:{confidence:'low',capabilityNeed:'inspect missing evidence'}});
    assert.deepEqual(result.taskConstraints.sourceScopes,['provided-only','specified-site-only']);
    assert.equal(result.taskConstraints.preserveInputs,true);
    assert.match(result.taskConstraints.sourceScopeIntersection,/also belong to the specified site/);
    assert.match(formatAgentContextV4(result),/allSourceScopes=\[provided-only, specified-site-only\]/);
    assert.deepEqual(result.recoveryPlan.searchQueries,[]);
    assert.match(result.recoveryPlan.sourceRestriction,/also belong to the specified site/);
  }
});

test('host restrictions only tighten network and read-only scope',()=>{
  const plain=taskAssessment('概括材料。');
  assert.equal(invocationConstraints(plain,{}).networkForbidden,false);
  assert.equal(invocationConstraints(plain,{invocationContext:{allowedActions:['read']}}).networkForbidden,true);
  assert.equal(invocationConstraints(plain,{invocationContext:{allowedActions:['read','network']}}).networkForbidden,false);
  const restricted=route('离线检查本地数据。',{invocationContext:{networkForbidden:false,readOnly:false}}).taskConstraints;
  assert.equal(restricted.networkForbidden,true);
  assert.equal(invocationConstraints(plain,{invocationContext:{mode:'plan'}}).readOnly,true);
  assert.throws(()=>invocationConstraints(plain,{invocationContext:{sourceScope:'all-sources'}}),TypeError);
});

test('opening a supplied URL and unbounded search receive different scope gates',()=>{
  const limits=invocationConstraints(taskAssessment('只使用提供的资料。'),{});
  const tool={name:'fixture__web',description:'Search and open web pages.',annotations:{readOnlyHint:true}};
  const base={name:tool.name,decision:'use-now',effect:'read',phase:'discovery',gates:[]};
  const open=constrainCapability({...base,intentMatches:['web-open'],inputEvidence:{providedUrls:['https://example.org/item']}},limits,tool);
  assert.equal(open.decision,'check-scope');
  assert(open.gates.includes('verify-open-url-is-user-provided-source'));
  const missing=constrainCapability({...base,intentMatches:['web-open'],inputEvidence:{providedUrls:[]}},limits,tool);
  assert.equal(missing.decision,'defer');
  const search=constrainCapability({...base,intentMatches:['web-search']},limits,tool);
  assert.equal(search.decision,'defer');
  assert(search.gates.includes('verify-bounded-source-query-before-search'));
});

test('a local output filename is not supplied as a website domain',()=>{
  const web={name:'fixture__web_search',description:'Search the internet for web pages and open web pages.',available:true,annotations:{readOnlyHint:true}};
  const entry={id:`tool:${web.name}`,kind:'tool',...web,enabled:true,callable:true,evidence:'runtime-tool'};
  const extra={runtimeTools:[web],capabilityIndex:{capabilities:[entry],revision:'invented-web',coverage:{},errors:[]}};
  const local=card(route('请联网搜索节约用水的方法，并将摘要写入 local-notes.md 文件。',extra),web.name);
  assert(local?.intentMatches.includes('web-search'));
  assert.deepEqual(local.inputEvidence.providedDomains,[]);
  const site=card(route('请检索资料，仅查询 imaginary.invalid.md 网站。',extra),web.name);
  assert(site?.inputEvidence.providedDomains.includes('imaginary.invalid.md'));
});

test('existing reminder and paper-passage matches remain advisory and bounded',()=>{
  const reminder=card(route('请暂停已有提醒。'),'fixture__reminder_update');
  assert(reminder?.intentMatches.includes('reminder-manage'));
  assert.equal(reminder.decision,'check-scope');
  assert(reminder.gates.includes('resolve-existing-reminder-and-preserve-settings'));
  assert.equal(reminder.invocation.automaticallyExecuted,false);
  assert(!card(route('解释如何暂停已有提醒。'),'fixture__reminder_update'));
  const paper=card(route('请阅读 DOI:10.1234/fictional.42 的论文正文，提取方法段落。'),'fixture__paper_read');
  assert(paper?.intentMatches.includes('academic-read'));
  assert(paper.gates.includes('verify-paper-id-question-and-indexed-full-text'));
  assert.equal(paper.availability.businessOutcome,'unknown');
  assert(!card(route('只使用提供的资料，离线整理论文。'),'fixture__paper_read'));
});

test('a document sharing ban does not become a ban on editing it',()=>{
  const query='请编辑文档，但不要分享文档。';
  assert.equal(prohibitedObjectOperation(query,fixtureTools[2]),true);
  assert.equal(prohibitedObjectOperation(query,fixtureTools[3]),false);
  const result=route(query);
  assert(!card(result,'fixture__share_file'));
  assert(card(result,'fixture__edit_file'));
});

test('actual MCP schema and route, phase searches, recovery retain host limits',async()=>{
  const client=new Client({name:'public-v4311-fixture',version:'1.0.0'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROUTER_ROOT,'src/mcp-server.mjs')],stderr:'pipe',env:{...process.env}}));
    const listed=await client.listTools();
    for(const name of ['route_task','search_skills','search_capabilities','plan_recovery']){
      const input=listed.tools.find(tool=>tool.name===name)?.inputSchema;
      assert(input,`missing ${name}`);
      const fields=input.properties.invocationContext.properties;
      assert(fields.sourceScope,`${name} missing sourceScope`);
      assert(fields.preserveInputs,`${name} missing preserveInputs`);
    }
    const call=async(name,args)=>{
      const result=await client.callTool({name,arguments:args});
      assert(!result.isError,JSON.stringify(result));
      return result.structuredContent;
    };
    const query='只使用提供的资料整理标题。';
    const invocationContext={sourceScope:'specified-site-only',preserveInputs:true,allowedActions:['read']};
    const first=await call('route_task',{query,host:'generic',contractVersion:4,dryRun:true,useFeedback:false,routingMode:'full',runtimeTools:[],invocationContext});
    assert(first.routeId);
    const common={query,routeId:first.routeId,invocationContext,runtimeTools:[]};
    const skills=await call('search_skills',{...common,host:'generic',useFeedback:false,responseDetail:'full'});
    const tools=await call('search_capabilities',{...common,host:'generic',phase:'discovery'});
    const recovery=await call('plan_recovery',{...common,recoveryContext:{confidence:'low',capabilityNeed:'inspect missing evidence'}});
    for(const result of [first,skills,tools,recovery]){
      assert.deepEqual(result.taskConstraints.sourceScopes,['provided-only','specified-site-only']);
      assert.equal(result.taskConstraints.preserveInputs,true);
      assert.equal(result.taskConstraints.networkForbidden,true);
    }
    assert.equal(skills.routeId,first.routeId);
    assert.equal(tools.routeId,first.routeId);
    assert.equal(recovery.routeId,first.routeId);
    assert.deepEqual(recovery.searchQueries,[]);
  } finally {
    await client.close();
  }
});
