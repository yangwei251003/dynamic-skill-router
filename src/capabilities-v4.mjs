import {validateHostOptions,exactToolConsultations} from './host-context-contract.mjs';
import {invocationConstraints,constrainCapability,prohibitedObjectOperation} from './invocation-constraints.mjs';
import {constrainSearchCapability} from './search-restrictions.mjs';
import {requestSegments,negativeDirective,scheduledReminderRequest,exactToolProhibited,imageObjectRemovalInquiry,imageEditInquiry,imageEditInquiryOnly,imageToolProhibitions,imageToolPurposes,webSearchToolProhibited,webSearchToolPurpose} from './request-evidence.mjs';
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
  const home = options.homeDir || process.env.SKILL_ROUTER_HOME || os.homedir();
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
    // A host runtimeTools entry is a registered handle, not proof of
    // authentication or successful access. A capabilities-only name is weaker.
    const callable=enabled?(named.has(item.name)||item.available===true?true:null):false;
    const declaredAvailable=typeof item.available==='boolean'?item.available:null;
    const entry = {id:`tool:${item.name}`,kind:'tool',name:item.name,server,plugin:plugin?.plugin || item.plugin || null,
      description:text(item.description),configured:false,enabled,callable,declaredAvailable,evidence:callable===true?'runtime-tool':enabled?'runtime-capability-name-only':'runtime-tool-disabled',annotations};
    entries.set(entry.id,entry);
    if (plugin) { plugin.tools.push(entry.name); plugin.callable ||= callable===true; }
    if (server) {
      const serverId=`mcp:${server}`;
      const group = serverEntry || entries.get(serverId) || {id:serverId,kind:'mcp',name:server,description:'',plugin:null,configured:false,enabled:true,callable:false,evidence:'runtime-tool',tools:[]};
      group.tools.push(entry.name); group.callable ||= callable===true; if (callable===true) group.evidence='runtime-tool'; entries.set(serverId,group);
    }
  }
  const capabilities = [...entries.values()].map(e=>({...e,...(e.tools ? {tools:unique(e.tools)} : {})}));
  return {revision:hash(capabilities),capabilities,errors,coverage:{plugins:capabilities.filter(x=>x.kind==='plugin').length,
    mcpServers:capabilities.filter(x=>x.kind==='mcp').length,tools:capabilities.filter(x=>x.kind==='tool').length,
    callableTools:capabilities.filter(x=>x.kind==='tool'&&x.callable).length,
    runtimeProvided:Array.isArray(options.runtimeTools)||Array.isArray(options.runtimeCapabilities?.tools),
    hostConfigScanned:codex || Boolean(options.configPath),authority:'Current host metadata only; never inferred from installed files.'}};
}

