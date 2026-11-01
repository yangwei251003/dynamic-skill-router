import {validateHostOptions,exactToolConsultations} from './host-context-contract.mjs';
import {invocationConstraints,constrainCapability} from './invocation-constraints.mjs';
import {requestSegments,negativeDirective} from './request-evidence.mjs';
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
const segmenter = new Intl.Segmenter('zh',{granularity:'word'});
function terms(value) {
  const source = norm(value).replace(/https?:\/\/\S+/g,' ');
  const result = (source.match(/[a-z][a-z0-9]+/g)||[]).filter(x=>!STOP.has(x)).map(x=>x.replace(/(ing|s)$/,'')).filter(x=>!STOP.has(x));
  for (const part of segmenter.segment(source)) if (/\p{Script=Han}/u.test(part.segment) && part.segment.length>=2) result.push(part.segment);
  const bridges = [
    [/数据库|postgres|sql|database/,['database']], [/原理图|电路|pcb|easyeda|schematic/,['circuit']],
    [/浏览器|browser|playwright/,['browser']], [/网页|网站|前端|frontend|website/,['frontend']],
    [/设计稿|figma|design file/,['figma']], [/设计稿|设计|design/,['design']], [/代码库|仓库|repository|github/,['repository']],
    [/文档|documentation|docs/,['documentation']], [/文档|document|file/,['document']], [/搜索|检索|查找|search/,['search']],
    [/测试|test|验证|verify|validation/,['test']], [/部署|上线|发布|deploy|publish/,['deploy']],
    [/幻灯片|演示文稿|slides|presentation/,['slides']], [/表格|spreadsheet|excel/,['spreadsheet']],
    [/邮件|email|mail/,['email']], [/日历|calendar/,['calendar']], [/图像|图片|照片|插画|海报|image|photo|illustration|poster/,['image']],
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
const PICTURE=/(?:图片|图像|照片|插画|插图|海报|画像|漫画|图画|截图|(?:这|那)(?:张|幅)图|\b(?:images?|screenshots?|photos?|photographs?|pictures?|illustrations?|posters?|portraits?|comics?)\b|\b[\w.-]+\.(?:png|jpe?g|webp|gif|bmp)\b)/i;
const splitIntentClauses=assessment=>list(assessment.activeClauses).flatMap(c=>c.split(/(?:并且|然后|同时|以及|并|\band then\b|\band\b)/i)).map(x=>x.trim()).filter(Boolean);
const ARTIFACT_ACTION=/(?:修改|编辑|修复|添加|插入|更新|开发|搭建|实现|优化|维护|排版|\b(?:update|edit|fix|repair|modify|add|insert|build|develop)\b)/i;
const ARTIFACT_TYPES=[
  {kind:'artifact-edit:web',request:/网页|网站|前端|\b(?:website|webpage|web page|frontend)\b/i,purpose:/网页|网站|前端|\b(?:website|webpage|web pages?|frontend)\b/i},
  {kind:'artifact-edit:design',request:/设计稿|figma|design file/i,purpose:/设计稿|figma|design file/i},
  {kind:'artifact-edit:document',request:/文档|报告|\b(?:document|report)\b/i,purpose:/文档|报告|\b(?:document|report)\b/i},
  {kind:'artifact-edit:slides',request:/幻灯片|演示文稿|\bpptx?\b|\b(?:slides?|presentation)\b/i,purpose:/幻灯片|演示文稿|\bpptx?\b|\b(?:slides?|presentation)\b/i},
  {kind:'artifact-edit:spreadsheet',request:/表格|电子表格|\b(?:spreadsheet|excel)\b/i,purpose:/表格|电子表格|\b(?:spreadsheet|excel)\b/i},
  {kind:'artifact-edit:code',request:/代码|源码|代码库|配置文件|\b(?:source code|codebase|source files?|repository)\b/i,purpose:/代码|源码|代码库|配置文件|\b(?:source code|codebase|source files?|repository)\b/i},
];
function semanticNeeds(assessment) {
  const clauses=splitIntentClauses(assessment);
  const needs=[];
  for(const clause of clauses) {
    const info=/^(?:(?:请|帮我|请你|麻烦|please)\s*)*(?:解释|介绍|讲解|说明|比较|举例|(?:给(?:我|出)?|提供|列举).{0,20}(?:例子|示例|实例|样例)|什么是|如何|怎么|explain\b|describe\b|(?:give|show)\b.{0,25}\bexamples?\b|what is\b|how (?:to|does|do)\b)/i.test(clause);
    const picture=PICTURE.test(clause);
    if(picture) {
      const source=/(?:附件|附图|上传的|所附|\b(?:attached|attachment|uploaded)\b)/i.test(clause)?'attachment'
        :/(?:刚发|刚才发|刚刚发|刚发送|\bjust sent\b)/i.test(clause)?'conversation-image'
        :/(?:本地|文件|磁盘|\b(?:local|filesystem|file)\b|[a-z]:[\\/])/i.test(clause)?'local'
          :/https?:\/\//i.test(clause)?'url':'unspecified';
      const actualInput=source!=='unspecified'||/(?:这张|这幅|该图片|给定|提供的|\b(?:this|that|provided|supplied|existing)\b)/i.test(clause);
      const create=/(?:生成|绘制|画出|画一|画个|制作|创作|设计(?!稿)|生成一|\b(?:generate|create|draw|make|render)\b).{0,28}(?:图片|图像|照片|插画|插图|海报|画像|漫画|图画|\b(?:image|photo|picture|illustration|poster|portrait|comic)\b)/i.test(clause);
      const edit=/(?:修改|编辑|调整|替换|美化|抠图|去背景|更换|修复)(?:(?:一下|这张|这幅|那张|那幅|这些|该|现有的?|原有的?|已有的?|上传的|给定的|提供的|产品)){0,5}(?:图片|图像|照片|插画|插图|海报|截图|图)|(?:图片|图像|照片|插画|插图|海报|截图|(?:这|那)(?:张|幅)图)(?:(?:的(?:背景|颜色|内容|细节|风格|元素)?)|进行|做|整体)?(?:修改|编辑|调整|替换|美化|抠图|去背景|更换|修复|改成|改为|变成)/i.test(clause)
        ||imageAction(clause,'(?:edit|modify|retouch|alter|change|replace)','(?:editing|modification|retouching)')
        ||/(?:去除|去掉|移除|抠除|更换|删除|\b(?:remove|erase|replace)\b).{0,28}(?:背景|background).{0,35}(?:图片|图像|照片|\b(?:image|photo|photograph|picture)\b)|(?:图片|图像|照片|\b(?:image|photo|photograph|picture)\b).{0,28}(?:背景|background).{0,20}(?:去除|去掉|移除|抠除|更换|删除|\b(?:remove|erase|replace)\b)|(?:去除|去掉|移除|抠除|更换|删除|\b(?:remove|erase|replace)\b).{0,28}(?:图片|图像|照片|\b(?:image|photo|photograph|picture)\b).{0,16}(?:背景|background)/i.test(clause);
      const read=/(?:查看|阅读|读取|观察|识别|看一下|解释|描述|分析|\b(?:view|read|inspect|examine|describe|analy[sz]e|interpret|look at)\b)/i.test(clause);
      if(!info&&create)needs.push({kind:'image-create',clause,source});
      if(!info&&edit)needs.push({kind:'image-edit',clause,source});
      if(read&&!create&&!edit&&(!info||actualInput))needs.push({kind:'image-read',clause,source});
      if(!info&&/(?:搜索|检索|查找|寻找|找|\b(?:search|find|look for)\b)/i.test(clause))needs.push({kind:'image-search',clause,source});
    }
    if(!info&&ARTIFACT_ACTION.test(clause))for(const item of ARTIFACT_TYPES)if(item.request.test(clause))needs.push({kind:item.kind,clause});
    // Keep explicit negative web actions from becoming affirmative needs, even
    // when the higher-level clause filter retained a short “不打开” phrase.
    const webClause=clause.replace(/(?:不要|不得|禁止|不能|请勿|不必|无需|无须|不需要|别|不)\s*(?:再|主动|直接|自行|实际|擅自|去)?\s*(?:打开|访问|读取|阅读|浏览|查看|读出|搜索|检索|查找|查询|核验|核实|查证)/g,'');
    const search=/(?:联网|网上|在线|网络|网页|网站|官网|官方|internet|online|web|official|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b)/i.test(webClause)&&/(?:搜索|检索|查找|查询|核验|核实|查证|查|\b(?:search|find|verify|research|look up|check)\b)/i.test(webClause);
    const open=/(?:阅读|读取|浏览|打开|查看|访问|\b(?:read|open|browse|visit|fetch)\b).{0,45}(?:网页|网址|网站|链接|页面|https?:\/\/|\b(?:page|url|link|website)\b)/i.test(webClause)
      ||(!info&&/(?:网页|网址|网站|链接|页面|\b(?:page|url|link|website)\b|https?:\/\/[^\s<>"，。！？、；）)]+).{0,45}(?:阅读|读取|读出|浏览|打开|查看|访问|\b(?:read|open|browse|visit|fetch)\b)/i.test(webClause));
    if(search)needs.push({kind:'web-search',clause});
    if(open)needs.push({kind:'web-open',clause});
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
function semanticMatches(entry,needs) {
  if(!['tool','plugin','mcp'].includes(entry.kind))return [];
  // For generic multi-operation web tools inspect named operation examples too.
  const purpose=purposeText(entry.description);
  const full=String(entry.description||'').slice(0,1600);
  const make=imageAction(purpose,'(?:generat(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|draw(?:s|n|ing)?|render(?:s|ed|ing)?)','(?:generation|creation|rendering)')||/(?:生成|创建|绘制|渲染)(?:一张|一个|新的|新|指定的|目标)?(?:图片|图像|照片|插画)/.test(purpose);
  const edit=imageAction(purpose,'(?:edit(?:s|ed|ing)?|modif(?:y|ies|ied|ying)|retouch(?:es|ed|ing)?|alter(?:s|ed|ing)?|restyl(?:e|es|ed|ing))','(?:editing|modification|retouching)')
    ||/\b(?:remove|erase|replace)\s+(?:the\s+)?backgrounds?\s+(?:from|of)\s+(?:(?:the|a|an|existing|supplied|provided)\s+)*(?:images?|photos?|photographs?|pictures?)\b/i.test(purpose)
    ||/(?:编辑|修改|修饰|调整)(?:已有的?|现有的?|上传的|指定的)?(?:图片|图像|照片|插画)|(?:图片|图像|照片|插画)(?:进行|的)?(?:编辑|修改|修饰|调整)/.test(purpose);
  const read=imageAction(purpose,'(?:view(?:s|ed|ing)?|read(?:s|ing)?|inspect(?:s|ed|ing)?|examine(?:s|d)?|analy[sz](?:e|es|ed|ing)|recogniz(?:e|es|ed|ing))','(?:viewing|inspection|analysis)')||/(?:查看|读取|识别|分析)(?:本地的?|已有的?|指定的|上传的)?(?:图片|图像|照片)/.test(purpose);
  const searchImages=imageAction(purpose,'(?:search(?:es|ed|ing)?|find(?:s|ing)?)','(?:search|retrieval)')||/(?:搜索|检索|查找)(?:网络|在线|网页)?(?:图片|图像|照片|插画)/.test(purpose);
  const web=/\b(?:internet|web|online|browser|website)\b/i.test(purpose);
  const artifactAction=/(?:修改|编辑|修复|添加|插入|更新|开发|搭建|实现|优化|维护|排版|\b(?:updat(?:e|es|ed|ing)|edit(?:s|ed|ing)?|fix(?:es|ed|ing)?|repair(?:s|ed|ing)?|modif(?:y|ies|ied|ying)|add(?:s|ed|ing)?|insert(?:s|ed|ing)?|build(?:s|ing)?|develop(?:s|ed|ing)?)\b)/i.exec(purpose);
  return needs.filter(need=>
    (need.kind==='image-create'&&make)||
    (need.kind==='image-edit'&&edit)||
    (need.kind==='image-read'&&read)||
    (need.kind==='image-search'&&(searchImages||(web&&/\bimage_query\b/i.test(full))))||
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
  const providedDomains=webNeed?unique([...domainText.matchAll(/(?<![\w@/.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?![\w-])/gi)].filter(x=>!raw||allowed(x.index)).map(x=>x[0]).filter(x=>!/\.(?:png|jpe?g|webp|gif|bmp|pdf)$/i.test(x))):[];
  return {sources:unique(semantics.map(x=>x.source)),providedUrls,providedDomains};
}

/** Produces host execution choices, never calls business tools itself. */
function adviseCapabilitiesBase(assessment, options = {}) {
  const inventory = options.capabilityIndex || discoverCapabilities(options);
  const active = assessment.activeText || '';
  const needs=semanticNeeds(assessment);
  const givenPhase=options.phase||options.invocationContext?.phase;
  const phase = (!givenPhase||givenPhase==='auto')&&needs.some(n=>n.kind==='image-create'||n.kind==='image-edit'||n.kind.startsWith('artifact-edit:'))?'implementation':currentPhase(active,givenPhase);
  const pureImageTask=needs.length>0&&needs.every(n=>n.kind.startsWith('image-'));
  const queryTerms = new Set(terms(active));
  const normalizedActive=label(active);
  const providerKey=value=>label(String(value||'').split('@')[0]);
  const namedProviders=new Set(inventory.capabilities.filter(e=>e.kind==='plugin'||e.kind==='mcp').flatMap(e=>[e.name,e.displayName,e.plugin]).filter(x=>x&&providerKey(x).length>2&&(`-${normalizedActive}-`).includes(`-${providerKey(x)}-`)).map(providerKey));
  const wantsSearch=/搜索|检索|查找|\bsearch\b|\bfind\b/i.test(active);
  const wantsRead=wantsSearch||/读取|查看|检查|获取|\bread\b|\bget\b|\binspect\b/i.test(active);
  const cards = [];
  for (const entry of inventory.capabilities) {
    if (!entry.enabled) continue;
    const runtimeRecord=entry.kind==='tool'?(options.runtimeTools||[]).find(t=>t.name===entry.name):null;
    if(runtimeRecord?.available===false)continue;
    const callable=runtimeRecord?true:entry.callable;
    const declaredAvailable=typeof runtimeRecord?.available==='boolean'?runtimeRecord.available:entry.declaredAvailable??null;
    if (entry.kind==='mcp' && entry.tools.length) continue; // Tools provide the actionable granularity.
    const semantics=semanticMatches(entry,needs),semantic=semantics[0];
    const independentNeed=semantics.some(match=>![...namedProviders].some(p=>(`-${label(match.clause)}-`).includes(`-${p}-`)));
    if(entry.kind==='tool'&&namedProviders.size&&!namedProviders.has(providerKey(entry.plugin))&&!namedProviders.has(providerKey(entry.server))&&![...namedProviders].some(p=>(`-${label(entry.name)}-`).includes(`-${p}-`))&&!independentNeed)continue;
    // Purpose text carries more signal than cross-tool instructions and examples.
    const purpose=purposeText(entry.description);
    if(/^Capture\b/i.test(purpose)&&!/捕获|截图|导入|capture|screenshot|import/i.test(active))continue;
    const haystack = `${entry.name} ${purpose}`;
    const shared = terms(haystack).filter(x=>queryTerms.has(x));
    const identity = unique((entry.kind==='tool'?[entry.name]:[entry.name,entry.plugin,entry.displayName]).filter(Boolean));
    const explicit = identity.some(x=> {
      const escaped=String(x).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      return new RegExp(`(?:\\$|使用\\s*|调用\\s*|用\\s*|use\\s+|invoke\\s+)${escaped}(?=$|[^a-z0-9_-])`,'i').test(active);
    });
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
    if (!explicit && shared.length<2 && !semantic) continue;
    const brandTerms=new Set(terms(`${entry.plugin||''} ${entry.server||''}`));
    const nonBrand=shared.filter(x=>!brandTerms.has(x));
    if(entry.kind==='tool'&&!explicit&&entry.plugin&&nonBrand.length===0)continue;
    // Reject tool purposes explicitly excluding the requested domain.
    const exclusions=[...entry.description.matchAll(/(?:Do not use (?:this tool )?for|not (?:intended|suitable) for)\s+([^.!\n]+)/gi)].map(x=>x[1]);
    if(!explicit&&exclusions.some(x=>terms(x).some(t=>queryTerms.has(t)&&!brandTerms.has(t))))continue;
    if (/dynamic.skill.router/.test(norm(`${entry.name} ${entry.server}`)) && !/路由|router/i.test(active)) continue;
    let op = entry.kind==='tool' ? operation(entry) : {action:'discover',phase,effect:'unknown'};
    if(entry.kind==='tool'&&semantic&&op.effect!=='high-impact'&&op.effect!=='external-write') {
      if(semantic.kind==='image-create'||semantic.kind==='image-edit'||semantic.kind.startsWith('artifact-edit:'))op={action:'change',phase:'implementation',effect:'write-or-unknown'};
      else if(op.action!=='change'||/^run$/i.test(entry.name.split('__').at(-1)))op={action:'read',phase:'discovery',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'};
    }
    let score = shared.length*4+(explicit?24:0)+(semantic?18:0);
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
    if (op.effect==='high-impact' || op.effect==='external-write') gates.push('check-destination-and-current-action-authorization');
    cards.push({id:entry.id,kind:entry.kind,name:entry.name,plugin:entry.plugin || null,server:entry.server || null,
      description:entry.description.slice(0,240),score,explicit,matchedTerms:shared.slice(0,6),
      ...(semantic?{intentMatches:unique(semantics.map(match=>match.kind)),purposeEvidence:{source:'tool-description',text:purpose.slice(0,240)},inputEvidence:inputEvidence(assessment,semantics)}:{}),
      availability:{discovered:true,enabled:entry.enabled,callable,evidence:runtimeRecord?'runtime-tool':entry.evidence,...(entry.kind==='tool'?{declaredAvailable,authentication:'unknown',businessOutcome:'unknown'}:{})},
      decision,phase:op.phase,when:decision==='defer'?(gates.includes('read-effects-unverified')?'当前可核对精确 schema 和只读效果，确认符合范围后再用':'仅到相应阶段且用户目标需要时再评估'):decision==='discover-first'?'先按需发现工具或读取相关技能，确认当前会话可用':`当前 ${phase} 阶段，且缺少其能提供的结果时`,
      expectedBenefit:OUTCOME[op.phase] || OUTCOME[phase],effect:op.effect,gates,
      invocation:{tool:entry.kind==='tool'?entry.name:null,argumentPolicy:'Use the host tool schema and actual task inputs; do not invent parameters.',executor:'host-agent',automaticallyExecuted:false},
      reason:explicit?'用户在当前任务中点名此能力':semantic?`当前任务与工具用途匹配：${semantic.kind}；仍需核对参数、效果和授权`:`任务与能力共有具体信号：${shared.slice(0,4).join('、')}`});
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
