import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';

const tool=(name,description,extra={})=>({id:`tool:${name}`,kind:'tool',name,description,enabled:true,callable:true,evidence:'runtime-tool',annotations:{},...extra});
const assess=(clauses,extra={})=>({activeText:clauses.join('; '),activeClauses:clauses,readOnly:false,...extra});
const advise=(clauses,capabilities,extra={})=>adviseCapabilities(assess(clauses,extra),{capabilityIndex:{capabilities,coverage:{},errors:[],revision:'rc7-purpose-fixture'},capabilityLimit:10});

test('output basenames do not recruit service objects while formats preserve image observation',()=>{
  const family=tool('account__read_family_controls','Read family controls and safety settings.',{annotations:{readOnlyHint:true}});
  const image=tool('native__inspect_image','View a local image file from the filesystem.');
  for(const basename of ['family-controls','safety','holiday','random-42']){
    const result=advise([`Inspect the local image ${basename}.png`],[family,image]);
    assert.deepEqual(result.candidates.map(x=>x.name),[image.name],basename);
  }
  assert(advise(['Read family controls and safety settings'],[family]).candidates.some(x=>x.name===family.name));
});

test('generic service lifecycle and return prose cannot identify a tool purpose',()=>{
  const cards=[
    tool('catalogue__read_manual','读取技能全文。返回请求结果，读取不执行脚本。'),
    tool('catalogue__health_check','校验注册表、技能目录和核心服务。'),
    tool('catalogue__resolve_alias','把中文技能名、英文 ID 或别名解析为真实技能路径。'),
  ];
  const result=advise(['实现本地 HTTP 服务','按 id 返回请求结果','检查服务目录并结束服务'],cards);
  assert.deepEqual(result.candidates,[]);
  assert(advise(['读取技能全文并返回候选技能'],cards).candidates.some(x=>x.name===cards[0].name));
  assert(advise(['检查注册表与技能目录'],cards).candidates.some(x=>x.name===cards[1].name));
});

test('HTTP methods and endpoints are protocol syntax, not social objects',()=>{
  const social=tool('social__get_posts','Read posts and messages from the social feed.');
  for(const route of ['/messages','/posts','/status']){
    assert.deepEqual(advise([`Implement HTTP POST ${route} with a JSON response and read back the response`],[social]).candidates,[],route);
  }
  assert(advise(['Read posts and messages from the social feed'],[social]).candidates.some(x=>x.name===social.name));
});

test('generic API prose does not establish a provider-specific service object',()=>{
  const vendor=tool('mcp__fabric__get_api','Read Fabric billing records through its HTTP API.',{server:'fabric'});
  assert.deepEqual(advise(['Implement a local HTTP API and inspect API responses'],[vendor]).candidates,[]);
  assert(advise(['Read Fabric billing records through the API'],[vendor]).candidates.some(x=>x.name===vendor.name));
});

test('explicit tools and necessary substrates survive purpose gates without granting permission',()=>{
  const writer=tool('ledger__update_billing','Update remote billing records.',{annotations:{readOnlyHint:true}});
  const explicit=advise([`Use ${writer.name}`],[writer],{readOnly:true}).candidates[0];
  assert.equal(explicit?.explicit,true);
  assert.equal(explicit?.decision,'skip');
  const shell=tool('native__terminal','Runs a command in a local terminal.');
  const runtime=advise(['Run a local script to inspect input.json'],[shell],{readOnly:true}).candidates[0];
  assert.equal(runtime?.capabilityRole,'local-execution');
  assert.equal(runtime?.decision,'defer');
});

test('a concrete skill-service request survives without the ambiguous router word',()=>{
  const manual=tool('mcp__dynamic_skill_router__get_skill','读取技能全文。返回候选路径，读取不执行脚本。',{server:'dynamic_skill_router'});
  assert(advise(['读取技能全文，核对技能说明'],[manual]).candidates.some(x=>x.name===manual.name));
  assert.deepEqual(advise(['Implement the HTTP route and return id fields'],[manual]).candidates,[]);
});

test('management purpose needs its managed object, independently of provider identity',()=>{
  const cards=[
    tool('catalogue__list_skills','列出管理的个人全局技能及中文名称、类别和可用状态。'),
    tool('orchestration__plan_recovery','复用 routeId，低成本判断遇阻、低信心、用户否定效果后的行动顺序。'),
    tool('telemetry__report_outcome','记录本次技能选择是否合适，供以后调优；不会自动改写路由规则。'),
    tool('registry__scan_capabilities','只读扫描本机插件/MCP 配置，合并宿主传入的运行时工具。'),
    tool('coordination__plan_agents','主 Agent 调查项目后提交具体子任务 workItems，检查依赖环和文件冲突。'),
    tool('dispatcher__route_task','任务开始时调用一次。联合扫描技能、插件与 MCP，传 runtimeTools 获取当前工具建议。'),
  ];
  const request=['制作列表，显示用户名称与状态','保留顺序并记录选择规则','只读输入并合并输出','制作 MCP 服务，读取文本并写 SKILL.md 说明','实际执行一次'];
  assert.deepEqual(advise(request,cards).candidates,[]);
  assert(advise(['列出技能目录名称和可用状态'],cards).candidates.some(x=>x.name===cards[0].name));
  assert(advise(['任务遇阻且低信心，制定恢复计划'],cards).candidates.some(x=>x.name===cards[1].name));
  assert(advise(['扫描本机插件和 MCP 配置'],cards).candidates.some(x=>x.name===cards[3].name));
});

test('concrete host workspace reads retain their existing scoped object evidence',()=>{
  const projects=tool('mcp__codex_app__list_projects','List local and remote projects available for task creation.');
  assert(advise(['List Codex projects available for a new chat'],[projects]).candidates.some(x=>x.name===projects.name));
  assert.deepEqual(advise(['List local project files for a Codex Skill'],[projects]).candidates,[]);
});