const STOP = new Set('the a an to of in on for and or with by from is are it its this that these those use using tool tools mcp plugin plugins api server get list create update read write run execute return returns task tasks help useful available function request user support supports provides access part'.split(' '));
const SINGULAR_S_WORDS = new Set('canvas alias atlas bias gas chaos cosmos ethos pathos lens news series species'.split(' '));
const segmenter = new Intl.Segmenter('zh',{granularity:'word'});
function terms(value) {
  const source = norm(value).replace(/https?:\/\/\S+/g,' ');
  const result = (source.match(/[a-z][a-z0-9]+/g)||[]).filter(x=>!STOP.has(x)).map(x=>/(?:ss|us|is)$/.test(x)||SINGULAR_S_WORDS.has(x)?x:x.replace(/(ing|s)$/,'')).filter(x=>!STOP.has(x));
  for (const part of segmenter.segment(source)) if (/\p{Script=Han}/u.test(part.segment) && part.segment.length>=2) result.push(part.segment);
  const bridges = [
    [/数据库|postgres|sql|database/,['database']], [/原理图|电路|pcb|easyeda|schematic/,['circuit']],
    [/浏览器|browser|playwright/,['browser']], [/网页|网站|前端|frontend|website/,['frontend']],
    [/设计稿|figma|design file/,['figma']], [/设计稿|设计|design/,['design']], [/代码库|仓库|repository|github/,['repository']],
    [/文档|documentation|docs/,['documentation']], [/文档|document|file/,['document']], [/搜索|检索|查找|search/,['search']],
    [/测试|test|验证|verify|validation/,['test']], [/部署|上线|发布|deploy|publish/,['deploy']],
    [/幻灯片|演示文稿|slides|presentation/,['slides']], [/表格|spreadsheet|excel/,['spreadsheet']],
    [/邮件|email|mail/,['email']], [/日历|calendar/,['calendar']], [/图像|图片|照片|插画|海报|image|photo|illustration|poster/,['image']],
    [/家长控制|parental controls?/,['parental','control']], [/家庭设置|family settings?/,['family','setting']],
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
  if (/\b(search|find|fetch|get|list|read|view|browse|lookup|resolve|open|status|windows)\b/.test(name) || entry.annotations?.readOnlyHint===true) return {action:'read',phase:'discovery',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'};
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

// These narrow action/object bridges complement lexical matching. They only
// supply reasons to inspect a currently registered tool; they never execute it
// or infer permissions from a description. Evaluate independent clauses so that
// "make slides and search for pictures" is not image-generation intent.
const PICTURE=/(?:图片|图像|照片|插画|插图|海报|画像|漫画|图画|截图|图标|(?:这|那)(?:张|幅)图|\b(?:images?|screenshots?|photos?|photographs?|pictures?|illustrations?|posters?|portraits?|comics?|icons?)\b|\b[\w.-]+\.(?:png|jpe?g|webp|gif|bmp)\b)/i;
const splitIntentClauses=assessment=>list(assessment.activeClauses).flatMap(c=>c.split(/(?:并且|然后|同时|以及|并|\band then\b|\band\b)/i)).map(x=>x.trim()).filter(Boolean);
const ARTIFACT_ACTION=/(?:修改|编辑|修复|添加|插入|更新|开发|搭建|实现|优化|维护|排版|\b(?:update|edit|fix|repair|modify|add|insert|build|develop)\b)/i;
const ARTIFACT_TYPES=[
  {kind:'artifact-edit:web',request:/网页|网站|前端|\b(?:website|webpage|web page|frontend)\b/i,purpose:/网页|网站|前端|\b(?:website|webpage|web pages?|frontend)\b/i},
  {kind:'artifact-edit:design',request:/设计稿|figma|design file/i,purpose:/设计稿|figma|design file/i},
  {kind:'artifact-edit:document',request:/文档|报告|\b(?:document|report)\b/i,purpose:/文档|报告|\b(?:document|report)\b/i},
  {kind:'artifact-edit:slides',request:/幻灯片|演示文稿|\bpptx?\b|\b(?:slides?|presentation)\b/i,purpose:/幻灯片|演示文稿|\bpptx?\b|\b(?:slides?|presentation)\b/i},
  {kind:'artifact-edit:spreadsheet',request:/表格|电子表格|\b(?:spreadsheet|excel)\b/i,purpose:/表格|电子表格|\b(?:spreadsheet|excel)\b/i},
  {kind:'artifact-edit:bound-canvas',request:/(?:已绑定|绑定的|绑定至).{0,10}(?:白板|画布)|\bbound\s+(?:canvas|whiteboard)\b|\bartifactref\b/i,purpose:/\bbound\s+canvas\b/i},
  {kind:'artifact-edit:code',request:/代码|源码|代码库|配置文件|\b(?:source code|codebase|source files?|repository)\b/i,purpose:/代码|源码|代码库|配置文件|\b(?:source code|codebase|source files?|repository)\b/i},
];
function semanticNeeds(assessment) {
  const clauses=splitIntentClauses(assessment);
  const needs=[];
  // A TeX task is identified by an actionable compile/create verb and a
  // document/project target in the same original instruction clause. The
  // result is only a reason to inspect a tool: it does not establish a local
  // project, its main file, or authorization to alter existing files.
  // The common task parser may trim a trailing "later" after preserving the
  // words before it. Consult the masked original to keep that future action
  // from becoming a present recommendation. This only removes a candidate;
  // it never derives authorization from quoted or supplied material.
  const rawLatexFragments=typeof assessment.rawText==='string'
    ? requestSegments(assessment.rawText,{preserveNames:false}).text.split(/[。！？!?;；，,\n]+|(?<!\d)\.(?=\s+\S)/u)
      .flatMap(raw=>raw.split(/(?:但是|并且|然后|同时|以及|但|并|\band then\b|\band\b|\bbut\b)/i))
    :[];
  const latexClauses=list(assessment.activeClauses).flatMap(raw=>{
    const parts=String(raw).split(/(?:但是|并且|然后|同时|以及|但|并|\band then\b|\band\b|\bbut\b)/i);
    return parts.map((part,index)=>({part,previous:index>0?parts[index-1]:''}));
  });
  for(const {part,previous} of latexClauses) {
    const current=part.trim();
    const originals=rawLatexFragments.filter(raw=>raw.trim().toLowerCase().startsWith(current.toLowerCase())&&current.length>0);
    if(originals.length&&originals.every(raw=>/^\s*(?:later(?:\s+on)?|in\s+the\s+future|eventually|以后|下次|将来|日后|稍后)\s*[.!?。！？]*\s*$/iu.test(raw.trim().slice(current.length))))continue;
    if(/^(?:(?:请|帮我|请你|麻烦|please)\s*)*(?:解释|介绍|讲解|说明|讨论|比较|如何|怎么|是否|下次|以后|将来|未来|日后|explain\b|describe\b|how\b|whether\b|later\b|in future\b)/i.test(current))continue;
    // "compile ... next week" is a deferred operation; "compile ... by next
    // week" is a current request with a deadline and must remain actionable.
    if(/\b(?:compile|build)\b.{0,80}\b(?:next\s+(?:week|month|year)|tomorrow)\b/i.test(current)
        && !/\b(?:by|before|no\s+later\s+than)\s+(?:next\s+(?:week|month|year)|tomorrow)\b/i.test(current))continue;
    if(/(?:了解|学习|请教|告诉我|说明|解释|介绍|讨论|研究|比较|如何|怎么|是否).{0,20}(?:编译|构建|compile|build)/i.test(current))continue;
    // Building a compiler's own source is different from using a compiler to
    // build a TeX document. Mention of "编译器" alone must not suppress the
    // latter, but an explicit request to build the engine itself remains out.
    if(/(?:编译|构建)\s*(?:(?:latex|tex)\s*)?(?:编译器|引擎)(?:本身|源代码|源码|软件)?|\b(?:compile|build)\s+(?:(?:the|a|an)\s+)?(?:latex|tex)\s+(?:compiler|engine|distribution|software)\b/i.test(current))continue;
    const direct=current
      .replace(/(?:不要|不得|禁止|不能|请勿|不允许|不可以|不必|无需|无须|不用|不需要|暂不|先不|别|避免|停止|不)\s*(?:(?:再|先|实际|直接|自行|擅自|去|执行|进行|运行)\s*){0,4}(?:编译(?!器)|构建|新建|创建|建立|生成)/gu,' ')
      .replace(/\b(?:do not|don't|never|without|no need to|avoid|not yet)\s+(?:(?:actually|directly|run|running)\s+){0,3}(?:compile|build|create|make|start|initialize)\b/gi,' ')
      .replace(/(?:查看|读取|阅读|分析|解释|总结|展示)\s*(?:已有|现有|上次|此前|之前)(?:的)?\s*(?:(?:latex|tex)\s*)?(?:编译|构建)(?:日志|结果|错误|报错|记录)/giu,' ')
      .replace(/(?:已有|现有|上次|此前|之前|历史|保存的?)\s*(?:的)?\s*(?:(?:latex|tex)\s*)?(?:编译|构建)\s*(?:日志|结果|错误|报错|记录)/giu,' ')
      .replace(/(?:已有|现有|上次|此前|之前|历史|保存的?)\s*(?:的)?\s*(?:latex|tex)\s*(?:项目|工程|文档|文件|文稿|稿件)\s*(?:的)?\s*(?:编译|构建)\s*(?:日志|结果|错误|报错|记录)/giu,' ')
      .replace(/\b(?:read|view|inspect|explain|summari[sz]e)\s+(?:(?:the|an?|existing|previous|prior|saved)\s+){0,4}(?:(?:latex|tex)\s+)?(?:compilation|compile|build)\s+(?:logs?|results?|errors?|output)\b/gi,' ')
      .replace(/\b(?:existing|previous|prior|saved)\s+(?:(?:latex|tex)\s+)?(?:compilation|compile|build)\s+(?:logs?|results?|errors?|output)\b/gi,' ');
    const explicitTarget=/(?:\b(?:latex|tex)\b|\.tex\b)/i.test(direct);
    const previousTarget=/(?:\b(?:latex|tex)\b|\.tex\b)/i.test(previous);
    // Only two narrow anaphora are inherited from the immediately preceding
    // fragment of the same clause: inspect a named TeX file and request its
    // compile errors, or compile "the/this project" just explicitly created.
    const diagnosticOfPrevious=previousTarget
      &&/(?:检查|查看|检视|inspect|check)/i.test(previous)
      &&/^(?:请|再|给出|提供|输出|报告|列出|检查|查看|show|report|provide|check|inspect|the|its|and|\s)*(?:的)?\s*(?:编译|compilation|compile)\s*(?:错误|报错|诊断|日志|问题|errors?|diagnostics?|logs?|issues?)/i.test(direct);
    const compilePrevious=previousTarget
      &&/(?:新建|创建|建立|初始化|\b(?:create|make|initialize)\b)/i.test(previous)
      &&/^(?:(?:请|再|然后|接着|please|then)\s*)*(?:编译|compile)\s*(?:(?:该|这个|此|其|刚才的?)\s*(?:项目|工程|文档|文件)|(?:the|this|same)\s+(?:project|document|file)\b)/i.test(direct);
    if(!explicitTarget&&!diagnosticOfPrevious&&!compilePrevious)continue;
    if(/(?:编译(?!器)|构建|\b(?:compil(?:e|es|ed|ing)|build(?:s|ing)?)\b)/i.test(direct))needs.push({kind:'latex-compile',clause:current});
    // Require the project itself to be the creation target. Creating a file,
    // image folder or report inside an existing LaTeX project is not the same
    // operation, even though the same three generic words are present.
    const createProject=/(?:新建|创建|建立|初始化)\s*(?:(?:一个|一份|新的?|本地|空白|的)\s*){0,5}(?:latex|tex)\s*(?:的\s*)?(?:项目|工程)(?!中|内|里|下|的)/i.test(direct)
      ||/(?:latex|tex)\s*(?:项目|工程)\s*(?:请|需|需要|可以|可)?\s*(?:新建|创建|建立|初始化)/i.test(direct)
      ||/(?:latex|tex)\s*(?:来|以|去|用于)?\s*(?:新建|创建|建立|初始化)\s*(?:(?:一个|一份|新的?|本地|空白|的|论文|文档)\s*){0,5}(?:项目|工程)(?!中|内|里|下|的)/i.test(direct)
      ||/\b(?:create|make|start|initialize)\s+(?:(?:a|an|new|local|empty)\s+){0,5}(?:latex|tex)\s+(?:projects?|workspace)\b(?!\s+(?:folder|subdirectory|files?|assets?)\b)/i.test(direct)
      ||/\b(?:latex|tex)\s+(?:to\s+)?(?:create|make|initialize)\s+(?:(?:a|an|new|local|empty)\s+){0,5}(?:projects?|workspace)\b/i.test(direct);
    if(createProject)needs.push({kind:'latex-create-project',clause:current});
    // This host's project-creation tool also supports a new standalone TeX
    // document, but it creates a dedicated project directory; the host must
    // honor the requested file path and must not use it to insert a file into
    // an existing project implicitly.
    const existingProject=/(?:已有|现有|既有|原有|已存在|existing|current).{0,24}(?:latex|tex).{0,16}(?:项目|工程|projects?|workspace)|(?:latex|tex).{0,16}(?:已有|现有|既有|原有|已存在|existing|current).{0,16}(?:项目|工程|projects?|workspace)/i.test(direct);
    const createDocument=/(?:新建|创建|建立|初始化)\s*(?:(?:一个|一份|一篇|新的?|本地|空白|的)\s*){0,5}(?:latex|tex)\s*(?:的\s*)?(?:文档|文稿|稿件|文件(?!夹))(?!中|内|里|下|的)/i.test(direct)
      ||/\b(?:create|make|start|initialize)\s+(?:(?:a|an|new|fresh|local|empty)\s+){0,5}(?:latex|tex)\s+(?:files?|documents?|reports?)\b(?!\s+(?:folder|subdirectory|assets?)\b)/i.test(direct);
    if(createDocument&&!existingProject)needs.push({kind:'latex-create-document',clause:current});
  }
  for(const clause of clauses) {
    const info=/^(?:(?:请|帮我|请你|麻烦|please)\s*)*(?:解释|介绍|讲解|说明|比较|举例|(?:给(?:我|出)?|提供|列举).{0,20}(?:例子|示例|实例|样例)|什么是|如何|怎么|explain\b|describe\b|(?:give|show)\b.{0,25}\bexamples?\b|what is\b|how (?:to|does|do)\b)/i.test(clause);
    const future=/^(?:(?:请|帮我|please)\s*)*(?:以后|将来|未来|下次|日后|后续|下一步|later\b|eventually\b|in future\b)/i.test(clause);
    const imageClause=clause.replace(/(?:不要|不得|禁止|不能|请勿|不必|无需|无须|不需要|别|不)\s*(?:实际|直接|主动|自行|擅自|再|去)?\s*(?:生成|绘制|画出|制作|创作|编辑|修改|修复|虚化|模糊|透明化|移除|去除|去掉|删掉|删除|擦除|抹去|抹掉)/g,'')
      .replace(/\b(?:do not|don't|never|without)\s+(?:actually\s+|directly\s+)?(?:generate|create|draw|make|render|edit|modify|retouch|blur|soften|defocus|remove|erase|delete)\b/gi,'');
    const picture=PICTURE.test(imageClause);
    if(picture) {
      const source=/(?:附件|附图|上传的?|所附|\b(?:attached|attachment|uploaded)\b)/i.test(clause)?'attachment'
        :/(?:刚发|刚才发|刚刚发|刚发送|\bjust sent\b)/i.test(clause)?'conversation-image'
        :/(?:本地|文件|磁盘|\b(?:local|filesystem|file)\b|[a-z]:[\\/])/i.test(clause)?'local'
          :/https?:\/\//i.test(clause)?'url':'unspecified';
      const actualInput=source!=='unspecified'||/(?:这张|这幅|该图片|给定|提供的|\b(?:this|that|provided|supplied|existing)\b)/i.test(clause);
      const createVerb='(?:生成|绘制|画出|画一|画个|制作|创作|设计(?!稿)|生成一|\\b(?:generate|create|draw|make|render)\\b)';
      const nonIconCreate=new RegExp(createVerb+'.{0,28}(?:图片|图像|照片|插画|插图|海报|画像|漫画|图画|\\b(?:image|photo|picture|illustration|poster|portrait|comic)\\b)','i').test(imageClause);
      const iconCreate=new RegExp(createVerb+'.{0,28}(?:图标|\\bicons?\\b)','i').test(imageClause);
      const create=nonIconCreate||iconCreate;
      const explicitIconAsset=/(?:png|jpe?g|webp|位图|图片|素材).{0,16}(?:图标|\bicons?\b)|(?:图标|\bicons?\b).{0,12}\.(?:png|jpe?g|webp)\b/i.test(imageClause);
      const iconCodeOnly=!explicitIconAsset&&(/(?:图标|\bicons?\b).{0,24}(?:组件|代码|源码|纯\s*(?:css|svg)|\b(?:component|code|source)\b)|(?:图标组件|icon\s+component)/i.test(imageClause)
        ||/(?:react|css|svg).{0,20}(?:代码|源码|组件|\b(?:code|component)\b).{0,24}(?:生成|绘制|画|制作|\b(?:generate|create|draw|render)\b).{0,24}(?:图标|\bicons?\b)/i.test(imageClause));
      const visualCodeOnly=/(?:图片|图像|插画|插图)(?:的)?(?:组件|代码|源码)|\b(?:image|illustration|picture)\s+(?:component|code)\b|\b(?:image|illustration|picture)\s+as\s+(?:an?\s+)?(?:react\s+)?component\b/i.test(imageClause);
      const edit=/(?:修改|编辑|调整|替换|美化|抠图|去背景|更换|修复|虚化|模糊|透明化)(?:(?:一下|这张|这幅|那张|那幅|这些|该|现有的?|原有的?|已有的?|我上传的?|上传的?|给定的|提供的|产品)){0,5}(?:图片|图像|照片|插画|插图|海报|截图|图标|图)|(?:图片|图像|照片|插画|插图|海报|截图|图标|(?:这|那)(?:张|幅)图)(?:(?:的?(?:背景|颜色|内容|细节|风格|元素)|的)|进行|做|整体)?(?:修改|编辑|调整|替换|美化|抠图|去背景|更换|修复|改成|改为|变成|变为|换成|换为|变透明|透明化|虚化|模糊)/i.test(imageClause)
        ||imageAction(imageClause,'(?:edit|modify|retouch|alter|change|replace)','(?:editing|modification|retouching)')
        ||/\b(?:edit|modify|retouch|alter|change)\b.{0,28}\bicons?\b/i.test(imageClause)
        ||/(?:去除|去掉|移除|抠除|更换|删除|虚化|模糊|\b(?:remove|erase|replace|blur|soften|defocus)\b).{0,28}(?:背景|background).{0,35}(?:图片|图像|照片|图标|\b(?:image|photo|photograph|picture|icon)\b)|(?:图片|图像|照片|图标|\b(?:image|photo|photograph|picture|icon)\b).{0,28}(?:背景|background).{0,20}(?:去除|去掉|移除|抠除|更换|删除|虚化|模糊|\b(?:remove|erase|replace|blur|soften|defocus)\b)|(?:去除|去掉|移除|抠除|更换|删除|虚化|模糊|\b(?:remove|erase|replace|blur|soften|defocus)\b).{0,28}(?:图片|图像|照片|图标|\b(?:image|photo|photograph|picture|icon)\b).{0,16}(?:背景|background)/i.test(imageClause);
      // “查看照片背景虚化程度” describes an existing image; it is not a
      // request to apply the same background effect.
      const backgroundDiscussion=/^(?:(?:请|帮我|请你|麻烦|please)\s*)*(?:查看|阅读|观察|描述|分析|判断|评估|解释|说明|比较|\b(?:view|inspect|describe|analy[sz]e|explain|compare)\b).{0,80}(?:背景|background).{0,30}(?:程度|效果|状态|原因|含义|\b(?:effect|appearance|degree)\b)/i.test(imageClause);
      // An object removed from inside a picture is an edit, not deletion of
      // the picture file or a request to change its metadata.
      const objectRemoval=!/(?:元数据|文件名|文件本身|\b(?:metadata|exif|filename)\b)/i.test(imageClause)
        && (/(?:图片|图像|照片|插画|截图)(?:中|里|内|上)(?:的)?(?:(?:移除|去除|去掉|删除|删掉|擦除|抹去|抹掉)[^，。；;！？!?]{1,20}|[^，。；;！？!?]{1,20}?(?:移除|去除|去掉|删除|删掉|擦除|抹去|抹掉))/i.test(imageClause)
          ||/(?:移除|去除|去掉|删除|删掉|擦除|抹去|抹掉).{0,16}(?:图片|图像|照片|插画|截图)(?:中|里|内|上)(?:的)?[^，。；;！？!?]{1,20}/i.test(imageClause)
          ||/\b(?:remove|erase)\b.{1,45}\bfrom\s+(?:(?:the|a|an|attached|uploaded|provided|existing|original)\s+){0,6}(?:images?|photos?|photographs?|pictures?)\b/i.test(imageClause));
      const removalDiscussion=/^(?:(?:请|帮我|请你|麻烦|please)\s*)*(?:查看|阅读|观察|描述|分析|判断|评估|解释|说明|比较|\b(?:view|inspect|describe|analy[sz]e|explain|compare)\b).{0,80}(?:移除|去除|去掉|删除|删掉|擦除|抹去|\b(?:remove|erase)\b).{0,30}(?:程度|效果|状态|原因|含义|\b(?:effect|appearance|degree)\b)/i.test(imageClause);
      const removalInquiry=imageObjectRemovalInquiry(imageClause),editInquiry=imageEditInquiry(imageClause);
      const read=/(?:查看|阅读|读取|观察|识别|检查|看一下|解释|描述|分析|\b(?:view|read|inspect|examine|describe|analy[sz]e|interpret|look at)\b)/i.test(clause);
      if(!info&&create&&((nonIconCreate&&!visualCodeOnly)||(iconCreate&&!iconCodeOnly)))needs.push({kind:'image-create',clause,source});
      if(!info&&(edit||objectRemoval)&&!backgroundDiscussion&&!removalDiscussion&&!removalInquiry&&!editInquiry&&!iconCodeOnly)needs.push({kind:'image-edit',clause,source});
      if(read&&!create&&(!(edit||objectRemoval)||backgroundDiscussion||removalDiscussion||removalInquiry||editInquiry)&&(!info||actualInput))needs.push({kind:'image-read',clause,source});
      if(!info&&/(?:搜索|检索|查找|寻找|找|\b(?:search|find|look for)\b)/i.test(clause))needs.push({kind:'image-search',clause,source});
    }
    if(!info&&ARTIFACT_ACTION.test(clause))for(const item of ARTIFACT_TYPES)if(item.request.test(clause))needs.push({kind:item.kind,clause});
    // Keep explicit negative web actions from becoming affirmative needs, even
    // when the higher-level clause filter retained a short “不打开” phrase.
    const webClause=clause.replace(/(?:不要|不得|禁止|不能|请勿|不必|无需|无须|不需要|别|不)\s*(?:再|主动|直接|自行|实际|擅自|去)?\s*(?:打开|访问|读取|阅读|浏览|查看|读出|搜索|检索|查找|查询|核验|核对|核实|查证)/g,'');
    const directSearch=/(?:联网|上网|网上|在线|网络|网页|网站|官网|官方|internet|online|web|official|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b)/i.test(webClause)&&/(?:搜索|检索|查找|查询|核验|核对|核实|查证|查|\b(?:search|find|verify|research|look up|check)\b)/i.test(webClause);
    // A request to look up a current stock price needs a source even when the
    // user does not explicitly say "online". Do not infer that need from a
    // historical, explanatory, offline or supplied-sources-only discussion.
    const currentQuote=!info && /(?:股价|股票(?:的)?价格|\b(?:stock|share)\s+(?:prices?|quotes?)\b)/i.test(webClause)
      && /(?:现在|当前|目前|今天|今日|最新|实时|\b(?:now|today|current|latest|live|real[ -]?time)\b)/i.test(webClause)
      && /(?:查询|查看|查找|搜索|检索|获取|查|多少|\b(?:find|look up|check|fetch|get|what is)\b)/i.test(webClause)
      && !assessment.inferredConstraints?.networkForbidden && assessment.inferredConstraints?.sourceScope!=='provided-only';
    const recentFinance=!info && /(?:财报|季报|年报|财务报告|季度业绩|(?:股票|证券|股市).{0,12}(?:新闻|消息|资讯)|(?:新闻|消息|资讯).{0,12}(?:股票|证券|股市)|\b(?:stock|share|equity)\s+news\b|\b(?:earnings|financial)\s+(?:reports?|statements?)\b)/i.test(webClause)
      && /(?:最近|近期|最新|近来|刚发布|本季|上季|\b(?:recent|latest|current|last\s+quarter)\b)/i.test(webClause)
      && /(?:查询|查找|搜索|检索|获取|搜集|查|\b(?:find|search|look up|check|fetch|get)\b)/i.test(webClause)
      && !assessment.inferredConstraints?.networkForbidden && assessment.inferredConstraints?.sourceScope!=='provided-only';
    const recentMonetary=!info && /(?:(?:央行|中央银行|美联储).{0,12}(?:利率|降息|加息|决议|政策)|(?:利率|降息|加息).{0,12}(?:央行|中央银行|美联储)|货币政策|\b(?:central bank|federal reserve)\b.{0,20}\b(?:rates?|monetary policy)\b)/i.test(webClause)
      && /(?:最近|近期|最新|当前|今天|今日|本周|上周|\b(?:recent|latest|current|today|this week|last week)\b)/i.test(webClause)
      && /(?:查询|查找|搜索|检索|核验|核对|核实|查证|查|\b(?:find|search|look up|check|verify)\b)/i.test(webClause)
      && !assessment.inferredConstraints?.networkForbidden && assessment.inferredConstraints?.sourceScope!=='provided-only';
    const search=directSearch||currentQuote||recentFinance||recentMonetary;
    const open=/(?:阅读|读取|浏览|打开|查看|访问|\b(?:read|open|browse|visit|fetch)\b).{0,45}(?:网页|网址|网站|链接|页面|https?:\/\/|\b(?:page|url|link|website)\b)/i.test(webClause)
      ||(!info&&/(?:网页|网址|网站|链接|页面|\b(?:page|url|link|website)\b|https?:\/\/[^\s<>"，。！？、；）)]+).{0,45}(?:阅读|读取|读出|浏览|打开|查看|访问|\b(?:read|open|browse|visit|fetch)\b)/i.test(webClause));
    if(search)needs.push({kind:'web-search',clause});
    if(open)needs.push({kind:'web-open',clause});
    // A literature request needs an actual search action; merely mentioning a
    // paper or asking for an explanation does not authorize remote retrieval.
    const academicTarget=/(?:论文|文献|期刊文章|学术文章|学术研究|\b(?:papers?|scholarly articles?|scientific literature)\b)/i.test(webClause);
    const academicAction=/(?:搜索|检索|查找|寻找|查询|搜集|收集|查阅|搜|找|\b(?:search|find|look for|look up|retrieve)\b)/i.test(webClause);
    if(!info&&academicTarget&&academicAction&&!assessment.inferredConstraints?.networkForbidden
        &&assessment.inferredConstraints?.sourceScope!=='provided-only')needs.push({kind:'academic-search',clause});
    // Reading passages of one identified paper is distinct from searching for
    // papers. The identifier and question are still checked by the host, and
    // a tool description cannot establish indexed full-text availability.
    const paperId=/(?:\bdoi\s*:?\s*)?\b10\.\d{4,9}\/[\w.();:/-]+|\b(?:arxiv|pmid|pmcid)\s*:\s*[\w.-]+/i.test(webClause);
    const paperRead=/(?:读取|阅读|查看|提取|读出|\b(?:read|retrieve|fetch|extract)\b)/i.test(webClause);
    const paperBody=/(?:正文|全文|文中|段落|章节|\b(?:full[ -]?text|in[ -]?body|passages?|sections?|methods?)\b)/i.test(webClause);
    if(!info&&!future&&academicTarget&&paperId&&paperRead&&paperBody&&!assessment.inferredConstraints?.networkForbidden
        &&assessment.inferredConstraints?.sourceScope!=='provided-only')needs.push({kind:'academic-read',clause});
    // Schedule a reminder only when an action and timing/recurrence are both
    // requested. Merely discussing reminders is not a scheduling request.
    if(!info&&scheduledReminderRequest(clause))needs.push({kind:'scheduled-reminder',clause});
    // Managing an existing scheduled reminder does not need a new recurrence
    // specification. Bind the operation to an existing reminder and do not
    // interpret explanations or hypothetical decisions as authorization.
    const existingReminder=/(?:现有|已有|原有|已经设置|已设置|之前设置|以前设置|这条|该条|这项|该项|\b(?:existing|current|previously set|this|that)\b).{0,25}(?:提醒|定时任务|自动化|\b(?:reminders?|scheduled tasks?|automations?)\b)|(?:提醒|定时任务|自动化|\b(?:reminders?|scheduled tasks?|automations?)\b).{0,18}(?:现有|已有|原有|已经设置|已设置|\b(?:existing|current)\b)/i.test(clause);
    const manageInquiry=/(?:是否|要不要|需不需要|如何|怎么|办法|方案|\b(?:whether|how to|should i|should we)\b)/i.test(clause);
    const deleteReminder=/(?:取消|删除|移除|\b(?:cancel|delete|remove)\b)/i.test(clause);
    const updateReminder=/(?:修改|更改|调整|更新|改为|改成|改到|变更|暂停|停用|恢复|启用|静音|\b(?:update|edit|change|reschedule|pause|resume|mute)\b)/i.test(clause);
    if(!info&&!future&&!manageInquiry&&existingReminder&&(deleteReminder||updateReminder))
      needs.push({kind:'reminder-manage',clause,action:deleteReminder?'delete':'update'});
  }
  return needs;
}
// Descriptions can start with a namespace heading. Skip that container label,
// but do not mine later instructions, examples or unrelated schema as purpose.
function purposeText(description) {
  const paragraphs=String(description||'').replace(/\r\n/g,'\n').split(/\n\s*\n/);
  for(let paragraph of paragraphs) {
    paragraph=paragraph.trim().replace(/^#{1,6}\s*/,'');
    if(!paragraph||/^(?:tools?\s+in\s+(?:the\s+)?[\w.-]+\s+namespace|[\w.-]+\s+namespace|[-_=]+)\.?$/i.test(paragraph))continue;
    if(/^(?:guidelines|examples|usage hints|exec tool declaration|```)/i.test(paragraph))break;
    return paragraph.slice(0,700);
  }
  return '';
}
const IMAGE_OBJECT='(?:images?|photos?|photographs?|pictures?|illustrations?|posters?|portraits?|comics?)';
const IMAGE_QUALIFIERS='(?:(?:a|an|the|of|this|that|existing|attached|uploaded|provided|supplied|local|source|reference|input|original|new|standalone|raster|bitmap|digital|product|selected|user-provided)\\s+){0,6}';
function imageAction(purpose,verb,nounAction) {
  // Bind the operation to its object, not two words in unrelated sentences.
  return new RegExp(`\\b${verb}\\b\\s+${IMAGE_QUALIFIERS}${IMAGE_OBJECT}\\b|\\b${IMAGE_OBJECT}\\s+${nounAction}\\b`,'i').test(purpose);
}
function latexToolPurposes(purpose) {
  // Later descriptions may mention another tool as a prerequisite/example;
  // only the lead sentence establishes this tool's own TeX purpose.
  const first=String(purpose||'').split(/(?<=[.!?。！？])\s+/u)[0];
  const target=/(?:\b(?:latex|tex)\b|\.tex\b)/i.test(first);
  const document=/(?:文档|文件|项目|工程|\b(?:documents?|files?|projects?|workspace)\b)/i.test(first);
  const create=target&&document&&/^(?:(?:this\s+(?:tool|function)\s+(?:can\s+|will\s+)?|use\s+(?:this\s+)?tool\s+to\s+)|(?:(?:此|该)工具)?(?:用于|可以|可)?)\s*(?:创建|新建|建立|(?:create|creates|creating|initialize)\b)/i.test(first)&&/(?:项目|工程|\b(?:projects?|workspace)\b)/i.test(first);
  return {
    compile:target&&document&&/^(?:(?:this\s+(?:tool|function)\s+(?:can\s+|will\s+)?|use\s+(?:this\s+)?tool\s+to\s+)|(?:(?:此|该)工具)?(?:用于|可以|可)?)\s*(?:编译|compil(?:e|es|ed|ing)\b)/i.test(first),
    create,
    // A project creator is recommended for a new document only when its own
    // description explicitly advertises this use, as the host tool does.
    createDocument:create&&/\bnew\s+(?:latex|tex)\s+(?:files?|documents?)\b/i.test(purpose),
  };
}
function semanticMatches(entry,needs) {
  if(!['tool','plugin','mcp'].includes(entry.kind))return [];
  // For generic multi-operation web tools inspect named operation examples too.
  const purpose=purposeText(entry.description);
  const full=String(entry.description||'').slice(0,1600);
  const imagePurpose=imageToolPurposes(entry.description);
  const make=imagePurpose.create,edit=imagePurpose.edit;
  const read=imageAction(purpose,'(?:view(?:s|ed|ing)?|read(?:s|ing)?|inspect(?:s|ed|ing)?|examine(?:s|d)?|analy[sz](?:e|es|ed|ing)|recogniz(?:e|es|ed|ing))','(?:viewing|inspection|analysis)')||/(?:查看|读取|识别|分析)(?:本地的?|已有的?|指定的|上传的)?(?:图片|图像|照片)/.test(purpose);
  const searchImages=imageAction(purpose,'(?:search(?:es|ed|ing)?|find(?:s|ing)?)','(?:search|retrieval)')||/(?:搜索|检索|查找)(?:网络|在线|网页)?(?:图片|图像|照片|插画)/.test(purpose);
  const web=/\b(?:internet|web|online|browser|website)\b/i.test(purpose);
  const academic=/(?:论文|文献|\b(?:papers?|scholarly articles?|scientific literature)\b)/i.test(purpose)
    &&/(?:搜索|检索|查找|查询|\b(?:search(?:es)?|find(?:s)?|discover(?:s)?)\b)/i.test(purpose);
  const academicRead=/(?:论文|文献|\b(?:papers?|scholarly articles?)\b)/i.test(purpose)
    &&/(?:正文|全文|段落|\b(?:in[ -]?body|full[ -]?text|passages?)\b)/i.test(purpose)
    &&/(?:读取|阅读|提取|\b(?:retrieve|read|fetch|extract)\b)/i.test(purpose);
  const reminder=/(?:提醒|定时任务|自动化|\b(?:reminders?|scheduled tasks?|recurring automations?)\b)/i.test(purpose)
    &&/(?:创建|设置|管理|更新|\b(?:create|update|manage|schedule)\b)/i.test(purpose);
  const reminderUpdate=/(?:更新|修改|调整|管理|\b(?:update|edit|change|manage)\b)/i.test(purpose);
  const reminderDelete=/(?:删除|取消|移除|管理|\b(?:delete|remove|cancel|manage)\b)/i.test(purpose);
  const latex=latexToolPurposes(purpose);
  const artifactAction=/(?:修改|编辑|修复|添加|插入|更新|开发|搭建|实现|优化|维护|排版|\b(?:updat(?:e|es|ed|ing)|edit(?:s|ed|ing)?|fix(?:es|ed|ing)?|repair(?:s|ed|ing)?|modif(?:y|ies|ied|ying)|add(?:s|ed|ing)?|insert(?:s|ed|ing)?|build(?:s|ing)?|develop(?:s|ed|ing)?)\b)/i.exec(purpose);
  return needs.filter(need=>
    (need.kind==='image-create'&&make)||
    (need.kind==='image-edit'&&edit)||
    (need.kind==='image-read'&&read)||
    (need.kind==='image-search'&&(searchImages||(web&&/\bimage_query\b/i.test(full))))||
    (need.kind==='academic-search'&&academic)||
    (need.kind==='academic-read'&&academicRead)||
    (need.kind==='scheduled-reminder'&&reminder)||
    (need.kind==='reminder-manage'&&reminder&&(need.action==='delete'?reminderDelete:reminderUpdate))||
    (need.kind==='latex-compile'&&latex.compile)||
    (need.kind==='latex-create-project'&&latex.create)||
    (need.kind==='latex-create-document'&&latex.createDocument)||
    (need.kind.startsWith('artifact-edit:')&&artifactAction&&ARTIFACT_TYPES.some(item=>{
      if(item.kind!==need.kind)return false;
      const target=item.purpose.exec(purpose);if(!target||target.index<artifactAction.index)return false;
      const between=purpose.slice(artifactAction.index+artifactAction[0].length,target.index);
      return between.length<80&&!PICTURE.test(between);
    }))||
    (need.kind==='web-search'&&web&&/(?:\bsearch\b|search_query)/i.test(full))||
    (need.kind==='web-open'&&web&&/(?:\bopen\b|\b(?:read|browse|fetch)\b)/i.test(full)));
}

function inputEvidence(assessment,semantics) {
  // Only the original current instruction can provide an exact URL. Mask
  // quoted/example material and omit negated segments; never construct one.
  const raw=typeof assessment.rawText==='string'?requestSegments(assessment.rawText,{preserveNames:false}).text:'';
  const urlPattern=/https?:\/\/[^\s<>"，。！？、；）)]+/gi;
  const masked=raw.replace(urlPattern,x=>'x'.repeat(x.length));
  const allowed=index=>{
    let start=index,end=index;
    while(start>0&&!/[。！？!?；;，,\n]/.test(masked[start-1]))start--;
    while(end<masked.length&&!/[。！？!?；;，,\n]/.test(masked[end]))end++;
    return !negativeDirective.test(masked.slice(start,end));
  };
  const providedUrls=unique([...raw.matchAll(urlPattern)].filter(x=>allowed(x.index)).map(x=>x[0]));
  const webNeed=semantics.some(x=>x.kind==='web-search'||x.kind==='web-open'||x.kind==='image-search');
  const domainText=raw||String(assessment.activeText||'');
  const localFileToken=match=>{
    const name=match[0],i=match.index;
    if(!/\.(?:md|txt|csv|tsv|jsonl?|m?js|cjs|py|docx?|xlsx?|pptx?|html?|svg|png|jpe?g|webp|gif|bmp|pdf)$/i.test(name))return false;
    const left=domainText.slice(0,i).split(/[。！？!?；;，,\n]/u).at(-1);
    const right=domainText.slice(i+name.length).split(/[。！？!?；;，,\n]/u)[0];
    // Some file extensions are real country-code domains (for example .md).
    // Keep a bare name when the user explicitly calls it a site or domain.
    if(/(?:网站|站点|官网|域名|网址|\b(?:website|site|domain)\b)\s*(?:为|是|[:：])?\s*$/iu.test(left)
        ||/^\s*(?:网站|站点|官网|域名|网址|\b(?:website|site|domain)\b)/iu.test(right))return false;
    return domainText[i-1]==='\\'
      ||/(?:保存|另存|写入|写到|写成|导出|输出|生成|创建|交付|读取|打开|上传|附件|输入|原始|本地|磁盘|目录|文件|文档|报告|表格|数据|路径|\b(?:save|write|export|output|create|read|open|upload|attachment|file|document|report|local|path)\b).{0,18}$/iu.test(left)
      ||/^\s*(?:的)?(?:文件|文档|报告|表格|路径|\b(?:file|document|report|spreadsheet|path)\b)/iu.test(right);
  };
  const providedDomains=webNeed?unique([...domainText.matchAll(/(?<![\w@/.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?![\w-])/gi)].filter(x=>(!raw||allowed(x.index))&&!localFileToken(x)).map(x=>x[0]).filter(x=>!/\.(?:png|jpe?g|webp|gif|bmp|pdf)$/i.test(x))):[];
  return {sources:unique(semantics.map(x=>x.source)),providedUrls,providedDomains};
}

// A runtime namespace is a weak identity clue, not an availability or
// authorization claim. Aggregator namespaces may encode the service in the
// operation name instead (e.g. provider_resource_search).
function toolProvider(entry) {
  if(entry.kind!=='tool')return '';
  const parts=String(entry.name||'').split('__');
  const namespace=entry.server||(parts[0]==='mcp'?parts[1]:parts.length>1?parts[0]:'');
  const normalized=label(namespace);
  const generic=new Set(['','mcp','apps','codex-apps','mcpapps','functions','tools','tool','web','browser','image-gen','exec']);
  if(!generic.has(normalized))return normalized;
  const leaf=parts.at(-1)||'';
  const prefix=leaf.replace(/_(?:search|find|list|get|read|fetch|lookup|open)(?:_(?:files?|documents?|items?))?$/i,'');
  return prefix!==leaf&&prefix.includes('_')?label(prefix):'';
}

/** Produces host execution choices, never calls business tools itself. */
function adviseCapabilitiesBase(assessment, options = {}) {
  const inventory = options.capabilityIndex || discoverCapabilities(options);
  const active = assessment.activeText || '';
  const needs=semanticNeeds(assessment);
  const searchRestrictions=options.invocationContext?.searchRestrictions===undefined?null:invocationConstraints(assessment,options).searchRestrictions;
  const rawQuery=assessment.rawText??active;
  const imageBans=imageToolProhibitions(rawQuery),searchToolBanned=webSearchToolProhibited(rawQuery),imageInquiryOnly=imageEditInquiryOnly(rawQuery);
  const givenPhase=options.phase||options.invocationContext?.phase;
  const phase = (!givenPhase||givenPhase==='auto')&&needs.some(n=>n.kind==='image-create'||n.kind==='image-edit'||n.kind==='scheduled-reminder'||n.kind==='reminder-manage'||n.kind==='latex-create-project'||n.kind==='latex-create-document'||n.kind.startsWith('artifact-edit:'))?'implementation'
    :(!givenPhase||givenPhase==='auto')&&needs.some(n=>n.kind==='latex-compile')?'validation':currentPhase(active,givenPhase);
  const pureImageTask=needs.length>0&&needs.every(n=>n.kind.startsWith('image-'));
  // Exact runtime handles are explicit identities, not evidence that every
  // other tool sharing their host namespace is relevant to the task.
  let lexicalActive=active;
  if(active.includes('__'))for(const entry of inventory.capabilities)if(entry.kind==='tool'&&typeof entry.name==='string'&&entry.name.includes('__')) {
    const escaped=entry.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    lexicalActive=lexicalActive.replace(new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`,'gi'),' ');
  }
  const queryTerms = new Set(terms(lexicalActive));
  const normalizedActive=label(active);
  const providerKey=value=>label(String(value||'').split('@')[0]);
  const namedProviders=new Set(inventory.capabilities.filter(e=>e.kind==='plugin'||e.kind==='mcp').flatMap(e=>[e.name,e.displayName,e.plugin]).filter(x=>x&&providerKey(x).length>2&&(`-${normalizedActive}-`).includes(`-${providerKey(x)}-`)).map(providerKey));
  const runtimeProviders=new Set(inventory.capabilities.map(toolProvider).filter(p=>p&&(`-${normalizedActive}-`).includes(`-${p}-`)));
  const broadSourceScope=/(?:等(?:等)?|所有|各个|各类|多个|不同|任意|各种|其他|其它).{0,15}(?:网盘|云盘|云空间|云端|云服务|存储|来源|服务|平台|\b(?:drives?|cloud|storage|providers?)\b)|(?:和|与|及|以及|、|或|\band\b|\bor\b).{1,24}(?:网盘|云盘|云空间|云端|云服务|存储|分别|各自|\b(?:drives?|cloud|storage)\b)/i.test(active)
    ||/(?:和|与|及|以及|、|或)\s*[\p{Script=Han}A-Za-z]{2,16}(?:文档|表格|知识库|群聊)/iu.test(active);
  const crossSourceTransfer=/(?:同步|转存|迁移|拷贝|复制|\b(?:sync|transfer|migrate|copy)\b)/i.test(active)
    ||/(?:上传|导入|导出).{0,20}(?:到|至)(?!本地|电脑|当前目录|当前文件夹)/i.test(active);
  const hasOtherSourceWork=broadSourceScope||crossSourceTransfer
    ||splitIntentClauses(assessment).some(clause=>{
    const current=label(clause);
    if([...runtimeProviders].some(p=>(`-${current}-`).includes(`-${p}-`)))return false;
    if(needs.some(n=>n.clause===clause&&(n.kind.startsWith('image-')||n.kind.startsWith('web-'))))return false;
    return /搜索|检索|查找|查询|访问|打开|同步|转存|上传|\b(?:search|find|lookup|open|sync|transfer|upload)\b/i.test(clause)
      ||/(?:使用|通过|借助|用|在).{1,20}(?:查看|读取|浏览)/i.test(clause);
  });
  const wantsSearch=/搜索|检索|查找|\bsearch\b|\bfind\b/i.test(active);
  const wantsRead=wantsSearch||/读取|查看|检查|获取|\bread\b|\bget\b|\binspect\b/i.test(active);
  const cards = [];
  for (const entry of inventory.capabilities) {
    if (!entry.enabled) continue;
    if (entry.kind==='tool' && exactToolProhibited(assessment.rawText??assessment.activeText,entry.name,
      {searchOnlyRestricted:searchRestrictions?.prohibitedToolSearch?.includes(entry.name)===true})) continue;
    if (entry.kind==='tool' && prohibitedObjectOperation(assessment.rawText??assessment.activeText,entry)) continue;
    if (entry.kind==='tool' && searchToolBanned && webSearchToolPurpose(entry.description,entry.name)) continue;
    const runtimeRecord=entry.kind==='tool'?(options.runtimeTools||[]).find(t=>t.name===entry.name):null;
    if(runtimeRecord?.available===false)continue;
    const callable=runtimeRecord?true:entry.callable;
    const declaredAvailable=typeof runtimeRecord?.available==='boolean'?runtimeRecord.available:entry.declaredAvailable??null;
    if (entry.kind==='mcp' && entry.tools.length) continue; // Tools provide the actionable granularity.
    const semantics=semanticMatches(entry,needs).filter(match=>!(match.kind==='image-create'&&imageBans.create)&&!(match.kind==='image-edit'&&imageBans.edit)),semantic=semantics[0];
    const imagePurpose=imageToolPurposes(entry.description);
    const imageRestrictionGates=[...(imageBans.create&&imagePurpose.create?['user-prohibits-image-generation']:[]),...(imageBans.edit&&imagePurpose.edit?['user-prohibits-image-edit']:[])];
    // A ban on a class of tools also excludes mixed-purpose tools whose stated
    // purpose includes that class, regardless of the operation planned now.
    if(imageRestrictionGates.length)continue;
    const independentNeed=semantics.some(match=>![...namedProviders].some(p=>(`-${label(match.clause)}-`).includes(`-${p}-`)));
    if(entry.kind==='tool'&&namedProviders.size&&!namedProviders.has(providerKey(entry.plugin))&&!namedProviders.has(providerKey(entry.server))&&![...namedProviders].some(p=>(`-${label(entry.name)}-`).includes(`-${p}-`))&&!independentNeed)continue;
    // Purpose text carries more signal than cross-tool instructions and examples.
    const purpose=purposeText(entry.description);
    const latexPurpose=latexToolPurposes(purpose);
    if(/^Capture\b/i.test(purpose)&&!/捕获|截图|导入|capture|screenshot|import/i.test(active))continue;
    const haystack = `${entry.name} ${purpose}`;
    const shared = terms(haystack).filter(x=>queryTerms.has(x));
    const identity = unique((entry.kind==='tool'?[entry.name]:[entry.name,entry.plugin,entry.displayName]).filter(Boolean));
    const explicit = identity.some(x=> {
      const escaped=String(x).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      return new RegExp(`(?:\\$|使用\\s*|调用\\s*|用\\s*|use\\s+|invoke\\s+)${escaped}(?=$|[^a-z0-9_-])`,'i').test(active);
    });
    // JavaScript drawing on an HTML canvas is not an existing viewer-bound
    // whiteboard. The artifact editor requires a supplied binding, whereas
    // other independent spreadsheet/presentation work must remain eligible.
    const boundCanvasEditor=/\b(?:viewer[- ]bound|existing\s+bound)\b/i.test(purpose)
      &&/\b(?:spreadsheet|presentation)\b/i.test(purpose)&&/\bbound\s+canvas\b/i.test(purpose);
    const htmlCanvasProgram=/(?:\bhtml\b.{0,25}\bcanvas\b|\bcanvas\b.{0,25}\bhtml\b|(?:浏览器|\bbrowser\b|\bjavascript\b).{0,30}\bcanvas\b)/i.test(active)
      &&/(?:编写|开发|实现|制作|做|游戏|绘制|\b(?:write|build|create|implement|develop|game|draw)\b)/i.test(active);
    const independentArtifact=/(?:表格|工作簿|电子表格|幻灯片|演示文稿|已绑定.{0,10}(?:白板|画布)|绑定的(?:白板|画布)|\b(?:spreadsheet|workbook|presentation|slides?|whiteboard|artifactref|bound canvas|xlsx|pptx)\b)/i.test(active);
    if(!explicit&&boundCanvasEditor&&htmlCanvasProgram&&!independentArtifact)continue;
    // Sharing the word LaTeX does not make project creation relevant to a
    // compile-only task (or compiling relevant to an explanation/new project).
    if(!explicit&&latexPurpose.compile&&!semantics.some(n=>n.kind==='latex-compile'))continue;
    if(!explicit&&latexPurpose.create&&!semantics.some(n=>n.kind==='latex-create-project'||n.kind==='latex-create-document'))continue;
    if(!explicit&&needs.some(n=>n.kind==='latex-compile')&&!semantics.some(n=>n.kind==='latex-compile')
        &&/^(?:explain|describe|teach|explanation|说明|解释|讲解)/i.test(purpose)
        &&/(?:\b(?:latex|tex)\b|\.tex\b)/i.test(purpose)
        &&!/(?:解释|说明|讲解|explain|describe|teach)/i.test(active))continue;
    // A safety column in local data is not evidence of a family account or
    // parental-controls task. Explicit tool names retain their normal gates.
    const familyTool=entry.kind==='tool'&&/(?:^|__)safety_settings_/i.test(entry.name);
    const familyObject=/(?:家长|家庭设置|家庭成员|子女|孩子|儿童|未成年|青少年|监护|可信联系人|\b(?:parental|family|children|child|teen|guardian|trusted contact)\b)/i.test(active);
    if(familyTool&&!explicit&&!familyObject)continue;
    // A data field called quality_feedback is not a request to submit
    // feedback on a search job. Bind that specialized tool to its object.
    const searchFeedbackTool=entry.kind==='tool'&&/(?:^|_)feedback(?:_|$)/i.test(entry.name)
      &&/\bfeedback\b/i.test(purpose)&&/\b(?:search|job|result)\b/i.test(purpose);
    const feedbackObject=/(?:反馈|评价|打分|评分|\b(?:feedback|rating|rate)\b)/i.test(active);
    const feedbackAction=/(?:提交|发送|提供|给出|评价|反馈|打分|评分|\b(?:submit|send|give|provide|rate|feedback)\b)/i.test(active);
    const searchObject=/(?:搜索|检索|网页|爬取|检索结果|\b(?:firecrawl|search|crawl|research|job)\b)/i.test(active);
    if(searchFeedbackTool&&!explicit&&!(feedbackObject&&feedbackAction&&searchObject))continue;
    const supportedFeedback=searchFeedbackTool&&feedbackObject&&feedbackAction&&searchObject;
    // A locally requested report does not imply creating, uploading or sharing
    // a file in a remote drive. Other independently requested remote actions
    // and explicitly named tools still go through their ordinary scope gates.
    const localReport=/(?:编写|撰写|写|生成|制作|输出|保存|导出|交付|创建).{0,12}(?:本地|本机|电脑|磁盘).{0,16}(?:报告|文档|文件|表格)|在(?:本地|本机|电脑|磁盘).{0,10}(?:编写|撰写|写|生成|制作|输出|保存|导出|交付|创建).{0,16}(?:报告|文档|文件|表格)/i.test(active);
    const remoteFileProvider=entry.kind==='tool'&&/(?:google_drive|onedrive|dropbox|feishu_drive|lark_drive|notion)/i.test([entry.name,entry.server,entry.plugin].join(' '));
    const remoteFileMutation=remoteFileProvider&&/\b(?:create|write|update|share|upload|copy|move|delete|publish)\b/i.test(entry.name.split('__').at(-1).replace(/[_-]+/g,' '));
    const remoteReference=/(?:云端|网盘|云盘|google\s*drive|onedrive|dropbox|notion|飞书云文档)/i.test(active);
    const remoteDestination=/(?:上传|保存|写入|分享|共享|发布|同步|转存|创建).{0,30}(?:云端|网盘|云盘|google\s*drive|onedrive|dropbox|notion|飞书云文档)|(?:云端|网盘|云盘|google\s*drive|onedrive|dropbox|notion|飞书云文档).{0,30}(?:上传|保存|写入|分享|共享|发布|同步|转存|创建)/i.test(active);
    if(localReport&&remoteFileProvider&&!remoteReference&&!explicit)continue;
    if(localReport&&remoteFileMutation&&!remoteDestination&&!explicit)continue;
    const editPurposeMissing=imagePurpose.create&&!imagePurpose.edit&&needs.some(n=>n.kind==='image-edit')&&!needs.some(n=>n.kind==='image-create')&&!semantics.some(n=>!n.kind.startsWith('image-'));
    if(editPurposeMissing&&!explicit)continue;
    const uncertainImagePurpose=(imageBans.create||imageBans.edit)&&!imagePurpose.create&&!imagePurpose.edit&&explicit
      && needs.some(n=>n.kind==='image-create'||n.kind==='image-edit')&&!semantics.some(n=>!n.kind.startsWith('image-'));
    const provider=toolProvider(entry), providerParts=provider.split('-');
    const providerPrefix=providerParts.slice(0,-1).join('-');
    // A distinctive partial service name ("Feishu" for "Feishu Drive")
    // prevents suppressing that service, but does not establish availability.
    const partialProviderMention=providerParts.length>1&&providerPrefix.length>=4&&(`-${normalizedActive}-`).includes(`-${providerPrefix}-`);
    const competingProvider=!explicit&&!hasOtherSourceWork&&!partialProviderMention&&providerParts.length>1&&!runtimeProviders.has(provider)
      && [...runtimeProviders].some(p=>{const parts=p.split('-');return parts.length>1&&parts.at(-1)===providerParts.at(-1)&&parts.at(-1).length>=4;});
    const localImageOnly=/\blocal image file\b|\bimages? already available on disk\b/i.test(purpose);
    if(!explicit&&localImageOnly&&semantics.length&&semantics.every(x=>x.kind==='image-read'&&['attachment','conversation-image','url'].includes(x.source)))continue;
    // Image production is not image inspection or an explanation of how
    // generation works. Explicitly named tools still go through normal gates.
    const imageProducer=imageAction(purpose,'(?:generat(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|edit(?:s|ed|ing)?|modif(?:y|ies|ied|ying))','(?:generation|creation|editing|modification)');
    if(!explicit&&imageProducer&&!semantic&& !needs.some(n=>n.kind==='image-create'||n.kind==='image-edit'))continue;
    // A picture mentioned as an upload, page embed or editing example does not
    // make a tool a photo editor. Keep an unrelated independently matched task.
    if(pureImageTask&&!explicit&&!semantic) {
      const independentlyMatched=splitIntentClauses(assessment).filter(c=>!PICTURE.test(c)).some(c=>{
        const other=new Set(terms(c));return shared.filter(t=>other.has(t)).length>=2;
      });
      if(!independentlyMatched)continue;
    }
    // One generic domain match is insufficient to add tools to an otherwise native task.
    const support=shared.filter(term=>term!=='id');
    if (!explicit && support.length<2 && !semantic && !supportedFeedback) continue;
    const brandTerms=new Set(terms(`${entry.plugin||''} ${entry.server||''}`));
    const nonBrand=shared.filter(x=>!brandTerms.has(x));
    if(entry.kind==='tool'&&!explicit&&entry.plugin&&nonBrand.length===0)continue;
    // Reject tool purposes explicitly excluding the requested domain.
    const exclusions=[...entry.description.matchAll(/(?:Do not use (?:this tool )?for|not (?:intended|suitable) for)\s+([^.!\n]+)/gi)].map(x=>x[1]);
    if(!explicit&&exclusions.some(x=>terms(x).some(t=>queryTerms.has(t)&&!brandTerms.has(t))))continue;
    if (/dynamic.skill.router/.test(norm(`${entry.name} ${entry.server}`)) && !/路由|router/i.test(active)) continue;
    let op = entry.kind==='tool' ? operation(entry) : {action:'discover',phase,effect:'unknown'};
    if(entry.kind==='tool'&&semantic&&op.effect!=='high-impact'&&op.effect!=='external-write') {
      if(semantic.kind==='image-create'||semantic.kind==='image-edit'||semantic.kind==='scheduled-reminder'||semantic.kind==='reminder-manage'||semantic.kind==='latex-create-project'||semantic.kind==='latex-create-document'||semantic.kind.startsWith('artifact-edit:'))op={action:'change',phase:'implementation',effect:'write-or-unknown'};
      else if(semantic.kind==='latex-compile')op={action:'verify',phase:'validation',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'};
      else if(op.action!=='change'||/^run$/i.test(entry.name.split('__').at(-1)))op={action:'read',phase:'discovery',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'};
    }
    let score = shared.length*4+(explicit?24:0)+(semantic?18:0)+(supportedFeedback?12:0);
    const nameTerms=terms(entry.name.split('__').at(-1));
    score+=nameTerms.filter(x=>queryTerms.has(x)&&!brandTerms.has(x)).length*8;
    if(op.action==='read'&&wantsRead)score+=10;
    if(wantsSearch&&/\bsearch\b/.test(entry.name.replace(/_/g,' ')))score+=24;
    if(wantsSearch&&/\blist\b/.test(entry.name.replace(/_/g,' ')))score+=8;
    // Specialized child resources must be asked for; a brand match is not enough.
    const specialist=['revision','comment','shader','motion','animation','row','range','toolbar','generative','deck','video'];
    if(!explicit&&!semantic&&nameTerms.some(t=>specialist.includes(t)&&!queryTerms.has(t)))continue;
    const needsDelivery = op.phase==='delivery';
    const deliveryRequested = phase==='delivery' && requestedDelivery(assessment,entry);
    let decision = callable===true && entry.kind==='tool' ? 'use-now' : 'discover-first';
    const gates = ['confirm-task-benefit','inspect-exact-schema-and-inputs','respect-current-user-authorization'];
    if(semantics.some(x=>x.kind==='reminder-manage'))gates.push('resolve-existing-reminder-and-preserve-settings');
    if(semantics.some(x=>x.kind==='academic-read'))gates.push('verify-paper-id-question-and-indexed-full-text');
    if(semantics.some(x=>x.kind==='latex-compile')) {
      gates.push('verify-current-tex-project-and-main-file');
      if(/\bwithout\s+exporting\s+(?:a\s+)?pdf\b/i.test(purpose))gates.push('diagnostics-do-not-export-pdf');
    }
    if(semantics.some(x=>x.kind==='latex-create-project'))gates.push('verify-new-project-destination-and-no-overwrite');
    if(semantics.some(x=>x.kind==='latex-create-document'))gates.push('verify-tex-document-path-and-dedicated-project-directory');
    if(semantics.some(x=>x.kind==='artifact-edit:bound-canvas'))gates.push('verify-application-provided-bound-canvas-artifact-ref');
    if(semantics.some(x=>x.kind==='image-edit'||x.kind==='image-read'))gates.push('verify-required-image-input');
    if(semantics.some(x=>x.kind==='image-read')&&localImageOnly)gates.push('verify-local-image-path');
    if(semantics.some(x=>x.kind==='image-edit')&&/\bupload\b.{0,120}\b(?:attachment|image|photo|reference)\b|\b(?:attachment|image|photo|reference)\b.{0,120}\bupload\b/i.test(entry.description))gates.push('verify-external-input-transfer-and-access');
    if(/must load|read .{0,160}SKILL\.md|skill.*before|before.*skill/i.test(entry.description))gates.push('read-required-skill-before-invocation');
    if (assessment.readOnly && op.effect!=='read') { decision=op.effect==='unknown'?'defer':'skip'; gates.push(op.effect==='unknown'?'read-effects-unverified':'read-only-scope'); }
    else if (needsDelivery && !deliveryRequested) {decision='defer';gates.push('delivery-not-requested');score-=12;}
    else if (entry.kind==='tool' && op.phase!=='discovery' && op.phase!==phase) {decision='defer';gates.push('different-task-phase');score-=8;}
    else if (entry.kind==='tool' && op.effect!=='read') {decision='check-scope';gates.push('verify-effects-and-authorized-scope');}
    if (callable!==true) {if(!['skip','defer'].includes(decision))decision='discover-first';gates.push('runtime-callability-unverified');}
    if (entry.kind==='plugin') {decision='discover-first';gates.push('select-specific-tool-or-read-relevant-skill');}
    if (competingProvider && decision!=='skip') {decision='defer';gates.push('different-specified-provider');}
    if (op.effect==='high-impact' || op.effect==='external-write') gates.push('check-destination-and-current-action-authorization');
    if(uncertainImagePurpose){if(decision!=='skip')decision='defer';gates.push('image-category-prohibition-purpose-unverified');}
    if((editPurposeMissing||imageInquiryOnly&&imagePurpose.edit)&&decision!=='skip'){decision='defer';gates.push(editPurposeMissing?'image-edit-purpose-unverified':'image-edit-inquiry-not-execution');}
    const card={id:entry.id,kind:entry.kind,name:entry.name,plugin:entry.plugin || null,server:entry.server || null,
      description:entry.description.slice(0,240),score,explicit,matchedTerms:shared.slice(0,6),
      ...(semantic?{intentMatches:unique(semantics.map(match=>match.kind)),purposeEvidence:{source:'tool-description',text:purpose.slice(0,240)},inputEvidence:inputEvidence(assessment,semantics)}:{}),
      availability:{discovered:true,enabled:entry.enabled,callable,evidence:runtimeRecord?'runtime-tool':entry.evidence,...(entry.kind==='tool'?{declaredAvailable,authentication:'unknown',businessOutcome:'unknown'}:{})},
      decision,phase:op.phase,when:decision==='defer'?(gates.includes('different-specified-provider')?'当前请求指定其他同类来源；确有该来源需求时再核对':gates.includes('read-effects-unverified')?'当前可核对精确 schema 和只读效果，确认符合范围后再用':'仅到相应阶段且用户目标需要时再评估'):decision==='discover-first'?'先按需发现工具或读取相关技能，确认当前会话可用':`当前 ${phase} 阶段，且缺少其能提供的结果时`,
      expectedBenefit:OUTCOME[op.phase] || OUTCOME[phase],effect:op.effect,gates,
      invocation:{tool:entry.kind==='tool'?entry.name:null,argumentPolicy:'Use the host tool schema and actual task inputs; do not invent parameters.',executor:'host-agent',automaticallyExecuted:false},
      reason:explicit?'用户在当前任务中点名此能力':semantic?`当前任务与工具用途匹配：${semantic.kind}；仍需核对参数、效果和授权`:`任务与能力共有具体信号：${shared.slice(0,4).join('、')}`};
    cards.push(constrainSearchCapability(card,searchRestrictions,entry));
  }
  const order = {'use-now':0,'check-scope':0,'discover-first':1,'defer':2,'skip':3};
  cards.sort((a,b)=>order[a.decision]-order[b.decision] || b.score-a.score || a.id.localeCompare(b.id));
  const limit=Math.min(10,Math.max(1,options.capabilityLimit||5));
  // Preserve explicitly named tools, then reserve a slot for each distinct
  // evidenced task need before filling the remaining score-ordered slots.
  const chosen=cards.filter(card=>card.explicit),chosenIds=new Set(chosen.map(card=>card.id));
  for(const need of needs) {
    if(chosen.length>=Math.max(limit,cards.filter(card=>card.explicit).length))break;
    if(chosen.some(card=>card.intentMatches?.includes(need.kind)))continue;
    const match=cards.find(card=>!chosenIds.has(card.id)&&card.intentMatches?.includes(need.kind)&&card.decision!=='skip');
    if(match){chosen.push(match);chosenIds.add(match.id);}
  }
  for(const card of cards){if(chosen.length>=Math.max(limit,cards.filter(item=>item.explicit).length))break;if(!chosenIds.has(card.id)){chosen.push(card);chosenIds.add(card.id);}}
  const candidates=cards.filter(card=>chosenIds.has(card.id));
  return {revision:inventory.revision,coverage:inventory.coverage,errors:inventory.errors,phase,candidates,
    executionPolicy:{executor:'host-agent',advisoryOnly:true,scanExecutesTools:false,
      recheckAt:['initial-task','phase-change','capability-gap','tool-unavailable'],
      skipWhen:['native-tools-sufficient','no-specific-task-benefit','already-have-required-evidence'],
      rule:'Use helpful, currently callable tools within existing authorization. Discovery is not permission; do not ask again for already authorized routine work.'}};
}

export function adviseCapabilities(assessment,options={}) {
  validateHostOptions(options);
  const base=adviseCapabilitiesBase(assessment,options);
  const result=options.taskContext?.capabilityRequests?{...base,capabilityConsultations:exactToolConsultations(assessment.rawText??assessment.activeText,assessment,options)}:base;
  const constraints=invocationConstraints(assessment,options);
  if(!options.invocationContext&&!constraints.readOnly&&!constraints.networkForbidden&&!constraints.sourceScope&&!constraints.preserveInputs)return result;
  return {...result,taskConstraints:constraints,candidates:result.candidates.map(card=>{
    const tool=(options.runtimeTools||[]).find(t=>t.name===card.name)||(options.capabilityIndex?.capabilities||[]).find(t=>t.name===card.name)||{};
    const restricted=constrainCapability(card,constraints,tool);
    return restricted.decision==='defer'&&restricted.gates.includes('read-effects-unverified')
      ?{...restricted,when:'当前可核对精确 schema 和只读效果，确认符合范围后再用'}:restricted;
  })};
}
