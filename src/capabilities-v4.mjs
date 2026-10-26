import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'smol-toml';

const list = x => Array.isArray(x) ? x : [];
const norm = x => String(x || '').normalize('NFKC').toLowerCase();
const label = x => norm(x).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
const text = (x, max = 1800) => typeof x === 'string' ? x.slice(0, max) : '';
const unique = x => [...new Set(x.filter(Boolean))];
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function localFile(root, value) {
  if (typeof value !== 'string' || path.isAbsolute(value)) return null;
  const target = path.resolve(root, value);
  try {
    const realRoot = fs.realpathSync(root), realTarget = fs.realpathSync(target);
    const relative = path.relative(realRoot, realTarget);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? realTarget : null;
  } catch { return null; }
}
function serverCard(name, value, plugin = null) {
  return {id:plugin ? `plugin-mcp:${plugin}:${name}` : `mcp:${name}`, kind:'mcp', name, plugin,
    description:text(value.description), configured:true, enabled:value.enabled !== false,
    callable:false, evidence:'configuration-only', tools:[],
    transport:value.url ? 'remote' : value.command ? 'stdio' : 'unknown',
    // Credentials, command lines, arguments, URLs and env values never leave discovery.
    enabledTools:Array.isArray(value.enabled_tools) ? value.enabled_tools.filter(x=>typeof x==='string') : null,
    disabledTools:list(value.disabled_tools).filter(x=>typeof x==='string')};
}

