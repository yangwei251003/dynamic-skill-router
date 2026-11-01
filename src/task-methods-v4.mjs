import {readFileSync} from 'node:fs';
import {optionComparison} from './task-intents.mjs';

const text = value => typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : '';
const list = value => Array.isArray(value) ? value : [];
let catalog;

// This small local catalogue is loaded only after a useful method is identified.
// Reading it never executes a skill, calls a service or persists user information.
function getCatalog() {
  catalog ??= JSON.parse(readFileSync(new URL('../config/task-methods.json', import.meta.url), 'utf8'));
  return catalog;
}

const rules = [
  {id:'socratic-questioning', family:'clarification', aliases:['苏格拉底式提问','苏格拉底提问','苏格拉底式问诊','socratic questioning'],
    match: t => /说不清(?:楚)?(?:.{0,12}(?:目标|需求|问题|卡点))|(?:目标|需求|真正的问题).{0,8}(?:模糊|含糊|不明确|互相冲突)|不知道.{0,8}(?:真正想要|真正要解决)/u.test(t),
    reason:'目标或关键概念尚不明确，澄清可能改变后续行动。', priority:70},
  {id:'dual-explanation', family:'explanation', aliases:['双层解释法','双层解释','dual explanation'],
    match: t => /(?:不懂|听不懂|看不懂|不理解|完全陌生|没有基础|零基础).{0,45}(?:概念|术语|原理|机制)|(?:解释|学习|讲解).{0,35}(?:小白版|专业版|通俗和专业)/u.test(t),
    reason:'用户明确表示概念理解存在缺口，需要把直观理解与准确机制对应。', priority:65},
  {id:'reverse-decomposition', family:'reference', aliases:['反向拆解','reverse decomposition'],
    match: t => /(?:拆解|逆向分析).{0,35}(?:优秀|范例|参考|成品|作品)|(?:优秀|标杆|参考|范例).{0,40}(?:为什么好|关键选择|可复用|拆解)/u.test(t),
    reason:'已有具体范例，需要识别可迁移的质量来源。', priority:67},
  {id:'longitudinal-comparison', family:'research', aliases:['纵横分析法','横纵分析法','纵横分析','横纵分析'],
    match: t => /(?:研究|调研|分析).{0,70}(?:演化|演进|历史|发展历程).{0,70}(?:同类|竞品|横向|对比)|(?:研究|调研|分析).{0,70}(?:同类|竞品|横向).{0,70}(?:演化|演进|历史|发展历程)/u.test(t),
    reason:'研究同时涉及历史形成过程与当下同类差异。', priority:61},
  {id:'fact-checking', family:'facts', aliases:['事实核查','事实核验','fact checking','fact-checking'],
    match: t => /(?:核查|核实|查证).{0,40}(?:说法|观点|数据|事实|结论|来源)|(?:说法|数据|消息|结论).{0,30}(?:真假|靠不靠谱|可靠吗|能不能信|证据不足|是否属实)/u.test(t),
    reason:'有具体说法或数据待核实，需要区分事实证据与由此作出的推断。', priority:76},
  {id:'complementary-perspectives', family:'perspectives', aliases:['专家会诊','互补专业视角','complementary perspectives'],
    match: t => /(?:跨学科|跨专业|多个专业).{0,35}(?:冲突|分歧|取舍|风险)|(?:工程|技术).{0,30}(?:设计|业务|商业|运营).{0,30}(?:冲突|分歧|难以兼顾)/u.test(t),
    reason:'多个专业目标有实质冲突，需要互补视角定位不同假设。', priority:64},
  {id:'first-principles', family:'reframing', aliases:['第一性原理','first principles','first-principles'],
    match: t => /(?:越改越|越修越|反复打补丁|补丁越来越多|治标不治本|路径依赖)|(?:重新|回到).{0,15}(?:基本事实|根本目标|问题本质)/u.test(t),
    reason:'现有路径出现反复修补或未经验证的惯例，需要重新核对基本事实。', priority:68},
  {id:'cross-domain-transfer', family:'analogy', aliases:['跨领域借解','跨领域迁移','cross-domain transfer'],
    match: t => /(?:其他行业|其他领域|跨领域).{0,30}(?:解法|借鉴|相似机制|迁移机制)|(?:常规|业内|本行业).{0,20}(?:解法|办法|方案).{0,15}(?:失效|想不出|走不通)/u.test(t),
    reason:'当前领域的常规办法不足，需要检查其他领域是否有可迁移机制。', priority:58},
  {id:'two-sided-steelman', family:'decision', aliases:['双向钢人论证','双向钢人','steelman','steelmanning'],
    match: (t,a) => /(?:纠结|难以选择|犹豫不决|怎么选).{0,40}(?:两个|两种|方案|选项|还是)|(?:两个|两种).{0,15}(?:方案|选项|方向).{0,20}(?:都说得通|都有道理|难以取舍)|(?:支持和反对|双方最强理由)/u.test(t)
      || optionComparison(a.activeText)&&/(?:支持|赞成)(?:与|及|以及)反对.{0,8}(?:理由|论证)|(?:双方|各自).{0,8}(?:最强|最有力).{0,10}(?:理由|论据)/u.test(t),
    reason:'真实选择存在有力的不同方向，需要找出改变选择的关键变量。', priority:69},
  {id:'minimal-experiment', family:'experiment', aliases:['最小实验','低成本验证实验','minimum experiment','minimal experiment'],
    match: t => /(?:关键假设|商业假设|需求假设).{0,25}(?:验证|试验|试错)|(?:纸上谈兵|空想|分析瘫痪).{0,30}(?:验证|行动|实验)|(?:低成本|可逆).{0,20}(?:实验|试验|试做)/u.test(t)
      || /(?:制定|编写|设计|给出|提供|准备|写).{0,12}(?:验证|试点)(?:计划|方案)/u.test(t)
        && /(?:低成本|可逆).{0,20}(?:验证|试点)(?:计划|方案)|(?:验证|试点)(?:计划|方案).{0,12}(?:可逆|低成本)/u.test(t),
    reason:'决定取决于尚未验证的假设，短小可逆的实验能够补充现实信息。', priority:71},
  {id:'personal-strength-exploration', family:'personal', personal:true, aliases:['挖掘隐藏天赋','隐藏天赋探索'],
    match: t => /(?:帮我|陪我|我想|我希望).{0,16}(?:挖掘|寻找|发现|探索|了解).{0,12}(?:我的|自身|自己|个人)?(?:隐藏)?(?:天赋|优势)|(?:我|自己).{0,8}(?:没有|没什么|有什么|有哪些).{0,5}天赋/u.test(t),
    reason:'用户当前明确希望探索自己的优势，需要以其具体经历为依据。', priority:66},
  {id:'life-design', family:'personal', personal:true, aliases:['人生设计术','人生设计','life design'],
    match: t => /(?:帮我|陪我|我想|我希望).{0,18}(?:设计|规划|探索|梳理).{0,15}(?:我的人生|个人生涯|人生方向|职业方向|人生路径)|(?:我的人生|我的职业).{0,14}(?:何去何从|不知道往哪|没有方向)/u.test(t),
    reason:'用户当前明确希望探索个人生涯路径，需要由本人选择并以体验验证。', priority:66},
  {id:'acceptance-design', family:'acceptance', aliases:['验收标准设计','设计验收标准','验收倒推'],
    match: t => /(?:建立|制定|设计|补齐|明确).{0,12}(?:验收标准|成功标准|通过门槛)|(?:验收标准|成功标准|交付标准).{0,12}(?:不明确|缺失|缺少|没有|不清楚)/u.test(t),
    reason:'可观察的完成条件尚未明确，应先把目标转化为能检验的成果标准。', priority:74},
  {id:'clarification-value', family:'clarification', aliases:['澄清价值评估','信息增益提问'],
    match: t => /(?:反复提问|过度追问|问太多|不要盘问|减少提问|只问关键).{0,40}(?:需求|问题|澄清|信息)|(?:澄清|提问).{0,20}(?:是否必要|值不值得|信息增益|会不会改变|是否改变)/u.test(t),
    reason:'需要判断一次澄清能否实质改变决策，避免为形式而打断任务。', priority:75},
  {id:'reference-calibration', family:'reference', aliases:['参考与反例校准','正反例校准','参考校准'],
    match: t => /(?:参考|范例|样例).{0,35}(?:反例|不喜欢|不能这样|质量差距|风格差距)|(?:校准|对齐).{0,25}(?:审美|质量标准|风格|参考样例)/u.test(t),
    reason:'质量或风格标准存在具体分歧，需要用可见参考与反例校准。', priority:73},
  {id:'tool-benefit-check', family:'tool-choice', aliases:['工具增益判断','技能增益判断'],
    match: t => /(?:技能|工具|插件|mcp).{0,25}(?:是否有用|到底有用|有没有帮助|值得使用|是否值得|会不会拖慢|限制模型)|(?:原生能力|直接完成).{0,35}(?:技能|工具).{0,20}(?:对比|比较|选择)/u.test(t),
    reason:'候选能力的实际增益尚不明确，需要与直接完成任务的基线比较。', priority:72},
  {id:'progressive-context', family:'context', aliases:['渐进加载','按需加载上下文','progressive disclosure'],
    match: t => /(?:上下文|技能正文|工具说明|文档).{0,20}(?:太长|过多|爆炸|占满|塞满|加载太多|预算不足)|(?:渐进|分阶段|按需).{0,15}加载.{0,15}(?:技能|工具|资料|上下文|正文)/u.test(t),
    reason:'上下文负担已经影响任务，需要按当前缺口加载必要信息。', priority:70},
  {id:'external-feedback-correction', family:'feedback', aliases:['外部反馈纠错','以证据纠错'],
    match: (t,a,o) => /(?:测试|验证|检查|工具|编译|构建).{0,25}(?:失败|报错|不通过|结果不符)|(?:自评|自我检查).{0,20}(?:不可靠|没发现|漏掉|无法发现)/u.test(t)
      || o.recoveryContext?.userRejected === true || o.recoveryContext?.confidence === 'low' || Number(o.recoveryContext?.failedAttempts || 0) >= 2,
    reason:'现有结果受到具体失败或低信心反馈，需要新证据定位并验证修正。', priority:80},
  {id:'evidence-replanning', family:'replanning', aliases:['证据驱动重规划','证据驱动调整路线'],
    match: (t,a,o) => /(?:新证据|新发现|工具反馈|验证结果|中途需求).{0,25}(?:改变|推翻|不支持|冲突|变更)|(?:原方案|现有方案).{0,25}(?:行不通|无法继续|前提失效)|(?:换一种路线|调整执行路线)/u.test(t)
      || (o.recoveryContext?.blocked === true && Number(o.recoveryContext?.failedAttempts || 0) >= 2),
    reason:'出现足以影响原路径的证据，需要调整相关步骤并保留原验收目标。', priority:77},
  {id:'memory-scope', family:'memory', aliases:['记忆范围与时效管理','记忆范围管理'],
    match: t => /(?:全局记忆|长期记忆|项目记忆|记忆规则|用户偏好).{0,35}(?:保存|写入|更新|过期|失效|污染|范围|核实|治理)|(?:保存|写入|更新|沉淀).{0,25}(?:全局记忆|长期记忆|项目记忆|用户偏好)/u.test(t),
    reason:'当前任务涉及跨任务保存信息，需要核对事实来源、适用范围和失效条件。', priority:74},
];

