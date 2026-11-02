import {validateHostOptions,requestContext,exactToolConsultations} from './host-context-contract.mjs';
import {invocationConstraints} from './invocation-constraints.mjs';
import {adviseTaskMethods,methodDirectives} from './task-methods-v4.mjs';
import {randomUUID} from 'node:crypto';
import {discoverSkills} from './discovery-v4.mjs';
import {readFeedbackV4} from './feedback-v4.mjs';
import {inferCapability, inferSkillStage} from './skill-staging.mjs';
import {adviseCapabilities} from './capabilities-v4.mjs';
import {planRecovery, useFastPath} from './recovery-v4.mjs';
import {instructionText,instructionClauses,negativeDirective,inferUserConstraints,isRequestedExampleOutput} from './request-evidence.mjs';
import {specialtyMismatch,positiveObjectEvidence} from './specialty-alignment-v4.mjs';
import {taskPurposeMatches,prohibitedDeclaredProduct} from './task-purpose-v4.mjs';

const norm = (value) => String(value || '').normalize('NFKC').toLowerCase();
const list = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter(Boolean))];
// Mask URLs without turning text inside their paths or queries into task
// instructions. A surrounding pair of brackets is different from a literal
// right parenthesis in an unwrapped URL; balanced inner pairs stay inside it.
// Spaces preserve offsets used when separating examples and restrictions.
function maskUrlText(value) {
  const text = String(value || ''), urls = /https?:\/\/[^\s<>"“”。，！？；]+/giu;
  const pairs = {'(': ')', '（': '）', '[': ']', '【': '】'};
  let cursor = 0, result = '', match;
  while ((match = urls.exec(text))) {
    let previous = match.index - 1;
    while (previous >= 0 && /[ \t]/u.test(text[previous])) previous--;
    const open = text[previous], close = pairs[open];
    let length = match[0].length, depth = 0;
    if (close) for (let i = 0; i < match[0].length; i++) {
      const char = match[0][i];
      if (char === open) depth++;
      else if (char === close) {
        if (depth > 0) depth--;
        else { length = i; break; }
      }
    }
    result += text.slice(cursor, match.index) + match[0].slice(0, length).replace(/[^\r\n]/g, ' ');
    cursor = match.index + length;
    urls.lastIndex = cursor;
  }
  return result + text.slice(cursor);
}
const STOP = new Set('a an and are as at be because before but by can code condition data do evidence explain for from full give has have how i in into is it its list load make making my name new no not of on or our out over please point real request review run should skill skills the their them there these this to use user users using version versions what when where which with work write you your app apps system systems task tasks need needs add claim'.split(' '));
const STEM = new Map(Object.entries({diagnostic:'debug',diagnostics:'debug',diagnose:'debug',diagnosing:'debug',troubleshoot:'debug',troubleshooting:'debug',failure:'debug',incident:'debug',outage:'debug',slow:'performance',slowness:'performance',migrations:'migration',migrate:'migration',migrating:'migration',schemas:'schema',rollbacks:'rollback',deployments:'deployment',deploy:'deployment',features:'feature',requirements:'requirement',prioritize:'priority',prioritization:'priority',concurrent:'concurrency',atomicity:'atomic',transactions:'transaction'}));
function softwareDiagnosticEvidence(text) {
  const software = /(?:代码|代码库|程序|软件|接口|服务器|数据库|后端|服务端|\b(?:node(?:\.js)?|javascript|typescript|python|java|sql|api|server)\b)/i.test(text);
  const action = /(?:故障排查|排查故障|调试|诊断|排查.{0,12}(?:异常|故障|错误|问题|原因|根因)|找出.{0,12}(?:原因|根因)|定位.{0,12}(?:问题|原因|根因|故障|错误|缺陷))/i.exec(text);
  const codeRepair = /(?:修复|修正|纠正|\bfix\b|\brepair\b).{0,60}(?:代码|函数|程序|模块|脚本|\.[cm]?[jt]sx?\b)|(?:代码|函数|程序|模块|脚本|\.[cm]?[jt]sx?\b).{0,35}(?:修复|修正|纠正|\bfix\b|\brepair\b)/i.exec(text);
  return software && action ? action[0] : codeRepair ? codeRepair[0] : null;
}
// Regular plurals such as ideas, areas and photos still stem to their singular.
// These common singular nouns are exceptions, not evidence of an s-plural.
const SINGULAR_S_WORDS = new Set('canvas alias atlas bias gas chaos cosmos ethos pathos lens news series species'.split(' '));
function token(value) {
  const normalized = norm(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!normalized || STOP.has(normalized)) return '';
  // An s is part of many singular words. A small exception list prevents
  // collisions such as canvas/Canva without erasing ordinary plural recall.
  if (/(?:ss|us|is)$/i.test(normalized)||SINGULAR_S_WORDS.has(normalized)) return STEM.get(normalized) || normalized;
  return STEM.get(normalized) || normalized.replace(/(ies|ing|ed|s)$/i, (ending) => ending === 'ies' ? 'y' : '');
}
const words = (value) => {
  const text = norm(value);
  const latin = text.match(/[a-z][a-z0-9]{1,}/g) || [];
  const han = text.match(/[\p{Script=Han}]{2,}/gu) || [];
  return [...latin, ...han.flatMap((run) => {
    const parts = [];
    for (let size = 2; size <= 3; size++) for (let i = 0; i + size <= run.length; i++) parts.push(run.slice(i, i + size));
    return parts;
  })].map(token).filter((item) => item.length >= 2 && !STOP.has(item));
};

// Character n-grams are useful for recall but can cross Chinese word
// boundaries. Only use independent, word-aligned signals as standalone
// support for an unrequested skill. No new score boost is introduced.
const genericHan = new Set('开始 结束 使用 制作 创建 生成 编辑 修改 执行 运行 处理 查询 搜索 查看 检查 审查 核对 研究 进行 支持 需要 可以 完成 用户 当前 之后 之前 期间 提供 展示 输出 输入 结果 内容 正文 资料 信息 数据 文件 任务 工作 交付 要求 不是 这个 目录 一个 一页 页面 离线 在线 不用 方案 方式 方法 设计 实现 出现 日志 复现'.split(' '));
const genericLatin = new Set('input output index file files page pages content task user local online offline create edit modify start stop run use used using show support result results format simple small one two'.split(' '));
// Common actions, quantity words and output labels are useful for recall,
// but a coincidence of several of them is not an independent task object.
const weakEvidenceHan = new Set('改进 测试 更新 最新 清楚 提出 一份 客户 开发 本地 系统 完整 报告 统计 区间 比较 包含 记录 数量 顺序 说明 情况 主要 相关 分析 安装 优先 时间 原始 其他 复核 如果 同时 组合 位置 区域 初始 控制 代码 网页 技能'.split(' '));
const weakEvidenceLatin = new Set('category share count percent total latest update test testing report local system customer develop complete describe compare summary analysis statistics position area initial control code web html javascript'.split(' '));
// Generic product suffixes do not identify a provider when qualified by a
// distinct proper name (for example, "Example Drive"). The prefix remains
// available as direct evidence for that provider's own skill.
const qualifiedServiceSuffixes = new Set('drive cloud docs office calendar storage mail wiki'.split(' '));
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-CN', {granularity: 'word'}) : null;
function queryWordSet(text) {
  if (!segmenter || !/\p{Script=Han}/u.test(text)) return null;
  return new Set([...segmenter.segment(norm(text))]
    .filter(x => x.isWordLike && /^[\p{Script=Han}]{2,}$/u.test(x.segment))
    .map(x => x.segment));
}
function alignedHanPhrase(text, phrase) {
  if (!segmenter) return false;
  const value = norm(text), term = norm(phrase);
  const boundaries = new Set([0, value.length]);
  for (const part of segmenter.segment(value)) {
    boundaries.add(part.index);
    boundaries.add(part.index + part.segment.length);
  }
  for (let at = value.indexOf(term); at >= 0; at = value.indexOf(term, at + 1)) {
    if (boundaries.has(at) && boundaries.has(at + term.length)) return true;
  }
  return false;
}
function positiveSkillText(value) {
  const positiveLines = [];
  let negativeList = false;
  for (const line of String(value || '').split(/\r?\n/)) {
    if (/^\s*(?:不应触发(?:的情况)?|不适用(?:的情况|场景)?|不建议使用(?:的情况)?|not for|not suitable for)\s*[:：]\s*$/i.test(line)) {
      negativeList = true;
      continue;
    }
    if (negativeList && (!line.trim() || /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))) continue;
    negativeList = false;
    positiveLines.push(line);
  }
  return positiveLines.join('\n')
    .replace(/(?:不要在以下场景触发|不应触发|不适用(?:于)?|不用于|不要用于|避免用于|禁止用于|不建议用于)\s*[:：]?[^\n。！？!?；;]*/giu, ' ')
    .replace(/\b(?:do not use for|don't use for|not intended for|not suitable for|avoid using for|not for)\b[^\n.!?;]*/giu, ' ');
}
function namedServiceEvidence(skill, active) {
  const serviceSuffix = /(?:云空间|云盘|网盘|知识库|工作台|文档管理|表格管理)$/u;
  const names = [skill.nameZh, skill.name, ...list(skill.aliases)]
    .map(value => String(value || '').trim())
    .filter(value => /^[\p{Script=Han}]{3,14}$/u.test(value) && serviceSuffix.test(value));
  // Some manifests have a transliterated identity and name the service only
  // at the very start of their summary. Do not infer names from later examples.
  const summary = String(skill.summaryZh || skill.description || '');
  const head = /^\s*([\p{Script=Han}]{2,12}?(?:云空间|云盘|网盘|知识库|工作台|文档管理|表格管理))(?=文件|文档|管理|服务|平台|工具|技能|\s|[，。:：])/u.exec(summary);
  if (head) names.push(head[1]);
  const namedHan = names.find(name => lexicalScore(active, name));
  if (namedHan) return namedHan;
  // A capitalized product name used as the source of a task is more specific
  // than a generic identity word occurring anywhere in the request.
  const latinNames = [skill.nameZh, skill.name].filter(name => /^[A-Z][A-Za-z0-9]{2,}$/u.test(String(name || '')));
  return latinNames.find(name => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:从|在|通过|搜索|查询|阅读|读取|查看|\\bfrom\\s+|\\bin\\s+|\\bon\\s+|\\bsearch\\s+|\\bread\\s+)\\s*${escaped}(?=$|[^a-z0-9_-])`, 'iu').test(active);
  }) || null;
}
function agentInstructionWork(clauses) {
  const model = '(?:\\bai(?:\\s+agent)?\\b|\\b(?:agent|llm|chatgpt|claude|gemini|codex)\\b|智能体|人工智能|大模型|语言模型|模型)';
  const artifact = '(?:任务(?:说明|描述|要求|规范|指令)|(?:项目|开发|工作)(?:任务说明|说明|指令|需求)|需求(?:说明|描述)|(?:task|work)\\s+(?:instructions?|description|brief|specification)|instructions?)';
  const edit = '(?:改写|重写|优化|完善|撰写|编写|编制|拟定|起草|生成|设计|写|整理|审查|检查|\\b(?:refine|rewrite|write|draft|create|improve|review)\\b)';
  const target = new RegExp(`(?:给|为|供|面向|交给|让)\\s*${model}.{0,45}${artifact}|${artifact}.{0,45}(?:给|为|供|面向|交给|让)\\s*${model}|${artifact}.{0,60}\\b(?:for|to)\\s+(?:(?:the|an?)\\s+)?${model}`, 'i');
  const writing = new RegExp(`${edit}.{0,40}${artifact}|${artifact}.{0,20}${edit}`, 'i');
  return list(clauses).some(clause => {
    // Concrete shell/build commands are not task instructions for an agent.
    const scoped = String(clause).replace(/(?:shell|bash|powershell|终端|命令行|安装|部署|编译|构建|启动)\s*(?:命令|指令)/gi, ' ');
    return target.test(scoped) && writing.test(scoped);
  });
}
function capabilityHasTaskObject(capability, text, skill, clauses) {
  if (capability === 'prompt-engineering')
    return /提示词|提示语|\bprompt\b|(?:不知道|不会|说不清|表达不清).{0,30}(?:模型|\bai\b|描述|表达)|(?:需求|想法).{0,12}(?:模糊|混乱)/i.test(text) || agentInstructionWork(clauses);
  if (capability === 'visual-design') {
    // "design" also appears in nonvisual fields such as experiments. Only
    // apply the visual-object check when the identity or leading summary
    // actually describes a visual/interface specialty.
    const identity = [skill.id, skill.nameZh, skill.name, skill.category, ...list(skill.aliases)].join(' ');
    const leadingSummary = String(skill.summaryZh || skill.description || '').slice(0, 350);
    if (!/(?:视觉|界面|网页|平面设计|排版|品牌设计|\b(?:visual|graphic|frontend|website|web|ui|ux)\b)/i.test(identity + ' ' + leadingSummary)) return true;
    const canvasGame=/(?:游戏|\bgames?\b)/i.test(text)&&/\bcanvas\b/i.test(text)
      &&/(?:game\s+(?:ui|interface)|游戏界面)/i.test(leadingSummary);
    return canvasGame||/视觉|界面|网页|网站|\bui\b|\bux\b|前端|设计稿|设计系统|版式|排版|配色|字体|样式|品牌|图标|海报|插画|图表|幻灯片|\bpptx?\b|\bweb\b|website|graphic design|visual design/i.test(text);
  }
  if (capability === 'image-production')
    return /图片|图像|照片|截图|插画|海报|图标|附图|这张图|这幅图|抠图|p图|去背景|\blogo\b|\b(?:images?|photos?|pictures?|screenshots?|illustrations?|posters?|icons?)\b|\.(?:png|jpe?g|webp|gif|bmp)\b|remove background/i.test(text);
  const lead = String(skill.summaryZh || skill.description || '').slice(0,120);
  if (/(?:运筹(?:优化|建模)|数学(?:优化|建模)|operations research|mathematical optimization)/i.test(lead))
    return /数学(?:模型|建模|优化)|运筹|目标函数|约束条件|(?:线性|整数|混合整数)规划|(?:最小化|最大化).{0,15}(?:成本|利润|收益)|(?:优化|设计).{0,12}(?:库存策略|补货策略|订货策略)|operations research|optimization model|linear programming/i.test(text);
  return true;
}

// Cost, benefit and a "combination" also describe engineering projects.
// A finance specialist needs evidence of a finance object unless the user
// explicitly names that skill; generic project terms may still rank other
// applicable capabilities normally.
function financeSpecialistWithoutObject(skill,text) {
  const identity=[skill.id,skill.nameZh,skill.name,...list(skill.aliases)].filter(Boolean).join(' ');
  const stockSpecialist=/(?:^|[^a-z])(?:stock|equity)(?:$|[^a-z])|(?:股票|证券)(?:分析|研究|评估)/i.test(identity);
  const financeSpecialist=stockSpecialist||/(?:^|[^a-z])(?:financial|finance|investments?)(?:$|[^a-z])|(?:金融|财务|投资)(?:分析|研究|评估)/i.test(identity);
  if(!financeSpecialist)return false;
  const stockObject=/(?:股票|股价|证券|股市|基金|期货|债券|外汇|持仓|股息|a股|\b(?:stocks?|shares?|equities|equity|securities|funds?|bonds?|dividends?)\b)/i.test(text);
  if(stockSpecialist)return !stockObject;
  const financeObject=stockObject||/(?:金融|财务|投资|估值|上市公司|年报|财报|季报|现金流|资产负债|利率|资本市场|\b(?:finance|financials?|investments?|valuation|earnings|cash flow|balance sheet|interest rates?)\b)/i.test(text);
  const businessFinance=/(?:公司|企业|银行|\b(?:company|business|corporation|bank)\b)/i.test(text)
    &&/(?:盈利|营收|利润|回报率|\b(?:profit|revenue|roi)\b)/i.test(text);
  return !(financeObject||businessFinance);
}
function independentDescriptionHits(hits, retrieval, document) {
  // When segmentation is unavailable, preserve prior routing behavior rather
  // than asserting a word boundary or suppressing a potentially useful skill.
  if (retrieval.queryWords === null) return null;
  return hits.filter(hit => {
    const term = hit.term;
    if (/^[\p{Script=Han}]+$/u.test(term))
      return retrieval.queryWords.has(term) && !genericHan.has(term)
        && (document.positiveWords === null || document.positiveWords.has(term));
    if (!document.positiveTerms.has(term)) return false;
    const qualifiers = retrieval.serviceQualifiers.get(term) || [];
    if (qualifiers.length && !qualifiers.some(prefix => lexicalScore(document.positiveText, prefix))) return false;
    return !genericLatin.has(term) && term.length >= 3;
  });
}

function weakEvidence(value) {
  const term=norm(value).trim();
  if(!term || genericHan.has(term) || genericLatin.has(term) || weakEvidenceHan.has(term) || weakEvidenceLatin.has(term))return true;
  if(segmenter && /^[\p{Script=Han}]+$/u.test(term)) {
    const pieces=[...segmenter.segment(term)].filter(part=>part.isWordLike).map(part=>part.segment);
    if(pieces.length>1&&pieces.every(part=>genericHan.has(part)||weakEvidenceHan.has(part)))return true;
  }
  return false;
}

function testingLanguages(value) {
  const text=String(value||''), found=new Set();
  if(/\b(?:python|pytest|unittest)\b|\.py\b/i.test(text))found.add('python');
  if(/\b(?:javascript|typescript|node(?:\.js)?|jest|vitest|mocha)\b|\.(?:js|jsx|ts|tsx)\b/i.test(text))found.add('javascript');
  if(/\b(?:java|junit)\b/i.test(text))found.add('java');
  if(/\b(?:rust|cargo\s+test)\b|\.rs\b/i.test(text))found.add('rust');
  if(/\bgolang\b|\.go\b|(?:^|[^a-z])go[-_](?:test|testing)/i.test(text))found.add('go');
  if(/\bcsharp\b|(?:^|[^a-z])c#(?![a-z0-9])|\.cs\b/i.test(text))found.add('csharp');
  if(/\bfsharp\b|(?:^|[^a-z])f#(?![a-z0-9])|\.fs\b/i.test(text))found.add('fsharp');
  return found;
}

function concreteTaskSupport(skill,capability,assessment) {
  const active=assessment.activeText||'';
  const identity=[skill.id,skill.nameZh,skill.name,skill.category,skill.sourceId,...list(skill.aliases)].filter(Boolean).join(' ');
  const purpose=positiveSkillText([skill.summaryZh,skill.description].filter(Boolean).join(' ')).slice(0,700);
  const skillTask=/(?:技能|\bskills?\b).{0,25}(?:创建|安装|更新|测试|管理|优化|审查|盘点|查找|搜索|\b(?:create|install|update|test|manage|audit|find)\b)|(?:创建|安装|更新|测试|管理|优化|审查|盘点|查找|搜索|\b(?:create|install|update|test|manage|audit|find)\b).{0,25}(?:技能|\bskills?\b)/i.test(active);
  const skillManual=/(?:skill[-_](?:assistant|creator|installer|stocktake|vetter|conductor)|技能(?:管理|治理|创建|安装|盘点|审查))/i.test(identity);
  const testTask=list(assessment.activeClauses).some(c=>/(?:测试|单测|回归|\btest(?:ing)?\b).{0,30}(?:代码|程序|函数|软件|接口|\b(?:code|function|software|api|python|javascript|typescript|rust|java)\b)|(?:代码|程序|函数|软件|接口|\b(?:code|function|software|api|python|javascript|typescript|rust|java)\b).{0,30}(?:测试|单测|回归|\btests?\b)/i.test(c));
  const testManual=/(?:test[-_ ]runner|(?:python|javascript|typescript|rust|java|go|csharp|fsharp)[-_ ]test(?:ing)?|测试(?:运行|执行|框架)|\b(?:unit|integration) tests?\b|\b(?:pytest|unittest|xunit|nunit|junit)\b)/i.test(identity+' '+purpose.slice(0,250));
  const requestedLanguages=testingLanguages(active),identityLanguages=testingLanguages(identity);
  const manualLanguages=identityLanguages.size?identityLanguages:testingLanguages(purpose.slice(0,250));
  const testLanguageMismatch=testTask&&testManual&&requestedLanguages.size>0&&manualLanguages.size>0
    &&![...requestedLanguages].some(language=>manualLanguages.has(language));
  // App-framework-specific manuals should not be promoted merely because
  // they mention generic unit tests for the same programming language.
  const appFrameworks=/\b(?:django|fastapi|flask|spring|react|vue|angular)\b/gi;
  const manualFrameworks=[...identity.matchAll(appFrameworks)].map(m=>m[0].toLowerCase());
  const requestedFrameworks=new Set([...active.matchAll(appFrameworks)].map(m=>m[0].toLowerCase()));
  const testFrameworkMismatch=testTask&&testManual&&manualFrameworks.length>0
    &&!manualFrameworks.some(name=>requestedFrameworks.has(name));
  const docTask=list(assessment.activeClauses).some(c=>/(?:交付|生成|制作|创建|编辑|修改|读取|阅读|检查|导出|另存|\b(?:create|edit|read|open|produce|export)\b).{0,70}(?:\.docx\b|\bword\b|word文档)|(?:\.docx\b|\bword\b|word文档).{0,50}(?:交付|生成|制作|创建|编辑|修改|读取|阅读|检查|导出|\b(?:create|edit|read|open|produce|export)\b)/i.test(c));
  const docManual=/(?:^|[^a-z])(?:docx|documents?|word)(?=$|[^a-z])|文档/i.test(identity)
    && /(?:\.docx\b|\bword\b|word文档)/i.test(purpose)
    && /(?:create|edit|read|manipulat|生成|创建|编辑|读取|处理)/i.test(purpose);
  const dataTask=/(?:csv|xlsx?|电子表格|数据)/i.test(active)&&/(?:统计|汇总|分析|去重|筛选|\b(?:analy[sz]e|aggregate|summari[sz]e|filter)\b)/i.test(active);
  // Promote general tabular analysis, not every geospatial, statistical or
  // library-specific specialist merely because its description says "data".
  const dataManual=capability==='data-analysis'&&/(?:^|[^a-z])(?:data[-_ ]analysis|exploratory[-_ ]data[-_ ]analysis|数据分析)(?=$|[^a-z])/i.test(identity)
    &&/(?:csv|xlsx?|表格|\b(?:data|tabular)\b)/i.test(purpose);
  const researchTask=/(?:横纵|纵横)(?:分析|研究|比较|对比)/i.test(active)
    ||/(?:纵向|历时|历史|演进|演变|发展|生命周期)/i.test(active)&&/(?:横向|同类|竞品|比较|对比)/i.test(active)
      &&/(?:分析|研究|调研|比较|对比)/i.test(active)&&/(?:产品|公司|技术|概念|人物|机构|行业|模式|平台|政策|服务|\b(?:product|company|technology|industry|policy|person)\b)/i.test(active);
  const researchManual=/(?:hv[-_]analysis|横纵分析|纵横分析)/i.test(identity+' '+purpose.slice(0,250));
  const stockTask=/(?:股票|股价|个股|证券|股市|a股|\b(?:stocks?|shares?|equities|equity|securities)\b)/i.test(active)
    &&/(?:分析|研究|评估|比较|对比|估值|研判|\b(?:analy[sz]e|research|assess|compare|valuation)\b)/i.test(active);
  const stockManual=/(?:^|[^a-z])stock[-_ ](?:analysis|analyst)(?:$|[^a-z])|(?:股票|证券)(?:分析|研究|评估)/i.test(identity)
    &&/(?:股票|证券|\b(?:stock|shares?|equity|securities)\b)/i.test(purpose);
  const aShareOnly=/(?:^|[^a-z])a[-_ ]stock(?:$|[^a-z])/i.test(identity)
    &&!/(?:a股|沪深|上证|深证|上海证券|深圳证券|\b(?:chinese|china)\s+(?:stocks?|equities|shares?)\b)/i.test(active);
  const financeTask=/(?:财务|财报|年报|现金流|资产负债|\b(?:financial statements?|financial performance|cash flow|balance sheet)\b)/i.test(active)
    &&/(?:分析|研究|评估|比较|对比|估值|\b(?:analy[sz]e|research|assess|compare|valuation)\b)/i.test(active);
  const financeManual=/(?:^|[^a-z])(?:financial|finance)[-_ ](?:suite|analysis|analyst)(?:$|[^a-z])|财务(?:分析|研究|评估)/i.test(identity)
    &&/(?:财务|财报|\b(?:financial|finance|cash flow)\b)/i.test(purpose);
  // Map an evidence-seeking action to a general source-verification manual,
  // rather than treating the named subject (for example speech) as the task.
  const explanationOnly=/^\s*(?:(?:请|帮我|please|只是|仅仅|仅需|只需)\s*)*(?:解释|介绍|说明|讲解|简述|阐述|科普|什么是|讨论是否|评估是否|如何|是否|explain\b|describe\b|what\s+is\b|whether\b|how\s+to\b|should\b)/i.test(active);
  const sourcedResearchTask=!explanationOnly&&/(?:对比|比较|调研|研究|考察|调查|\b(?:compare|evaluate|investigate|research|assess)\b)/i.test(active)
    &&/(?:官方(?:文档|资料|来源|网站)|一手(?:资料|来源)|原始来源|许可条款|实际许可|\b(?:official\s+(?:docs?|documentation|sources?|websites?)|primary\s+sources?|licen[cs]e\s+terms)\b)/i.test(active)
    &&!assessment.inferredConstraints?.networkForbidden&&assessment.inferredConstraints?.sourceScope!=='provided-only';
  const generalResearchManual=capability==='research'
    &&/(?:^|[^a-z])deep[-_ ]research(?:$|[^a-z])/i.test(identity)
    &&/(?:source|evidence|reference|citation|来源|证据)/i.test(purpose);
  const canvasGameTask=!explanationOnly&&/(?:游戏|\bgames?\b)/i.test(active)&&/\bcanvas\b/i.test(active)
    &&/(?:做|制作|开发|创建|编写|实现|\b(?:build|create|make|implement|develop)\b)/i.test(active);
  const canvasGameManual=/(?:game\s+(?:ui|interface)|游戏界面)/i.test(purpose)
    &&/(?:frontend|web|interface|ui|前端|界面|网页)/i.test(identity+' '+purpose);
  const accessibilityTask=!explanationOnly&&/(?:创建|制作|开发|实现|改进|审计|修复|\b(?:build|create|implement|improve|audit|fix|make)\b)/i.test(active)
    &&/(?:可访问性|无障碍|\b(?:accessible|accessibility|a11y|wcag|screen reader|keyboard navigation)\b)/i.test(active)
    &&/(?:网页|页面|界面|表格|\b(?:web|website|page|ui|table|interactive|visuali[sz]er)\b)/i.test(active);
  const canvasDocTask=!explanationOnly&&/\bjson\s+canvas\b|\.canvas\b/i.test(active)
    &&/(?:创建|制作|整理成|整理为|交付|输出|生成|编辑|修改|修复|增加|构建|检查|查看|读取|解析|审查|\b(?:create|make|edit|build|deliver|export|inspect|read|review)\b)/i.test(active);
  const canvasDocManual=/\bjson\s+canvas\b/i.test(purpose)&&/(?:nodes?|edges?|连接|节点)/i.test(purpose);
  const videoSource=/(?:视频|影片|录像|\bvideo\b|\.(?:mp4|mov|mkv|webm|avi|m4v)\b)/i;
  const transcriptAction=/(?:转写|转录|听写|转成文字|转换为文字|\b(?:transcribe|transcription|speech.to.text)\b)/i;
  // Keep independent media work separated: transcribing another audio file
  // does not mean transcribing the mentioned video. A short anaphor may refer
  // to the immediately preceding video only when no other audio file is named.
  const mediaClauses=list(assessment.activeClauses).flatMap(clause=>clause.split(/(?:并且|然后|接着|同时|以及|并|\band then\b|\band\b)/i)).map(clause=>clause.trim()).filter(Boolean);
  const videoTranscriptionTask=!explanationOnly&&mediaClauses.some((clause,i)=>transcriptAction.test(clause)
    &&(videoSource.test(clause)||(i>0&&/(?:其中|其(?:中|音轨|声音|人声)|它|该视频|这段|\b(?:the same video|its audio)\b)/i.test(clause)
      &&videoSource.test(mediaClauses[i-1])&&!/\.(?:mp3|wav|m4a|flac|aac|ogg)\b/i.test(clause))));
  const videoTranscriptionManual=/(?:local\s+video|video\s+url|本地视频|视频链接)/i.test(purpose)
    &&/(?:transcri(?:ption|be)|captions?|转写|字幕|语音识别)/i.test(purpose);
  return {skill:skillTask&&skillManual,codeTest:testTask&&testManual&&!testLanguageMismatch&&!testFrameworkMismatch,docx:docTask&&docManual,data:dataTask&&dataManual,research:researchTask&&researchManual,sourceResearch:sourcedResearchTask&&generalResearchManual,canvasGame:canvasGameTask&&canvasGameManual,accessibility:accessibilityTask&&capability==='accessibility',canvasDoc:canvasDocTask&&canvasDocManual,videoTranscription:videoTranscriptionTask&&videoTranscriptionManual,stock:stockTask&&stockManual&&!aShareOnly,finance:financeTask&&financeManual,testLanguageMismatch,testFrameworkMismatch};
}

function retrievalTerms(text, experimental = false) {
  const terms = new Set(words(text));
  const bridges = [
    [/数据库/gu, ['database']],
    [/数据库(?:结构|模式)|表结构|字段|列名/gu, ['schema']],
    [/迁移/gu, ['migration']],
    [/回滚/gu, ['rollback']],
    [/并发/gu, ['concurrency']],
    [/事务/gu, ['transaction']],
    [/故障排查|排查故障|调试|诊断/gu, ['debug']],
    [/rename.{0,60}(?:column|field)|(?:column|field).{0,60}rename|schema change|mixed.{0,50}deployment/i, ['schema', 'migration']],
    [/diagnostic|diagnos|troubleshoot|investigat|incident|outage|requests slow|connections increased/i, ['debug']],
    [/real goal|minimal useful|which features|additional features|product direction|product scope|requirements/i, ['product', 'direction', 'why']],
    [/lost updates|lose updates|concurrent requests|shared db|atomicity/i, ['concurrency', 'transaction']],
  ];
  const inferred = [];
  for (const [pattern, additions] of bridges) {
    const match = pattern.exec(text);
    if (match && (experimental || !/\p{Script=Han}/u.test(match[0]))) for (const term of additions) { terms.add(term); inferred.push({term, evidence: match[0]}); }
  }
  const softwareDiagnostic = softwareDiagnosticEvidence(text);
  if (softwareDiagnostic && !terms.has('debug')) {
    terms.add('debug');
    inferred.push({term:'debug', evidence:softwareDiagnostic});
  }
  return {terms, inferred};
}

function retrievalIndex(skills, activeText, experimental = false, negativeSkillClauses = []) {
  const {terms, inferred} = retrievalTerms(activeText, experimental);
  const queryWords = queryWordSet(activeText);
  const serviceQualifiers = new Map();
  for (const match of String(activeText).matchAll(/\b([A-Z][A-Za-z0-9.-]*)\s+([A-Z][A-Za-z0-9.-]*)\b/g)) {
    const prefix = norm(match[1]), suffix = norm(match[2]);
    if (qualifiedServiceSuffixes.has(suffix)) serviceQualifiers.set(suffix, [...(serviceQualifiers.get(suffix) || []), prefix]);
  }
  const documents = skills.map((skill) => {
    const identity = [skill.id, skill.nameZh, skill.name, ...list(skill.aliases)].join(' ');
    const description = [skill.summaryZh, skill.description, ...list(skill.triggers)].join(' ');
    const positiveText = norm(identity + ' ' + positiveSkillText(description));
    return {identity: new Set(words(identity)), description: new Set(words(description)),
      positiveText, positiveTerms: new Set(words(positiveText)), positiveWords: queryWordSet(positiveText)};
  });
  const df = new Map();
  for (const doc of documents) for (const term of new Set([...doc.identity, ...doc.description])) df.set(term, (df.get(term) || 0) + 1);
  return {terms, inferred, documents, df, corpusSize: skills.length, experimental, queryWords, serviceQualifiers, negativeSkillClauses};
}
const explicitName = (skill) => [skill.id, skill.nameZh, skill.name, ...list(skill.aliases)].filter(Boolean);

function explicitlyNames(active,name) {
  const escaped=String(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const named=new RegExp(`(?:^|[\\s，,：:])\\$${escaped}(?=$|[\\s，,。.!！?？])`,'i');
  const suffix=/[\p{Script=Han}]$/u.test(name)?'':'(?![a-z0-9_-]|[.:](?=[a-z0-9]))';
  const direct=new RegExp(`(?:使用|调用|启用|采用|用|apply|use|invoke)\\s*(?:\\$)?${escaped}${suffix}`,'i');
  return named.test(active)||direct.test(active);
}

function prohibitedSkill(skill, clauses) {
  if (!list(clauses).length) return false;
  const names = explicitName(skill);
  if (skill.sourceId?.startsWith('plugin:')) names.push(skill.sourceId.slice(7));
  const prefix = "(?:不要|不得|禁止|严禁|请勿|禁用|不使用|不用|不调用|不采用|不执行|别用|避免|do not|don't|never|without)";
  const action = '(?:使用|调用|启用|采用|参考|咨询|执行|用|use|invoke|apply|consult)?';
  const prior = '(?:[$\\p{L}\\p{N}_.:-]+\\s*(?:和|与|或|及|、|\\band\\b|\\bor\\b)\\s*)*';
  return names.some(name => {
    if (!clauses.some(clause => norm(clause).includes(norm(name)))) return false;
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffix = /[\p{Script=Han}]$/u.test(name) ? '' : '(?![a-z0-9_-]|[.:](?=[a-z0-9]))';
    const rule = new RegExp(`${prefix}\\s*${action}\\s*${prior}\\$?${escaped}${suffix}`, 'iu');
    return list(clauses).some(clause => rule.test(clause));
  });
}

// Some Git release manuals explicitly restrict themselves to complete ship
// workflows. General words from their examples are not release intent.
function restrictedGitDelivery(skill) {
  const identity = [skill.id, skill.nameZh, skill.name, skill.category].join(' ');
  const summary = String(skill.summaryZh || skill.description || '');
  return /\bgit\b|Git(?=交付)/i.test(identity + ' ' + summary.slice(0, 250))
    && /(?:仅在用户明确表达|只在用户明确表达|only (?:when|if) (?:the )?user explicitly).{0,40}(?:ship|完整.{0,8}(?:流程|工作流))/i.test(summary);
}
function gitDeliveryIntent(text) {
  return /^\s*(?:(?:请|帮我|现在|直接|please)\s*)*ship\s*[.!。！]?\s*$/i.test(text)
    || /\bgit\s+ship\b|\/ship\b|\bship\b.{0,25}(?:代码|改动|变更|changes|code|commit)|(?:走|完成|执行|进行).{0,10}\bgit\b.{0,8}(?:流程|工作流)|(?:\bpr\b|pull requests?|合并请求).{0,35}(?:合并|\bmerge\b)|(?:合并|\bmerge\b).{0,35}(?:\bpr\b|pull requests?|合并请求)/i.test(text);
}
// A named diagram specialist can describe supported diagram objects in its
// summary without listing them as triggers. Keep this advisory and require an
// explicit creation action and an exact, word-aligned object in the summary.
function diagramTaskEvidence(skill, clauses) {
  const identity = [skill.id, skill.nameZh, skill.name, ...list(skill.aliases)].join(' ');
  if (!/\b(?:diagram|flowchart|schematic)\b|图表|流程图|电路图|架构图|示意图|制图/i.test(identity)) return null;
  const summary = norm(positiveSkillText([skill.summaryZh, skill.description].filter(Boolean).join(' ')));
  if (!summary) return null;
  for (const clause of list(clauses)) {
    const text = norm(maskUrlText(clause));
    for (let end = text.indexOf('图'); end >= 0; end = text.indexOf('图', end + 1)) {
      for (let length = 3; length <= 7 && length <= end + 1; length++) {
        const start = end - length + 1, object = text.slice(start, end + 1);
        if (!/^[\p{Script=Han}]+图$/u.test(object) || !summary.includes(object) || !alignedHanPhrase(text, object)) continue;
        const before = text.slice(Math.max(0, start - 24), start), after = text.slice(end + 1, end + 16);
        if (/(?:绘制|画出|画|生成|制作|重绘|渲染|创建|新建|转成|转换为).{0,16}$/u.test(before)
          || /^.{0,8}(?:绘制|画出|生成|制作|重绘|渲染|创建|新建)/u.test(after)) return object;
      }
    }
  }
  return null;
}

function queryClauses(query) {
  const raw = String(query || '');
  // Host plugin mentions are explicit names; preserve their surrounding clause
  // so quoted, future and negative uses still go through the scope filters.
  const clauses = instructionClauses(instructionText(raw))
    .flatMap(value => value.split(/但(?=\s*(?:请|仍|继续|直接|改用|使用|调用|修复|实现|处理|分析|生成|读取|检查|执行))|(?:然后|接着)(?=\s*(?:请|继续|直接|改用|使用|调用|修复|实现|处理|分析|生成|读取|检查|执行))|\band then\b(?=\s*(?:please|continue|use|invoke|apply|fix|read|check))/iu))
    // A prohibition may be followed by an independent read-only goal without
    // punctuation. Do not split attributive constraints such as 无需联网的.
    .flatMap(value => /(?:不要|不得|禁止|严禁|请勿|禁用|不使用|不用|不调用|不采用|不执行|(?<![分识辨区判鉴])别用|do not|don't|never)/iu.test(value)
      ? value.split(/(?:并|然后|接着|[:：])(?=\s*(?:(?:请|继续|直接)\s*)?(?:只(?:读|检查|查看|阅读|审查|分析)|仅(?:限)?(?:只读|查看|读取|检查|审查|阅读|分析)))|(?:并|同时)(?=\s*请\s*(?:(?:继续|直接|另外)\s*)?(?:编辑|修改|移除|去除|处理|生成|绘制|查询|查找|搜索|检索|联网|使用|调用|创建|新建|添加|编写|撰写|制作|输出|保存|导出))|\band\b(?=\s+(?:only|read.only)\s+(?:inspect|read|review|check|analy[sz]e)\b)|\b(?:and|then)\b(?=\s+please\s+(?:create|add|write|make|produce|export|save)\b)/iu)
      : [value])
    .map(value => value.trim()).filter(Boolean);
  const controlText = maskUrlText;
  const deferredOutputExample = value => /^(?:请\s*)?下次\s*(?:再|将|请)?\s*(?:生成|创建|编写|撰写|写出|写|制作|设计|绘制|画|做|提供|给出|输出).{0,12}示例\s*[:：]/u.test(controlText(value));
  const isFuture = (value) => /以后|将来|未来|后续|下一步|届时|日后|计划(?:再|之后)|下次(?=.{0,12}(?:不要|不得|禁止|不使用|不用|请勿|严禁))|eventually|later|future|subsequently/i.test(controlText(value))||deferredOutputExample(value);
  const isNegative = (value) => negativeDirective.test(controlText(value)) || /(?:请勿|严禁|禁用|不调用|不采用|不执行)/iu.test(controlText(value));
  const active = clauses.flatMap((value) => {
    // "示例代码" or "示例 app.mjs" is an object of the task, not a
    // material boundary. A standalone illustrative directive still is.
    const controlled=controlText(value);
    let exampleAt=-1;
    for(const hit of controlled.matchAll(/(?:例如|比如|举例|示例(?=\s*(?:[:：]|使用|调用|启用|执行|部署|安装|删除|联网|发送|修改))|for example|e\.g\.)/gi)) {
      if(hit[0]==='示例'&&isRequestedExampleOutput(controlled.slice(0,hit.index),'示例'))continue;
      exampleAt=hit.index;break;
    }
    const usable = exampleAt < 0 ? value : value.slice(0, exampleAt);
    // A future time horizon inside a request to produce a plan is current work.
    const currentPlan = /^(?:(?:请你?|现在|本次|帮我|麻烦)\s*)*(?:(?:为|针对)未来.{0,25}(?:制定|编写|设计|准备)|(?:制定|编写|设计|准备)).*(?:计划|方案)/.test(usable)
      || /^(?:please\s+)?(?:write|create|prepare|design)\b.*\bplan\b/i.test(usable);
    const planning = (currentPlan ? usable.replace(/(?:未来|后续)(?=.{0,35}(?:计划|方案))/g, '').replace(/\bfuture\b/gi, '') : usable)
      // “绘制后续步骤流程图” requests a current artifact. It is different
      // from “后续再绘制流程图”, which is a future action.
      .replace(/((?:绘制|画出|画|制作|生成|编写|设计|列出|分析|梳理|整理|描述|说明|展示|规划|总结)(?:.{0,20}?))(?:后续|下一步|未来)(?=(?:的)?(?:步骤|流程|操作|环节|方案|计划|路径|趋势|安排|任务|内容))/g,'$1');
    // An attributive “无需联网的小游戏” does not negate the following goal.
    // Keep deriving the actual restrictions from the unmodified raw query.
    const boundedModifiers=planning.replace(/(?:无需|无须|不需要|不用|不必|不)(?:联网|上网|网络|外部依赖|第三方依赖|外部资源|外部服务)(?:(?:和|与|及|或|、|以及)(?:联网|上网|网络|外部依赖|第三方依赖|外部资源|外部服务)){0,4}的/g,' ');
    const futureAt=deferredOutputExample(boundedModifiers)?0:controlText(boundedModifiers).search(/(?:以后|将来|未来|后续|下一步|届时|日后|下次(?=.{0,12}(?:不要|不得|禁止|不使用|不用|请勿|严禁))|eventually|later|future|subsequently)/i);
    const beforeFuture=futureAt<0?boundedModifiers:boundedModifiers.slice(0,futureAt);
    const negativeAt=controlText(beforeFuture).search(/(?:不要|不得|禁止|请勿|严禁|禁用|不使用|不用|不调用|不采用|不执行|(?<![分识辨区判鉴])别用|无需|不需要|避免|do not|don't|never|without)/iu);
    const beforeNegative=negativeAt<0?beforeFuture:beforeFuture.slice(0,negativeAt);
    return beforeNegative.trim() && !isNegative(beforeNegative) ? [beforeNegative.trim()] : [];
  });
  return {active, future: clauses.filter(isFuture), negative: clauses.filter(isNegative), raw};
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

export function taskAssessment(query, taskContext = {}) {
  const clauses = queryClauses(query);
  const activeText = clauses.active.join(' ');
  const statedActions = list(taskContext.actions).filter((action) => lexicalScore(activeText, action));
  const statedDeliverables = list(taskContext.deliverables).filter((item) => lexicalScore(activeText, item));
  const development = /开发|实现|修复|重构|迁移|集成|升级|编写代码|build|implement|develop|fix|refactor|migrat/i.test(activeText);
  const selfContainedFunction = /^\s*(?:export|implement|write)\s+(?:an?\s+)?(?:async\s+)?[a-z_$][\w$]*\s*\(/i.test(activeText)
    && !/repository|database|deployment|production|security audit|cross.module|existing system/i.test(activeText);
  const complexitySignals = [
    /跨.{0,8}(?:模块|服务|系统|边界)|前后端|cross[- ]?(?:module|service)/i.test(activeText) && 'cross-boundary',
    /迁移|兼容|状态|并发|权限|安全|部署|migration|compatib|concurren|security|deploy/i.test(activeText) && 'migration-or-system-impact',
    /架构|设计取舍|tradeoff|architecture/i.test(activeText) && 'design-tradeoff',
    /集成|接口|构建|既有|现有|integrat|existing/i.test(activeText) && 'existing-system-integration',
    /独立(?:子任务|交付物|工作线)|多个(?:模块|交付物)|parallel workstreams/i.test(activeText) && 'independent-deliverables',
  ].filter(Boolean);
  for (const signal of list(taskContext.complexityEvidence)) if (lexicalScore(activeText, signal)) complexitySignals.push(signal);
  const complexDevelopment = development && unique(complexitySignals).length >= 2;
  const complexity = complexDevelopment ? 'complex' : development ? 'moderate' : 'simple';
  const taskType = /审查|review|audit|检查|核验/i.test(activeText) ? 'review'
    : development ? 'development'
      : /研究|调研|论文|文献|research/i.test(activeText) ? 'research'
        : /分析|统计|数据|analys/i.test(activeText) ? 'analysis' : 'general';
  const inferredConstraints = inferUserConstraints(clauses.raw,activeText,clauses.active);
  const readOnly = inferredConstraints.readOnly;
  const explicitSkills = list(taskContext.explicitSkills).filter((name) => lexicalScore(activeText, name));
  return {
    objective: taskContext.objective && lexicalScore(activeText, taskContext.objective) ? taskContext.objective : activeText.slice(0, 280),
    actions: statedActions,
    deliverables: statedDeliverables,
    domain: taskContext.domain && lexicalScore(activeText, taskContext.domain) ? taskContext.domain : null,
    explicitSkills,
    constraints: list(taskContext.constraints).filter((item) => lexicalScore(activeText, item)),
    complexity, taskType, complexityEvidence: unique(complexitySignals), development, complexDevelopment, selfContainedFunction, readOnly,
    ...(inferredConstraints.networkForbidden||inferredConstraints.sourceScope||inferredConstraints.preserveInputs?{inferredConstraints}:{}),
    activeText, activeClauses: clauses.active,
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

function scoreCandidate(skill, assessment, host, runtimeCapabilities, calibration, retrieval, document) {
  // URLs are inputs. Text inside their paths and query strings is not a
  // request to use a skill or a positive task signal.
  const active = maskUrlText(assessment.activeText);
  const names = explicitName(skill);
  if (prohibitedSkill(skill, retrieval.negativeSkillClauses)) return {
    skill, score: -100, explicit: false, capability: inferCapability(skill), phase: inferSkillStage(skill),
    reasons: ['explicitly prohibited by the current request'], availability: skillAvailability(skill, host, runtimeCapabilities), evidence: [],
  };
  const blockedProduct=prohibitedDeclaredProduct(skill,retrieval.negativeSkillClauses);
  if(blockedProduct)return {
    skill, score:-100, explicit:false, capability:inferCapability(skill), phase:inferSkillStage(skill),
    reasons:['product explicitly prohibited in the current request'],availability:skillAvailability(skill,host,runtimeCapabilities),evidence:[],
  };
  // A plugin mention identifies its currently supplied runtime skills, not an
  // unrelated legacy skill which happens to share the package's name.
  if (skill.sourceId?.startsWith('plugin:')) names.push(skill.sourceId.slice(7));
  const explicit = names.some(name=>explicitlyNames(active,name));
  // QClaw's own host rules are not ambient instructions in another host.
  // They remain available for an explicitly requested QClaw task.
  if(host!=='qclaw'&&!explicit&&/^qclaw-rules(?:$|[-_])/i.test(String(skill.id||''))&&!/\bqclaw\b/i.test(active)) return {
    skill,score:0,explicit:false,capability:inferCapability(skill),phase:inferSkillStage(skill),
    reasons:['host-specific rules do not apply to this task'],availability:skillAvailability(skill,host,runtimeCapabilities),evidence:[],
  };
  // An unavailable qualified runtime identity cannot become available via a
  // different origin merely because both point at the same physical file.
  // An independently named, enabled alternative remains eligible.
  const unavailableNames=list(skill.runtimeIdentities)
    .filter(entry=>entry&&entry.available!==true&&typeof entry.id==='string'&&explicitlyNames(active,entry.id))
    .map(entry=>entry.id);
  if(unavailableNames.length&&!names.some(name=>!unavailableNames.includes(name)&&explicitlyNames(active,name)))return {
    skill,score:-100,explicit:false,capability:inferCapability(skill),phase:inferSkillStage(skill),
    reasons:['explicit runtime skill identity is unavailable in the current host'],availability:skillAvailability(skill,host,runtimeCapabilities),evidence:[],
  };
  if (assessment.selfContainedFunction && !explicit) return {
    skill, score: 0, explicit: false, capability: inferCapability(skill), phase: inferSkillStage(skill),
    reasons: ['self-contained function; native baseline is sufficient'], availability: skillAvailability(skill, host, runtimeCapabilities), evidence: [],
  };
  const capability = inferCapability(skill);
  const phase = inferSkillStage(skill, capability);
  const diagramObject = diagramTaskEvidence(skill, assessment.activeClauses);
  const triggerHits = list(skill.triggers).filter((term) => lexicalScore(active, term));
  const serviceName = namedServiceEvidence(skill, active);
  const description = [skill.summaryZh, skill.description, skill.nameZh, skill.name, skill.category].filter(Boolean).join(' ');
  const rawLexicalHits = [...retrieval.terms].filter((term) => document.identity.has(term) || document.description.has(term))
    .map((term) => {
      const rarity = 1 + Math.log(1 + (retrieval.corpusSize + 1) / ((retrieval.df.get(term) || 0) + 1));
      const translated = retrieval.inferred.some(item => item.term === term && /\p{Script=Han}/u.test(item.evidence));
      return {term, weight: Math.max(translated ? 4 : 0, Math.min(7, rarity) * (document.identity.has(term) ? 1.5 : 1)), inferred: retrieval.inferred.some((item) => item.term === term)};
    })
    .filter((hit) => hit.weight >= 1.4)
    .sort((a, b) => b.weight - a.weight);
  const lexicalHits = retrieval.experimental ? independentHits(rawLexicalHits, active) : rawLexicalHits;
  const supportedHits = independentDescriptionHits(lexicalHits, retrieval, document);
  const scoreableHits = supportedHits ?? lexicalHits.filter(hit => document.positiveTerms.has(hit.term));
  const descriptionScore = scoreableHits.slice(0, 5).reduce((sum, hit) => sum + hit.weight, 0);
  const domain = assessment.domain;
  const domainMatch = domain && lexicalScore([document.positiveText, ...list(skill.domains)].join(' '), domain);
  let score = (explicit ? 30 : 0) + Math.min(3, triggerHits.length) * 6 + descriptionScore + (domainMatch ? 3 : 0);
  const promptArtifactWork = capability === 'prompt-engineering' && scoreableHits.length >= 2
    && list(assessment.activeClauses).some(clause => /(?:写|撰写|编写|生成|改写|优化|完善|\b(?:write|create|refine|rewrite)\b).{0,40}(?:提示词|提示语|\bprompt\b)|(?:提示词|提示语|\bprompt\b).{0,25}(?:写|撰写|编写|生成|改写|优化|完善|\b(?:write|create|refine|rewrite)\b)/i.test(clause));
  if (promptArtifactWork) score += 8;
  if (lexicalScore(active, skill.id)) score += 5;
  if (capability === 'skill-governance' && /技能|skill|路由器|router/i.test(active)) score += 8;
  const softwareDiagnostic = Boolean(softwareDiagnosticEvidence(active));
  const diagnosticIntent = softwareDiagnostic || (/diagnostic|diagnos|troubleshoot|investigat|incident|outage/i.test(active)
    && /mitigation|reversible|cause|evidence|checks|checks|检查|排查/i.test(active));
  const shortName = String(skill.id || '').split(':').at(-1);
  const specialistNameTerms = words(shortName).filter((term) => !['debug', 'pro', 'workflow', 'systematic'].includes(term) && !/^\d+$/.test(term));
  const diagnosticNameMatch = diagnosticIntent && /\bdebug(?:ging)?\b/i.test([skill.id, skill.nameZh, skill.name].join(' '))
    && specialistNameTerms.every((term) => retrieval.terms.has(term))
    && scoreableHits.some((hit) => hit.term === 'debug');
  if (diagnosticNameMatch) score += 12;
  if (capability === 'browser-automation' && !/浏览器|browser|playwright|网页操作|自动化测试/i.test(active)) score -= 10;
  const strongDescription = scoreableHits.length >= 2 && descriptionScore >= 7;
  const agentInstruction = capability === 'prompt-engineering' && agentInstructionWork(assessment.activeClauses);
  const agentInstructionSupported = agentInstruction && scoreableHits.length > 0;
  const identityAnchor = scoreableHits.some(hit => document.identity.has(hit.term));
  if (!explicit && !triggerHits.length && !strongDescription && !domainMatch && !diagnosticNameMatch && !serviceName && !agentInstructionSupported && !identityAnchor) score = 0;
  if (!explicit && !triggerHits.length && !domainMatch && !serviceName && !agentInstructionSupported && !identityAnchor && score < 8) score = 0;
  if (!explicit && !triggerHits.length && !domainMatch && !diagnosticNameMatch && !serviceName && supportedHits !== null) {
    const distinct = new Set(supportedHits.map(hit => hit.term));
    if (distinct.size < 2 && !identityAnchor && !agentInstructionSupported) score = 0;
  }
  // A skill's examples can mention many unrelated projects. For these
  // specialized capabilities, require the task object, not merely a topic
  // from an example. Explicit names, matching triggers, and user-supplied
  // domain matches remain higher-priority evidence.
  const taskObjectCompatible = capabilityHasTaskObject(capability, active, skill, assessment.activeClauses);
  if (!explicit && !triggerHits.length && !domainMatch && !taskObjectCompatible) score = 0;
  // A format-specific trigger alone can narrowly miss the consult threshold in
  // small/custom catalogs. Require an exact requested filename extension AND
  // an independent, direct identity match before restoring that consultation.
  const identityTerms = (supportedHits || []).filter(hit => !hit.inferred && document.identity.has(hit.term));
  const formatTrigger = triggerHits.find(term => /^[a-z][a-z0-9]{1,5}$/i.test(term)
    && new RegExp(`\\.${term}(?=$|[^a-z0-9])`, 'i').test(active)
    && (supportedHits || []).some(hit => !hit.inferred && hit.term === token(term))
    && identityTerms.some(hit => hit.term !== token(term)));
  const formatCorroborated = !explicit && Boolean(formatTrigger) && score > 0 && score < 20;
  if (formatCorroborated) score = 20;
  const specificHanTrigger = triggerHits.some(term => {
    const word = String(term);
    const isSpecific = /^[\p{Script=Han}]{4,}$/u.test(word)
      || (/^[\p{Script=Han}]{3}$/u.test(word)
        && [skill.nameZh, skill.name, ...list(skill.aliases)].some(name => norm(name).trim() === norm(word))
        && alignedHanPhrase(active, word));
    return isSpecific && scoreableHits.some(hit => document.identity.has(hit.term) && norm(word).includes(hit.term));
  });
  const identityText = [skill.nameZh, skill.name, skill.id, ...list(skill.aliases)].filter(Boolean).join(' ');
  const specificMultiwordTrigger = triggerHits.some(term => /^[a-z0-9]+(?:\s+[a-z0-9]+)+$/i.test(String(term).trim())
    && words(term).filter(word => word.length >= 3 && !genericLatin.has(word)).length >= 2
    && lexicalScore(identityText, term));
  if ((specificHanTrigger || specificMultiwordTrigger) && score > 0 && score < 20 && taskObjectCompatible) score = 20;
  if (diagramObject && taskObjectCompatible && score < 20) score = 20;
  if (identityAnchor && score > 0 && score < 8) score = 8;
  if (agentInstructionSupported && score > 0 && score < 20) score = 20;
  const frontendImplementation = capability === 'frontend-implementation' && scoreableHits.length >= 2
    && /前端|网页|网站|landing\s+page|\b(?:react|vue|html|web)\b/i.test(active)
    && /代码|编程|编码|实现|搭建|可运行|\b(?:code|implement|build)\b/i.test(active);
  if (frontendImplementation && score > 0 && score < 20) score = 20;
  if (serviceName && taskObjectCompatible && score < 20) score = 20;
  if (softwareDiagnostic && diagnosticNameMatch && score > 0 && score < 20) score = 20;
  if (!explicit && restrictedGitDelivery(skill)) {
    if (!gitDeliveryIntent(active)) score = 0;
    else if (score > 0 && score < 20) score = 20;
  }
  // Generic verbs and output labels may help rank an already relevant skill,
  // but their combined rarity is not evidence that the task and manual share
  // a concrete object. Keep exact names, specific triggers and independently
  // supported action/object pairs, including short requests.
  const concrete=concreteTaskSupport(skill,capability,assessment);
  const concretePair=concrete.skill||concrete.codeTest||concrete.docx||concrete.data||concrete.research||concrete.sourceResearch||concrete.canvasGame||concrete.accessibility||concrete.canvasDoc||concrete.videoTranscription||concrete.stock||concrete.finance;
  const substantiveHit=scoreableHits.some(hit=>!weakEvidence(hit.term)
    && (!/^[\p{Script=Han}]+$/u.test(hit.term)||retrieval.queryWords!==null));
  const specificTrigger=triggerHits.some(term=>!weakEvidence(term)
    && (!/^[\p{Script=Han}]+$/u.test(String(term))||alignedHanPhrase(active,term)));
  const specificDomain=Boolean(domainMatch&&!weakEvidence(domain));
  // Compare specialized primary purposes with positive task objects; text
  // from a standalone negative clause cannot become an identity anchor.
  // Exact skill requests and independently requested services remain eligible.
  const objectText=positiveObjectEvidence(assessment.activeClauses,active);
  const sharedIdentityTerms=new Set(['codex','openai','plugin','plugins','skill','skills','agent','agents','assistant','host','runtime','system','网站','网页','主页','website','site','homepage']);
  const specialtyIdentityAnchor=scoreableHits.some(hit=>document.identity.has(hit.term)
    &&!weakEvidence(hit.term)&&!sharedIdentityTerms.has(norm(hit.term))&&lexicalScore(objectText,hit.term));
  const positiveService=serviceName&&lexicalScore(objectText,serviceName);
  const objectMismatch=!explicit&&!positiveService&&!specialtyIdentityAnchor
    ?specialtyMismatch(skill,objectText,retrieval.rawQuery):null;
  const purposeMatches=taskPurposeMatches(skill,assessment);
  if(objectMismatch)score=0;
  if(!explicit&&!serviceName&&!diagramObject&&!diagnosticNameMatch&&!agentInstructionSupported
      &&!identityAnchor&&!specificHanTrigger&&!specificMultiwordTrigger
      &&!specificDomain&&!specificTrigger&&!substantiveHit&&!concretePair)score=0;
  if(!explicit&&!objectMismatch&&concretePair&&taskObjectCompatible&&score<20)score=20;
  const recognitionTask=/(?:语音识别|语音转(?:写|文字)|\bspeech\s+recognition\b|\bautomatic\s+speech\s+recognition\b|\bspeech.to.text\b)/i.test(active);
  const voiceOutputTask=/(?:配音|旁白|语音合成|朗读|\b(?:voiceover|narration|text.to.speech|spoken audio)\b)/i.test(active);
  const speechSynthesisOnly=/^(?:generate|create|produce)\s+spoken\s+audio\s+from\s+text\b/i.test(String(skill.summaryZh||skill.description||'').trim())
    &&!/(?:speech recognition|speech.to.text|语音识别|转写)/i.test(String(skill.summaryZh||skill.description||''));
  if(!explicit&&recognitionTask&&!voiceOutputTask&&speechSynthesisOnly)score=0;
  if(!explicit&&(concrete.testLanguageMismatch||concrete.testFrameworkMismatch))score=0;
  if(!explicit&&financeSpecialistWithoutObject(skill,active))score=0;
  if(!explicit&&restrictedGitDelivery(skill)&&!gitDeliveryIntent(active))score=0;
  if(!objectMismatch&&purposeMatches.length&&!(concrete.testLanguageMismatch||concrete.testFrameworkMismatch)
      &&!financeSpecialistWithoutObject(skill,active)&&!(restrictedGitDelivery(skill)&&!gitDeliveryIntent(active)))score=Math.max(score,20);
  if (score > 0) score += calibration?.adjustment || 0;
  const availability = skillAvailability(skill, host, runtimeCapabilities);
  if (!availability.discovered || !availability.readable || !availability.enabled || !availability.compatible) score = -100;
  const reasons = [];
  if (explicit) reasons.push('explicitly requested in active task');
  if (triggerHits.length) reasons.push(`matched task signal: ${triggerHits[0]}`);
  if (diagramObject && taskObjectCompatible) reasons.push(`explicit diagram creation matches manual object: ${diagramObject}`);
  if (agentInstructionSupported) reasons.push('task explicitly requests writing instructions for an AI agent');
  if (concrete.sourceResearch) reasons.push('source-based comparison aligns with a general research manual');
  if (concrete.canvasGame) reasons.push('interactive canvas game aligns with the manual game interface purpose');
  if (concrete.accessibility) reasons.push('requested accessible interface aligns with accessibility manual');
  if (concrete.canvasDoc) reasons.push('requested JSON Canvas document aligns with its manual');
  if (concrete.videoTranscription) reasons.push('video transcription aligns with a manual that supports video input and transcription');
  if (purposeMatches.length&&!objectMismatch) reasons.push(`task action and manual purpose align: ${purposeMatches[0].group}`);
  if (serviceName) reasons.push(`literal service name in task and skill: ${serviceName}`);
  if (formatCorroborated) reasons.push('requested file extension is corroborated by an independent skill identity match');
  const explainedHits = scoreableHits;
  if (explainedHits.length) reasons.push(`distinctive manual terms: ${explainedHits.slice(0, 3).map((hit) => `${hit.term}${hit.inferred ? ' (inferred)' : ''}`).join(', ')}`);
  if (diagnosticNameMatch) reasons.push('diagnostic request plus mitigation/check requirement matches a general debugging manual');
  if (calibration?.adjustment) reasons.push(`verified feedback: ${calibration.adjustment > 0 ? '+' : ''}${calibration.adjustment}`);
  const matchedPhrase = triggerHits[0] || (explicit ? names.find((name) => lexicalScore(active, name)) : serviceName || diagramObject || explainedHits[0]?.term);
  const clauseIndex = assessment.activeClauses?.findIndex((clause) => matchedPhrase && lexicalScore(clause, matchedPhrase)) ?? -1;
  const inference = retrieval.inferred.find((item) => item.term === matchedPhrase);
  const evidence = matchedPhrase ? [{kind: triggerHits.length ? 'trigger' : explicit ? 'explicit' : serviceName ? 'service-name' : inference ? 'inferred-description' : 'description', phrase: matchedPhrase,
    querySignal: inference?.evidence || null,
    clauseIndex, snippet: clauseIndex >= 0 ? assessment.activeClauses[clauseIndex].slice(0, 160) : active.slice(0, 160)}] : [];
  // Purpose matches must cite continuous user text, even when the relevant
  // manual uses another language and no lexical identity term overlapped.
  const purposeSignals=[
    [concrete.canvasGame,/(?:游戏|\bgames?\b)/i],
    [concrete.canvasGame,/\bcanvas\b/i],
    [concrete.sourceResearch,/(?:官方(?:文档|资料|来源|网站)|一手(?:资料|来源)|原始来源|许可条款|实际许可|\b(?:official\s+(?:docs?|documentation|sources?|websites?)|primary\s+sources?|licen[cs]e\s+terms)\b)/i],
    [concrete.accessibility,/(?:可访问性|无障碍|\b(?:accessible|accessibility|a11y|wcag|screen reader|keyboard navigation)\b)/i],
    [concrete.canvasDoc,/\bjson\s+canvas\b|\.canvas\b/i],
    [concrete.videoTranscription,/(?:视频|影片|录像|\bvideo\b|\.(?:mp4|mov|mkv|webm|avi|m4v)\b)/i],
    [concrete.videoTranscription,/(?:转写|转录|听写|转成文字|转换为文字|\b(?:transcribe|transcription|speech.to.text)\b)/i],
  ];
  for(const [enabled,pattern] of purposeSignals)if(enabled){
    const i=list(assessment.activeClauses).findIndex(clause=>pattern.test(clause));
    const snippet=i>=0?assessment.activeClauses[i]:active;
    const match=pattern.exec(snippet);
    if(match&&!evidence.some(item=>norm(item.phrase)===norm(match[0])))
      evidence.unshift({kind:'task-purpose',phrase:match[0],querySignal:null,clauseIndex:i,snippet:snippet.slice(0,160)});
  }
  for(const purpose of purposeMatches)if(!objectMismatch){
    const i=list(assessment.activeClauses).findIndex(clause=>String(clause).includes(purpose.phrase));
    if(i>=0&&!evidence.some(item=>norm(item.phrase)===norm(purpose.phrase)))
      evidence.unshift({kind:'task-purpose',phrase:purpose.phrase,querySignal:null,clauseIndex:i,snippet:assessment.activeClauses[i].slice(0,160)});
  }
  return {skill, score, explicit, capability, phase, reasons, availability, evidence, serviceName,purposeMatches:objectMismatch?[]:purposeMatches};
}

function candidateCard(item, assessment) {
  const {skill, score, explicit, capability, phase, reasons, availability, evidence} = item;
  const governance = capability === 'skill-governance';
  const action = availability.toolsAvailable === false ? 'skip'
    : governance ? 'consult' : explicit ? 'consult' : score >= 20 ? 'consult' : 'skip';
  return {
    id: skill.id, nameZh: skill.nameZh || skill.name || skill.id,
    summaryZh: skill.summaryZh || skill.description || '',
    ...(skill.summaryQuality === 'placeholder' ? {summaryQuality:'placeholder',summaryNotice:'摘要为占位，应核对完整手册'} : {}),
    path: skill.path || null, sourceId: skill.sourceId || 'legacy-registry', contentHash: skill.contentHash || null,
    parentId: skill.parentId || null, origins: list(skill.origins),
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

function budgetFor(assessment, candidates, profile) {
  const simple = assessment.complexity === 'simple';
  const cardLimit = simple ? 3 : 12;
  const ordinaryReadLimit = profile === 'economy' ? 1 : profile === 'quality' ? (simple ? 2 : 5) : simple ? 1 : 3;
  const explicitCount = candidates.filter((item) => item.explicit).length;
  return {
    consultCardLimit: cardLimit,
    fullReadLimit: ordinaryReadLimit,
    softTokenLimit: profile === 'economy' ? 6000 : profile === 'quality' ? 18000 : 12000,
    ...(profile ? {qualityProfile:profile,verificationDepth:profile==='quality'?'independent-evidence-where-needed':profile==='economy'?'focused-required-checks':'proportionate-checks',requiredValidationPreserved:true} : {}),
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

function advise(query, options = {}, filters = {}) {
  validateHostOptions(options);
  const routeId = options.routeId || randomUUID();
  const host = options.host || 'codex';
  const assessment = taskAssessment(query, options.taskContext || {});
  const recovery = planRecovery({...assessment,rawText:query},options);
  if (!filters.followup && useFastPath(assessment,options,recovery)) return {
    contractVersion:4,routeId,registryRevision:null,task:assessment,consultCandidates:[],capabilityCandidates:[],
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
    ? readFeedbackV4({host, taskType: assessment.taskType, contentHashes,modelId:options.currentModel}, options.feedbackPolicy || {}, options.feedbackPath)
    : new Map();
  // New ranking remains opt-in until representative recall/precision gates pass.
  const scopedClauses = queryClauses(query);
  const negativeSkillClauses = scopedClauses.negative.filter(clause => !scopedClauses.future.includes(clause));
  const signalText = maskUrlText(assessment.activeText);
  const retrieval = retrievalIndex(skills, signalText, options.retrievalProfile === 'experimental', negativeSkillClauses);
  retrieval.rawQuery=query;
  let ranked = skills.map((skill, index) => scoreCandidate(skill, assessment, host, options.runtimeCapabilities, feedback.get(skill.id)?.byMode?.consult, retrieval, retrieval.documents[index]))
    .filter((item) => item.score > 0);
  const explicitProviders = new Set(ranked.filter(item => item.explicit && item.skill.sourceId?.startsWith('plugin:')).map(item => item.skill.sourceId.slice(7)));
  ranked = ranked.filter(item => item.skill.sourceId?.startsWith('plugin:') || !explicitName(item.skill).some(name => explicitProviders.has(name)));
  if (filters.source) ranked = ranked.filter((item) => item.skill.sourceId === filters.source || list(item.skill.origins).some((origin) => origin.sourceId === filters.source));
  if (filters.domain) ranked = ranked.filter((item) => lexicalScore([item.capability, item.skill.category, item.skill.summaryZh, ...list(item.skill.domains)].join(' '), filters.domain));
  if (filters.phase) ranked = ranked.filter((item) => item.phase === filters.phase || item.purposeMatches?.some(match=>match.phases.includes(filters.phase)));
  ranked.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
  if (assessment.complexity === 'simple' && ranked.length) {
    const floor = Math.max(8, ranked[0].score * 0.82);
    ranked = ranked.filter((item) => item.score >= floor || item.explicit || item.serviceName || item.purposeMatches?.length || item.reasons.some((reason) => reason.startsWith('matched task signal:')));
  }
  const budget = budgetFor(assessment, ranked, options.qualityProfile);
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? Math.min(filters.limit, 12) : budget.consultCardLimit;
  const explicitCandidates = ranked.filter(item => item.explicit);
  // Cover distinct observed action/output needs before adding repeated
  // candidates for the same need. All remain optional host consultations.
  const selectedCards=[...explicitCandidates],purposeCounts=new Map();
  const recordPurposes=item=>{for(const match of item.purposeMatches||[])purposeCounts.set(match.group,(purposeCounts.get(match.group)||0)+1);};
  for(const item of explicitCandidates)recordPurposes(item);
  const purposePriority=item=>Math.min(...(item.purposeMatches||[]).map(match=>match.group==='personal-site-work'?0:match.group.startsWith('declared:')?1:2),3);
  const purposeRanked=[...ranked].sort((a,b)=>purposePriority(a)-purposePriority(b)||b.score-a.score||a.skill.id.localeCompare(b.skill.id));
  const needs=new Set(ranked.flatMap(item=>(item.purposeMatches||[]).map(match=>match.group).filter(group=>!group.startsWith('declared:'))));
  const limitRepeatedNeeds=needs.size>1||explicitCandidates.length>1;
  for(const item of purposeRanked){
    if(selectedCards.length>=limit||item.explicit||item.score<20||item.availability.toolsAvailable===false)continue;
    const unseen=(item.purposeMatches||[]).filter(match=>!purposeCounts.has(match.group));
    if(!unseen.length)continue;
    selectedCards.push(item);recordPurposes(item);
  }
  for(const item of ranked){
    if(selectedCards.length>=limit)break;
    if(selectedCards.includes(item))continue;
    const groups=(item.purposeMatches||[]).map(match=>match.group).filter(group=>!group.startsWith('declared:'));
    if(limitRepeatedNeeds&&!item.explicit&&!item.serviceName&&groups.length&&groups.every(group=>(purposeCounts.get(group)||0)>=3))continue;
    selectedCards.push(item);recordPurposes(item);
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
  const capabilities = adviseCapabilities({...assessment,rawText:query}, {...options, host, phase:filters.phase || options.phase});
  return {
    contractVersion: 4, routeId, registryRevision: index.revision || null,
    recoveryPlan:recovery,
    performance:{mode:'full',scannedSkills:true,scannedCapabilities:true},
    capabilityCandidates:capabilities.candidates,
    capabilityCoverage:{revision:capabilities.revision,...capabilities.coverage,errors:capabilities.errors},
    invocationPolicy:{phase:capabilities.phase,...capabilities.executionPolicy},
    task: assessment,
    consultCandidates,
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

function extendAdvice(result,query,options){
  const fast=result.performance?.mode==='fast';
  const unquoted=String(query).replace(/```[\s\S]*?```/g,' ').replace(/[“"「『][^”"」』\n]*[”"」』]/g,' ');
  const assessment={...result.task,methodDirectives:methodDirectives(unquoted.split(/[。！？!?;；，,\n]+/))};
  return {...result,requestContext:requestContext(query,options),taskConstraints:invocationConstraints({...result.task,rawText:query},options),methodCandidates:fast?[]:adviseTaskMethods(assessment,options),capabilityConsultations:fast?[]:exactToolConsultations(query,result.task,options)};
}
export function routeTaskV4(query, options = {}) { const result = extendAdvice(advise(query, options),query,options); return options.responseDetail === 'compact' ? compactAdviceV4(result) : result; }
export function searchSkills(query, options = {}) {
  const result = extendAdvice(advise(query, options, {source: options.source, domain: options.domain, phase: options.phase, limit: options.limit,followup:true}),query,options);
  return options.responseDetail === 'compact' ? compactAdviceV4(result) : result;
}
export function formatAgentContextV4(result) {
  const candidates = list(result?.consultCandidates).map((item) => `${item.id} (${item.phase}; ${item.suggestedMode}): ${item.reasons.join('; ') || item.summaryZh}${item.summaryQuality === 'placeholder' ? ' [摘要为占位，应核对完整手册]' : ''}`).join('\n');
  const tools = list(result?.capabilityCandidates).map(item=>`${item.name} (${item.kind}; ${item.decision}; ${item.phase}): ${item.reason}; ${item.when}`).join('\n');
  const methods=list(result?.methodCandidates).map(item=>`${item.id} (${item.name}; advisory only): ${String(item.reason||'').slice(0,180)}`).join('\n');
  const consultations=list(result?.capabilityConsultations).map(item=>`${item.name} (${item.decision}; effect=${item.effect||'unknown'}; available=${item.availability?.callable??'unknown'}): consultation only; verify schema, inputs and authorization.`).join('\n');
  const limits=result?.taskConstraints;
  const restricted=limits&&(limits.readOnly||limits.networkForbidden||limits.sourceScope||limits.preserveInputs||Array.isArray(limits.allowedActions));
  const sourceBoundaryUnclear=list(result?.requestContext?.sourceSegments).some(segment=>segment.boundary==='unclosed');
  return `[动态技能路由器] routeId=${result?.routeId || 'unknown'} contractVersion=4\n` +
    `Native baseline: ${result?.decisionBrief?.nativeBaseline?.approach || result?.decisionBrief?.nativeBaseline?.prompt || 'Evaluate native capabilities.'}\n` +
    `Candidate manuals (advisory only):\n${candidates || 'none'}\n` +
    `Plugin/MCP/tool candidates (host executes within task scope):\n${tools || 'none; use native capabilities'}\n` +
    (methods?`Optional method advice (skip when unnecessary; no mandatory interview or workflow):\n${methods}\n`:'') +
    (consultations?`Host-proposed tool consultations (not user authorization):\n${consultations}\n`:'') +
    (restricted?`Current restrictions: readOnly=${Boolean(limits.readOnly)}; networkForbidden=${Boolean(limits.networkForbidden)}${limits.sourceScope?`; sourceScope=${limits.sourceScope}`:''}${Array.isArray(limits.sourceScopes)&&limits.sourceScopes.length>1?`; allSourceScopes=[${limits.sourceScopes.join(', ')}]`:''}${typeof limits.sourceScopeIntersection==='string'?`; ${limits.sourceScopeIntersection}`:''}${limits.preserveInputs?'; preserveInputs=true':''}${Array.isArray(limits.allowedActions)?`; allowedActions=[${limits.allowedActions.join(', ')}]`:''}. Restrictions only; unknown effects remain gated.\n`:'') +
    (sourceBoundaryUnclear?'A source or quoted block has no explicit closing boundary. Inspect the original request before treating later text as task instructions.\n':'') +
    (result?.recoveryPlan?.triggered ? `Recovery: ${result.recoveryPlan.reason}; external research required=${result.recoveryPlan.externalResearchRequired}. ${restricted?'Respect the current restrictions; diagnose and return to the original acceptance criteria.':'Diagnose, research, acquire only useful capabilities, then return to the original acceptance criteria.'}\n` : '') +
    `Choose skip, consult, adapt, or execute after scope and availability checks. Read complete manuals before applying them. ` +
    `No execution or external write is authorized by this advice.\n` +
    `Coordination: ${result?.coordination?.reason || 'Assess independent work and verified slots.'}`;
}