/** Read-only inventory. Never starts MCP processes, connects to endpoints, or writes a cache. */
export function discoverCapabilities(options = {}) {
  const home = options.homeDir || os.homedir();
  const entries = new Map(), errors = [];
  const codex = (options.host || 'codex') === 'codex';
  let config = {};
  if (codex || options.configPath) {
    try { config = parse(fs.readFileSync(options.configPath || path.join(home,'.codex','config.toml'),'utf8')); }
    catch { errors.push('codex-config-unreadable-or-invalid'); }
  }
  for (const [name, value] of Object.entries(config.mcp_servers || {})) {
    if (!value || typeof value !== 'object') continue;
    const entry = serverCard(name, value); entries.set(entry.id, entry);
  }
  const cacheRoot = options.pluginCacheRoot || path.join(home,'.codex','plugins','cache');
  for (const [id, settings] of Object.entries(config.plugins || {})) {
    const at = id.lastIndexOf('@'), name = at > 0 ? id.slice(0,at) : id;
    const entry = {id:`plugin:${id}`, kind:'plugin', name, plugin:id, description:'', configured:true,
      enabled:settings?.enabled === true, callable:false, evidence:'configuration-only', tools:[], skills:[], manifestStatus:'missing'};
    entries.set(entry.id, entry);
    // Do not allow config identifiers to traverse the plugin cache.
    if (at < 1 || !/^[\w.-]+$/.test(name) || !/^[\w.-]+$/.test(id.slice(at+1))) continue;
    const root = path.join(cacheRoot,id.slice(at+1),name);
    let versions = [];
    try { versions = fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()); } catch {}
    if (versions.length !== 1) { entry.manifestStatus = versions.length ? 'ambiguous-version' : 'missing'; continue; }
    const pluginRoot = path.join(root,versions[0].name);
    const manifest = readJson(path.join(pluginRoot,'plugin.json')) || readJson(path.join(pluginRoot,'.codex-plugin','plugin.json'));
    if (!manifest || manifest.name !== name) { entry.manifestStatus = 'invalid'; continue; }
    const ui = manifest.extensions?.['com.openai']?.interface || manifest.interface || {};
    Object.assign(entry,{description:text(manifest.description || ui.shortDescription), displayName:text(ui.displayName,100),
      version:text(manifest.version,80), manifestStatus:'readable'});
    // Fixed-location skills are already indexed by the skill scanner. No duplicate recursive scan.
    try { entry.skills = fs.readdirSync(path.join(pluginRoot,'skills'),{withFileTypes:true}).filter(x=>x.isDirectory() && fs.existsSync(path.join(pluginRoot,'skills',x.name,'SKILL.md'))).map(x=>x.name); } catch {}
    const mcpRef = manifest.mcpServers;
    const mcpFile = typeof mcpRef === 'string' ? localFile(pluginRoot,mcpRef)
      : localFile(pluginRoot,'mcp.json') || localFile(pluginRoot,'.mcp.json');
    const mcp = mcpRef && typeof mcpRef === 'object' ? mcpRef : readJson(mcpFile || '')?.mcpServers;
    for (const [server, value] of Object.entries(mcp || {})) {
      if (!value || typeof value !== 'object') continue;
      const card = serverCard(server,value,id); card.enabled &&= entry.enabled;
      entries.set(card.id,card);
    }
  }
  // Runtime metadata is supplied afresh by the host; configuration is not availability proof.
  for (const item of list(options.runtimePlugins)) {
    if (!item?.id) continue;
    const id = `plugin:${item.id}`;
    const prior = entries.get(id);
    entries.set(id,{...prior,id,kind:'plugin',name:item.name || item.id.split('@')[0],plugin:item.id,
      description:text(item.description || prior?.description),configured:prior?.configured || false,
      enabled:item.enabled !== false,callable:false,evidence:'runtime-plugin',tools:[],skills:list(item.skills).filter(x=>typeof x==='string')});
  }
  const runtime = [...list(options.runtimeTools)];
  const named = new Set(runtime.map(x=>x?.name));
  for (const name of list(options.runtimeCapabilities?.tools)) if (!named.has(name)) runtime.push({name});
  function pluginFor(name) {
    if (!name) return null;
    const matches = [...entries.values()].filter(e=>e.kind==='plugin' && [e.plugin,e.name,e.displayName].some(x=>label(x)===label(name)));
    if (matches.length === 1) return matches[0];
    // A display name can be ambiguous across marketplaces; do not bind it arbitrarily.
    if (matches.length > 1) return null;
    const id=`plugin:${name}`;
    const entry={id,kind:'plugin',name,plugin:name,description:'',configured:false,enabled:true,callable:false,evidence:'runtime-tool-provider',tools:[],skills:[]};
    entries.set(id,entry); return entry;
  }
  for (const item of runtime) {
    if (!item || typeof item.name !== 'string' || !item.name) continue;
    const server = text(item.server,120) || item.name.match(/^mcp__(.+?)__/i)?.[1] || null;
    const plugin = pluginFor(item.plugin);
    const serverEntry = server ? entries.get(`mcp:${server}`) : null;
    const shortName = item.name.split('__').at(-1);
    const enabled = item.available !== false && serverEntry?.enabled !== false && plugin?.enabled !== false
      && (!serverEntry?.enabledTools || serverEntry.enabledTools.includes(shortName) || serverEntry.enabledTools.includes(item.name))
      && !serverEntry?.disabledTools?.some(x=>x===shortName || x===item.name);
    const annotations = {};
    for (const key of ['readOnlyHint','destructiveHint','idempotentHint','openWorldHint']) if (typeof item.annotations?.[key] === 'boolean') annotations[key]=item.annotations[key];
    const entry = {id:`tool:${item.name}`,kind:'tool',name:item.name,server,plugin:plugin?.plugin || item.plugin || null,
      description:text(item.description),configured:false,enabled,callable:enabled,evidence:'runtime-tool',annotations};
    entries.set(entry.id,entry);
    if (plugin) { plugin.tools.push(entry.name); plugin.callable ||= enabled; }
    if (server) {
      const serverId=`mcp:${server}`;
      const group = serverEntry || entries.get(serverId) || {id:serverId,kind:'mcp',name:server,description:'',plugin:null,configured:false,enabled:true,callable:false,evidence:'runtime-tool',tools:[]};
      group.tools.push(entry.name); group.callable ||= enabled; if (enabled) group.evidence='runtime-tool'; entries.set(serverId,group);
    }
  }
  const capabilities = [...entries.values()].map(e=>({...e,...(e.tools ? {tools:unique(e.tools)} : {})}));
  return {revision:hash(capabilities),capabilities,errors,coverage:{plugins:capabilities.filter(x=>x.kind==='plugin').length,
    mcpServers:capabilities.filter(x=>x.kind==='mcp').length,tools:capabilities.filter(x=>x.kind==='tool').length,
    callableTools:capabilities.filter(x=>x.kind==='tool'&&x.callable).length,
    runtimeProvided:Array.isArray(options.runtimeTools)||Array.isArray(options.runtimeCapabilities?.tools),
    hostConfigScanned:codex || Boolean(options.configPath),authority:'Current host metadata only; never inferred from installed files.'}};
}

