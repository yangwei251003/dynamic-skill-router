import {semanticTaskText,taskStructure} from './task-structure.mjs';
import {randomUUID} from 'node:crypto';
import {discoverSkills} from './discovery-v4.mjs';
import {readFeedbackV4} from './feedback-v4.mjs';
import {inferCapability, inferSkillStage, skillDomainCompatible, capabilityActionCompatible, capabilityDirectlyRequested} from './skill-staging.mjs';
import {adviseCapabilities} from './capabilities-v4.mjs';
import {planRecovery, useFastPath} from './recovery-v4.mjs';
import {taskText} from './task-input.mjs';
import {adviseTaskMethods} from './task-methods-v4.mjs';
import {assessRestrictions} from './task-restrictions.mjs';
import {closedSuppliedProse} from './supplied-prose.mjs';
import {requestedName,unquoteRequestedNames} from './request-entities.mjs';
import {webImplementation,evidenceResearch,cadArtifact,latexArtifact,mcpImplementation,imageArtifact,structuredDataOperation,accessibilityNeed,manualNeedKeys,backendImplementation,designToCode,wordDocumentArtifact,desktopObservation,skillAuthoring,publicInformationSearch,businessAnalysis,experimentWork,experimentDesign,electricalDesign,databaseMigration,electricalInspection,wordDocumentInspection,numericalComputation,optionComparison,gameImplementation,sourceCodeReview,latexSourceRepair} from './task-intents.mjs';

const norm = (value) => String(value || '').normalize('NFKC').toLowerCase();
const list = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter(Boolean))];
const STOP = new Set('a an and are as at be because before but by can code condition data do evidence explain for from full give has have how i in into is it its list load make making my name new no not of on or our out over please point real request review run should skill skills the their them there these this to use user users using version versions what when where which with work write you your app apps system systems task tasks need needs add claim'.split(' '));
const STEM = new Map(Object.entries({diagnostic:'debug',diagnostics:'debug',diagnose:'debug',diagnosing:'debug',troubleshoot:'debug',troubleshooting:'debug',failure:'debug',incident:'debug',outage:'debug',slow:'performance',slowness:'performance',migrations:'migration',migrate:'migration',migrating:'migration',schemas:'schema',rollbacks:'rollback',deployments:'deployment',deploy:'deployment',features:'feature',requirements:'requirement',prioritize:'priority',prioritization:'priority',concurrent:'concurrency',atomicity:'atomic',transactions:'transaction'}));
function token(value) {
  const normalized = norm(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!normalized || STOP.has(normalized)) return '';
  const morphological={experimental:'experiment',experimentation:'experiment',randomization:'random',randomisation:'random',randomizing:'random',randomising:'random',randomized:'random',randomised:'random',accessible:'accessibility',analyses:'analysis',analysis:'analysis',status:'status',process:'process',access:'access',business:'business',css:'css',canvas:'canvas',canvases:'canvas'};
  if (normalized === 'postgresql' || normalized === 'postgres') return 'postgres';
  return morphological[normalized] || STEM.get(normalized) || normalized.replace(/(ies|ing|ed|s)$/i, (ending) => ending === 'ies' ? 'y' : '');
}
const legacyWords = (value) => {
  const text = norm(value);
  const latin = text.match(/[a-z][a-z0-9]{1,}/g) || [];
  const han = text.match(/[\p{Script=Han}]{2,}/gu) || [];
  return [...latin, ...han.flatMap((run) => {
    const parts = [];
    for (let size = 2; size <= 3; size++) for (let i = 0; i + size <= run.length; i++) parts.push(run.slice(i, i + size));
    return parts;
  })].map(token).filter((item) => item.length >= 2 && !STOP.has(item));
};

// Word boundaries provide evidence; arbitrary overlapping character fragments do not.
const segmenter = new Intl.Segmenter('zh', {granularity: 'word'});
const HAN_STOP = new Set('一个 这个 那个 这些 那些 我们 你们 自己 用户 任务 工作 使用 采用 可以 能够 需要 希望 帮助 进行 提供 相关 内容 方式 方法 以及 通过 根据 然后 最后 目前 现在 已经 还有 怎么 如何 什么 是否 很好 更好 高质量 优质 优秀 全局 动态 就是 直到 本身 其中 针对 完成 做好 要求 判断 重要 特别 确实 真实 具体 原来 一下 一些 所有 各种 更多 不同 进一步 同时 尽量'.split(' '));
const wordCache = new Map();
const words = (value) => {
  const text = norm(value);
  if (wordCache.has(text)) return wordCache.get(text);
  const latin = [...(text.match(/[a-z][a-z0-9]{1,}/g) || []),...(text.match(/[a-z][a-z0-9]+(?:\.[a-z0-9]+)+/g)||[]).map(term=>term.replaceAll('.',''))].map(token);
  const han = [...segmenter.segment(text)].filter(part => part.isWordLike && /\p{Script=Han}/u.test(part.segment))
    .map(part => part.segment).filter(part => part.length >= 2 && !HAN_STOP.has(part));
  const result = unique([...latin, ...han].filter(item => item.length >= 2 && !STOP.has(item)));
  if (wordCache.size > 6000) wordCache.clear();
  wordCache.set(text, result);
  return result;
};

