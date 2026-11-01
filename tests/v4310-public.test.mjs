import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4, searchSkills, taskAssessment} from '../src/advisor-v4.mjs';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';
import {prohibitedObjectOperation} from '../src/invocation-constraints.mjs';

// All names, descriptions and requests below are invented for this suite.
const tools = [
  {name:'mcp__fixture__automation_update',description:'Create, update, or view scheduled reminders and recurring automations.',available:true},
  {name:'mcp__fixture__search_papers',description:'Search paper titles and abstracts across scholarly sources.',available:true},
  {name:'mcp__fixture__read_paper',description:'Read selected passages in an identified paper.',available:true},
  {name:'mcp__fixture__calendar_create_event',description:'Create a new calendar event.',available:true},
  {name:'mcp__fixture__calendar_delete_event',description:'Delete a calendar event.',available:true},
  {name:'mcp__fixture__calendar_list_events',description:'List calendar events in a date range.',available:true},
  {name:'mcp__fixture__safety_settings_get_family_info',description:'Read family information for parental controls.',available:true},
  {name:'mcp__fixture__search_feedback',description:'Submit feedback for the quality of a search result.',available:true},
  {name:'mcp__fixture__mail_search',description:'Search email messages in an inbox.',available:true},
];
const capabilities = tools.map(t=>({id:`tool:${t.name}`,kind:'tool',name:t.name,description:t.description,enabled:true,callable:true,evidence:'runtime-tool',annotations:{}}));
const options = {host:'codex',contractVersion:4,index:[],runtimeTools:tools,
  capabilityIndex:{capabilities,revision:'public-fixture',coverage:{runtimeProvided:true},errors:[]},
  useFeedback:false,dryRun:true,capabilityLimit:10,routingMode:'full'};
const route=(query,extra={})=>routeTaskV4(query,{...options,...extra});
const cards=query=>route(query).capabilityCandidates;
const find=(items,name)=>items.find(item=>item.name===name);
const named=suffix=>tools.find(item=>item.name.endsWith(suffix));

// This checks scope classification, not access to the fictitious websites.
test('a source restriction for a named website survives recovery planning',()=>{
  const r=route('只在 https://example.net 网站上检索资料。',
    {recoveryContext:{confidence:'low',capabilityNeed:'investigate'}});
  assert.equal(r.taskConstraints.sourceScope,'specified-site-only');
  assert.equal(r.taskConstraints.networkForbidden,false);
  assert.deepEqual(r.recoveryPlan.searchQueries,[]);
  assert.equal(r.recoveryPlan.searchTools.marketplace,null);
  assert.equal(r.recoveryPlan.searchTools.repositories,null);
});

test('the exact supplied URL, a negated restriction and a future restriction remain distinct',()=>{
  assert.equal(route('只阅读 https://example.net/article 并概括。').taskConstraints.sourceScope,'provided-only');
  assert.notEqual(route('不必只在 example.net 网站上检索，可以比较其他来源。').taskConstraints.sourceScope,'specified-site-only');
  assert.notEqual(route('现在解答；下次只在 example.net 网站上查询。').taskConstraints.sourceScope,'specified-site-only');
});

test('local output and protection of source are independent constraints',()=>{
  const c=route('保持源代码不变，生成本地总结文档。').taskConstraints;
  assert.equal(c.preserveInputs,true);
  assert.equal(c.readOnly,false);
  const a=route('全程只读检查配置，不要写入任何文件。').taskConstraints;
  assert.equal(a.readOnly,true);
  const b=route('检查项目并生成本地报告。',{invocationContext:{readOnly:true,networkForbidden:true}}).taskConstraints;
  assert.equal(b.readOnly,true);
  assert.equal(b.networkForbidden,true);
});

test('offline and local-source constraints do not leak into a discussion of those concepts',()=>{
  const a=route('请离线统计本地 CSV 文件。').taskConstraints;
  assert.equal(a.networkForbidden,true);
  assert.equal(route('仅使用本地CSV数据并生成本地报告。').taskConstraints.sourceScope,'provided-only');
  assert.notEqual(route('只用本地 CSV 格式输出，并联网查询其他资料。').taskConstraints.sourceScope,'provided-only');
  assert.equal(route('解释离线处理的概念，并联网查证。').taskConstraints.networkForbidden,false);
});