function explicitlyRequested(active, aliases) {
  return aliases.some(alias => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:使用|采用|应用|运用|请用|帮我用|按照|进行|做一次|用|\\buse\\s+|\\bapply\\s+)\\s*${escaped}(?=$|[^a-z])`, 'iu').test(active);
  });
}

// Only source-filtered, current clauses enter here. Keep named directives in
// source order so a later explicit correction replaces an earlier prohibition.
export function methodDirectives(clauses=[]) {
  const directives=[];
  for(const clause of clauses){
    const normalized=text(clause);
    const prohibition=/(?:不要|不得|禁止|不准|不允许|不能|不用|无需|无须)(?:再|实际|自动|主动)?(?:使用|采用|应用|运用|进行|用)?\s*|\b(?:do not|don't|must not|never)\s+(?:use|apply|adopt)\s+/iu.exec(normalized);
    for(const rule of rules){
      const forbidden=prohibition&&rule.aliases.some(alias=>{
        const index=normalized.indexOf(text(alias),prohibition.index+prohibition[0].length);
        if(index<0)return false;
        let prefix=normalized.slice(prohibition.index+prohibition[0].length,index);
        for(const other of rules.flatMap(item=>item.aliases).sort((a,b)=>b.length-a.length))prefix=prefix.replaceAll(text(other),'');
        return /^(?:\s|和|与|及|、|以及|,|，|\band\b)*$/u.test(prefix);
      });
      if(forbidden)directives.push({id:rule.id,mode:'forbid'});
      else if(explicitlyRequested(normalized,rule.aliases))directives.push({id:rule.id,mode:'allow'});
    }
  }
  return directives;
}

function personalRequestAllowed(active) {
  // Writing a biography, translating a prompt or building an application is not
  // a request to interview the user or infer a personal psychological profile.
  const personal = /(?:帮我|陪我|我想|我希望|我的|我自身|我自己|为我|\bhelp me\b|\bmy\b|\bfor me\b)/u.test(active);
  const artifact = /(?:编写|开发|实现|制作|生成|写一|翻译|总结|研究|审查|\bwrite\b|\bbuild\b|\btranslate\b|\breview\b).{0,35}(?:提示词|prompt|模板|软件|应用|网站|插件|技能|skill|文章|方法库|路由器|\bapp\b|\btemplate\b)/iu.test(active);
  return personal && !artifact;
}

/**
 * Return at most two advisory cards. Only trusted, scope-filtered active clauses can
 * trigger a method: raw prompts, attachments and ungrounded task metadata cannot.
 * The host chooses skip / consult / adapt / execute; this function executes none.
 */
export function adviseTaskMethods(assessment = {}, options = {}) {
  assessment = assessment && typeof assessment === 'object' ? assessment : {};
  options = options && typeof options === 'object' ? options : {};
  if (options.taskMethods === false) return [];
  const policy = options.taskMethods && typeof options.taskMethods === 'object' ? options.taskMethods : {};
  const maxCards = Number.isFinite(policy.maxCards) ? Math.max(0, Math.min(2, Math.floor(policy.maxCards))) : 2;
  if (!maxCards || options.fast === true || options.performance?.mode === 'fast') return [];
  const recovery = options.recoveryContext || {};
  const hasRecovery = recovery.blocked === true || recovery.userRejected === true || recovery.confidence === 'low' || Number(recovery.failedAttempts || 0) >= 2;
  if (options.routingMode === 'fast' && !hasRecovery) return [];
  const active = text(assessment.activeText).trim();
  if (!active || assessment.selfContainedFunction === true && !hasRecovery) return [];
  const methodClauses=Array.isArray(assessment.methodClauses)
    ? assessment.methodClauses.map(text).filter(Boolean) : [active];
  const disabled = new Set(list(policy.disabledIds));
  const namedPolicy=new Map(list(assessment.methodDirectives).map(item=>[item.id,item.mode]));
  const candidates = rules.flatMap(rule => {
    if (disabled.has(rule.id) || namedPolicy.get(rule.id)==='forbid' || rule.personal && !personalRequestAllowed(active)) return [];
    const explicit = explicitlyRequested(active, rule.aliases);
    const concreteGap = methodClauses.some(clause=>rule.match(clause, assessment, options));
    if (!explicit && !concreteGap) return [];
    if (options.nativeSufficient === true && !hasRecovery && !explicit) return [];
    return [{...rule, explicit, score:rule.priority + (explicit ? 100 : 0)}];
  }).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
  if (!candidates.length) return [];
  const entries = getCatalog().methods;
  const seen = new Set();
  const selected = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.family)) continue;
    const entry = entries.find(method => method.id === candidate.id);
    if (!entry) continue;
    seen.add(candidate.family);
    selected.push({id:entry.id, name:entry.name,
      reason:candidate.explicit ? `用户当前明确请求采用${entry.name}；是否执行仍由宿主结合具体目标判断。` : candidate.reason,
      trigger:entry.trigger, inputs:[...entry.inputs], output:entry.output,
      validation:entry.validation, stop:entry.stop, avoid:[...entry.avoid],
      sourceIds:[...entry.sourceIds], advisoryOnly:true});
    if (selected.length >= maxCards) break;
  }
  return selected;
}
