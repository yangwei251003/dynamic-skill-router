import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'smol-toml';
import {currentWorkClauses} from './task-restrictions.mjs';
import {imageArtifact} from './task-intents.mjs';
import {requestedName} from './request-entities.mjs';
import {semanticTaskText} from './task-structure.mjs';
import {normalizeCapabilityRequests} from './host-context-contract.mjs';

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
  const home = options.homeDir || (process.env.SKILL_ROUTER_HOME || os.homedir());
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
    const configurationPermits = serverEntry?.enabled !== false && plugin?.enabled !== false
      && (!serverEntry?.enabledTools || serverEntry.enabledTools.includes(shortName) || serverEntry.enabledTools.includes(item.name))
      && !serverEntry?.disabledTools?.some(x=>x===shortName || x===item.name);
    // A host's explicit, current availability observation may outlive an older
    // config snapshot. Keep both facts; this does not enable a service or prove auth.
    const configurationEnabled = serverEntry?.configured || plugin?.configured ? configurationPermits : null;
    const runtimeAvailable = typeof item.available === 'boolean' ? item.available : null;
    const enabled = runtimeAvailable === true || (runtimeAvailable !== false && configurationPermits);
    const configurationConflict = runtimeAvailable === true && configurationEnabled === false;
    const annotations = {};
    for (const key of ['readOnlyHint','destructiveHint','idempotentHint','openWorldHint']) if (typeof item.annotations?.[key] === 'boolean') annotations[key]=item.annotations[key];
    const entry = {id:`tool:${item.name}`,kind:'tool',name:item.name,server,plugin:plugin?.plugin || item.plugin || null,
      // A shared server introduction can exceed 4 KB before the concrete
      // function purpose appears. Retain bounded prose, never its schema.
      description:text(String(item.description || '').split(/^\s*exec tool declaration\s*:/im)[0],16000),configured:false,enabled,callable:enabled,evidence:'runtime-tool',annotations,
      runtimeAvailable,configurationEnabled,configurationConflict};
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