test('object-scoped prohibitions distinguish a calendar deletion from a creation',()=>{
  const del=named('calendar_delete_event'),create=named('calendar_create_event'),list=named('calendar_list_events');
  assert(prohibitedObjectOperation('查看日历但不要删除日历事件。',del));
  assert(!prohibitedObjectOperation('查看日历但不要删除日历事件。',create));
  assert(!prohibitedObjectOperation('不要创建日历事件。',list));
  assert(!prohibitedObjectOperation('引用句子“不要创建日历事件”，请创建日历事件。',create));
});

test('a prohibited calendar operation is not proposed through an exact consultation',()=>{
  const create=named('calendar_create_event');
  const query='读取日历，写一份本地摘要，不要创建日历事件。';
  const assessment={...taskAssessment(query),rawText:query};
  const r=adviseCapabilities(assessment,{...options,phase:'implementation',taskContext:{capabilityRequests:[{toolNames:[create.name],evidenceRefs:['日历']}]}});
  assert(!find(r.candidates,create.name));
  assert(!r.capabilityConsultations.some(c=>c.name===create.name));
});

test('scheduled reminders use matching purpose without automatic execution or authentication assumptions',()=>{
  const name=named('automation_update').name;
  const card=find(cards('请每周四下午3点提醒我检查备份。'),name);
  assert(card);
  assert.equal(card.decision,'check-scope');
  assert.equal(card.invocation.automaticallyExecuted,false);
  assert.equal(card.availability.authentication,'unknown');
  assert(!find(cards('解释如何设置提醒。'),name));
});

test('a reminder retains its action when the message contains an English inspection verb',()=>{
  const name=named('automation_update').name;
  const card=find(cards('Remind me every Friday at 10:00 to review my backups.'),name);
  assert(card);
  assert.equal(card.decision,'check-scope');
});

test('a host read-only restriction remains authoritative over a scheduled reminder',()=>{
  const name=named('automation_update').name;
  const result=route('请每周四下午3点提醒我检查备份。',{invocationContext:{readOnly:true}});
  const card=find(result.capabilityCandidates,name);
  assert(card);
  assert.equal(card.decision,'skip');
});

test('an academic search matches a search tool rather than an unrelated reader',()=>{
  const result=cards('请检索关于海岸鸟类迁徙的学术论文。');
  assert(find(result,named('search_papers').name));
  assert(!find(result,named('read_paper').name));
  assert(!find(cards('只使用提供的文献，不要搜索其他来源。'),named('search_papers').name));
});

test('an explicit handle does not make every tool in its namespace relevant',()=>{
  const name=named('automation_update').name;
  const result=cards(`请使用 ${name} 每周四下午3点提醒我检查备份。`);
  assert(find(result,name)?.explicit);
  assert(!find(result,named('search_papers').name));
  assert(!find(result,named('mail_search').name));
});

test('ordinary table labels do not establish a family or search-feedback task',()=>{
  const result=cards('整理离线设备台账，包含 safety_controls、quality_index 和 record_id。');
  assert(!find(result,named('safety_settings_get_family_info').name));
  assert(!find(result,named('search_feedback').name));
  assert(find(cards('请检查家庭设置和家长控制的状态。'),named('safety_settings_get_family_info').name));
});

test('a finance specialist needs a finance object unless explicitly named',()=>{
  const base={sourceId:'fixture',availability:{discovered:true,readable:true,enabled:true,compatible:true},triggers:[],aliases:[]};
  const index=[
    {...base,id:'sample-stock-analysis',nameZh:'股票分析',summaryZh:'分析股票证券风险和估值。'},
    {...base,id:'sample-financial-suite',nameZh:'财务分析',summaryZh:'研究企业财务表现与估值。'},
  ];
  const opts={...options,index,routeId:'public-fixture',limit:12};
  const consult=(q,id)=>searchSkills(q,opts).consultCandidates.some(c=>c.id===id&&c.suggestedMode==='consult');
  assert(!consult('优化仓储分拣方案组合，提高收益并限制资源成本。','sample-stock-analysis'));
  assert(!consult('优化仓储分拣方案组合，提高收益并限制资源成本。','sample-financial-suite'));
  assert(consult('分析两只股票的估值和风险。','sample-stock-analysis'));
  assert(consult('使用 sample-stock-analysis 处理这些记录。','sample-stock-analysis'));
});