const STOP = new Set('the a an to of in on for and or with by from is are this that use using tool tools mcp plugin plugins api server get list create update read write run execute task tasks help useful available function request user support supports provides access part'.split(' '));
const segmenter = new Intl.Segmenter('zh',{granularity:'word'});
function terms(value) {
  const source = norm(value).replace(/https?:\/\/\S+/g,' ');
  const result = (source.match(/[a-z][a-z0-9]+/g)||[]).map(x=>x.replace(/(ing|s)$/,''));
  for (const part of segmenter.segment(source)) if (/\p{Script=Han}/u.test(part.segment) && part.segment.length>=2) result.push(part.segment);
  const bridges = [
    [/数据库|postgres|sql|database/,['database']], [/原理图|电路|pcb|easyeda|schematic/,['circuit']],
    [/浏览器|browser|playwright/,['browser']], [/网页|网站|前端|frontend|website/,['frontend']],
    [/设计稿|figma|design file/,['figma']], [/设计稿|设计|design/,['design']], [/代码库|仓库|repository|github/,['repository']],
    [/文档|documentation|docs/,['documentation']], [/文档|document|file/,['document']], [/搜索|检索|查找|search/,['search']],
    [/测试|test|验证|verify|validation/,['test']], [/部署|上线|发布|deploy|publish/,['deploy']],
    [/幻灯片|演示文稿|slides|presentation/,['slides']], [/表格|spreadsheet|excel/,['spreadsheet']],
    [/邮件|email|mail/,['email']], [/日历|calendar/,['calendar']], [/图像|图片|image/,['image']],
    [/迁移|migration/,['migration']], [/日志|logs/,['logs']], [/错误|error|故障|debug/,['debug']],
  ];
  for (const [pattern, additions] of bridges) if (pattern.test(source)) result.push(...additions);
  return unique(result.filter(x=>x.length>1 && !STOP.has(x)));
}
function operation(entry) {
  const name = norm(entry.name.split('__').at(-1)).replace(/[_-]/g,' ');
  if (entry.annotations?.destructiveHint === true) return {action:'commit',phase:'delivery',effect:'high-impact'};
  // Mutating names dominate hints. Hints are descriptive metadata, never authorization.
  if (/\b(send|post message|reply|email send)\b/.test(name)) return {action:'communicate',phase:'delivery',effect:'external-write'};
  if (/\b(deploy|publish|release|merge|purchase|pay|delete|remove|drop|destroy)\b/.test(name)) return {action:'commit',phase:'delivery',effect:'high-impact'};
  if (/\b(create|update|edit|write|insert|upload|push|apply|execute|exec|run|query|generate|mutate|change|set|add)\b/.test(name)) return {action:'change',phase:'implementation',effect:'write-or-unknown'};
  if (/\b(test|validate|verify|check|inspect|screenshot)\b/.test(name)) return {action:'verify',phase:'validation',effect:entry.annotations?.readOnlyHint === true?'read':'unknown'};
  if (/\b(search|find|fetch|get|list|read|browse|lookup|resolve|open|status|windows)\b/.test(name) || entry.annotations?.readOnlyHint===true) return {action:'read',phase:'discovery',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'};
  return {action:'unknown',phase:'implementation',effect:'unknown'};
}
function currentPhase(active, given) {
  if (given && given!=='auto') return given;
  if (/测试|验证|排查|调试|检查|test|validat|debug|verify|inspect|check/i.test(active)) return 'validation';
  if (/部署|上线|发布|发送|删除|deploy|publish|send|delete|merge/i.test(active)) return 'delivery';
  if (/实现|修改|修复|编写|开发|构建|implement|build|fix|edit|develop/i.test(active)) return 'implementation';
  if (/设计|design/i.test(active)) return 'design';
  return 'discovery';
}
const OUTCOME = {discovery:'获取当前任务缺失的具体资料或项目状态',planning:'取得制定方案所需的具体依据',design:'获得实现所需的设计资料',implementation:'生成或修改当前任务要求的产物',validation:'取得可验证的运行结果或缺陷证据',delivery:'完成用户当前明确要求的交付动作'};
function requestedDelivery(assessment, entry) {
  const name=norm(entry.name);
  const pattern=/send|reply|message/.test(name)?/发送|回复|\bsend\b|\breply\b/i
    : /delete|remove|drop|destroy/.test(name)?/删除|移除|\bdelete\b|\bremove\b|\bdrop\b/i
      : /merge/.test(name)?/合并|\bmerge\b/i
        : /purchase|pay/.test(name)?/购买|付款|支付|\bpurchase\b|\bpay\b/i
          : /部署|上线|发布|\bdeploy\b|\bpublish\b|\brelease\b/i;
  return list(assessment.activeClauses).some(clause=>pattern.test(clause)
    && !/检查|查看|验证|测试|审查|计划|方案|文档|如何|介绍|是否|check|inspect|review|plan|document|how to|status/i.test(clause));
}

/** Produces host execution choices, never calls business tools itself. */
export function adviseCapabilities(assessment, options = {}) {
  const inventory = options.capabilityIndex || discoverCapabilities(options);
  const active = assessment.activeText || '';
  const phase = currentPhase(active, options.phase || options.invocationContext?.phase);
  const queryTerms = new Set(terms(active));
  const normalizedActive=label(active);
  const providerKey=value=>label(String(value||'').split('@')[0]);
  const namedProviders=new Set(inventory.capabilities.filter(e=>e.kind==='plugin'||e.kind==='mcp').flatMap(e=>[e.name,e.displayName,e.plugin]).filter(x=>x&&providerKey(x).length>2&&(`-${normalizedActive}-`).includes(`-${providerKey(x)}-`)).map(providerKey));
  const wantsSearch=/搜索|检索|查找|\bsearch\b|\bfind\b/i.test(active);
  const wantsRead=wantsSearch||/读取|查看|检查|获取|\bread\b|\bget\b|\binspect\b/i.test(active);
  const cards = [];
  for (const entry of inventory.capabilities) {
    if (!entry.enabled) continue;
    if (entry.kind==='mcp' && entry.tools.length) continue; // Tools provide the actionable granularity.
    if(entry.kind==='tool'&&namedProviders.size&&!namedProviders.has(providerKey(entry.plugin))&&!namedProviders.has(providerKey(entry.server))&&![...namedProviders].some(p=>(`-${label(entry.name)}-`).includes(`-${p}-`)))continue;
    // Purpose text carries more signal than cross-tool instructions and examples.
    const purpose=entry.description.split(/\n\s*\n/)[0].slice(0,700);
    if(/^Capture\b/i.test(purpose)&&!/捕获|截图|导入|capture|screenshot|import/i.test(active))continue;
    const haystack = `${entry.name} ${purpose}`;
    const shared = terms(haystack).filter(x=>queryTerms.has(x));
    const identity = unique((entry.kind==='tool'?[entry.name]:[entry.name,entry.plugin,entry.displayName]).filter(Boolean));
    const explicit = identity.some(x=> {
      const escaped=String(x).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      return new RegExp(`(?:\\$|使用\\s*|调用\\s*|用\\s*|use\\s+|invoke\\s+)${escaped}(?=$|[^a-z0-9_-])`,'i').test(active);
    });
    // One generic domain match is insufficient to add tools to an otherwise native task.
    if (!explicit && shared.length<2) continue;
    const brandTerms=new Set(terms(`${entry.plugin||''} ${entry.server||''}`));
    const nonBrand=shared.filter(x=>!brandTerms.has(x));
    if(entry.kind==='tool'&&!explicit&&entry.plugin&&nonBrand.length===0)continue;
    // Reject tool purposes explicitly excluding the requested domain.
    const exclusions=[...entry.description.matchAll(/(?:Do not use (?:this tool )?for|not (?:intended|suitable) for)\s+([^.!\n]+)/gi)].map(x=>x[1]);
    if(!explicit&&exclusions.some(x=>terms(x).some(t=>queryTerms.has(t)&&!brandTerms.has(t))))continue;
    if (/dynamic.skill.router/.test(norm(`${entry.name} ${entry.server}`)) && !/路由|router/i.test(active)) continue;
    const op = entry.kind==='tool' ? operation(entry) : {action:'discover',phase,effect:'unknown'};
    let score = shared.length*4+(explicit?24:0);
    const nameTerms=terms(entry.name.split('__').at(-1));
    score+=nameTerms.filter(x=>queryTerms.has(x)&&!brandTerms.has(x)).length*8;
    if(op.action==='read'&&wantsRead)score+=10;
    if(wantsSearch&&/\bsearch\b/.test(entry.name.replace(/_/g,' ')))score+=24;
    if(wantsSearch&&/\blist\b/.test(entry.name.replace(/_/g,' ')))score+=8;
    // Specialized child resources must be asked for; a brand match is not enough.
    const specialist=['revision','comment','shader','motion','animation','row','range','toolbar','generative','deck','video'];
    if(!explicit&&nameTerms.some(t=>specialist.includes(t)&&!queryTerms.has(t)))continue;
    const needsDelivery = op.phase==='delivery';
    const deliveryRequested = phase==='delivery' && requestedDelivery(assessment,entry);
    let decision = entry.callable && entry.kind==='tool' ? 'use-now' : 'discover-first';
    const gates = ['confirm-task-benefit','inspect-exact-schema-and-inputs','respect-current-user-authorization'];
    if(/must load|read .{0,160}SKILL\.md|skill.*before|before.*skill/i.test(entry.description))gates.push('read-required-skill-before-invocation');
    if (assessment.readOnly && op.effect!=='read') { decision='skip'; gates.push('read-only-scope'); }
    else if (needsDelivery && !deliveryRequested) {decision='defer';gates.push('delivery-not-requested');score-=12;}
    else if (entry.kind==='tool' && op.phase!=='discovery' && op.phase!==phase) {decision='defer';gates.push('different-task-phase');score-=8;}
    else if (entry.kind==='tool' && op.effect!=='read') {decision='check-scope';gates.push('verify-effects-and-authorized-scope');}
    if (!entry.callable) {decision=decision==='skip'?'skip':'discover-first';gates.push('runtime-callability-unverified');}
    if (entry.kind==='plugin') {decision='discover-first';gates.push('select-specific-tool-or-read-relevant-skill');}
    if (op.effect==='high-impact' || op.effect==='external-write') gates.push('check-destination-and-current-action-authorization');
    cards.push({id:entry.id,kind:entry.kind,name:entry.name,plugin:entry.plugin || null,server:entry.server || null,
      description:entry.description.slice(0,240),score,explicit,matchedTerms:shared.slice(0,6),
      availability:{discovered:true,enabled:entry.enabled,callable:entry.callable,evidence:entry.evidence},
      decision,phase:op.phase,when:decision==='defer'?'仅到相应阶段且用户目标需要时再评估':decision==='discover-first'?'先按需发现工具或读取相关技能，确认当前会话可用':`当前 ${phase} 阶段，且缺少其能提供的结果时`,
      expectedBenefit:OUTCOME[op.phase] || OUTCOME[phase],effect:op.effect,gates,
      invocation:{tool:entry.kind==='tool'?entry.name:null,argumentPolicy:'Use the host tool schema and actual task inputs; do not invent parameters.',executor:'host-agent',automaticallyExecuted:false},
      reason:explicit?'用户在当前任务中点名此能力':`任务与能力共有具体信号：${shared.slice(0,4).join('、')}`});
  }
  const order = {'use-now':0,'check-scope':0,'discover-first':1,'defer':2,'skip':3};
  cards.sort((a,b)=>order[a.decision]-order[b.decision] || b.score-a.score || a.id.localeCompare(b.id));
  const candidates = cards.slice(0,Math.min(10, Math.max(1,options.capabilityLimit || 5)));
  return {revision:inventory.revision,coverage:inventory.coverage,errors:inventory.errors,phase,candidates,
    executionPolicy:{executor:'host-agent',advisoryOnly:true,scanExecutesTools:false,
      recheckAt:['initial-task','phase-change','capability-gap','tool-unavailable'],
      skipWhen:['native-tools-sufficient','no-specific-task-benefit','already-have-required-evidence'],
      rule:'Use helpful, currently callable tools within existing authorization. Discovery is not permission; do not ask again for already authorized routine work.'}};
}