function retrievalTerms(text, experimental = false, legacy = false) {
  const terms = new Set((legacy ? legacyWords : words)(text));
  const bridges = [
    [/数据库/gu, ['database']],
    [/数据库(?:结构|模式)|表结构|字段|列名/gu, ['schema']],
    [/迁移/gu, ['migration']],
    [/回滚/gu, ['rollback']],
    [/并发/gu, ['concurrency']],
    [/事务/gu, ['transaction']],
    [/网页|网站|前端/gu, ['frontend', 'website']],
    [/幻灯片|演示文稿|课件|PPT/gi, ['presentation', 'slides']],
    [/表格|电子表|Excel/gi, ['spreadsheet']],
    [/论文|文献/gu, ['academic']],
    [/竞品|竞争对手|市场规模|商业可行性|market sizing|competitor/gi, ['market','competitor']],
    [/电路|原理图|PCB/gi, ['circuit', 'schematic']],
    [/技能路由|路由器/gu, ['router']],
    [/视频|剪辑|动效/gu, ['video']],
    [/提示词/gu, ['prompt']],
    [/故障排查|排查故障|调试|诊断/gu, ['debug']],
    [/实验|试验/gu,['experiment']],
    [/随机(?:化|分组)|randomization|randomisation/gi,['random']],
    [/分区|区组|blocking/gi,['blocking']],
    [/无障碍|可访问|键盘导航|读屏/gu,['accessibility']],
    [/润色|校对|proofread|polish/gi,['polish']],
    [/后端|服务器|服务端|\b(?:node\.?js|express|fastapi|django|flask|http)\b.{0,30}(?:服务|接口|service|api)|(?:服务|接口|service|api).{0,30}\b(?:node\.?js|express|fastapi|django|flask|http)\b/gi,['backend','api']],
    [/原理图|电路板|嘉立创|EDA/gi,['schematic','pcb']],
    [/\.tex\b|\btex\b|\b(?:pdf|xe|lua)?latex\b|\blatexmk\b|\btectonic\b|\bfontspec\b/gi,['latex']],
    [/键盘.{0,35}(?:控制|操作|移到|移动|焦点|按钮|导航)|keyboard.{0,25}(?:control|operat|navigat|focus)/gi,['accessibility']],
    [/(?:未解析|未定义|重复).{0,12}(?:引用|label|reference)|(?:引用|label|reference).{0,12}(?:未解析|未定义|重复)/gi,['reference','debug']],
    [/rename.{0,60}(?:column|field)|(?:column|field).{0,60}rename|schema change|mixed.{0,50}deployment/i, ['schema', 'migration']],
    [/diagnostic|diagnos|troubleshoot|investigat|incident|outage|requests slow|connections increased/i, ['debug']],
    [/real goal|minimal useful|which features|additional features|product direction|product scope|requirements/i, ['product', 'direction', 'why']],
    [/lost updates|lose updates|concurrent requests|shared db|atomicity/i, ['concurrency', 'transaction']],
  ];
  const inferred = [];
  if(!legacy){
    for(const [matched,additions,evidence] of [[sourceCodeReview(text),['code','review'],'source code review action/object'],[latexSourceRepair(text),['latex','repair'],'LaTeX source repair action/object']])
      if(matched)for(const term of additions){terms.add(term);inferred.push({term,evidence});}
    for(const [matched,additions,evidence] of [[webImplementation(text),['frontend','website'],'web implementation action/object'],[evidenceResearch(text),['research','search'],'evidence research action/object'],[cadArtifact(text),['cad'],'CAD artifact object']])
      if(matched)for(const term of additions){terms.add(term);inferred.push({term,evidence});}
    for(const [matched,additions,evidence] of [[mcpImplementation(text),['mcp','server','validation'],'MCP implementation action/object'],[imageArtifact(text),['image','edit'],'raster image action/object'],[structuredDataOperation(text),['analysis','validation','数据分析'],'structured data operation']])
      if(matched)for(const term of additions){terms.add(term);inferred.push({term,evidence});}
    for(const [matched,additions,evidence] of [[numericalComputation(text),['numerical','scientific','数学建模'],'numerical computation action/object'],[optionComparison(text),['decision','consulting'],'option comparison action/object'],[gameImplementation(text),['game'],'game implementation action/object'],[backendImplementation(text),['backend','api'],'backend implementation action/object'],[wordDocumentArtifact(text),['word','docx'],'editable Word document artifact'],[desktopObservation(text),['desktop','电脑','界面'],'existing desktop observation']])
      if(matched)for(const term of additions){terms.add(term);inferred.push({term,evidence});}
  }
  for (const [pattern, additions] of bridges) {
    const match = pattern.exec(text);
    if (match && (!legacy || experimental || !/\p{Script=Han}/u.test(match[0]))) for (const term of additions) { terms.add(term); inferred.push({term, evidence: match[0]}); }
  }
  return {terms, inferred};
}

export function retrievalIndex(skills, activeText, experimental = false, legacy = false) {
  const {terms, inferred} = retrievalTerms(activeText, experimental, legacy);
  const documents = skills.map((skill) => {
    const identity = [skill.id, skill.nameZh, skill.name, ...list(skill.aliases)].join(' ');
    const description = [skill.summaryZh, skill.description, ...list(skill.triggers)].join(' ');
    const tokenize = legacy ? legacyWords : words;
    return {identity: new Set(tokenize(identity)), description: new Set(tokenize(description))};
  });
  const df = new Map();
  for (const doc of documents) for (const term of new Set([...doc.identity, ...doc.description])) df.set(term, (df.get(term) || 0) + 1);
  return {terms, inferred, documents, df, corpusSize: skills.length, experimental, legacy};
}
const explicitName = (skill) => unique([skill.id, skill.nameZh, skill.name, ...list(skill.aliases)].filter(Boolean)
  .flatMap(name => [name,String(name).replace(/[-_]/g,' ')]));