const STOP = new Set('the a an to of in on for and or with by from is are this that use using tool tools mcp plugin plugins api server get list create update read write run execute task tasks help useful available function request user support supports provides access part it its they them their we our you your can could will would should may must when while then than as be been being was were have has had return returns result results existing current supplied specific instruction instructions description descriptions based also only any each other both which whose into through without same such local offline no not so all before after whether does do did cannot 本地 离线'.split(' '));
// Actions and generic workflow words can refine a match, but cannot identify
// its object. Two such matches must not recruit an unrelated service.
const GENERIC_SIGNALS = new Set('search find fetch lookup inspect check test validate verify generate edit design build develop implement deploy publish send export import open close save connect install setup add reset creator creation generation production editing modification implementation inspection verification validation compilation conversion copying importing exporting opening saving reading writing skill project context output input status documentation file data record content metadata 生成 制作 修改 创建 新建 检查 验证 查看 读取 使用 任务 工具 项目 工作 产物 结果 输出 输入 设计'.split(' '));
// Transport, lifecycle and response words describe many unrelated services.
// They can rank an already grounded tool, but cannot establish its purpose.
const PURPOSE_GENERIC = new Set('http https rest api service endpoint request response id true false return execute start stop directory path core 运行 执行 启动 停止 服务 接口 请求 响应 返回 目录 路径 真实 核心 只读 宿主 重复 校验'.split(' '));
const segmenter = new Intl.Segmenter('zh',{granularity:'word'});
function terms(value) {
  const source = norm(value).replace(/https?:\/\/\S+/g,' ').replace(/\bopen[- ]source\b/g,'opensource');
  const result = (source.match(/[a-z][a-z0-9]+/g)||[]).filter(x=>!STOP.has(x)).map(x=>{
    const word=x.replace(/ing$/,'');
    if(word.length>5 && /ies$/.test(word) && !/^(?:series|species)$/.test(word))return word.replace(/ies$/,'y');
    // Singular words such as canvas, status and analysis must not be turned
    // into another provider or a different object by blind final-s removal.
    return word.length>3&&!/(?:ss|us|is|as)$/.test(word)?word.replace(/s$/,''):word;
  });
  for (const part of segmenter.segment(source)) if (/\p{Script=Han}/u.test(part.segment) && part.segment.length>=2) result.push(part.segment);
  const bridges = [
    [/数据库|postgres|sql|database/,['database']], [/原理图|电路|pcb|easyeda|schematic/,['circuit']],
    [/浏览器|browser|playwright/,['browser']], [/网页|网站|前端|frontend|website/,['frontend']],
    [/设计稿|figma|design file/,['figma']], [/设计稿|设计|design/,['design']], [/代码库|仓库|repository|github/,['repository']],
    [/文档|documentation|docs/,['documentation']], [/文档|document/,['document']], [/搜索|检索|查找|调研|search/,['search']],
    [/latex|\btex\b|\.tex\b/,['latex']],
    [/调研|研究|文献|research/,['research']], [/官方资料|官方文档|official documentation/,['official','documentation']],
    [/(?:核实|核查|查证|fact[- ]check).{0,100}(?:门户|网站|主管机构|官方|来源|公开数据)|(?:官方|机构|公共).{0,35}(?:说明|门户|资料)/,['research','search','web','source']],
    [/(?:\b(?:compare|evaluate|survey|comparison)\b.{0,100}\b(?:official|documentation|papers|opensource)\b|(?:比较|对比|评估|综述).{0,60}(?:官方|文献|开源|论文))/,['research','search','web']],
    [/来源|原始资料|\bsources?\b/,['source']], [/联网|全网|互联网|internet|\bweb\b/,['web']],
    [/门户|公开网页|公共网站|public[- ]web/,['web','public']],
    [/版本|修订(?:记录|历史|版本)|当前版|上一版|旧版|历史版|\brevisions?\b|\bversion[- ]history\b|\b(?:previous|earlier|prior) version\b/,['revision','version','history']],
    [/桌面|\bdesktop\b/,['desktop']], [/窗口|\bwindows?\b/,['window']],
    [/界面|窗口|屏幕|\bui\b|\buser interface\b/,['ui']], [/截图|截屏|\bscreenshots?\b/,['screenshot']],
    [/测试|test|验证|verify|validation/,['test']], [/部署|上线|发布|deploy|publish/,['deploy']],
    [/检查|检视|审视|\binspect\b/,['inspect']],
    [/幻灯片|演示文稿|slides|presentation/,['slides']], [/表格|spreadsheet|excel/,['spreadsheet']],
    [/\b(?:google\s+sheets?|worksheets?)\b|在线表|电子表|单元格/,['spreadsheet','sheet']],
    [/\bgoogle\s+docs?\b/,['document']], [/\bgoogle\s+slides?\b/,['slides']],
    [/元数据|文件属性|\bmetadata\b/,['metadata']],
    [/单元格|\bcells?\b/,['cell']],
    [/邮件|email|mail/,['email']], [/日历|calendar/,['calendar']],
    [/图像|图片|照片|相片|插画|海报|头像|漫画|\b(?:images?|photos?|photographs?|pictures?|illustrations?|portraits?|posters?|comics?|memes?|cutouts?)\b/,['image']],
    [/生成|制作|绘制|\b(?:generat(?:e|es|ed|ing|ion)|creat(?:e|es|ed|ing|ion)|draw(?:s|ing)?|render(?:s|ed|ing)?)\b/,['generate']],
    [/编辑|修改|修图|抠图|\b(?:edit(?:s|ed|ing)?|modif(?:y|ies|ied|ying|ication)|retouch(?:es|ed|ing)?)\b/,['edit']],
    [/迁移|migration/,['migration']], [/日志|logs/,['logs']], [/错误|error|故障|debug/,['debug']],
    [/恢复计划|遇阻|低信心|\b(?:recovery plan|blocked task|low confidence)\b/,['recovery']],
  ];
  for (const [pattern, additions] of bridges) if (pattern.test(source)) result.push(...additions);
  // Table/row pagination is a database object, even when its Chinese label is
  // a compound such as “统计表”. It does not itself request statistical inference.
  if (/数据库|\b(?:database|postgres|sqlite|sql|d1)\b/.test(source)) {
    if (/表格|表名|数据表|统计表|用户表|业务表|表结构|表(?:中|内|的|第)|\btables?\b/.test(source)) result.push('table');
    if (/行数据|数据行|实际行数|表.{0,12}(?:分页|第[一二三\d]+页|行)|\brows?\b/.test(source)) result.push('row');
  }
  if(imageArtifact(source))result.push('image');
  // Coordinates are spreadsheet objects only in a spreadsheet context, not
  // arbitrary version numbers or hardware part identifiers.
  if (result.includes('spreadsheet') && /(?:\$?[a-z]{1,3}\$?\d{1,7})\s*:\s*(?:\$?[a-z]{1,3}\$?\d{1,7})/i.test(source))result.push('range','cell');
  const softwareImage=/\b(?:docker|container|oci|disk|iso|firmware|bootable|virtual machine)\s+images?\b|(?:docker|容器|磁盘|固件|启动)镜像/i.test(source);
  const explicitVisual=/照片|图片|插画|海报|头像|漫画|图解|\b(?:photo|picture|illustration|portrait|poster|comic|diagram|screenshot)\b/i.test(source);
  return unique(result.filter(x=>x.length>1 && !STOP.has(x) && !(x==='image'&&softwareImage&&!explicitVisual)));
}
function operation(entry, describedPurpose) {
  const name = norm(entry.name.split('__').at(-1)).replace(/[_-]/g,' ');
  const purpose = primaryPurpose(describedPurpose ?? toolPurpose(entry.description));
  const diagnostics = diagnosticCompilationPurpose(describedPurpose ?? toolPurpose(entry.description));
  if (entry.annotations?.destructiveHint === true) return {action:'commit',phase:'delivery',effect:'high-impact'};
  // General local runtimes can read or mutate. Classifying all execution as
  // writing would hide the only file reader in a read-only diagnostic task.
  if (capabilityRole(purpose)==='local-execution') return {action:'execute',phase:'implementation',effect:'unknown'};
  // Polling a generation job is a separate operation from creating the job.
  // Its name contains the producer's action, but that does not make it a writer.
  if (/\b(?:get|list|read|fetch|check|inspect)\b.*\b(?:jobs?|status|results?|progress|logs?)\b/.test(name))
    return {action:'read',phase:'discovery',effect:entry.annotations?.readOnlyHint === true?'read':'unknown'};
  // Removing a background creates/edits a visual artifact; deleting a file or
  // external record remains a high-impact operation below.
  if (/\b(?:remove|erase)\s+(?:image\s+)?background\b/.test(name) && /\b(?:image|photo|picture|background)\b/i.test(purpose))
    return {action:'change',phase:'implementation',effect:'write-or-unknown'};
  // Mutating names dominate hints. Hints are descriptive metadata, never authorization.
  if (/\b(send|post message|reply|email send)\b/.test(name)) return {action:'communicate',phase:'delivery',effect:'external-write'};
  if (/\b(deploy|publish|release|merge|purchase|pay|delete|remove|drop|destroy)\b/.test(name)) return {action:'commit',phase:'delivery',effect:'high-impact'};
  if (publicWebPurpose(purpose)&&!/\b(?:create|update|edit|write|save|persist|insert|upload|push|apply|generate|mutate|change|set|add|build|install|reset|click|type|select|copy|import|export|move|rename)\b/.test(name))
    return {action:'read',phase:'discovery',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'};
  if (/\b(create|update|edit|write|save|persist|insert|upload|push|apply|execute|exec|run|query|generate|mutate|change|set|add|build|install|reset|click|type|select|keyboard|mouse|duplicate|copy|import|export|move|rename)\b/.test(name)
      || /\bcompile\b/.test(name)&&!diagnostics) return {action:'change',phase:'implementation',effect:'write-or-unknown'};
  // A compiler can expose a diagnostics-only operation. Its concrete contract
  // distinguishes that operation from building/exporting an artifact; prose
  // alone still does not verify effects or supply a readOnlyHint. Other
  // mutating names above retain their conservative classification.
  if (diagnostics) return {action:'verify',phase:'validation',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'};
  // Native tool names need not contain an action (e.g. an opaque function name).
  // The actual purpose may establish a mutation, but prose never establishes a
  // read-only guarantee and cannot override the high-impact checks above.
  if (/^(?:(?:generate|create|edit|modify|render|transform|convert|crop|resize|retouch|write|run|execute)\b|(?:生成|制作|编辑|修改|渲染|转换|运行))/i.test(purpose)
      || /^Use\s+(?:this\s+)?[^.!?]{0,100}\btool for\b[^.!?]{0,180}\b(?:authoring|editing|generation|creation|modification)\b/i.test(purpose)
      || /\b(?:tool|function)\s+(?:enables|performs|supports)\b[^.!?。！？]{0,180}\b(?:generation|creation|editing|modification)\b/i.test(purpose))
    return {action:'change',phase:'implementation',effect:'write-or-unknown'};
  if (/\b(test|validate|verify|check|inspect|screenshot)\b/.test(name)) return {action:'verify',phase:'validation',effect:entry.annotations?.readOnlyHint === true?'read':'unknown'};
  if (/\b(search|find|fetch|get|list|read|browse|lookup|resolve|open|status|windows)\b/.test(name) || entry.annotations?.readOnlyHint===true) return {action:'read',phase:'discovery',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'};
  return {action:'unknown',phase:'implementation',effect:'unknown'};
}

function sharedServiceOverview(value) {
  // A connector overview describes a service's many capabilities. Its broad
  // build/publish instructions are not the purpose of each child operation.
  return /^Use [^.!?\n]{1,120} to\b/i.test(value)
    && /\bUse this (?:connector|integration|plugin|service) for\b/i.test(value);
}

function toolPurpose(description, commonParagraphs = new Set()) {
  const prose=String(description || '').split(/^\s*exec tool declaration\s*:/im)[0]
    .replace(/```[\s\S]*?```/g,'');
  const paragraphs=prose.split(/\r?\n\s*\r?\n/).map(value=>value.trim()).filter(Boolean);
  // Registries often prepend the same server handbook to each operation.
  // Remove only a verified common prefix, stopping at the first unique part.
  while (paragraphs.length && commonParagraphs.has(paragraphs[0])) paragraphs.shift();
  // Native registries can prefix an exact namespace caption. It describes the
  // wrapper, not the function. Do not discard arbitrary leading prose or scan
  // later guidelines/examples for a convenient-looking matching instruction.
  while (paragraphs.length>1 && /^Tools in (?:the )?[\w.-]+ namespace\.?$/i.test(paragraphs[0])) paragraphs.shift();
  if (paragraphs.length>1 && sharedServiceOverview(paragraphs[0])) paragraphs.shift();
  const serverAt=paragraphs.findIndex(value=>/^MCP server instructions\s*:/i.test(value));
  // Host metadata often wraps the actual tool description in an app title and
  // shared server rules. Those rules concern every tool, not this operation.
  if (serverAt>=0) return (paragraphs[serverAt+1] || paragraphs.slice(0,serverAt).join(' ')).slice(0,700);
  let [first='',second='']=paragraphs;
  if (/^Manage (?:the|a|an) [^\n]+app:/i.test(first) && /^(?:Locate|Find|Get|Read|List|Create|Update|Open|End|Return|Start|Set|Compile|Diagnose)\b/i.test(second)) first=second;
  if (/^Use `[^`]+` for [\s\S]*\bexecution\b/i.test(first) && /^Execute\s+(?:JavaScript|Python|code)\b/i.test(second)) first=second;
  // Some registries attach the same entire server workflow to every function.
  // It is not this function's purpose; its exact identifier is still usable.
  if (/^#{1,6}\s*(?:\d+[.)]\s*)?(?:WINDOW TARGETING|UI INTERACTION|Core Workflows)/i.test(first)) return '';
  const shortHeading=first.length<=80 && !/[.!?。！？:：]/.test(first);
  const specificOperation=/^(?:search(?:es)?|find(?:s)?|get(?:s)?|read(?:s)?|fetch(?:es)?|retrieve(?:s)?|list(?:s)?|create(?:s)?|update(?:s)?|delete(?:s)?|render(?:s)?|inspect(?:s)?|validate(?:s)?|return(?:s)?|run(?:s)?|execute(?:s)?|capture(?:s)?|compile(?:s)?|diagnose(?:s)?|搜索|检索|读取|获取|列出|创建|更新|删除|渲染|检查|返回)\b/i;
  // Also accept metadata whose shared rules were stripped by the host. Never
  // switch to paragraphs starting with cross-tool directions such as "Use ...".
  return (shortHeading && specificOperation.test(second) ? second : first).slice(0,700);
}

function registryPurposePrefixes(capabilities) {
  const counts=new Map();
  for (const entry of capabilities.filter(x=>x.kind==='tool')) {
    const paragraphs=String(entry.description||'').split(/^\s*exec tool declaration\s*:/im)[0].split(/\r?\n\s*\r?\n/).map(x=>x.trim()).filter(Boolean);
    // Only explicit server/app overviews are eligible, never ordinary repeated
    // purpose sentences or secondary examples from unrelated tools.
    if (!paragraphs.some(x=>/^MCP server instructions\s*:/i.test(x))&&!sharedServiceOverview(paragraphs[0]||'')&&!/^#{1,6}\s*[^\n]*(?:Server|Core Workflows)|^Manage (?:the|a|an) [^\n]+app:|^Search and work with files from\b|^Use [\s\S]*\bconnected [\s\S]*\bCall `[^`]+` first\b/i.test(paragraphs[0]||'')) continue;
    paragraphs.forEach((paragraph,index)=>{const key=`${index}\0${paragraph}`;counts.set(key,(counts.get(key)||0)+1);});
  }
  return new Set([...counts].filter(([,count])=>count>=2).map(([key])=>key.slice(key.indexOf('\0')+1)));
}

// Capabilities are classified from their observed concrete purpose, not a
// tool-name allowlist. These are substrate gaps, not extra user authorization.
function capabilityRole(purpose) {
  if (diagnosticCompilationPurpose(purpose)) return 'compilation-diagnostics';
  if (publicWebPurpose(purpose)) return 'public-web-access';
  if (/^(?:Runs?|Executes?)\s+(?:a\s+)?(?:local\s+(?:shell\s+)?|shell\s+)commands?\b/i.test(purpose)&&!/^.*?\b(?:remote|cloud|database|SQL)\b[^.!?]*[.!?]?$/i.test(primaryPurpose(purpose))
    || /^(?:Runs?|Executes?)\s+(?:a\s+)?(?:shell\s+)?command\b[^.!?]*\b(?:PTY|terminal|shell|local)\b/i.test(purpose)
    || /^Execute\s+(?:JavaScript|Python|code)\b[^.!?]*\b(?:persistent|local|repl|runtime)\b/i.test(purpose)) return 'local-execution';
  if (/^(?:Locate|Find|Discover)\b[^.!?]*\b(?:bundled|workspace)\b[^.!?]*\b(?:dependenc|runtime|librar)/i.test(purpose)) return 'document-runtime';
  if (/^(?:View|Inspect|Read)\b[^.!?]*\b(?:local|filesystem|disk)\b[^.!?]*\bimage\b|^(?:View|Inspect|Read)\b[^.!?]*\bimage\b[^.!?]*\b(?:local|filesystem|disk)\b/i.test(purpose)) return 'image-observation';
  if (/(?:^Reads?\s+(?:an?\s+)?observed element|\bcapture\b[^.!?]*\b(?:element tree|screenshot)\b|^Capture\b[^.!?]*\b(?:window|screen|monitor|desktop)\b)/i.test(purpose)) return 'interface-observation';
  return null;
}

function publicWebPurpose(purpose) {
  const opening=primaryPurpose(purpose);
  // A general public-web entry can expose several methods. Its own purpose
  // establishes discovery, not a particular method, effect or authentication.
  if (/\b(?:private|personal|account|mailbox|workspace|intranet|local|offline|database)\b|\b(?:tools?|plugins?)\s+(?:catalog|directory|registry|management)\b|私人|账户|账号|内网|本地|离线/i.test(opening)) return false;
  return /^(?:Tool for\s+)?(?:access(?:ing)?|brows(?:e|ing)|search(?:ing)?|open(?:ing)?)\s+(?:the\s+)?(?:internet|public\s+web(?:sites?|pages?)?)\b/i.test(opening)
    || /^(?:用于)?(?:访问|浏览)(?:互联网|公网|公开网站|公开网页)/.test(opening);
}

const restrictedAccess=/(?:受限|私有|私人|需(?:要)?(?:先)?登录|登录后|已有登录|登录权限|凭.{0,12}登录|经过认证|身份认证)|\b(?:restricted|private|authenticated|authentication[- ]required|login[- ]required|sign[- ]in[- ]required|signed[- ]in|logged[- ]in|existing\s+(?:login|session)|requires?\s+(?:a\s+)?(?:login|authentication))\b/i;
const sourceRead=/阅读|读取|查阅|查看|获取|打开|访问|浏览|检索|搜索|\b(?:read|fetch|open|browse|visit|consult|search|retrieve)\b/i;
const remoteSource=/公网来源|本地网络来源|https?:\/\/|(?:受限|私有|私人|内网).{0,12}(?:页面|网页|网站|文档|资料)|\b(?:page|website|document|resource|intranet)\b/i;
function accessWork(assessment) {
  const clauses=list(assessment.activeClauses).length?assessment.activeClauses:[assessment.activeText || ''];
  return currentWorkClauses(clauses.map(value=>requestEvidenceText(positiveRequestText(value))));
}
function restrictedSourceAt(work,index) {
  const clause=work[index];
  if(restrictedAccess.test(clause))return true;
  // A separate access qualifier belongs to the preceding resource. Another
  // resource/action clause cannot lend its private authentication requirement.
  const next=work[index+1] || '';
  return !remoteSource.test(next)&&restrictedAccess.test(next)
    && /^(?:请)?(?:用|使用|凭|通过)|^\s*(?:use|using|with|via)\b/i.test(next);
}
function sourceAccessNeeds(assessment) {
  const work=accessWork(assessment);
  return work.flatMap((clause,index)=>{
    if(!remoteSource.test(clause)||!sourceRead.test(clause)||!restrictedSourceAt(work,index)
      || /本地(?:保存|副本|文件)|离线|\b(?:local\s+(?:copy|file)|offline)\b|(?:给定|已提供|粘贴).{0,15}(?:正文|内容|摘录)|\b(?:provided|supplied|pasted)\s+(?:text|content|excerpt)\b/i.test(clause)
      || /^\s*(?:(?:please|only|now)\s+|请|只|仅)*(?:explain|describe|how\b|解释|介绍|说明如何|如何)/i.test(clause))return [];
    return [{accessClass:'authenticated-private',requirementSource:'user-request',evidence:clause,
      authenticationStatus:'unknown',capabilityStatus:'unverified',
      gaps:['authenticated-source-capability-unverified','authentication-state-unverified'],
      authority:'advisory-only',
      guidance:'该来源需要与目标资源匹配的受限内容读取能力及认证状态证据；当前元数据未证明可读取或已登录。沿用现有授权，核实可用连接器/浏览器会话与目标访问条件；公开搜索不能证明读到了受限内容，保留用户对搜索与上传的限制。'}];
  });
}

function publicWebNeed(assessment, includeHostNeeds = true) {
  const source=/公网来源|官网|官方(?:网站|网页|来源|文档|资料|公告)|公开(?:网页|网站|来源|资料)|门户|互联网|\b(?:internet|public\s+(?:web|websites?|webpages?|sources?)|official\s+(?:[a-z][a-z0-9_-]*\s+){0,3}(?:web\s+)?(?:sites?|websites?|sources?|docs?|documentation|announcements?))\b|https?:\/\//i;
  // Chinese lookup verbs admit ordinary aspect/reduplication, not just formal
  // 查询. Bare 查/搜 require a request lead, avoiding nouns such as 调查表.
  const retrieve=/(?:查(?:询|找|阅|看|证|一下|一查|下|查)|搜(?:索|一下|一搜|下|搜)|看(?:一下|一看|看)|(?:^|请|帮我|替我|先|再)\s*[查搜]|只搜|检索|核实|核查|核对|确认|获取|阅读|读取|打开|访问|浏览|调研|比较|对比|标注|引用)|\b(?:search|look\s+up|find|check|verify|fetch|read|open|browse|visit|consult|research|compare|cite)\b/i;
  const work=accessWork(assessment);
  if(work.some(clause=>/^(?:请)?(?:只|仅)(?:用|使用|根据|依据|基于).{0,15}(?:给定|提供|粘贴|附上).{0,15}(?:正文|内容|摘录|资料|材料|文本)|^\s*(?:use|consult)\s+only\s+(?:the\s+)?(?:provided|supplied|pasted|attached)\b/i.test(clause)))return false;
  const eligible=work.map((clause,index)=>{
    // currentWorkClauses normalizes pure chat speech to this inert marker.
    // Host retrieval hints must not turn that marker into external work.
    if(clause==='说明')return false;
    if(restrictedSourceAt(work,index))return false;
    // Local copies, account records, and explanations are different inputs.
    // Evaluate each work clause so a separate public lookup can still survive.
    if (/本地|离线|私人|私有|账户|账号|登录后|我的.{0,12}(?:订单|账单|订阅|记录|数据)|个人(?:信息|记录|账单|订单|订阅)|\bmy\s+(?:orders?|invoices?|subscriptions?|records?|data)\b|\b(?:local|offline|private|personal|account|logged[- ]in|intranet)\b|localhost|127\.0\.0\.1|file:\/\//i.test(clause)) return false;
    if (/^\s*(?:(?:please|only|now|currently)\s+|请|现在|本次|本轮|只|仅|只需|仅需)*(?:explain|describe|how\b|解释|介绍|说明如何|如何)/i.test(clause)) return false;
    if (/(?:给定|已提供|附上|粘贴).{0,15}(?:正文|内容|摘录|资料|材料|文本)|\b(?:provided|supplied|pasted|attached)\s+(?:text|content|excerpt|documents?)\b/i.test(clause)) return false;
    return clause;
  });
  // A neighboring explicit source instruction can qualify the lookup clause;
  // unrelated mentions or an excluded local/private clause cannot supply it.
  const sourceInstruction=clause=>clause&&source.test(clause)
    && /^(?:请)?(?:资料来源|信息来源|来源|出处|以|用|依据|根据)|^\s*(?:use|consult)\b.*\b(?:source|reference)\b/i.test(clause);
  if(eligible.some((clause,index)=>clause&&retrieve.test(clause)
    && (source.test(clause)||sourceInstruction(eligible[index-1])||sourceInstruction(eligible[index+1]))))return true;
  // Host interpretations retain their separate retrieval lane. They cannot
  // revive an excluded local/explanation/supplied-text task or lend a source
  // across user clauses; each need must independently establish public lookup.
  return includeHostNeeds&&eligible.some(Boolean)&&!sourceAccessNeeds(assessment).length
    && list(assessment.interpretation?.retrievalCapabilityNeeds??assessment.capabilityNeeds)
      .filter(value=>typeof value==='string')
      .some(value=>publicWebNeed({activeText:value,activeClauses:[value]},false));
}

function diagnosticCompilationPurpose(purpose) {
  // Require the operation itself to compile for diagnostics and separately
  // describe reading without source changes and returning without export.
  // Cross-tool instructions or a compiler's incidental log output do not do so.
  return /^Compile\b[^.!?]*\breturn diagnostics\b/i.test(primaryPurpose(purpose))
    && /\bReads?\b[^.!?]*\bwithout (?:modifying|changing|editing)\b/i.test(purpose)
    && /\breturns? diagnostics without exporting\b/i.test(purpose);
}

function diagnosticCompilationObjectMatch(purpose, queryTerms) {
  const source=primaryPurpose(purpose).split(/\b(?:documents?|projects?|files?|sources?)\b/i)[0];
  return terms(source).some(term=>!GENERIC_SIGNALS.has(term)&&!PURPOSE_GENERIC.has(term)
    && !['compile','saved','diagnostic'].includes(term)&&queryTerms.has(term));
}

function taskSubstrateNeeds(assessment) {
  const clauses=list(assessment.activeClauses).length?assessment.activeClauses:[assessment.activeText];
  const positive=currentWorkClauses(clauses.map(positiveRequestText)).join(' ');
  const explanationOnly=/^\s*(?:explain|describe|what\b|how\b|介绍|解释|讲讲|什么是|如何)/i.test(positive)
    && !/请实际|实际(?:运行|读取|检查)|\b(?:actually|please)\s+(?:run|read|inspect|execute)\b/i.test(positive);
  const local=/本地|离线|目录|原件|文件|脚本|工程|源码|\b(?:local|offline|directory|filesystem|files?|script|source code|repository|project)\b|\.(?:csv|json|py|js|html|tex|sty|bib|log|blg|md|step|stl|ap17)\b/i.test(positive);
  const execute=/实际(?:运行|测试|生成|编译|渲染|玩通)|运行|执行|编译|渲染|求解脚本|本地(?:自检|验证|校验)|\b(?:run|execute|compile|render|benchmark)\b/i.test(positive);
  const inspect=/读取|查看|检查|诊断|核对|提取|回读|\b(?:read|inspect|diagnose|extract|verify|check)\b/i.test(positive);
  const create=/生成|另存|制作|写入|编写|写一个|做成|做一(?:个|支|份|张|页)|建立索引|输出.{0,30}(?:文件|源文件|报告|计算表|csv|json|markdown)|\b(?:create|write|generate|save|build|implement|produce)\b/i.test(positive);
  const files=/文件|目录|脚本|源码|报告|计算表|\.\w{2,5}\b|\b(?:files?|directories|scripts?|source code|report)\b/i.test(positive);
  const interfaceRead=/(?:当前|现有|已经打开|已打开).{0,35}(?:界面|屏幕|窗口|阅读器)|(?:桌面|屏幕).{0,45}(?:观察|查看|看一下|读到)|\b(?:current|existing|already open)\b.{0,40}\b(?:window|screen|desktop|interface)\b/i.test(positive)
    && /观察|查看|看一下|确认|读到|读取|截图|\b(?:inspect|observe|read|capture|confirm)\b/i.test(positive);
  const bridge=/\b(?:bridge|local api)\b|本地接口/i.test(positive)&&inspect;
  const office=/\.(?:docx?|xlsx?|pptx?|pdf)\b|\b(?:word|powerpoint|spreadsheet|slide deck)\b|可编辑.{0,12}(?:简历|幻灯片|PPT)|演示文稿/i.test(positive);
  const remoteOnly=/google\s*(?:docs?|sheets?|slides?|drive)|docs\.google/i.test(positive)&&!/(?:生成|输出|保存|写).{0,50}本地|本地.{0,50}(?:生成|输出|保存|写)|\.(?:docx|xlsx|pptx)\b/i.test(positive);
  const localImage=/\.(?:png|jpe?g|webp|gif|tiff?|bmp)\b|(?:本地|原始|现有).{0,20}(?:图片|图像|照片)|\b(?:local|existing|source)\b.{0,20}\b(?:image|photo|picture)\b/i.test(positive);
  const imageWork=imageArtifact(positive)||/(?:观察|查看|检查|先看|\binspect\b|\bview\b|\bread\b).{0,60}(?:原图|照片|图片|图像|\.(?:png|jpe?g|webp|gif|bmp|tiff?)\b|\b(?:images?|photos?|pictures?)\b)/i.test(positive);
  const specialist=taskSpecialistNeeds(assessment);
  const compilationDiagnostics=!explanationOnly&&/编译|\bcompil(?:e|ation)\b/i.test(positive)&&/诊断|\bdiagnos(?:tic|tics|e|is)\b/i.test(positive);
  const builtinDiagnostics=compilationDiagnostics&&/内置|\bbuilt[- ]in\b/i.test(positive)
    && !/(?:运行|执行|编写).{0,15}(?:脚本|命令)|\b(?:run|execute|write)\b.{0,25}\b(?:script|command)\b/i.test(positive);
  // Reuse the restriction parser's witnessed operation and structured input
  // role. A read-only attribute alone does not request reading its object.
  const readOnlyLocalInput=list(assessment.restrictions?.evidence).some(item=>item?.source==='user-request'
    && item.basis==='explicit-read-only-operation')
    && list(assessment.taskStructure?.artifacts).some(item=>item.role==='input')
    && /(?:[a-z]:[\\/]|\.{1,2}[\\/])|\.(?:csv|json|txt|md|log|xlsx?|docx?|pptx?|pdf|parquet)\b/i.test(
      String(assessment.originalRequest||'').replace(/https?:\/\/[^\s<>"'，。；;]+/gi,''));
  // An offline specialist project is not itself evidence that a shell can
  // operate it. Bind generic execution to actual files/scripts/commands or a
  // documented local bridge. The host may separately supply an evidenced gap.
  // RUN may be a hardware state in a prohibition, not an execution verb.
  // General execution needs an actual operation lead, not the bare token.
  const runtimeAction=value=>/(?:^|[,;，；]|\b(?:and|then)\s+)\s*(?:(?:please|actually)\s+|请|先|再|然后|并且|并)*(?:run|execute)\b|运行|执行/i.test(value);
  const executionObject=files||/命令|\bcommands?\b/i.test(positive)||runtimeAction(positive)
    || list(assessment.taskStructure?.artifacts).length>0;
  const localExecution=!explanationOnly&&!interfaceRead&&!remoteOnly&&!builtinDiagnostics&&!(specialist.databaseRead&&!specialist.localWork)
    && (readOnlyLocalInput || bridge || local && executionObject && (execute || inspect || create&&!imageWork));
  const localEvidence=localExecution?currentWorkClauses(clauses.map(positiveRequestText)).filter(value=>
    runtimeAction(value)||/文件|目录|脚本|源码|报告|计算表|命令|\.(?:[a-z][a-z0-9]{1,5})\b|\b(?:files?|directories|scripts?|source code|report|command|bridge|local api)\b|本地接口/i.test(value)
      && !/^(?:文件|资料|文本)(?:中|里)(?:若|如果|假如)/.test(value.trim())) : [];
  const userPublicWeb=publicWebNeed(assessment,false);
  return {
    'public-web-access': userPublicWeb||publicWebNeed(assessment),
    publicWebNeedSource:userPublicWeb?'user-request':'host-context',
    'local-execution': localExecution,
    localExecutionEvidence:localEvidence,
    'compilation-diagnostics': compilationDiagnostics,
    'document-runtime': !explanationOnly&&office&&(create||inspect||execute)&&!interfaceRead&&!remoteOnly,
    'image-observation': !explanationOnly&&localImage&&imageWork,
    'interface-observation': !explanationOnly&&interfaceRead,
  };
}

function taskSpecialistNeeds(assessment) {
  const clauses=list(assessment.activeClauses).length?assessment.activeClauses:[assessment.activeText || ''];
  const positive=currentWorkClauses(clauses.map(positiveRequestText)).join(' ');
  const explanationOnly=/^\s*(?:explain|describe|what\b|how\b|介绍|解释|讲讲|什么是|如何)/i.test(positive)
    && !/请实际|实际(?:运行|读取|检查|测试|试玩)|\bactually\s+(?:run|read|inspect|test|query)\b/i.test(positive);
  const browserObject=/浏览器|网页|页面|\b(?:browser|web(?:page|site)?|html|frontend|playwright)\b/i.test(positive);
  const browserValidation=!explanationOnly&&browserObject&&/试玩|截图|截屏|渲染|实际.{0,12}(?:检查|测试|验证|操作)|\b(?:test|verify|validate|playtest|screenshot|render|interact)\b/i.test(positive);
  const databaseRead=!explanationOnly&&/数据库|数据表|(?:指定|现有|项目|的).{0,50}表|\b(?:database|postgres(?:ql)?|sql|tables?|rows?)\b/i.test(positive)
    && /查询|聚合|分组计数|统计.{0,20}行数|\b(?:query|queries|aggregate|count|group by|read)\b/i.test(positive);
  return {browserValidation,databaseRead,recordRead:recordReadWitness(assessment),
    localBrowser:browserValidation&&/本地|离线|loopback|localhost|127\.0\.0\.1|file:\/\/|\b(?:local|offline)\b/i.test(positive),
    localWork:/本地|离线|文件|目录|脚本|\b(?:local|offline|filesystem|files?|directories|scripts?|source code)\b|\.(?:csv|json|sql|sqlite|db|py|js|html|xlsx?|docx?|pptx?|pdf|parquet)\b/i.test(positive)};
}

// A record operation is stronger evidence than a provider word or an isolated
// “statistics” keyword. Preserve the source clauses; no query or identifier is
// inferred and no material inside quoted reference text becomes an instruction.
function recordReadWitness(assessment) {
  const clauses=currentWorkClauses((list(assessment.activeClauses).length?assessment.activeClauses:[assessment.activeText||'']).map(positiveRequestText));
  const active=clauses.join(' ');
  if(/^(?:请\s*)?(?:解释|介绍|说明如何|如何|讲解|explain\b|describe\b|how\b)/i.test(active)
    || /(?:只|仅)(?:给|提供|说明|写出).{0,12}(?:方法|思路|步骤|示例|SQL)|\b(?:only|just)\s+(?:explain|describe|provide\s+(?:a\s+)?(?:method|example))\b/i.test(active))return null;
  const objects=clauses.filter(x=>/(?:[\p{Script=Han}]{1,10}(?:表|记录|明细))|\b(?:tables?|rows?|records?|entries)\b/u.test(x));
  const operations=clauses.filter(x=>/统计|分组|计数|重复|去重|\b(?:aggregate|count|group\s+by|duplicate|deduplicate)\b/i.test(x));
  const reads=clauses.filter(x=>/查看|读取|检查|查询|只读|\b(?:read|inspect|check|query)\b/i.test(x));
  if(!objects.length||!operations.length||!reads.length)return null;
  return {evidence:unique([...objects,...operations,...reads]),authority:'advisory-only'};
}

function recordReadCapability(entry,purpose,witness,providerMentioned,queryTerms) {
  if(!witness||!providerMentioned||entry.kind!=='tool')return null;
  const opening=primaryPurpose(purpose);
  // Only a concrete retrieval contract can cross the bilingual term boundary.
  // Mutating names/effects remain subject to operation() and capabilityGates().
  if(!/^(?:Read|Retrieve|Fetch|Inspect|List|Find)\b/i.test(opening))return null;
  if(['change','commit','communicate'].includes(operation(entry,purpose).action))return null;
  const head=opening.split(/\bbefore\b/i)[0];
  let role=null;
  if(/\b(?:rows?|records?|entries)\b/i.test(head)&&/\b(?:table|database|collection|store)\b/i.test(opening))role='record-read';
  else if(/\b(?:schema|tables?|structure)\b/i.test(head)&&/\b(?:database|collection|store)\b/i.test(opening))role='record-schema';
  else if(/^List\b/i.test(opening)&&/\b(?:own|owned|accessible|account|workspace)\b/i.test(opening)
    && terms(opening).some(term=>queryTerms.has(term)&&!GENERIC_SIGNALS.has(term)&&!PURPOSE_GENERIC.has(term)))role='record-resource-discovery';
  if(!role)return null;
  return {role,evidence:witness.evidence,
    purpose:role==='record-read'?'读取用户要求统计或查重的实际记录；核实字段、范围与分页完整性':
      role==='record-schema'?'先核对记录所在的真实表结构及标识符，不猜绑定或列名':
      '仅在缺少已核实资源标识时定位用户指定的服务资源；有现成标识则复用',
    scope:'discovery only; authentication, identifiers and complete pagination are unverified'};
}

// Containers may establish a concrete discovery gap, never a callable action
// or an authenticated connection. An exact parent may supply missing metadata.
function specialistDiscovery(entry, inventory, needs, providerMentioned) {
  if(entry.kind==='tool')return null;
  const parent=entry.kind==='mcp'&&entry.plugin
    ? inventory.capabilities.find(item=>item.kind==='plugin'&&item.plugin===entry.plugin):null;
  const description=entry.description || parent?.description || '';
  const statements=description.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(x=>x.trim()).filter(x=>x&&!/^(?:do not|don't|not |never |不得|不要|不支持)/i.test(x));
  if(needs.browserValidation){
    const purpose=statements.find(x=>/\bbrowser\b|浏览器/i.test(x)&&/\b(?:automation|automate|testing|test|playtesting|screenshot|navigate|click)\b|测试|试玩|截图|自动化/i.test(x));
    if(purpose)return {role:'browser-validation',phase:'validation',purpose,network:networkPurpose(purpose),
      supportsLocal:/\blocal\b|localhost|127\.0\.0\.1|file:\/\/|本地|离线/i.test(purpose),sourceId:parent?.id || entry.id};
  }
  if(needs.databaseRead&&providerMentioned){
    const purpose=statements.find(x=>/\b(?:database|postgres(?:ql)?|sql)\b|数据库/i.test(x)
      && /\b(?:query|queries|querying|read|aggregate|select)\b|查询|读取|聚合/i.test(x));
    if(purpose)return {role:'database-access',phase:'discovery',purpose,
      network:entry.transport==='remote'?'network':networkPurpose(purpose),sourceId:parent?.id || entry.id};
  }
  return null;
}

// Secondary instructions often mention tools, inputs and artefacts that this
// function does not itself provide. Rank its concrete opening purpose instead.
function primaryPurpose(purpose) {
  return purpose.split(/[。！？]|(?<=[.!?])\s+(?=[A-Z\p{Script=Han}])/u)[0];
}

function concretePurposeMatch(purpose, queryTerms) {
  const opening=primaryPurpose(purpose);
  // Without purpose metadata, retain the existing name-based fallback; do not
  // fabricate a purpose from server boilerplate that discovery discarded.
  if(!opening.trim())return true;
  const objects=terms(opening).filter(term=>!GENERIC_SIGNALS.has(term)&&!PURPOSE_GENERIC.has(term));
  return objects.some(term=>queryTerms.has(term));
}

function networkPurpose(purpose) {
  const opening=primaryPurpose(purpose);
  if (publicWebPurpose(opening)) return 'network';
  // Classify the operation's purpose, never a provider's name or read-only
  // annotation. Local execution can be constrained by the host's inputs.
  const remote=/\b(?:internet|public web|web search|online|remote|cloud(?:flare)?|deployed|hosted|connected (?:account|service|workspace))\b|联网|公网|云端|远程服务|在线服务/i.test(opening);
  const local=/\b(?:local|offline|filesystem|on.disk|bundled)\b|本地|离线|文件系统/i.test(opening);
  if (remote&&local) return 'unknown';
  if (remote) return 'network';
  if (local) return 'local';
  if (/\b(?:google\s+(?:drive|docs?|sheets?|slides?|calendar)|gmail|github|gitlab|figma|slack)\b/i.test(opening)) return 'network';
  return 'unknown';
}

function declaredProvider(entry) {
  // Some host registries expose the app owner in a fixed attribution sentence
  // rather than a plugin field. This scopes retrieval; it grants no permission
  // and does not establish availability, authentication or an explicit call.
  const prose=String(entry.description||'').split(/^\s*exec tool declaration\s*:/im)[0].replace(/```[\s\S]*?```/g,'');
  return prose.match(/\bThis tool is part of plugin `([^`\n]{1,100})`\.\s*$/i)?.[1] || null;
}

function managementPurposeMatch(purpose, clauses) {
  // Catalog, routing and coordination APIs operate on the agent's management
  // objects, not on an application's similarly named records or HTTP routes.
  // Classify their observed purpose rather than a provider/tool identifier.
  const opening=primaryPurpose(purpose);
  if(/workItems|具体子任务|\b(?:subagent|agent coordination|task dependencies)\b/i.test(opening))
    return clauses.some(clause=>/子任务|任务依赖|依赖环|协作调度|分配.{0,15}(?:任务|agent)|\b(?:subagents?|agent coordination|task dependencies|work items|parallel workstreams)\b/i.test(clause));
  if(/\brouteId\b/i.test(opening)&&/遇阻|低信心|recovery/i.test(opening))
    return clauses.some(clause=>/任务.{0,20}(?:遇阻|失败|恢复|低信心)|遇阻|低信心|恢复计划|\b(?:blocked task|failed task|recovery plan|low confidence)\b/i.test(clause));
  if(/技能(?:全文|目录|选择|路径|名|路由|匹配)|(?:列出|查询|扫描|读取).{0,20}技能|\b(?:read|list|search|find|select|match|route)\w*\b.{0,20}\bskills?\b|\bskill (?:selection|routing|catalog|registry|directory)\b|\brouteId\b/i.test(opening)
    || /扫描.{0,12}技能.{0,12}插件|\bscan\b.{0,30}\bskills\b.{0,20}\bplugins\b/i.test(purpose))
    return clauses.some(clause=>/技能.{0,18}(?:全文|说明|目录|列表|检索|搜索|匹配|选择|路由|推荐|维护)|(?:读取|查看|获取|列出|查找|搜索|检索|扫描|诊断|检查|维护).{0,18}技能|\b(?:read|list|search|find|inspect|route|select|match|discover)\b.{0,25}\bskills?\b|\b(?:skill|capability)[- ](?:routing|selection|discovery|registry|catalog|directory)\b|\bdynamic[-_ ]skill[-_ ]router\b/i.test(clause));
  if(/扫描.{0,25}(?:插件|MCP).{0,15}配置|\b(?:capability|tool|plugin) (?:inventory|registry)\b/i.test(opening))
    return clauses.some(clause=>/(?:扫描|列出|枚举|查找|检查|发现).{0,25}(?:插件|工具|MCP).{0,15}(?:配置|能力|目录|可用)|\b(?:scan|list|enumerate|discover|inspect)\b.{0,30}\b(?:capabilities|plugins|tool inventory|tool registry)\b/i.test(clause));
  return true;
}

function requestEvidenceText(value) {
  // A protocol method and endpoint identify syntax, not a social post or the
  // resource named by an arbitrary endpoint. Preserve the raw request for
  // authorization, explicit names, actions and auditable binding text.
  const protocol=String(value || '').replace(/\b(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)\s+(?:https?:\/\/[^\s,;，；。]+|\/[^\s,;，；。]+)/gi,' HTTP endpoint ');
  return semanticTaskText(protocol);
}

function currentPhase(active, given) {
  if (given && given!=='auto') return given;
  active=currentWorkClauses(String(active||'').split(/[\n。；;，,]+/).map(positiveRequestText)).join(' ');
  if (/测试|验证|排查|调试|检查|诊断|test|validat|debug|verify|inspect|check|diagnos/i.test(active)) return 'validation';
  if (/部署|上线|发布|发送|删除|deploy|publish|send|delete|merge/i.test(active)) return 'delivery';
  if (/实现|修改|编辑|修图|抠图|修复|编写|开发|构建|生成|制作|绘制|(?<![a-z0-9_./\\-])(?:implement|build|fix|edit|develop|create|generate|draw|render|retouch|write|save|copy|duplicate|import|export)(?![a-z0-9_./\\-])/i.test(active)) return 'implementation';
  if (/设计|design/i.test(active)) return 'design';
  return 'discovery';
}
const OUTCOME = {discovery:'获取当前任务缺失的具体资料或项目状态',planning:'取得制定方案所需的具体依据',design:'获得实现所需的设计资料',implementation:'生成或修改当前任务要求的产物',validation:'取得可验证的运行结果或缺陷证据',delivery:'完成用户当前明确要求的交付动作'};

const decisionOrder = {'use-now':0,'check-scope':0,'discover-first':1,'defer':2,'skip':3};
const candidateOrder = (a,b) => decisionOrder[a.decision]-decisionOrder[b.decision] || b.score-a.score || a.id.localeCompare(b.id);

// Coverage is about finding evidence for a need, not authorizing its execution.
// Reserve room for distinct needs before filling remaining slots by relevance.
function selectCandidates(cards, needs, limit) {
  const concrete = cards.filter(card => !(card.kind==='tool' && (card.plugin||card.server||/^mcp__/.test(card.name)) && !card.explicit && !card.providerRequested
    && card.effect==='write-or-unknown' && cards.some(other=>other.kind==='tool' && !other.plugin && !other.server&&!/^mcp__/.test(other.name)
      && other.availability.callable && other.effect===card.effect && other.phase===card.phase
      && card.matchedTerms.filter(term=>!GENERIC_SIGNALS.has(term)).length>0
      && (card.matchedTerms.filter(term=>!GENERIC_SIGNALS.has(term)).every(term=>other.matchedTerms.includes(term))
        || resourceFamilies(card.description).some(family=>resourceFamilies(other.description).includes(family))))));
  const ordered = concrete.filter(card => card.kind==='tool' || !concrete.some(other=>other.kind==='tool'
    && ((card.plugin && other.plugin===card.plugin) || other.server===card.name)
    && (!card.capabilityRole || other.capabilityRole===card.capabilityRole)
    && decisionOrder[other.decision]<=2)).sort(candidateOrder);
  // Shell and a persistent language runtime solve the same execution gap.
  // Keep an alternative only when it was explicitly requested independently.
  const sorted=ordered.filter((card,index)=>card.explicit || !ordered.slice(0,index).some(other=>
    other.capabilityRole===card.capabilityRole&&decisionOrder[other.decision]<=decisionOrder[card.decision]
    && (['local-execution','browser-validation'].includes(card.capabilityRole)
      || card.capabilityRole==='database-access'&&other.plugin===card.plugin)));
  if (needs.length < 2) return sorted.slice(0,limit);
  const selected = [], selectedIds = new Set(), covered = new Set();
  const add = card => {
    selected.push(card); selectedIds.add(card.id);
    if (decisionOrder[card.decision]<2) for (const match of card.needMatches) covered.add(match.index);
  };
  for (const card of sorted.filter(card => card.explicit)) {
    if (selected.length === limit) break;
    // Naming a provider is not a request to spend a slot on its container when
    // a currently usable concrete child already covers the same declared need.
    if(card.kind!=='tool' && sorted.some(other=>other.kind==='tool' && decisionOrder[other.decision]<2
      && ((card.plugin&&other.plugin===card.plugin)||other.server===card.name)
      && other.needMatches.some(match=>card.needMatches.some(own=>own.index===match.index)))) continue;
    add(card);
  }
  for (let index=0;index<needs.length && selected.length<limit;index++) {
    if (covered.has(index)) continue;
    const choices=sorted.filter(card => !selectedIds.has(card.id) && decisionOrder[card.decision]<2 && card.needMatches.some(match=>match.index===index));
    choices.sort((a,b) => decisionOrder[a.decision]-decisionOrder[b.decision]
      || b.needMatches.find(match=>match.index===index).strength-a.needMatches.find(match=>match.index===index).strength
      || candidateOrder(a,b));
    if (choices[0]) add(choices[0]);
  }
  while (selected.length<limit) {
    const remaining=sorted.filter(card=>!selectedIds.has(card.id));
    if (!remaining.length) break;
    const family=card=>`${card.plugin || card.server || card.name.split('__').slice(0,-1).join('__')}\u0000${card.phase}`;
    const repeats=card=>selected.filter(other=>family(other)===family(card)).length;
    // A small redundancy penalty never outranks a scope/phase restriction.
    remaining.sort((a,b)=>decisionOrder[a.decision]-decisionOrder[b.decision]
      || (b.score-4*repeats(b))-(a.score-4*repeats(a)) || candidateOrder(a,b));
    add(remaining[0]);
  }
  return selected.sort(candidateOrder);
}

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

function positiveRequestText(value) {
  return String(value || '')
    .replace(/(?:没有|未获)[^。；;\n，,]{0,180}(?:授权|许可)/g,' ')
    .replace(/(?:不要|禁止|不得|不再|不必|无需|不需要|不(?:读|读取|改|更改|更新|编辑|保存|创建|新建|写|制作|生成|复制|发布|部署|发送|评论|分享|注册|购买|点击|关闭|导出|导入|上传|运行))[^，。；\n]*/g,' ')
    .replace(/\b(?:do not|don't|must not|without)\s+(?:read\w*|inspect\w*|edit\w*|modif\w*|creat\w*|writ\w*|sav\w*|generat\w*|mak\w*|cop(?:y|ies|ied|ying)|publish\w*|deploy\w*|send\w*|comment\w*|shar\w*|register\w*|purchas\w*|click\w*|clos\w*|export\w*|run\w*)\b[^,.\n;]*/gi,' ');
}

const FACET_ACTIONS = {
  read:/读取|查看|看一下|确认|提取|获取|检查|核实|核查|观察|检索|搜索|只搜|查找|比较|对照|回读|截图|截屏|\b(?:read|fetch|get|list|inspect|review|search|compare|check|observe|extract|verify|screenshot)\b/i,
  create:/新建|另建|生成|制作|做成|做一(?:个|份|套|张|页)|绘制|编写|写入|另写|新增|创建|保存|导出|复制|\b(?:create|generate|make|draw|render|write|build|save|export|copy|duplicate)\b/i,
  modify:/修改|编辑|修图|重绘|抠图|调整|修复|更新|修正|转换|\b(?:edit|retouch|modify|adjust|fix|update|convert|transform|rename|move|import|upload)\b/i,
};
function facetLocation(value) {
  const local=/本地|离线|新工作目录|副本|\b(?:local|offline|on.disk|filesystem|new directory|copy)\b/i.test(value);
  const remote=/在线|云端|云盘|远程|google\s*(?:drive|docs?|sheets?|slides?)|github|gitlab|figma|\bcanva\b|\b(?:online|cloud|remote)\b/i.test(value);
  return local&&!remote?'local':remote&&!local?'remote':'unspecified';
}
const RESOURCE_FAMILIES = [
  ['spreadsheet',/\b(?:spreadsheet|worksheet|sheet|celldata|excel|xlsx?)\b|电子表|在线表|单元格/],
  ['document',/\b(?:document|paragraph|word|docx?)\b|文档|段落/],
  ['slides',/\b(?:slides?|presentation|powerpoint|pptx?)\b|幻灯片|演示文稿/],
  ['image',/\b(?:image|photo|picture|illustration|portrait)\b|图片|图像|照片|插画/],
  ['video',/\b(?:video|movie|film)\b|视频|短片/],
];
function resourceFamilies(value) {
  const normalized=terms(value).join(' ');
  return RESOURCE_FAMILIES.filter(([,pattern])=>pattern.test(normalized)).map(([family])=>family);
}
function requestFacets(assessment) {
  const clauses=list(assessment.activeClauses).length?assessment.activeClauses:[assessment.activeText || ''];
  const actionStart='(?:读取|查看|提取|获取|检查|生成|制作|编写|新建|另建|另写|写入|修改|编辑|调整|修复|更新|保存|导出|复制|read\\b|fetch\\b|inspect\\b|create\\b|generate\\b|write\\b|edit\\b|modify\\b|save\\b|export\\b|copy\\b)';
  const splitActions=new RegExp(`(?:然后|并且|并|且|以及|\\band\\s+|\\bthen\\s+)(?=\\s*${actionStart})`,'i');
  const facets=[];
  for(const raw of clauses){
    const parts=String(raw).split(/[，,;；。\n]+/).flatMap(x=>x.split(splitActions));
    let prefix='';
    for(let part of parts){
    part=prefix+part;prefix='';
    const positive=positiveRequestText(part).trim();
    if(!positive)continue;
    // Coordinated verbs can share a trailing object: "write and read the
    // document". Do not invent a separate objectless write facet.
    if(!terms(positive).some(x=>!GENERIC_SIGNALS.has(x))){prefix=`${positive} `;continue;}
    // Editable is a deliverable property, not a request to edit every source
    // asset mentioned elsewhere in the task.
    const actionText=positive.replace(/可(?:继续|再次|直接)?编辑|可修改|可更新/g,' ');
    const actions=Object.entries(FACET_ACTIONS).filter(([,pattern])=>pattern.test(actionText)).map(([action])=>action);
    facets.push({index:facets.length,text:positive,source:'user-request',actions,location:facetLocation(positive),
      terms:new Set(terms(requestEvidenceText(positive))),readOnly:false});
    }
  }
  const protectedClauses=unique([
    ...list(assessment.restrictions?.protectedScopes).filter(x=>x?.scope!=='component-behavior').map(x=>x?.clause),
    ...list(assessment.constraintClauses).filter(x=>typeof x==='string'&&/只读|read[- ]only|不得修改|不(?:改|写)|do not (?:modify|write|edit)/i.test(x)),
    ...clauses.filter(x=>/只读|read[- ]only/i.test(x)),
  ]);
  for(const clause of protectedClauses)facets.push({index:facets.length,text:clause,source:'user-restriction',actions:[],location:facetLocation(clause),terms:new Set(terms(requestEvidenceText(clause))),readOnly:true});
  return facets;
}

function bindOperation(entry,purpose,op,facets) {
  const brand=new Set(terms(`${entry.plugin || ''} ${entry.server || ''}`));
  const objects=terms(`${entry.name} ${primaryPurpose(purpose)}`).filter(x=>!GENERIC_SIGNALS.has(x)&&!brand.has(x));
  const location=facetLocation(`${entry.plugin || ''} ${entry.server || ''} ${primaryPurpose(purpose)}`);
  const namedFamilies=resourceFamilies(entry.name);
  // A reader may search documentation ABOUT images, videos or tables. Its
  // purpose prose does not make the search topic an incompatible output type.
  // Precise resource identifiers still distinguish document/spreadsheet ranges.
  const families=namedFamilies.length?namedFamilies:op.action==='change'?resourceFamilies(primaryPurpose(purpose)):[];
  const scoped=facets.filter(facet=>!(location!=='unspecified'&&facet.location!=='unspecified'&&location!==facet.location));
  const overlapping=scoped.map(facet=>({facet,objects:objects.filter(x=>facet.terms.has(x))})).filter(x=>x.objects.length);
  const matchingFamilies=overlapping.map(({facet})=>resourceFamilies(requestEvidenceText(facet.text)));
  const objectMismatch=families.length>0&&matchingFamilies.length>0&&matchingFamilies.every(x=>x.length&&!x.some(family=>families.includes(family)));
  const matches=overlapping.filter(({facet})=>!families.length || !resourceFamilies(requestEvidenceText(facet.text)).length || resourceFamilies(requestEvidenceText(facet.text)).some(family=>families.includes(family)));
  const active=matches.filter(x=>x.facet.source==='user-request'&&x.facet.actions.length);
  const writable=active.some(x=>x.facet.actions.some(action=>action==='create'||action==='modify'));
  // A typed producer needs a requested action on its own output family. A
  // source asset and a write to another deliverable cannot jointly create
  // that need, even when both words occur in advisory retrieval text.
  const unboundOutput=op.action==='change'&&families.length>0&&!active.some(({facet})=>{
    if(!facet.actions.some(action=>action==='create'||action==='modify'))return false;
    // In "create a video from a photo", the photo is an input, not a second
    // requested output. Keep edit operations intact (their target may follow
    // a preposition), and separate source descriptions for creation facets.
    const outputText=facet.actions.includes('modify')?facet.text:
      facet.text.split(/\b(?:from|using|based on)\b|(?:素材|原料)(?:是|为|包括)/i)[0];
    return resourceFamilies(outputText).some(family=>families.includes(family));
  });
  const locationProtected=location!=='unspecified'&&facets.some(facet=>facet.readOnly&&facet.location===location)
    && facets.some(facet=>facet.source==='user-request'&&facet.actions.includes('read')&&facet.location===location);
  const readOnly=(matches.some(x=>x.facet.readOnly)||!matches.length&&locationProtected)&&!writable;
  // A local output action is not an action on a remotely read source. Only
  // reject a producer when the same concrete object has a clear read intent.
  const readIntentOnly=active.length>0&&active.every(x=>x.facet.actions.every(action=>action==='read'));
  const writesAnotherObject=facets.some(facet=>facet.source==='user-request'&&facet.actions.some(action=>action==='create'||action==='modify'));
  const readsThisObject=facets.some(facet=>facet.source==='user-request'&&facet.actions.includes('read')&&objects.some(x=>facet.terms.has(x)));
  return {readOnly,objectMismatch,unboundOutput,mismatch:op.action==='change'&&!writable&&(readIntentOnly || (writesAnotherObject&&readsThisObject)),
    matches:matches.map(({facet,objects})=>({index:facet.index,source:facet.source,text:facet.text,actions:facet.actions,location:facet.location,matchedObjects:objects}))};
}

function deviceOperationScope(entry,purpose,restrictions) {
  const device='(?:设备|控制器|PLC|硬件|\\bdevices?\\b|\\bcontrollers?\\b|\\bequipment\\b|\\bhardware\\b)';
  const concrete=primaryPurpose(purpose),actions=[];
  if(new RegExp('^(?:连接|connect\\b).{0,100}'+device,'i').test(concrete))actions.push('connect');
  if(new RegExp('^(?:下载|download\\b).{0,100}(?:到|至|\\bto\\b|\\bonto\\b).{0,45}'+device,'i').test(concrete))actions.push('download');
  const blocked=restrictions.some(x=>list(x.actions).some(action=>actions.includes(action)));
  const named=entry.name.replace(/[_-]/g,' ');
  const uncertain=capabilityRole(purpose)==='local-execution'
    || new RegExp(device,'i').test(named+' '+concrete)&&/连接|下载|\b(?:connect|download)\b/i.test(named+' '+concrete);
  return {blocked,uncertain};
}

function capabilityGates({assessment,entry,op,scopedReadOnly,phase,networkForbidden,network,discovery,role,specialistNeeds,purpose,preserveRestrictionDecision=false}) {
  let score=0;
  const needsDelivery = op.phase==='delivery';
  const deliveryRequested = phase==='delivery' && requestedDelivery(assessment,entry);
  let decision = entry.callable && entry.kind==='tool' ? 'use-now' : 'discover-first';
  const gates = ['confirm-task-benefit','inspect-exact-schema-and-inputs','respect-current-user-authorization'];
  const protectedScopes=list(assessment.restrictions?.protectedScopes).filter(scope=>scope && typeof scope.clause==='string')
    .map(scope=>({source:scope.source,scope:'protected-target',clause:scope.clause}));
  if(protectedScopes.length)gates.push('preserve-protected-targets-and-check-output-destination');
  if(/must load|read .{0,160}SKILL\.md|skill.*before|before.*skill/i.test(entry.description))gates.push('read-required-skill-before-invocation');
  if (scopedReadOnly && !['read','unknown'].includes(op.effect)) { decision='skip'; gates.push('read-only-scope'); }
  else if (scopedReadOnly && op.effect==='unknown' && entry.kind==='tool') { decision='defer'; gates.push('verify-read-only-effect-before-invocation'); }
  else if (needsDelivery && !deliveryRequested) {decision='defer';gates.push('delivery-not-requested');score-=12;}
  else if (entry.kind==='tool' && op.phase!=='discovery' && op.phase!==phase) {decision='defer';gates.push('different-task-phase');score-=8;}
  else if (entry.kind==='tool' && op.effect!=='read') {decision='check-scope';gates.push('verify-effects-and-authorized-scope');}
  if (!entry.callable) {
    if(decision!=='skip'&&!(preserveRestrictionDecision&&decisionOrder[decision]>decisionOrder['discover-first']))decision='discover-first';
    gates.push('runtime-callability-unverified');
  }
  if (entry.kind==='plugin') {decision='discover-first';gates.push('select-specific-tool-or-read-relevant-skill');}
  if (entry.configurationConflict) {
    gates.push('runtime-config-conflict-do-not-change-configuration');
    if (decision==='use-now') decision='check-scope';
  }
  if (op.effect==='high-impact' || op.effect==='external-write') gates.push('check-destination-and-current-action-authorization');
  if (networkForbidden) {
    gates.push('preserve-offline-scope');
    if (network==='network') { decision='skip'; gates.push('network-forbidden'); }
    else if (network==='unknown' && decision!=='skip') { decision='defer'; gates.push('verify-no-network-before-invocation'); }
  }
  if(discovery?.role==='database-access')gates.push('verify-database-target-query-and-authentication-before-invocation');
  if(role==='public-web-access')gates.push('verify-public-web-method-target-and-access-before-invocation');
  if(specialistNeeds.localBrowser&&/\bbrowser\b|浏览器/i.test(purpose)){
    gates.push('restrict-browser-to-authorized-local-target');
    if(network==='network'){decision='skip';gates.push('remote-browser-not-authorized-for-local-target');}
    else if(!(discovery?.supportsLocal || network==='local')&&decision!=='skip'){decision='defer';gates.push('verify-local-browser-target-support-before-invocation');}
  }
  const operationRestrictions=list(assessment.restrictions?.forbiddenOperations).filter(x=>x?.scope==='device-operations'&&typeof x.clause==='string');
  const unresolvedConstraints=list(assessment.restrictions?.unresolvedConstraints).filter(x=>typeof x?.clause==='string');
  let scopeInstruction=null;
  if(entry.kind==='tool'&&operationRestrictions.length){
    const deviceScope=deviceOperationScope(entry,purpose,operationRestrictions);
    if(deviceScope.blocked){
      decision='skip';gates.push('device-operation-forbidden');
      scopeInstruction='当前请求禁止该设备连接或下载操作；保留离线检查范围';
    }else if(deviceScope.uncertain){
      gates.push('verify-device-operation-scope-before-invocation');
      if(decision==='use-now')decision='check-scope';
    }
  }
  if(unresolvedConstraints.length){
    gates.push('resolve-unclassified-user-constraint-before-invocation');
    if(decision==='use-now')decision='check-scope';
  }
  return {decision,gates,protectedScopes,operationRestrictions,unresolvedConstraints,scopeInstruction,scoreAdjustment:score};
}

function structuredRole(purpose) {
  const role=capabilityRole(purpose);
  if(role)return role;
  const opening=primaryPurpose(purpose);
  if(/^(?:Generate|Create|Render|Edit)\s+(?:an?\s+|new\s+)?(?:images?|pictures?|photos?)\b/i.test(opening)
    || /^(?:The\s+.{1,100}?\s+tool|This\s+tool|The\s+function)\s+(?:enables|supports)\s+image\s+(?:generation|editing)\b/i.test(opening))return 'image-generation';
  return null;
}

function selectWithHostRequests(cards,needs,requests,limit) {
  const base=selectCandidates(cards,needs,limit);
  if(!requests.length)return base;
  const selected=[],used=new Set();
  const add=card=>{if(selected.length<limit&&!used.has(card.id)){selected.push(card);used.add(card.id);}};
  // Actual user names retain priority. Host names never become user names.
  base.filter(card=>card.explicit).forEach(add);
  for(const request of requests){
    if(selected.some(card=>card.hostRequestMatches?.some(item=>item.index===request.index)))continue;
    const choice=cards.filter(card=>!used.has(card.id)&&card.decision!=='skip'
      &&card.hostRequestMatches?.some(item=>item.index===request.index)).sort(candidateOrder)[0];
    if(choice)add(choice);
  }
  base.forEach(add);
  return selected;
}

function addStructuredCandidates(cards,assessment,options,inventory,purposes,phase,readOnly,networkForbidden,facets,specialistNeeds) {
  // Revalidate direct callers through the same schema. Never trust a stored
  // normalized marker as authority, and never inspect another task's state.
  const input=options.taskContext || {capabilityRequests:assessment.capabilityRequests?.map(({role,toolNames,purpose,evidenceRefs})=>({
    ...(role?{role}:{}),...(toolNames?.length?{toolNames}:{}),purpose,evidenceRefs})),evidence:assessment.evidence};
  const normalized=normalizeCapabilityRequests(input);
  const requests=normalized.requests,unresolved=[...(!options.taskContext?list(assessment.capabilityRequestIssues):[]),...normalized.unresolved];
  // runtimeTools is the current invocation's observation. An inventory's
  // provenance label is not a visibility protocol, and may describe history.
  // Current purpose, hints and availability replace stale metadata rather than
  // borrowing those facts from a row with a familiar-looking evidence string.
  const observed=list(options.runtimeTools).filter(item=>item&&typeof item.name==='string'&&item.name.trim()).map(item=>{
    const prior=inventory.capabilities.find(entry=>entry.kind==='tool'&&entry.name===item.name);
    const available=typeof item.available==='boolean'?item.available:null;
    return {...prior,id:`tool:${item.name}`,kind:'tool',name:item.name,
      server:item.server||prior?.server||null,plugin:item.plugin||prior?.plugin||null,
      description:text(String(item.description||'').split(/^\s*exec tool declaration\s*:/im)[0],16000),
      annotations:item.annotations||{},enabled:available!==false,callable:available===true,runtimeAvailable:available,
      evidence:prior?.evidence||'current-runtime-tool-metadata',
      ...(prior?.callabilityEvidence?{callabilityEvidence:prior.callabilityEvidence}:{}),
      currentObservation:item.observationSource||{source:'runtimeTools',available,scope:'current metadata only; authentication and business execution unverified'},
      configurationConflict:available===true&&prior?.configurationEnabled===false};
  });
  const observedPrefixes=registryPurposePrefixes(observed);
  const observedPurposes=new Map(observed.map(entry=>[entry.id,toolPurpose(entry.description,observedPrefixes)]));
  if(requests.length)for(let index=cards.length-1;index>=0;index--){
    const current=observed.find(entry=>entry.id===cards[index].id);
    if(!current)continue;
    if(current.runtimeAvailable===false){cards.splice(index,1);continue;}
    cards[index].availability={...cards[index].availability,callable:current.callable,
      runtimeAvailable:current.runtimeAvailable,currentObservation:current.currentObservation,
      ...(current.callabilityEvidence?{callabilityEvidence:current.callabilityEvidence}:{})};
    if(!current.callable){
      if(decisionOrder[cards[index].decision]<decisionOrder['discover-first'])cards[index].decision='discover-first';
      cards[index].gates=unique([...cards[index].gates,'runtime-callability-unverified']);
    }
  }
  for(const request of requests){
    const expected=request.toolNames.length?request.toolNames:[null];
    for(const name of expected){
      const available=observed.filter(entry=>(name===null||entry.name===name)
        &&(!request.role||structuredRole(observedPurposes.get(entry.id)||'')===request.role));
      if(!available.length){
        const named=name&&observed.find(entry=>entry.name===name);
        unresolved.push({index:request.index,toolName:name,reason:named?'role-or-purpose-mismatch':name?'unobserved-runtime-tool':'no-observed-role-match'});
        continue;
      }
      for(const entry of available){
        if(!entry.enabled||entry.runtimeAvailable===false){unresolved.push({index:request.index,toolName:entry.name,reason:'runtime-tool-unavailable'});continue;}
        const purpose=observedPurposes.get(entry.id)||'';
        if(!purpose.trim()){unresolved.push({index:request.index,toolName:entry.name,reason:'purpose-metadata-missing'});continue;}
        const role=structuredRole(purpose),op=operation(entry,purpose),network=networkPurpose(purpose);
        if(role==='local-execution'&&op.action==='execute')op.phase=phase;
        const binding=bindOperation(entry,purpose,op,facets);
        const scopedReadOnly=readOnly||binding.readOnly;
        const gate=capabilityGates({assessment,entry,op,scopedReadOnly,phase,networkForbidden,network,
          discovery:null,role,specialistNeeds,purpose,preserveRestrictionDecision:true});
        gate.gates.push('host-context-is-retrieval-evidence-not-user-authorization');
        if(gate.decision==='use-now')gate.decision='check-scope';
        const denied=list(assessment.negativeRequests).some(clause=>String(clause).includes(entry.name));
        if(denied){gate.decision='skip';gate.gates.push('explicit-user-exclusion');}
        if(binding.objectMismatch||binding.mismatch||binding.unboundOutput){
          if(gate.decision!=='skip')gate.decision='defer';
          gate.gates.push('verify-host-suggestion-against-requested-object-and-action');
        }
        // Config or an old inventory row cannot prove this tool callable now.
        const callable=entry.runtimeAvailable===true;
        if(!callable){
          // Unknown callability adds discovery work; it must not lower a
          // read-only or unknown-network defer into a more permissive rank.
          if(decisionOrder[gate.decision]<decisionOrder['discover-first'])gate.decision='discover-first';
          gate.gates.push('runtime-callability-unverified');
        }
        const match={index:request.index,role:request.role||null,purpose:request.purpose,
          evidenceRefs:request.evidenceRefs,source:'host-context',authority:'advisory-only'};
        const existing=cards.find(card=>card.id===entry.id);
        if(existing){
          (existing.hostRequestMatches??=[]).push(match);
          // A structured request cannot relax a restriction already found by
          // the text route, and cannot turn unknown runtime status into true.
          if(decisionOrder[gate.decision]>decisionOrder[existing.decision])existing.decision=gate.decision;
          existing.description=purpose.slice(0,240);existing.effect=op.effect;
          existing.availability={...existing.availability,enabled:entry.enabled,callable,
            runtimeAvailable:entry.runtimeAvailable,evidence:entry.evidence,
            currentObservation:entry.currentObservation,
            ...(entry.callabilityEvidence?{callabilityEvidence:entry.callabilityEvidence}:{})};
          existing.gates=unique([...existing.gates,...gate.gates]);
          if(gate.operationRestrictions.length)existing.operationRestrictions=gate.operationRestrictions;
          if(gate.unresolvedConstraints.length)existing.unresolvedConstraints=gate.unresolvedConstraints;
          if(gate.scopeInstruction)existing.when=gate.scopeInstruction;
          continue;
        }
        cards.push({id:entry.id,kind:'tool',name:entry.name,plugin:entry.plugin||null,server:entry.server||null,
          description:purpose.slice(0,240),score:70+gate.scoreAdjustment,explicit:false,providerRequested:false,
          matchedTerms:[],needMatches:[],hostRequestMatches:[match],capabilityRole:role,
          requirementSource:'host-context',requirementEvidence:request.evidenceRefs,
          availability:{discovered:true,enabled:entry.enabled,callable,evidence:entry.evidence,
            runtimeAvailable:entry.runtimeAvailable??null,configurationEnabled:entry.configurationEnabled??null,
            configurationConflict:entry.configurationConflict===true,currentObservation:entry.currentObservation,
            ...(entry.callabilityEvidence?{callabilityEvidence:entry.callabilityEvidence}:{})},
          decision:gate.decision,phase:op.phase,when:gate.scopeInstruction||'按当前用户请求核对具体输入、范围、效果和阶段后，由宿主决定是否调用',
          expectedBenefit:request.purpose,effect:op.effect,gates:gate.gates,
          objectBindings:binding.matches,scopeReadOnly:scopedReadOnly,
          ...(gate.protectedScopes.length?{protectedScopes:gate.protectedScopes}:{}),
          ...(gate.operationRestrictions.length?{operationRestrictions:gate.operationRestrictions}:{}),
          ...(gate.unresolvedConstraints.length?{unresolvedConstraints:gate.unresolvedConstraints}:{}),
          ...(networkForbidden?{networkScope:{forbidden:true,purposeEvidence:network}}:{}),
          invocation:{tool:entry.name,argumentPolicy:'Use the observed host schema and authorized task inputs.',executor:'host-agent',automaticallyExecuted:false},
          reason:'宿主声明的能力缺口匹配当前真实工具；该建议不等于用户点名、授权或认证'});
      }
    }
  }
  return {requests,unresolved};
}

/** Produces host execution choices, never calls business tools itself. */
export function adviseCapabilities(assessment, options = {}) {
  const inventory = options.capabilityIndex || discoverCapabilities(options);
  const commonPrefixes=registryPurposePrefixes(inventory.capabilities);
  const purposes=new Map(inventory.capabilities.map(entry=>[entry.id,toolPurpose(entry.description,commonPrefixes)]));
  const substrateNeeds=taskSubstrateNeeds(assessment);
  const specialistNeeds=taskSpecialistNeeds(assessment);
  const active = assessment.activeText || '';
  const needs = unique(list(assessment.interpretation?.retrievalCapabilityNeeds ?? assessment.capabilityNeeds).filter(value=>typeof value==='string').map(value=>value.trim()));
  // Excluded actions are restrictions, not positive retrieval evidence. Keep
  // the original assessment for all permission/phase gates below.
  const retrieval = [active, typeof assessment.retrievalText==='string' ? assessment.retrievalText : '', ...needs].map(value=>requestEvidenceText(positiveRequestText(value))).join('\n');
  const facets=requestFacets(assessment);
  const needTerms = needs.map(need=>new Set(terms(requestEvidenceText(need))));
  const phase = currentPhase(active, options.phase || options.invocationContext?.phase);
  const readOnly = assessment.readOnly === true || options.invocationContext?.readOnly === true || options.invocationContext?.mode === 'plan';
  const networkForbidden = assessment.restrictions?.networkForbidden === true || options.invocationContext?.networkForbidden === true;
  const queryTerms = new Set(terms(retrieval));
  const normalizedActive=label(requestEvidenceText(active));
  const providerKey=value=>label(String(value||'').split('@')[0]);
  const namedProviders=new Set(inventory.capabilities.flatMap(e=>e.kind==='tool'?[e.plugin,e.server,declaredProvider(e)]:[e.name,e.displayName,e.plugin]).filter(x=>x&&providerKey(x).length>2&&(`-${normalizedActive}-`).includes(`-${providerKey(x)}-`)).map(providerKey));
  const wantsSearch=/搜索|检索|查找|调研|\bsearch\b|\bfind\b|\bresearch\b/i.test(retrieval) || (queryTerms.has('research')&&queryTerms.has('search'));
  const wantsRead=wantsSearch||/读取|查看|检查|获取|观察|\bread\b|\bget\b|\binspect\b|\bobserve\b/i.test(retrieval);
  const localArtifact=/(?:本地|离线|单文件).{0,40}(?:文件|页|游戏)|\b(?:html|canvas)\b|浏览器.{0,20}游戏|\b(?:local|offline|single[- ]file)\b.{0,60}\b(?:files?|pages?|games?)\b/i.test(retrieval);
  const shortNames=new Map();
  for(const entry of inventory.capabilities.filter(e=>e.kind==='tool')){
    const short=entry.name.split('__').at(-1);shortNames.set(short,(shortNames.get(short)||0)+1);
  }
  const isExplicit=entry=>{
    const short=entry.name.split('__').at(-1);
    const aliases=entry.kind==='tool'?[entry.name,...(shortNames.get(short)===1 && /^[a-z][a-z0-9]{4,}$/i.test(short) && !GENERIC_SIGNALS.has(short)?[short]:[])]:[entry.name,entry.plugin,entry.displayName];
    const clauses=list(assessment.activeClauses).length?assessment.activeClauses:[active];
    return unique(aliases.filter(Boolean)).some(alias=>requestedName(clauses,alias));
  };
  const explicitTools=inventory.capabilities.filter(e=>e.kind==='tool'&&e.enabled&&isExplicit(e));
  const cards = [];
  for (const entry of inventory.capabilities) {
    if (!entry.enabled) continue;
    if (entry.kind==='mcp' && entry.tools.length) continue; // Tools provide the actionable granularity.
    // Purpose text carries more signal than cross-tool instructions and examples.
    const providerMentioned=[...(entry.kind==='tool'?[]:[entry.name,entry.displayName]),entry.plugin,entry.server,declaredProvider(entry)].some(value=>value&&providerKey(value).length>2
      && (`-${normalizedActive}-`).includes(`-${providerKey(value)}-`));
    const discovery=specialistDiscovery(entry,inventory,specialistNeeds,providerMentioned);
    const purpose=discovery?.purpose || purposes.get(entry.id);
    const network=discovery?.network || networkPurpose(purpose);
    const recordRead=recordReadCapability(entry,purpose,specialistNeeds.recordRead,providerMentioned,queryTerms);
    const role=recordRead?.role || (entry.kind==='tool'?capabilityRole(purpose):discovery?.role || null);
    const fillsSubstrate=Boolean(recordRead || discovery || role&&substrateNeeds[role]
      && (role!=='compilation-diagnostics'||diagnosticCompilationObjectMatch(purpose,queryTerms)));
    const explicit=isExplicit(entry);
    if(['compilation-diagnostics','public-web-access'].includes(role)&&!explicit&&!fillsSubstrate)continue;
    if (networkForbidden && network==='network' && !explicit) continue;
    if(specialistNeeds.localBrowser&&/\bbrowser\b|浏览器/i.test(purpose)&&network==='network'&&!explicit)continue;
    const op = entry.kind==='tool' ? operation(entry,purpose) : {action:'discover',phase:discovery?.phase || phase,effect:'unknown'};
    if(role==='local-execution'&&fillsSubstrate&&op.action==='execute')op.phase=phase;
    if(role&&!['local-execution','compilation-diagnostics'].includes(role)&&['read','unknown','verify'].includes(op.action))Object.assign(op,{action:'read',phase:'discovery',effect:entry.annotations?.readOnlyHint===true?'read':'unknown'});
    // A shared action such as search/export/status does not establish the
    // requested object. Personal communication and workspace APIs need a
    // matching domain or an explicit capability need supplied by the host.
    const identityText=norm(`${entry.name} ${entry.plugin || ''} ${entry.server || ''}`);
    // A configured plugin is a discovery container, not a task-specific
    // operation. Its generic marketing description alone is insufficient.
    if(entry.kind==='plugin'&&!explicit&&!discovery)continue;
    const scopedSources=[
      [/github/,/github|gitlab|代码库|代码仓库|git仓库|开源项目|\brepositor(?:y|ies)\b|\bopen[- ]source\b|\bpull request\b/i],
      [/google.?drive/,/google\s*(?:drive|docs?|sheets?|slides?)|谷歌云盘|云盘|云端文档|docs\.google/i],
      [/figma/,/figma|设计稿/i],
      [/(?:^|[^a-z0-9])sites(?:$|[^a-z0-9])/,/\bsites\b|站点|\b(?:existing|deployed|published|hosted)\s+(?:site|website)\b|部署|上线|已发布|托管|\b(?:deploy|deployment|hosting|published)\b/i],
      [/xcodebuildmcp/,/\b(?:xcode|swift|swiftui|swiftpm|ios|macos|watchos|tvos|visionos|iphone|ipad|apple)\b|苹果|\.xcodeproj\b|\.xcworkspace\b|\.app\b/i],
    ];
    if(!explicit&&scopedSources.some(([source,object])=>source.test(identityText)&&!object.test(retrieval)))continue;
    // A connector's explicit applicability statement is a scope requirement,
    // not topical evidence from its generic workflow vocabulary.
    const requestedService=entry.description.match(/only use for an explicitly requested\s+(.+?)\s+task\b/i)?.[1];
    if(!explicit&&requestedService&&!norm(active).includes(norm(requestedService)))continue;
    if(!explicit&&!fillsSubstrate&&/mcp__codex_app__/.test(entry.name)
      && !/聊天|会话|侧栏|置顶|Codex.{0,15}项目|\b(?:chat|thread|sidebar|pinned|worktree)\b|\bcodex\b.{0,25}\bprojects?\b/i.test(active))continue;
    if(/\bcanvas\b/i.test(retrieval)&&!/\bcanva\b/i.test(retrieval)&&/(?:^|[^a-z0-9])canva(?:$|[^a-z0-9])/.test(identityText))continue;
    if(localArtifact){
      // A local file deliverable does not itself identify a cloud repository or
      // design document. Explicit source context or a separate need can do so.
      const remoteScopes=[
        [/github/,/github|gitlab|仓库|\brepositor(?:y|ies)\b|\bpull request\b/i],
        [/google.?drive/,/google\s*(?:drive|docs?|sheets?|slides?)|谷歌云盘|云盘|云端文档|docs\.google/i],
        [/figma/,/figma|设计稿/i],
        [/(?:^|[^a-z0-9])canva(?:$|[^a-z0-9])/,/\bcanva\b/i],
        [/(?:^|[^a-z0-9])sites(?:$|[^a-z0-9])/,/\bsites\b|(?:现有|线上|远程|已部署|已发布|托管).{0,12}(?:站点|网站)|\b(?:existing|deployed|published|hosted)\s+(?:site|website)\b|部署|上线|已发布|托管|\b(?:deploy|deployment|hosting|published)\b/i],
      ];
      if(!explicit&&remoteScopes.some(([provider,object])=>provider.test(identityText)&&!object.test(retrieval)))continue;
    }
    if (/gmail|email|mailbox/.test(identityText) && !/邮件|邮箱|电子信|gmail|e-?mail|mailbox/i.test(retrieval)) continue;
    if (/google.calendar/.test(identityText) && !/日历|日程|会议|calendar|schedule|meeting/i.test(retrieval)) continue;
    if (/chatgpt.space/.test(identityText) && !/chatgpt\s*space|空间|知识库|协作文档|\bspace\b/i.test(retrieval)) continue;
    if(!fillsSubstrate&&/^Capture\b/i.test(purpose)&&!/捕获|截图|导入|capture|screenshot|import/i.test(retrieval))continue;
    const haystack = `${entry.name} ${primaryPurpose(purpose)}`;
    const entryTerms = terms(haystack);
    const shared = entryTerms.filter(x=>queryTerms.has(x));
    const needMatches = needTerms.flatMap((need,index)=> {
      const matched=entryTerms.filter(term=>need.has(term));
      return matched.length>=2 ? [{index,strength:matched.length/Math.max(1,need.size),matchedTerms:matched}] : [];
    });
    const ownedProvider=entry.plugin||declaredProvider(entry);
    // An observed owner beats a coincidental provider word in a tool name.
    // Name fragments remain a fallback only when ownership is unavailable.
    if(entry.kind==='tool'&&namedProviders.size&&!explicit&&!fillsSubstrate&&!namedProviders.has(providerKey(entry.plugin))&&!namedProviders.has(providerKey(entry.server))&&!namedProviders.has(providerKey(declaredProvider(entry)))
      && (ownedProvider||![...namedProviders].some(p=>(`-${label(entry.name)}-`).includes(`-${p}-`)))){
      // A named provider scopes its own need, not every independent work item.
      // An unrelated provider still needs a concrete match to a separately
      // declared need; its name is not an authorization signal.
      const separateNeed=needMatches.some(match=>![...namedProviders].some(p=>(`-${label(needs[match.index])}-`).includes(`-${p}-`)));
      if(!separateNeed)continue;
    }
    const brandTerms=new Set([...terms(`${entry.plugin||''} ${entry.server||''} ${declaredProvider(entry)||''}`),
      ...(/^mcp__/.test(entry.name)?norm(entry.name.split('__').slice(1,-1).join(' ')).split(/[^a-z0-9]+/).filter(Boolean):[])]);
    const nonBrand=shared.filter(x=>!brandTerms.has(x));
    // "Codex projects for a new chat" identifies a concrete host object even
    // though the word project alone is generic in business/code requests.
    const scopedWorkspaceRead=op.action==='read'&&/mcp__codex_app__/.test(entry.name)
      && /聊天|会话|侧栏|置顶|\b(?:chat|thread|sidebar|pinned)\b/i.test(active)
      && /列出|查看|读取|\b(?:list|show|read|enumerate)\b/i.test(active)
      && shared.some(term=>['project','chat','thread'].includes(term)&&terms(entry.name).includes(term));
    // An exact concrete object plus a requested read is sufficient even when
    // languages differ and read verbs are stop words. A generic file/data word
    // or brand alone never earns this narrow exception.
    const exactReadObject=op.action==='read'&&wantsRead&&nonBrand.some(term=>!GENERIC_SIGNALS.has(term)&&terms(entry.name).includes(term));
    if (!explicit && !fillsSubstrate && shared.length<2&&!exactReadObject) continue;
    if(entry.kind==='tool'&&!explicit&&!fillsSubstrate&&entry.plugin&&nonBrand.length===0)continue;
    if(!explicit&&!fillsSubstrate&&!providerMentioned&&!scopedWorkspaceRead&&!nonBrand.some(x=>!GENERIC_SIGNALS.has(x)))continue;
    // Reject tool purposes explicitly excluding the requested domain.
    const exclusions=[...entry.description.matchAll(/(?:Do not use (?:this tool )?for|not (?:intended|suitable) for)\s+([^.!\n]+)/gi)].map(x=>x[1]);
    if(!explicit&&exclusions.some(x=>terms(x).some(t=>queryTerms.has(t)&&!brandTerms.has(t))))continue;
    // A tool must serve an object in its own opening purpose. Name fragments,
    // incidental return instructions and generic HTTP routing vocabulary do
    // not turn an application task into a service-management request.
    if(!explicit&&!fillsSubstrate&&!scopedWorkspaceRead&&!concretePurposeMatch(purpose,queryTerms))continue;
    if(!explicit&&!fillsSubstrate&&!managementPurposeMatch(purpose,retrieval.split(/[\n。；;，,]+/)))continue;
    const binding=entry.kind==='tool'?bindOperation(entry,purpose,op,facets):{readOnly:false,mismatch:false,matches:[]};
    if(!explicit&&!fillsSubstrate&&(binding.objectMismatch||binding.unboundOutput))continue;
    if(!explicit&&!fillsSubstrate&&binding.mismatch&&!readOnly)continue;
    const scopedReadOnly=readOnly||binding.readOnly;
    const operationName=norm(entry.name.split('__').at(-1)).replace(/[_-]/g,' ');
    if(!explicit&&/\bsearch\b/.test(operationName)&&!wantsSearch&&!/查找|找到|定位|\b(?:find|locate)\b/i.test(retrieval))continue;
    if(!explicit&&/\bfigjam\b/.test(operationName)&&!/figjam|figma\.com\/board\//i.test(active))continue;
    if(!explicit&&/\bparse\b/.test(operationName)&&!/解析|提取|格式转换|\b(?:parse|extract|convert)\b/i.test(retrieval))continue;
    if(!explicit&&/^Scrape\b/i.test(purpose)&&!wantsSearch&&!/https?:\/\/|网页|网站|网址|\b(?:urls?|webpages?|websites?|public web)\b/i.test(active))continue;
    if(!explicit&&/^List shared drives\b/i.test(purpose)&&!/共享云盘|\bshared drives?\b|(?:列出|枚举).{0,15}云盘|\blist\b.{0,20}\bdrives?\b/i.test(active))continue;
    if(!explicit&&/\bcode connect\b/.test(operationName)
      && !/code connect|代码(?:连接|映射)|组件.{0,15}(?:代码映射|关联代码)|component.{0,20}(?:mapping|connection)/i.test(retrieval))continue;
    if(!explicit&&!fillsSubstrate&&/\blibraries\b/.test(operationName)
      && !/组件库|设计库|\b(?:component|design|shared) librar(?:y|ies)\b|\blibraries\b/i.test(retrieval))continue;
    if(!explicit&&/\bopen\b/.test(operationName)
      && !/打开|开启|\bopen\b/i.test(positiveRequestText(active)))continue;
    if(!explicit&&!fillsSubstrate&&/\b(?:ui (?:read|find|snapshot|wait)|screenshot)\b/.test(operationName)
      && !binding.matches.some(match=>match.actions.includes('read')&&match.matchedObjects.some(term=>['ui','window','desktop','screenshot'].includes(term))))continue;
    // Starting a multi-step research job has a different cost and output from
    // retrieving a page or search result. Require that actual workflow need.
    if(!explicit&&/\bagent\b/.test(operationName)&&/\bweb research\b/i.test(purpose)
      && !/深度|深入|全面|系统性|大规模|广泛|结构化数据|数据集|\b(?:deep|comprehensive|multi[- ]step|dataset|structured data|across several sites)\b/i.test(retrieval))continue;
    if(!explicit&&/\b(?:click|type|select|keyboard|mouse)\b/.test(operationName)
      && !/点击|键入|选中|选择控件|鼠标|键盘操作|\b(?:click|type into|select control|press key|mouse)\b/i.test(retrieval))continue;
    if(!explicit&&/\bnavigate\b/.test(operationName)
      && !/导航|切换到|跳转到|\b(?:navigate|switch to|go to)\b/i.test(retrieval))continue;
    if(!explicit && /\bcompile\b/.test(operationName)
      && (/(?:不|禁止|不要|无需)(?:运行|重新)?编译|\b(?:do not|don't|without)\s+compil(?:e|ing)\b/i.test([active,...list(assessment.constraintClauses)].join(' '))
        || list(assessment.negativeRequests).some(x=>/编译|\bcompil/i.test(x))))continue;
    if(!explicit && /\bcreate\b.*\bproject\b/.test(operationName)
      && !/新建|创建|新(?:的)?(?:工程|项目|文档|文件)|\b(?:create|new)\b/i.test(positiveRequestText(active)))continue;
    // A specifically requested producer takes precedence over alternative
    // producers of the same object; readers/validators and other needs survive.
    if(!explicit&&entry.kind==='tool'&&op.action==='change'&&explicitTools.some(other=>operation(other).action==='change'
      && terms(`${other.name} ${primaryPurpose(toolPurpose(other.description))}`).some(term=>nonBrand.includes(term)&&!GENERIC_SIGNALS.has(term))))continue;
    let score = shared.length*4+(explicit?24:0)+(fillsSubstrate?70:0);
    const nameTerms=terms(entry.name.split('__').at(-1));
    score+=nameTerms.filter(x=>queryTerms.has(x)&&!brandTerms.has(x)).length*8;
    if(op.action==='read'&&wantsRead)score+=10;
    if(wantsSearch&&/\bsearch\b/.test(entry.name.replace(/_/g,' ')))score+=24;
    if(wantsSearch&&/\blist\b/.test(entry.name.replace(/_/g,' ')))score+=8;
    // Specialized child resources must be asked for; a brand match is not enough.
    const specialist=['revision','comment','shader','motion','animation','row','range','table','toolbar','generative','deck','video','job','progress','latex','module','reset','asset','paper','developer','thread','dependency','metadata','profile','handoff','usage','worktree','session','account','model','weave','folder'];
    if(!explicit&&!fillsSubstrate&&nameTerms.some(t=>specialist.includes(t)&&!queryTerms.has(t)))continue;
    score+=nameTerms.filter(t=>specialist.includes(t)&&queryTerms.has(t)).length*12;
    const {decision,gates,protectedScopes,operationRestrictions,unresolvedConstraints,scopeInstruction,scoreAdjustment}=capabilityGates({assessment,entry,op,scopedReadOnly,phase,networkForbidden,network,discovery,role,specialistNeeds,purpose});
    score+=scoreAdjustment;
    cards.push({id:entry.id,kind:entry.kind,name:entry.name,plugin:entry.plugin || null,server:entry.server || null,
      description:purpose.slice(0,240),score,explicit,providerRequested:providerMentioned,matchedTerms:shared.slice(0,6),needMatches,
      ...(fillsSubstrate?{capabilityRole:role,requirementSource:role==='public-web-access'?substrateNeeds.publicWebNeedSource:'user-request',requirementEvidence:recordRead?.evidence || OUTCOME[op.phase]}:{}),
      ...(recordRead?{recordReadEvidence:recordRead}:{}),
      ...(discovery?{discoveryEvidence:{sourceId:discovery.sourceId,purpose:discovery.purpose,scope:'functional-discovery-only; callability, authentication and effects unverified'}}:{}),
      availability:{discovered:true,enabled:entry.enabled,callable:entry.callable,evidence:entry.evidence,
        ...(entry.runtimeAvailable!==undefined?{runtimeAvailable:entry.runtimeAvailable,configurationEnabled:entry.configurationEnabled,configurationConflict:entry.configurationConflict}:{})},
      decision,phase:op.phase,when:scopeInstruction||(networkForbidden&&network==='network'?'当前请求禁止联网，不能调用此联网能力':networkForbidden&&network==='unknown'?'先核对准确 schema 与输入，确认不会联网后再评估调用；确认前暂缓':scopedReadOnly && op.effect==='unknown' && entry.kind==='tool'?'先核对准确 schema 与输入，确认无写入效果后再评估调用；确认前暂缓':decision==='defer'?'仅到相应阶段且用户目标需要时再评估':decision==='discover-first'?'先按需发现工具或读取相关技能，确认当前会话可用':`当前 ${phase} 阶段，且缺少其能提供的结果时`),
      ...(networkForbidden?{networkScope:{forbidden:true,purposeEvidence:network}}:{}),
      expectedBenefit:recordRead?.purpose || (role==='local-execution'&&fillsSubstrate&&substrateNeeds.localExecutionEvidence.length
        ? `核对本地执行入口以完成这些用户操作：${substrateNeeds.localExecutionEvidence.join('；')}`
        :OUTCOME[op.phase] || OUTCOME[phase]),effect:op.effect,gates,
      objectBindings:binding.matches,scopeReadOnly:scopedReadOnly,
      ...(role==='local-execution'&&fillsSubstrate?{operationEvidence:substrateNeeds.localExecutionEvidence.map(clause=>({source:'user-request',clause,scope:'advisory-only; exact command and effects require host verification'}))}:{}),
      ...(protectedScopes.length?{protectedScopes}:{}),
      ...(operationRestrictions.length?{operationRestrictions}:{}),
      ...(unresolvedConstraints.length?{unresolvedConstraints}:{}),
      invocation:{tool:entry.kind==='tool'?entry.name:null,argumentPolicy:'Use the host tool schema and actual task inputs; do not invent parameters.',executor:'host-agent',automaticallyExecuted:false},
      reason:explicit?'用户在当前任务中点名此能力':fillsSubstrate?`任务需要 ${role}，该工具的具体用途可补足此缺口；输入及效果仍须核对`:`任务与能力共有具体信号：${shared.slice(0,4).join('、')}`});
  }
  const hostRequests=addStructuredCandidates(cards,assessment,options,inventory,purposes,phase,readOnly,networkForbidden,facets,specialistNeeds);
  const candidates = selectWithHostRequests(cards,needs,hostRequests.requests,Math.min(10, Math.max(1,options.capabilityLimit || 5)));
  const covered = new Set(candidates.filter(card=>decisionOrder[card.decision]<2).flatMap(card=>card.needMatches.map(match=>match.index)));
  const needCoverage = {requested:needs,covered:needs.filter((_,index)=>covered.has(index)),uncovered:needs.filter((_,index)=>!covered.has(index)),
    verification:'Retrieval coverage only; tool execution and output quality remain unverified.'};
  return {revision:inventory.revision,coverage:inventory.coverage,errors:inventory.errors,phase,candidates,
    sourceAccessRequirements:sourceAccessNeeds(assessment),
    needCoverage,
    hostCapabilityCoverage:{requests:hostRequests.requests.map(request=>{
      const matched=candidates.filter(card=>card.hostRequestMatches?.some(item=>item.index===request.index));
      return {index:request.index,purpose:request.purpose,evidenceRefs:request.evidenceRefs,
        status:matched.some(card=>card.decision!=='skip')?'retrieved':matched.length?'restricted':'unresolved',
        toolNames:matched.map(card=>card.name),authority:'advisory-only'};
    }),unresolved:hostRequests.unresolved,verification:'Candidate retrieval only; execution, authorization and authentication remain host responsibilities.'},
    executionPolicy:{executor:'host-agent',advisoryOnly:true,scanExecutesTools:false,
      recheckAt:['initial-task','phase-change','capability-gap','tool-unavailable'],
      skipWhen:['native-tools-sufficient','no-specific-task-benefit','already-have-required-evidence'],
      rule:'Use helpful, currently callable tools within existing authorization. Discovery is not permission; do not ask again for already authorized routine work.'}};
}