function queryClauses(query) {
  const raw = String(query || '');
  // Host plugin mentions are explicit names; preserve their surrounding clause
  // so quoted, future and negative uses still go through the scope filters.
  const mentions = taskText(raw.replace(/\[\$([\w.:-]+)\]\(app:\/\/[^\s)]+\)/g, ' $$$1 '));
  // Reported instructions remain source material even when they quote only a
  // skill identifier. Strip reporting clauses before unquoting direct requests.
  const reported = mentions
    .replace(/(?:^|[。，,；;\n])\s*(?:参考资料|参考文档|(?:产品|用户|设备|技术|操作|项目|参考|样例|示例)?手册|网页(?:上|中|里)?|页面(?:上|中|里)?|文章(?:中|里)?|文档(?:中|里)?|日志(?:中|内|里)?)(?:说|写着|写道|提到|指出|要求|建议|记录|描述|[：:])[^。；;\n]*(?=[。；;\n]|$)/g,' ')
    .replace(/(?:^|[.,;\n])\s*(?:the\s+)?(?:readme|document|article|manual|webpage|log|reference|source)\s+(?:says?|states?|instructs?|recommends?|reads?)\s*:?(?:\s+|(?=[^a-z]))[^.;\n]*(?=[.;\n]|$)/gi,' ');
  // Only unquote an identifier directly governed by a use verb. Quoted examples
  // and arbitrary code remain excluded; later clause checks still reject negation.
  const namedQuotes = unquoteRequestedNames(reported);
  const withoutCode = namedQuotes.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, (_, inner) => /^\$[\p{L}\p{N}_.:-]+$/u.test(inner.trim()) ? inner.trim() : ' ');
  const sourceFiltered = withoutCode.replace(/(?:^|[。；;\n])\s*(?:参考资料|参考文档|网页上的|页面上的|文章中|文章里|文档中|文档里)[^。；;\n]*[“‘"][^。；;\n]*(?=[。；;\n]|$)/g,' ');
  const withoutQuotes = sourceFiltered.replace(/[“"「『][^”"」』\n]*[”"」』]/g, ' ')
    .replace(/‘[^’\n]*’|【[^】\n]*】/g, ' ')
    .replace(/(^|[\s:：])'[^'\n]+'(?=\s|[.,，。;；]|$)/g, ' ')
    .replace(/^\s*>.*$/gm, ' ');
  const clauses = withoutQuotes.split(/[。！？!?;；，,\n]+|而(?:是|要)|但是|但(?=请|要|需|改为|可以)|\bbut\b|\binstead\b/i).map((value) => value.trim()).filter(Boolean);
  const futurePattern=/以后|将来|未来|后续|下一步|届时|日后|计划(?:再|之后)|(?:等|待)(?:我|用户|客户|审批|确认|授权).{0,20}(?:确认|批准|授权|同意|后)|(?:确认|批准|授权)后|\bafter\s+(?:approval|confirmation|I\s+(?:approve|confirm))|\bonce\s+(?:approved|confirmed|I\s+(?:approve|confirm))|eventually|later|future|subsequently/i;
  const isFuture = (value) => futurePattern.test(value);
  const negativePattern=/不要|不得|禁止|不允许|不准|不能|不可|别用|不用|不使用|不调用|不启用|不采用|不(?:替我|帮我|公开|线上|在线)?(?:做|进行|制作|生成|编写|修改|重绘|导出|发布|写|新建|创建|提交|上传|下载|启动|发送|报名|执行|访问|运行|安装|连接|部署|注册|联系)|没有(?:线上|在线)?(?:发布|部署|上传)需求|无需|不需要|避免|do not|don't|must not|may not|cannot|can't|should not|shouldn't|never|without/i;
  const isNegative = (value) => negativePattern.test(value);
  const active = clauses.flatMap((value) => {
    if(/^(?:并)?(?:不是|并非|而非)|^(?:not\b|rather than\b)/i.test(value))return [];
    const source = value.split(/(?:例如|比如|举例|示例|for example|e\.g\.)/i)[0];
    // A negative attribute qualifies the requested object. It does not cancel
    // the governing action: "create a page that needs no server" is still a page.
    // Keep the untouched clause in constraintText for permission assessment.
    const usable = source.replace(/(?:无需|无须|不需要|不用)[^，。；;\n]{1,40}?的/g,(modifier,offset)=>{
      const before=source.slice(0,offset);
      return /(?:做|制作|开发|创建|设计|实现|编写|写|交付|导出|生成|画|搭建|给我|研究|了解|比较|评估|检查|核对|一个|一份|一种|一套)[^，。；;\n]{0,30}$/.test(before)?'':modifier;
    });
    // A future time horizon inside a request to produce a plan is current work.
    const currentPlan = /^(?:(?:请你?|现在|本次|帮我|麻烦)\s*)*(?:(?:为|针对)未来.{0,25}(?:制定|编写|设计|准备)|(?:制定|编写|设计|准备)).*(?:计划|方案)/.test(usable)
      || /^(?:please\s+)?(?:write|create|prepare|design)\b.*\bplan\b/i.test(usable);
    const planning = currentPlan ? usable.replace(/(?:未来|后续)(?=.{0,35}(?:计划|方案))/g, '').replace(/\bfuture\b/gi, '') : usable;
    const beforeFuture = planning.split(futurePattern)[0];
    const beforeNegative = beforeFuture.split(negativePattern)[0];
    return beforeNegative.trim() && !isNegative(beforeNegative) ? [beforeNegative.trim()] : [];
  });
  const constraintText = clauses.map(value => value.split(/(?:例如|比如|举例|示例|for example|e\.g\.)/i)[0]).join('\n');
  // Preserve sentence boundaries for scoped restrictions: a comma may continue
  // a protected object, whereas a new sentence can state a global prohibition.
  const restrictionText=withoutQuotes.replace(/(?:例如|比如|举例|示例|for example|e\.g\.)[^。！？!?;；，,\n]*/gi,'');
  return {active, future: clauses.filter(isFuture), negative: clauses.filter(isNegative), raw, constraintText, restrictionText};
}

function lexicalScore(haystack, needle) {
  const h = norm(haystack);
  const n = norm(needle).trim();
  if (!n || n.length < 2) return 0;
  if (/^[a-z0-9._-]+$/.test(n)) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(h) ? 1 : 0;
  }
  return h.includes(n) ? 1 : 0;
}

function independentHits(hits, active) {
  const occupied = new Set();
  const accepted = new Set();
  // Overlapping Chinese bigrams/trigrams are one piece of evidence, not votes.
  const han = hits.filter(hit => /^[\p{Script=Han}]+$/u.test(hit.term))
    .sort((a, b) => b.term.length - a.term.length || b.weight - a.weight);
  for (const hit of han) {
    const start = norm(active).indexOf(hit.term);
    if (start < 0) continue;
    const positions = Array.from({length: hit.term.length}, (_, i) => start + i);
    if (positions.some(i => occupied.has(i))) continue;
    positions.forEach(i => occupied.add(i)); accepted.add(hit.term);
  }
  const generic = new Set(['技能', '研究', '对比', '方案', '风险']);
  return hits.filter(hit => !generic.has(hit.term) && (!/^[\p{Script=Han}]+$/u.test(hit.term) || accepted.has(hit.term)));
}

export function taskAssessment(query, taskContext = {}, invocationContext = {}) {
  const parsedClauses = queryClauses(query);
  const suppliedOperation = closedSuppliedProse(taskText(query));
  // Only a complete input-closed grammar may remove data from retrieval. The
  // original request and actual restrictions remain available for host review.
  const clauses = suppliedOperation ? {...parsedClauses,active:[suppliedOperation.instructionText]} : parsedClauses;
  const activeText = clauses.active.join('\n');
  const structure = taskStructure(activeText);
  const strings = values => unique(list(values).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()));
  const statedActions = strings(taskContext.actions);
  const statedDeliverables = strings(taskContext.deliverables);
  const development = /开发|实现|修复|重构|迁移|集成|升级|编写代码|build|implement|develop|fix|refactor|migrat/i.test(activeText)
    || webImplementation(activeText)
    || /(?:做|制作|搭建|创建).{0,25}(?:网页|网站|应用|系统|游戏|软件|程序|插件)/i.test(activeText);
  const selfContainedFunction = /^\s*(?:export|implement|write)\s+(?:an?\s+)?(?:async\s+)?[a-z_$][\w$]*\s*\(/i.test(activeText)
    && !/repository|database|deployment|production|security audit|cross.module|existing system/i.test(activeText);
  const complexitySignals = [
    /跨.{0,8}(?:模块|服务|系统|边界)|前后端|cross[- ]?(?:module|service)/i.test(activeText) && 'cross-boundary',
    /迁移|兼容|状态|并发|权限|安全|部署|migration|compatib|concurren|security|deploy/i.test(activeText) && 'migration-or-system-impact',
    /架构|设计取舍|tradeoff|architecture/i.test(activeText) && 'design-tradeoff',
    /集成|接口|构建|既有|现有|integrat|existing/i.test(activeText) && 'existing-system-integration',
    /独立(?:子任务|交付物|工作线)|多个(?:模块|交付物)|parallel workstreams/i.test(activeText) && 'independent-deliverables',
  ].filter(Boolean);
  const hostComplexity = ['low','medium','high'].includes(taskContext.complexity) ? taskContext.complexity : null;
  const hostEvidence = strings(taskContext.complexityEvidence);
  const complexDevelopment = development && (unique(complexitySignals).length >= 2 || hostComplexity === 'high');
  const complexity = complexDevelopment || hostComplexity === 'high' ? 'complex'
    : development || hostComplexity === 'medium' ? 'moderate' : 'simple';
  const taskType = /审查|review|audit|检查|核验/i.test(activeText) ? 'review'
    : development ? 'development'
      : /研究|调研|论文|文献|research/i.test(activeText) ? 'research'
        : /分析|统计|数据|analys/i.test(activeText) ? 'analysis' : 'general';
  const constraints = strings(taskContext.constraints);
  const restrictionAssessment=assessRestrictions(clauses.restrictionText,constraints.map(value=>queryClauses(value).restrictionText),invocationContext,clauses.active);
  if(suppliedOperation?.chatOnly){
    restrictionAssessment.readOnly=true;
    restrictionAssessment.sources=unique([...restrictionAssessment.sources,'closed-supplied-input']);
    restrictionAssessment.evidence.push({source:'user-request',scope:'all-writes',basis:'complete-supplied-text-operation',operation:suppliedOperation.kind});
  }
  const {readOnly,sources:readOnlySources}=restrictionAssessment;
  const explicitSkills = list(taskContext.explicitSkills).filter((name) => lexicalScore(activeText, name));
  const objective = typeof taskContext.objective === 'string' && taskContext.objective.trim()
    ? taskContext.objective.trim() : activeText.slice(0, 280);
  const domain = typeof taskContext.domain === 'string' ? taskContext.domain.trim() || null : null;
  const acceptanceCriteria = strings(taskContext.acceptanceCriteria);
  const capabilityNeeds = strings(taskContext.capabilityNeeds);
  const evidence = list(taskContext.evidence).filter(item => item && ['user','project','runtime','reference','inference'].includes(item.source)
    && typeof item.reference === 'string').map(item => ({source:item.source,reference:item.reference,claim:typeof item.claim==='string'?item.claim:undefined}));
  // Preserve host interpretation in its own fields, but do not use its proposed
  // mutations as retrieval evidence during a globally read-only invocation.
  // This projection never changes the source request or restriction decision.
  const advisoryProjection = value => taskStructure(value).clauses.filter(clause=>!readOnly
    || !/修复|修改|编辑|重构|新增|创建|开发|生成|部署|发布|推送|发送|删除|安装|\b(?:fix|repair|edit|modify|refactor|create|develop|generate|deploy|publish|push|send|delete|install)\b/i.test(clause)).join('\n');
  const hostRetrieval = [taskContext.objective ? objective : '', domain, ...statedActions, ...statedDeliverables, ...capabilityNeeds].map(advisoryProjection);
  return {
    objective,
    actions: statedActions,
    deliverables: statedDeliverables,
    domain,
    explicitSkills,
    constraints,
    complexity, taskType, complexityEvidence: unique(complexitySignals), development, complexDevelopment, selfContainedFunction, readOnly,
    activeText, activeClauses: clauses.active, negativeRequests:clauses.negative, constraintClauses:clauses.constraintText.split('\n').filter(Boolean),
    originalRequest: clauses.raw,
    suppliedOperation,
    acceptanceCriteria, capabilityNeeds, evidence,
    taskStructure: structure,
    retrievalText: unique([structure.intentText, ...hostRetrieval]).join('\n'),
    interpretation: {source:'host-context',authority:'advisory-only',hostComplexity,complexityEvidence:hostEvidence,
      retrievalCapabilityNeeds:capabilityNeeds.map(advisoryProjection).filter(Boolean)},
    restrictions: {readOnly, sources:readOnlySources, protectedScopes:restrictionAssessment.protectedScopes,evidence:restrictionAssessment.evidence,networkForbidden:restrictionAssessment.networkForbidden,executionScope:suppliedOperation?'chat-only':'unspecified',mode:invocationContext.mode || 'unspecified',canGrantPermission:false},
    excludedContext: {futureClauses: clauses.future.length, negativeClauses: clauses.negative.length},
  };
}

function skillAvailability(skill, host, runtimeCapabilities) {
  const declared = skill.availability || {};
  const compatibility = skill.hostCompatibility?.[host];
  const hostCompatible = compatibility !== 'unsupported' && compatibility !== 'degraded'
    && (!Array.isArray(skill.compatibleHosts) || skill.compatibleHosts.includes(host));
  const compatible = declared.compatible !== false && hostCompatible;
  const discovered = declared.discovered !== false;
  const readable = declared.readable !== false;
  const enabled = declared.enabled !== false && !['unsupported', 'disabled', 'degraded'].includes(skill.status);
  const requiredTools = unique([...list(skill.requiredTools), ...list(skill.requiresTools), ...list(skill.requirements?.tools)]);
  const runtimeTools = list(runtimeCapabilities?.tools);
  const toolsAvailable = declared.toolsAvailable === false ? false
    : requiredTools.length && Array.isArray(runtimeCapabilities?.tools) ? requiredTools.every((tool) => runtimeTools.includes(tool))
      : requiredTools.length ? null : declared.toolsAvailable ?? null;
  const reasons = [];
  if (!discovered) reasons.push('not-discovered');
  if (!readable) reasons.push('manual-unreadable');
  if (!enabled) reasons.push(skill.status === 'degraded' ? 'degraded-not-executable' : 'disabled');
  if (!compatible) reasons.push('host-incompatible');
  if (toolsAvailable === false) reasons.push('required-tools-unavailable');
  if (toolsAvailable === null && requiredTools.length) reasons.push('required-tools-unverified');
  return {discovered, readable, enabled, compatible, toolsAvailable, reasons};
}

export function scoreCandidate(skill, assessment, host, runtimeCapabilities, calibration, retrieval, document) {
  const active = semanticTaskText(assessment.activeText);
  const retrievalText = assessment.retrievalText || active;
  const names = explicitName(skill);
  // A plugin mention identifies its currently supplied runtime skills, not an
  // unrelated legacy skill which happens to share the package's name.
  if (skill.sourceId?.startsWith('plugin:')) names.push(skill.sourceId.slice(7));
  const denied = list(assessment.negativeRequests).some(clause =>
    /(?:不要|不得|禁止|不允许|不准|不能|不可)(?:使用|调用|启用|采用|用)|别用|不用|不使用|不调用|不启用|不采用|不需要(?:使用|调用)|(?:do not|don't|must not|may not|cannot|can't|should not|shouldn't|never)\s+(?:use|apply|invoke)/i.test(clause)
    && names.some(name => lexicalScore(clause,name)));
  if (denied) return {skill,score:0,explicit:false,capability:inferCapability(skill),phase:inferSkillStage(skill),reasons:['explicit exclusion in user request'],availability:skillAvailability(skill,host,runtimeCapabilities),evidence:[]};
  const activeNameText=norm(assessment.activeText);
  const entityRequest=names.filter(name=>!/^[\x00-\x7f\p{Script=Han}]+$/u.test(name)||activeNameText.includes(norm(name)))
    .map(name=>requestedName(assessment.activeClauses||[active],name)).find(Boolean);
  const explicit=!!entityRequest;
  if (assessment.selfContainedFunction && !explicit) return {
    skill, score: 0, explicit: false, capability: inferCapability(skill), phase: inferSkillStage(skill),
    reasons: ['self-contained function; native baseline is sufficient'], availability: skillAvailability(skill, host, runtimeCapabilities), evidence: [],
  };
  const capability = inferCapability(skill);
  const phase = inferSkillStage(skill, capability);
  const needKeys=manualNeedKeys(skill,capability,retrievalText);
  const webCreation=webImplementation(retrievalText);
  const actionMatch=webCreation && ['visual-design','frontend-implementation'].includes(capability)
    || experimentDesign(retrievalText) && capability==='experiment-design'
    || (electricalDesign(retrievalText)||electricalInspection(retrievalText)) && capability==='electrical-design'
    || databaseMigration(retrievalText) && capability==='database-migration'
    || mcpImplementation(retrievalText) && capability==='mcp-authoring'
    || latexArtifact(retrievalText) && capability==='latex' && needKeys.length>0
    || accessibilityNeed(retrievalText) && capability==='accessibility'
    || structuredDataOperation(retrievalText) && capability==='data-analysis'
    || designToCode(retrievalText) && capability==='design-to-code'
    || backendImplementation(retrievalText) && capability==='backend-implementation'
    || (wordDocumentArtifact(retrievalText)||wordDocumentInspection(retrievalText)) && needKeys.includes('word-document')
    || desktopObservation(retrievalText) && capability==='desktop-operation'
    || evidenceResearch(retrievalText) && capability==='research'
    || publicInformationSearch(retrievalText) && capability==='public-information-search'
    || skillAuthoring(retrievalText) && capability==='skill-authoring'
    || businessAnalysis(retrievalText) && needKeys.includes('business-analysis')
    || needKeys.some(key=>['spatial-data','video-postproduction','mathematical-modeling','numerical-computation','option-comparison','game-implementation','source-code-review','latex-source-repair','cad-model'].includes(key))
    || imageArtifact(retrievalText) && capability==='image-production' && skill.sourceId===host+'-system';
  const compatibleDomain=skillDomainCompatible(skill,retrievalText);
  const identityText=[skill.id,skill.name,skill.nameZh,...list(skill.aliases)].join(' ');
  const manualSummary=[skill.summaryZh,skill.description].filter(Boolean).join(' ');
  const exclusionStop=new Set(['standard','routine','basic','general','task','use','query']);
  const exclusions=[...manualSummary.matchAll(/(?:do not use(?: this skill)? for|not suitable for|不适用于|不要用于)\s*([^.!。\n]+)/gi)]
    .flatMap(match=>match[1].split(/,|、|\bor\b/i));
  const explicitlyOutOfScope=exclusions.some(phrase=>{
    const terms=words(phrase).filter(term=>!exclusionStop.has(term));
    const matched=terms.filter(term=>retrieval.terms.has(term));
    return terms.length>=2 && matched.length>=2 && matched.length/terms.length>=0.6;
  });
  const financeSpecialist=/(?:stock|equity)[-_ ]?(?:analysis|analyst|market|trading)|a-stock|股票|证券|backtest|yfinance/i.test(identityText);
  const financeIntent=/股票|证券|股价|股市|基金|财报|估值|交易策略|回测|stock|equity|ticker|trading|backtest/i.test(retrievalText);
  const scopeChecks=[
    [/(?:^|:)qclaw-rules$/i, /qclaw/i],
    [/network-config-validation/i, /路由设备|交换机|子网|网段|网络配置|cisco|\bvlan\b|\bsubnet\b|network.{0,20}config|switch.{0,20}config/i],
    [/mle-workflow/i, /机器学习|模型训练|训练模型|训练集|machine.learning|\bML\b|training|prediction|inference pipeline/i],
    [/batch-file-processor/i, /批量.{0,8}(?:文件|改名|重命名|转换|整理)|(?:batch|bulk|mass).{0,30}(?:file|rename|convert)|(?:files|文件).{0,20}(?:batch|bulk|批量)/i],
    [/web-clone/i, /复刻|克隆|仿站|仿照|还原|参照.{0,12}(?:网页|网站)|clone|reproduce|replicat|recreat|copy.{0,12}(?:site|website)/i],
  ];
  const scopeMismatch=scopeChecks.some(([identity, intent])=>identity.test(skill.id) && !intent.test(retrievalText));
  const requiredMention=manualSummary.match(/在用户提及\s+([a-z][a-z0-9._-]+)/i)?.[1];
  const specificContextMismatch=requiredMention && !lexicalScore(retrievalText,requiredMention)
    || /(?:client[- ]intelligence|资讯网站|情报台)/i.test(identityText+' '+manualSummary) && !/资讯|情报|新闻|日报|rss|news|intelligence|daily digest/i.test(retrievalText)
    || /experiment[- ]log|实验日志/i.test(identityText) && !experimentWork(retrievalText)
    || /^extract an existing website's visual system/i.test(manualSummary) && !/https?:\/\/|参考.{0,15}(?:网站|网页)|复刻|仿照|还原|existing website|reference (?:url|site)|recreat/i.test(retrievalText);
  const videoSpecialist=(/video|视频/i.test(identityText) || /^(?:视频|video)/i.test(manualSummary)) && /video|视频/i.test(manualSummary);
  const videoIntent=needKeys.includes('video-postproduction') || /视频|短片|成片|剪辑|片头|分镜|镜头|\bvideo\b|\bfilm\b|\bclip\b|\bshot\b/i.test(retrievalText);
  if (!explicit && (!compatibleDomain || financeSpecialist && !financeIntent || scopeMismatch || specificContextMismatch || explicitlyOutOfScope || videoSpecialist && !videoIntent)) return {
    skill,score:0,explicit,capability,phase,reasons:['specialist scope does not match current task'],availability:skillAvailability(skill,host,runtimeCapabilities),evidence:[],
  };
  // A language extension inside a filename is a format hint, not an invocation
  // of every product-specific manual registered under that extension.
  const triggerHits = list(skill.triggers).filter((term) => lexicalScore(active, term)
    && !/^(?:py|js|ts|mjs|cjs|sh|ps1)$/i.test(term));
  const description = [skill.summaryZh, skill.description, skill.nameZh, skill.name, skill.category].filter(Boolean).join(' ');
  const rawLexicalHits = [...retrieval.terms].filter((term) => document.identity.has(term) || document.description.has(term))
    .map((term) => {
      const rarity = 1 + Math.log(1 + (retrieval.corpusSize + 1) / ((retrieval.df.get(term) || 0) + 1));
      const translated = retrieval.inferred.some(item => item.term === term && /\p{Script=Han}/u.test(item.evidence));
      return {term, weight: Math.max(translated ? 4 : 0, Math.min(7, rarity) * (document.identity.has(term) ? 1.5 : 1)), inferred: retrieval.inferred.some((item) => item.term === term)};
    })
    .filter((hit) => hit.weight >= 1.4)
    .sort((a, b) => b.weight - a.weight);
  const lexicalHits = retrieval.legacy && !retrieval.experimental ? rawLexicalHits : independentHits(rawLexicalHits, retrievalText);
  const descriptionScore = lexicalHits.slice(0, 5).reduce((sum, hit) => sum + hit.weight, 0);
  // A manual's subject is stronger evidence than incidental vocabulary in a
  // long description. Provider/version boilerplate and generic roles are not subjects.
  const genericIdentity=new Set(['codex','plugin','legacy','ecc','system','skill','tool','tools','design','analysis','research','pattern','workflow','expert','pro','creator','create','build','develop','database','query','sql','工具','技能','方法','分析','研究','创建','设计','工作','流程','系统','专业']);
  const identityTerms=words([skill.nameZh,skill.name,String(skill.id||'').split(':').at(-1)].filter(Boolean).join(' '))
    .filter(term=>!genericIdentity.has(term)&&!/^\d+$/.test(term));
  // A substring inside an output filename is not a request for that subject.
  // Dotted technical names retain their complete identity (e.g. Three.js).
  const directSubjects=new Set((norm(active).match(/[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*/g)||[])
    .flatMap(value=>[token(value),...(value.includes('.')?[token(value.replaceAll('.',''))]:[])]));
  const identityHits=identityTerms.filter(term=>retrieval.terms.has(term)
    && (/\p{Script=Han}/u.test(term)||directSubjects.has(term)||retrieval.inferred.some(item=>item.term===term)));
  // A distinctive technology or file-format subject is already independent
  // evidence. Requiring an unrelated second word favors broad noisy manuals.
  const rareSubject=identityHits.some(term=>directSubjects.has(term)&&/^[a-z][a-z0-9]{2,}$/.test(term)
    && (retrieval.df.get(term)||0)/Math.max(1,retrieval.corpusSize)<=0.025);
  const subjectMatch=identityHits.length>0&&(rareSubject||identityHits.length/identityTerms.length>=0.67&&lexicalHits.length>=2);
  const directSubjectMatch=subjectMatch&&identityHits.some(term=>lexicalScore(active,term)&&!retrieval.inferred.some(item=>item.term===term));
  const domain = assessment.domain;
  const domainMatch = domain && lexicalScore([description, ...list(skill.domains)].join(' '), domain);
  let score = (explicit ? 30 : 0) + Math.min(3, triggerHits.length) * 6 + descriptionScore + (domainMatch ? 3 : 0) + (actionMatch ? 16 : 0) + (subjectMatch ? 12 : 0);
  // Host-maintained authoring guidance describes that host's packaging contract.
  if(capability==='skill-authoring'&&skill.sourceId===host+'-system')score+=8;
  if (lexicalScore(active, skill.id)) score += 5;
  if (capability === 'skill-governance' && /技能|skill|路由器|router/i.test(active)) score += 8;
  const diagnosticIntent = /diagnostic|diagnos|troubleshoot|investigat|incident|outage/i.test(active)
    && /mitigation|reversible|cause|evidence|checks|checks|检查|排查/i.test(active);
  const shortName = String(skill.id || '').split(':').at(-1);
  const specialistNameTerms = words(shortName).filter((term) => !['debug', 'pro', 'workflow', 'systematic'].includes(term) && !/^\d+$/.test(term));
  const diagnosticNameMatch = diagnosticIntent && /\bdebug(?:ging)?\b/i.test([skill.id, skill.nameZh, skill.name].join(' '))
    && specialistNameTerms.every((term) => retrieval.terms.has(term))
    && lexicalHits.some((hit) => hit.term === 'debug');
  if (diagnosticNameMatch) score += 12;
  if (capability === 'browser-automation' && !/浏览器|browser|playwright|网页操作|自动化测试/i.test(active)) score -= 10;
  // Repeated generic description words (download, local, inspect, output) may
  // recall a manual but cannot justify recommending it. Require a manual-subject
  // anchor or a requested capability whose action/object scope also matches.
  const subjectAnchor = identityHits.some(term => !genericIdentity.has(term) && term.length >= 3);
  const scopedCapability = capability !== 'general' && capabilityDirectlyRequested(capability,retrievalText)
    && capabilityActionCompatible(capability,retrievalText);
  const strongDescription = lexicalHits.length >= 2 && descriptionScore >= 7 && (subjectAnchor || scopedCapability);
  if (!explicit && !triggerHits.length && !strongDescription && !subjectMatch && !domainMatch && !diagnosticNameMatch && !actionMatch) score = 0;
  if (!explicit && !triggerHits.length && !domainMatch && score < 8) score = 0;
  if (score > 0) score += calibration?.adjustment || 0;
  const availability = skillAvailability(skill, host, runtimeCapabilities);
  if (!availability.discovered || !availability.readable || !availability.enabled || !availability.compatible) score = -100;
  const reasons = [];
  if (explicit) reasons.push('explicitly requested in active task');
  if (subjectMatch) reasons.push('manual subject matches task object: '+identityHits.join(', '));
  if (actionMatch) reasons.push('requested action and artifact match this manual capability');
  if (triggerHits.length) reasons.push(`matched task signal: ${triggerHits[0]}`);
  if (lexicalHits.length) reasons.push(`distinctive manual terms: ${lexicalHits.slice(0, 3).map((hit) => `${hit.term}${hit.inferred ? ' (inferred)' : ''}`).join(', ')}`);
  if (diagnosticNameMatch) reasons.push('diagnostic request plus mitigation/check requirement matches a general debugging manual');
  if (calibration?.adjustment) reasons.push(`verified feedback: ${calibration.adjustment > 0 ? '+' : ''}${calibration.adjustment}`);
  const matchedPhrase = triggerHits[0] || (explicit ? names.find((name) => lexicalScore(active, name)) : lexicalHits[0]?.term);
  const clauseIndex = assessment.activeClauses?.findIndex((clause) => matchedPhrase && lexicalScore(clause, matchedPhrase)) ?? -1;
  const inference = retrieval.inferred.find((item) => item.term === matchedPhrase);
  const evidence = matchedPhrase ? [{kind: triggerHits.length ? 'trigger' : explicit ? 'explicit' : inference ? 'inferred-description' : 'description', phrase: matchedPhrase,
    querySignal: inference?.evidence || null,
    clauseIndex, snippet: clauseIndex >= 0 ? assessment.activeClauses[clauseIndex].slice(0, 160) : active.slice(0, 160)}] : [];
  return {skill, score, explicit, entityRequest, actionMatch, subjectMatch, directSubjectMatch, needKeys, preserveAcrossFloor:actionMatch&&needKeys.length>0||subjectMatch&&rareSubject, capability, phase, reasons, availability, evidence};
}

function candidateCard(item, assessment) {
  const {skill, score, explicit, capability, phase, reasons, availability, evidence} = item;
  const governance = capability === 'skill-governance';
  const action = availability.toolsAvailable === false ? 'skip'
    : governance ? 'consult' : explicit ? 'consult' : score >= 20 ? 'consult' : 'skip';
  return {
    id: skill.id, nameZh: skill.nameZh || skill.name || skill.id,
    summaryZh: skill.summaryZh || skill.description || '',
    path: skill.path || null, sourceId: skill.sourceId || 'legacy-registry', contentHash: skill.contentHash || null,
    parentId: skill.parentId || null, origins: list(skill.origins),
    alternatives: item.alternatives || [],
    phase, capability, score, explicit, reasons, evidence, availability,
    suggestedMode: action,
    activationCondition: `Consult only if ${capability} is needed for the active ${phase} work and the main agent confirms scope and availability.`,
    estimatedTokens: Number.isFinite(skill.estimatedTokens) ? skill.estimatedTokens : null,
    advisoryOnly: true,
  };
}

export function compactAdviceV4(result) {
  const clip = (text, size) => { const value = String(text || ''); return value.length > size ? value.slice(0, size) + '…' : value; };
  return {...result, responseDetail: 'compact', consultCandidates: result.consultCandidates.map(card => {
    const {origins, path, activationCondition, ...rest} = card;
    return {...rest, nameZh: clip(card.nameZh, 100), summaryZh: clip(card.summaryZh, 240),
      reasons: card.reasons.slice(0, 3).map(value => clip(value, 180)),
      evidence: card.evidence.slice(0, 2).map(value => ({...value, phrase: clip(value.phrase, 100), snippet: clip(value.snippet, 180)})),
      detailsAvailable: true};
  }), detailAccess: 'Use responseDetail:full for full catalog metadata; get_skill returns the complete manual. Compact summaries are not execution instructions.'};
}

function budgetFor(assessment, candidates, requestedProfile) {
  const simple = assessment.complexity === 'simple';
  const qualityProfile = ['economy','balanced','quality'].includes(requestedProfile) ? requestedProfile : 'balanced';
  const profiles = {economy:[4,1,4000],balanced:[8,2,8000],quality:[12,3,12000]};
  const [cards, reads, tokens] = profiles[qualityProfile];
  const cardLimit = simple ? Math.min(3,cards) : cards;
  const ordinaryReadLimit = simple ? 1 : reads;
  const explicitCount = candidates.filter((item) => item.explicit).length;
  return {
    consultCardLimit: cardLimit,
    fullReadLimit: ordinaryReadLimit,
    softTokenLimit: simple ? Math.min(4000,tokens) : tokens,
    qualityProfile,
    verificationDepth: simple ? 'proportionate' : qualityProfile === 'quality' ? 'artifact-and-independent-evidence' : qualityProfile === 'balanced' ? 'artifact-and-targeted-checks' : 'required-acceptance-checks',
    explicitSkillException: explicitCount > ordinaryReadLimit,
    guidance: 'Read complete manuals only after scope and availability checks. Explicitly requested or necessary primary skills may exceed ordinary limits; do not trim safety constraints.',
  };
}

function coordinationFor(assessment, options) {
  const runtime = options.runtimeCapabilities || {};
  const slots = Number.isInteger(runtime.availableAgentSlots) ? runtime.availableAgentSlots
    : Number.isInteger(options.availableAgentSlots) ? options.availableAgentSlots : 1;
  const parallel = (runtime.parallelAgents === true || options.parallelAgents === true) && slots > 1;
  const possible = assessment.complexDevelopment && parallel;
  const models = list(runtime.availableModels ?? options.availableModels).filter((model) => typeof model === 'string');
  return {
    recommendationOnly: true,
    mode: possible ? 'consider-native-collaboration' : 'single-agent',
    availableAgentSlots: slots,
    parallelAgentsVerified: parallel,
    independentWorkVerified: false,
    dispatchable: false,
    reason: possible ? 'Inspect project boundaries and identify independent, reviewable work with unique writers before planning or dispatch.'
      : assessment.complexDevelopment ? 'No verified parallel agent capacity or independent work boundaries.' : 'Task structure does not establish a need for parallel agents.',
    availableModels: models,
    modelOverrideVerified: runtime.modelOverride === true || options.modelOverride === true,
    modelChoice: 'Select only from runtime verified models at dispatch; keep the main agent model.',
  };
}

function indexFor(options) {
  if (options.index) return Array.isArray(options.index) ? {skills: options.index, revision: 'fixture', coverage: {}, errors: []} : options.index;
  return discoverSkills({host: options.host, projectRoot: options.projectRoot, runtimeSkills: options.runtimeSkills, runtimeCapabilities: options.runtimeCapabilities});
}

function compactCoverage(coverage = {}) {
  const sourceList = list(coverage.sources);
  return {
    sourceCount: sourceList.length || (Number.isFinite(coverage.sources) ? coverage.sources : 0),
    sources: sourceList.map((source) => ({id: source.id, kind: source.kind, present: source.present, count: source.count})).slice(0, 30),
    discovered: coverage.discovered ?? null,
    readable: coverage.readable ?? null,
    enabled: coverage.enabled ?? null,
    excluded: coverage.excluded ?? null,
    invalid: coverage.invalid ?? null,
    pluginInventory: coverage.pluginInventory || null,
  };
}

// An unqualified name is one request, even when several installed libraries
// contain a manual with that name. Prefer the host's own maintained entry;
// retain exact qualified/version requests and expose the other origins as choices.
function manualIdentity(skill) {
  let name=skill.name || skill.nameZh || String(skill.id).split(':').at(-1);
  if(/^skill_\d+$/.test(name))name=[...list(skill.aliases),...list(skill.triggers)].find(x=>!/^skill_\d+$/.test(x)) || name;
  return norm(name).replace(/[_ ]/g,'-');
}
function hostOriginRank(skill,host) {
  const sources=[skill.sourceId,...list(skill.origins).map(x=>x.sourceId)];
  if(sources.includes(host+'-system'))return 6;
  if(sources.includes('project-'+host))return 5;
  if(sources.includes(host))return 4;
  if(sources.some(x=>String(x).startsWith('plugin:')))return 3;
  if(sources.includes('agents'))return 2;
  if(sources.includes('legacy'))return 1;
  return 0;
}

function advise(query, options = {}, filters = {}) {
  const routeId = options.routeId || randomUUID();
  const host = options.host || 'codex';
  const assessment = taskAssessment(query, options.taskContext || {}, options.invocationContext || {});
  const recovery = planRecovery({...assessment,rawText:query},options);
  if (!filters.followup && useFastPath(assessment,options,recovery)) return {
    contractVersion:4,routeId,registryRevision:null,task:assessment,consultCandidates:[],capabilityCandidates:[],methodCandidates:[],
    recoveryPlan:recovery,performance:{mode:'fast',scannedSkills:false,scannedCapabilities:false,reason:'Native capability is sufficient; no blocker or explicit discovery request.'},
    coverage:{summary:{discovered:null},errors:[],discoveredSkills:null,skippedReason:'native-fast-path'},
    capabilityCoverage:{skippedReason:'native-fast-path'},
    invocationPolicy:{executor:'host-agent',advisoryOnly:true,scanExecutesTools:false},
    decisionBrief:{nativeBaseline:{kind:'native-fast-path',prompt:'Complete this task directly with native capabilities.'},recommendation:'Use native capabilities and verify proportionately; escalate if confidence drops or the result is rejected.',authority:'advisory-only'},
    budget:{consultCardLimit:0,fullReadLimit:0,softTokenLimit:0},adoptionOptions:[{mode:'skip',meaning:'Complete directly.'}],coordination:coordinationFor(assessment,options),
  };
  let index;
  try { index = indexFor(options); }
  catch (error) { index = {skills: [], revision: null, coverage: {}, errors: [String(error.message || error)]}; }
  const skills = list(index.skills);
  const contentHashes = Object.fromEntries(skills.filter((skill) => skill.contentHash).map((skill) => [skill.id, skill.contentHash]));
  const feedback = options.useFeedback === true
    ? readFeedbackV4({host, taskType: assessment.taskType, modelId:options.currentModel, contentHashes}, options.feedbackPolicy || {}, options.feedbackPath)
    : new Map();
  // Legacy is retained for ablation; production promotion is gated by paired evaluation.
  const retrieval = retrievalIndex(skills, assessment.retrievalText, options.retrievalProfile === 'experimental', options.retrievalProfile === 'legacy');
  let ranked = skills.map((skill, index) => scoreCandidate(skill, assessment, host, options.runtimeCapabilities, feedback.get(skill.id)?.byMode?.consult, retrieval, retrieval.documents[index]))
    .filter((item) => item.score > 0);
  // Restrict the requested search universe before preferring one same-name source.
  if (filters.source) ranked = ranked.filter((item) => item.skill.sourceId === filters.source || list(item.skill.origins).some((origin) => origin.sourceId === filters.source));
  if (filters.domain) ranked = ranked.filter((item) => lexicalScore([item.capability, item.skill.category, item.skill.summaryZh, ...list(item.skill.domains)].join(' '), filters.domain));
  if (filters.phase) ranked = ranked.filter((item) => item.phase === filters.phase);
  const explicitProviders = new Set(ranked.filter(item => item.explicit && item.skill.sourceId?.startsWith('plugin:')).map(item => item.skill.sourceId.slice(7)));
  ranked = ranked.filter(item => item.skill.sourceId?.startsWith('plugin:') || !explicitName(item.skill).some(name => explicitProviders.has(name)));
  const namedChoices=new Map();
  const exactQualified=item=>item.explicit && /:|\d+\.\d+/.test(item.skill.id) && lexicalScore(assessment.activeText,item.skill.id);
  for(const item of ranked){
    if(exactQualified(item))continue;
    const key=manualIdentity(item.skill),previous=namedChoices.get(key);
    if(!previous || hostOriginRank(item.skill,host)>hostOriginRank(previous.skill,host)
      || hostOriginRank(item.skill,host)===hostOriginRank(previous.skill,host)&&item.score>previous.score)namedChoices.set(key,item);
  }
  for(const item of ranked){
    const chosen=namedChoices.get(manualIdentity(item.skill));
    if(chosen&&chosen!==item&&!exactQualified(item))(chosen.alternatives??=[]).push({id:item.skill.id,sourceId:item.skill.sourceId,contentHash:item.skill.contentHash});
  }
  ranked=ranked.filter(item=>exactQualified(item)||namedChoices.get(manualIdentity(item.skill))===item);
  const nativeImageManual=ranked.find(item=>item.capability==='image-production'&&item.skill.sourceId===host+'-system');
  if(nativeImageManual&&imageArtifact(assessment.retrievalText))ranked=ranked.filter(item=>item.explicit||item.capability!=='image-production'||item===nativeImageManual);
  ranked.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
  // Byte-identical manuals add no evidence. Preserve explicit requests while
  // avoiding another reading slot for a redundant, unrequested installation.
  const seenManuals=new Set();
  ranked=ranked.filter(item=>{
    const key=item.skill.contentHash;
    if (!key) return true;
    if (seenManuals.has(key) && !item.explicit) return false;
    seenManuals.add(key);return true;
  });
  if (ranked.length) {
    const floor = Math.max(8, ranked[0].score * (assessment.complexity === 'simple' ? 0.82 : 0.68));
    ranked = ranked.filter((item) => item.score >= floor || item.explicit || item.preserveAcrossFloor || item.reasons.some((reason) => reason.startsWith('matched task signal:')));
  }
  const budget = budgetFor(assessment, ranked, options.qualityProfile);
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? Math.min(filters.limit, 12) : budget.consultCardLimit;
  const explicitCandidates = ranked.filter(item => item.explicit);
  const selectedCards=[...explicitCandidates],covered=new Set(selectedCards.flatMap(item=>item.needKeys||[]));
  const needs=unique(ranked.flatMap(item=>item.needKeys||[]));
  for(const need of needs){
    if(covered.has(need))continue;
    const choices=ranked.filter(item=>item.needKeys?.includes(need));
    // A subject-specific manual is a stronger fit than a large handbook whose
    // description merely mentions many abilities. Score breaks ties.
    choices.sort((a,b)=>Number(!!b.directSubjectMatch)-Number(!!a.directSubjectMatch)||Number(!!b.subjectMatch)-Number(!!a.subjectMatch)||b.score-a.score);
    const chosen=choices[0];if(!chosen)continue;
    if(!selectedCards.includes(chosen))selectedCards.push(chosen);
    for(const key of chosen.needKeys||[])covered.add(key);
  }
  for(const item of ranked){
    if(selectedCards.length>=Math.max(limit,explicitCandidates.length)||selectedCards.includes(item))continue;
    if(item.needKeys?.length&&item.needKeys.every(key=>covered.has(key)))continue;
    // Once the requested outcomes have a primary manual, incidental description
    // overlap is not another independent need. Explicit names, subjects, and
    // direct triggers remain eligible; no minimum candidate count is required.
    if(covered.size&&!item.explicit&&!item.subjectMatch&&!item.reasons.some(reason=>reason.startsWith('matched task signal:')))continue;
    selectedCards.push(item);
  }
  const consultCandidates = selectedCards.map((item) => {
    const card = candidateCard(item, assessment);
    const byMode = feedback.get(item.skill.id)?.byMode;
    if (byMode) card.calibrationByMode = byMode;
    return card;
  });
  const nativeBaseline = typeof options.taskContext?.nativeApproach === 'string' && options.taskContext.nativeApproach.trim()
    ? {kind: 'agent-proposed', approach: options.taskContext.nativeApproach.trim(), authority: 'advisory-only'}
    : {kind: 'evaluation-prompt', prompt: 'First assess whether native tools and project knowledge can complete the active request with less context and equal quality.'};
  const capabilities = adviseCapabilities(assessment, {...options, host, phase:filters.phase || options.phase});
  return {
    contractVersion: 4, routeId, registryRevision: index.revision || null,
    recoveryPlan:recovery,
    performance:{mode:'full',scannedSkills:true,scannedCapabilities:true},
    capabilityCandidates:capabilities.candidates,
    capabilityNeedCoverage:capabilities.needCoverage,
    capabilityCoverage:{revision:capabilities.revision,...capabilities.coverage,errors:capabilities.errors},
    invocationPolicy:{phase:capabilities.phase,...capabilities.executionPolicy},
    task: assessment,
    methodCandidates:adviseTaskMethods(assessment,options),
    consultCandidates,
    feedbackPlan: {tool:'report_outcome',routeId,host,taskType:assessment.taskType,modelId:options.currentModel || null,
      timing:'After the deliverable is checked; report only actually observed decisions.',
      evidenceRequired:true,selfAssessmentCalibrates:false,unknownIsAllowed:true,
      guidance:'Preserve skill contentHash and mode, cite a real validation result or user feedback, and use unknown when benefit cannot be attributed. Do not report all shown skills as adopted.'},
    decisionBrief: {
      nativeBaseline,
      recommendation: consultCandidates.length || capabilities.candidates.length ? 'Compare skill and tool candidates with the native approach; verify benefit, timing, inputs and existing authorization before adoption or host invocation.' : 'Proceed with native capabilities unless new task evidence establishes a capability need.',
      authority: 'advisory-only',
      scopeRule: 'Quoted, example, descriptive, future and negative mentions do not authorize execution.',
    },
    adoptionOptions: [
      {mode: 'skip', meaning: 'Continue with native approach.'},
      {mode: 'consult', meaning: 'Read the complete manual when relevant, then decide.'},
      {mode: 'adapt', meaning: 'Use relevant guidance within current task authorization.'},
      {mode: 'execute', meaning: 'Follow the applicable manual for authorized current work after checking tools and scope.'},
    ],
    budget, coverage: {summary: compactCoverage(index.coverage), errors: list(index.errors).slice(0, 10), discoveredSkills: skills.length},
    coordination: coordinationFor(assessment, options),
  };
}

export function routeTaskV4(query, options = {}) { const result = advise(query, options); return options.responseDetail === 'compact' ? compactAdviceV4(result) : result; }
export function searchSkills(query, options = {}) {
  const result = advise(query, options, {source: options.source, domain: options.domain, phase: options.phase, limit: options.limit,followup:true});
  return options.responseDetail === 'compact' ? compactAdviceV4(result) : result;
}
function formatBaseAgentContextV4(result) {
  const candidates = list(result?.consultCandidates).map((item) => `${item.id} (${item.phase}; ${item.suggestedMode}): ${item.reasons.join('; ') || item.summaryZh}`).join('\n');
  const tools = list(result?.capabilityCandidates).map(item=>`${item.name} (${item.kind}; ${item.decision}; ${item.phase}): ${item.reason}; ${item.when}`).join('\n');
  return `[动态技能路由器] routeId=${result?.routeId || 'unknown'} contractVersion=4\n` +
    `Native baseline: ${result?.decisionBrief?.nativeBaseline?.approach || result?.decisionBrief?.nativeBaseline?.prompt || 'Evaluate native capabilities.'}\n` +
    `Candidate manuals (advisory only):\n${candidates || 'none'}\n` +
    `Plugin/MCP/tool candidates (host executes within task scope):\n${tools || 'none; use native capabilities'}\n` +
    (result?.recoveryPlan?.triggered ? `Recovery: ${result.recoveryPlan.reason}; external research required=${result.recoveryPlan.externalResearchRequired}. Diagnose, research, acquire only useful capabilities, then return to the original acceptance criteria.\n` : '') +
    `Choose skip, consult, adapt, or execute after scope and availability checks. Read complete manuals before applying them. ` +
    `No execution or external write is authorized by this advice.\n` +
    `Coordination: ${result?.coordination?.reason || 'Assess independent work and verified slots.'}`;
}

export function formatAgentContextV4(result) {
  const parts=[formatBaseAgentContextV4(result)];
  if (result?.task?.restrictions?.readOnly) parts.push('Host/user restriction: read-only; advice cannot authorize writes.');
  if (list(result?.methodCandidates).length) {
    parts.push('Optional task methods (skip unless useful):');
    for (const item of result.methodCandidates) parts.push([item.name,item.reason,'Validation: '+item.validation,'Stop: '+item.stop].join(' — '));
  }
  return parts.join('\n');
}
