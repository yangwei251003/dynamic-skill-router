import {randomUUID} from 'node:crypto';
import {discoverSkills} from './discovery-v4.mjs';
import {readFeedbackV4} from './feedback-v4.mjs';
import {inferCapability, inferSkillStage} from './skill-staging.mjs';
import {adviseCapabilities} from './capabilities-v4.mjs';
import {planRecovery, useFastPath} from './recovery-v4.mjs';

const norm = (value) => String(value || '').normalize('NFKC').toLowerCase();
const list = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter(Boolean))];
const STOP = new Set('a an and are as at be because before but by can code condition data do evidence explain for from full give has have how i in into is it its list load make making my name new no not of on or our out over please point real request review run should skill skills the their them there these this to use user users using version versions what when where which with work write you your app apps system systems task tasks need needs add claim'.split(' '));
const STEM = new Map(Object.entries({diagnostic:'debug',diagnostics:'debug',diagnose:'debug',diagnosing:'debug',troubleshoot:'debug',troubleshooting:'debug',failure:'debug',incident:'debug',outage:'debug',slow:'performance',slowness:'performance',migrations:'migration',migrate:'migration',migrating:'migration',schemas:'schema',rollbacks:'rollback',deployments:'deployment',deploy:'deployment',features:'feature',requirements:'requirement',prioritize:'priority',prioritization:'priority',concurrent:'concurrency',atomicity:'atomic',transactions:'transaction'}));
function token(value) {
  const normalized = norm(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!normalized || STOP.has(normalized)) return '';
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
  return {terms, inferred};
}

function retrievalIndex(skills, activeText, experimental = false) {
  const {terms, inferred} = retrievalTerms(activeText, experimental);
  const documents = skills.map((skill) => {
    const identity = [skill.id, skill.nameZh, skill.name, ...list(skill.aliases)].join(' ');
    const description = [skill.summaryZh, skill.description, ...list(skill.triggers)].join(' ');
    return {identity: new Set(words(identity)), description: new Set(words(description))};
  });
  const df = new Map();
  for (const doc of documents) for (const term of new Set([...doc.identity, ...doc.description])) df.set(term, (df.get(term) || 0) + 1);
  return {terms, inferred, documents, df, corpusSize: skills.length, experimental};
}
const explicitName = (skill) => [skill.id, skill.nameZh, skill.name, ...list(skill.aliases)].filter(Boolean);

function queryClauses(query) {
  const raw = String(query || '');
  // Host plugin mentions are explicit names; preserve their surrounding clause
  // so quoted, future and negative uses still go through the scope filters.
  const mentions = raw.replace(/\[\$([\w.:-]+)\]\(app:\/\/[^\s)]+\)/g, ' $$$1 ');
  // Only unquote an identifier directly governed by a use verb. Quoted examples
  // and arbitrary code remain excluded; later clause checks still reject negation.
  const namedQuotes = mentions.replace(/((?:使用|调用|启用|采用|用|\bapply|\buse|\binvoke)\s*)[“"「『`]([$\p{L}\p{N}_.:-]+)[”"」』`]/giu, '$1$2');
  const withoutCode = namedQuotes.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, (_, inner) => /^\$[\p{L}\p{N}_.:-]+$/u.test(inner.trim()) ? inner.trim() : ' ');
  const withoutQuotes = withoutCode.replace(/[“"「『][^”"」』\n]*[”"」』]/g, ' ')
    .replace(/^\s*>.*$/gm, ' ');
  const clauses = withoutQuotes.split(/[。！？!?;；，,\n]+/).map((value) => value.trim()).filter(Boolean);
  const isFuture = (value) => /以后|将来|未来|后续|下一步|届时|日后|计划(?:再|之后)|eventually|later|future|subsequently/i.test(value);
  const isNegative = (value) => /不要|不得|禁止|别用|无需|不需要|避免|do not|don't|never|without/i.test(value);
  const active = clauses.flatMap((value) => {
    const usable = value.split(/(?:例如|比如|举例|示例|for example|e\.g\.)/i)[0];
    // A future time horizon inside a request to produce a plan is current work.
    const currentPlan = /^(?:(?:请你?|现在|本次|帮我|麻烦)\s*)*(?:(?:为|针对)未来.{0,25}(?:制定|编写|设计|准备)|(?:制定|编写|设计|准备)).*(?:计划|方案)/.test(usable)
      || /^(?:please\s+)?(?:write|create|prepare|design)\b.*\bplan\b/i.test(usable);
    const planning = currentPlan ? usable.replace(/(?:未来|后续)(?=.{0,35}(?:计划|方案))/g, '').replace(/\bfuture\b/gi, '') : usable;
    const beforeFuture = planning.split(/(?:以后|将来|未来|后续|下一步|届时|日后|eventually|later|future|subsequently)/i)[0];
    const beforeNegative = beforeFuture.split(/(?:不要|不得|禁止|别用|无需|不需要|避免|do not|don't|never|without)/i)[0];
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
  const readOnly = /只读|仅查看|不要修改|不得写入|read.only|review only/i.test(clauses.raw);
  const explicitSkills = list(taskContext.explicitSkills).filter((name) => lexicalScore(activeText, name));
  return {
    objective: taskContext.objective && lexicalScore(activeText, taskContext.objective) ? taskContext.objective : activeText.slice(0, 280),
    actions: statedActions,
    deliverables: statedDeliverables,
    domain: taskContext.domain && lexicalScore(activeText, taskContext.domain) ? taskContext.domain : null,
    explicitSkills,
    constraints: list(taskContext.constraints).filter((item) => lexicalScore(activeText, item)),
    complexity, taskType, complexityEvidence: unique(complexitySignals), development, complexDevelopment, selfContainedFunction, readOnly,
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
  const active = assessment.activeText;
  const names = explicitName(skill);
  // A plugin mention identifies its currently supplied runtime skills, not an
  // unrelated legacy skill which happens to share the package's name.
  if (skill.sourceId?.startsWith('plugin:')) names.push(skill.sourceId.slice(7));
  const explicit = names.some((name) => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const named = new RegExp(`(?:^|[\\s，,：:])\\$${escaped}(?=$|[\\s，,。.!！?？])`, 'i');
    const suffix = /[\p{Script=Han}]$/u.test(name) ? '' : '(?=$|[^a-z0-9_-])';
    const direct = new RegExp(`(?:使用|调用|启用|采用|用|apply|use|invoke)\\s*(?:\\$)?${escaped}${suffix}`, 'i');
    return named.test(active) || direct.test(active);
  });
  if (assessment.selfContainedFunction && !explicit) return {
    skill, score: 0, explicit: false, capability: inferCapability(skill), phase: inferSkillStage(skill),
    reasons: ['self-contained function; native baseline is sufficient'], availability: skillAvailability(skill, host, runtimeCapabilities), evidence: [],
  };
  const capability = inferCapability(skill);
  const phase = inferSkillStage(skill, capability);
  const triggerHits = list(skill.triggers).filter((term) => lexicalScore(active, term));
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
  const descriptionScore = lexicalHits.slice(0, 5).reduce((sum, hit) => sum + hit.weight, 0);
  const domain = assessment.domain;
  const domainMatch = domain && lexicalScore([description, ...list(skill.domains)].join(' '), domain);
  let score = (explicit ? 30 : 0) + Math.min(3, triggerHits.length) * 6 + descriptionScore + (domainMatch ? 3 : 0);
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
  const strongDescription = lexicalHits.length >= 2 && descriptionScore >= 7;
  if (!explicit && !triggerHits.length && !strongDescription && !domainMatch && !diagnosticNameMatch) score = 0;
  if (!explicit && !triggerHits.length && !domainMatch && score < 8) score = 0;
  if (score > 0) score += calibration?.adjustment || 0;
  const availability = skillAvailability(skill, host, runtimeCapabilities);
  if (!availability.discovered || !availability.readable || !availability.enabled || !availability.compatible) score = -100;
  const reasons = [];
  if (explicit) reasons.push('explicitly requested in active task');
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
  return {skill, score, explicit, capability, phase, reasons, availability, evidence};
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

function budgetFor(assessment, candidates) {
  const simple = assessment.complexity === 'simple';
  const cardLimit = simple ? 3 : 12;
  const ordinaryReadLimit = simple ? 1 : 3;
  const explicitCount = candidates.filter((item) => item.explicit).length;
  return {
    consultCardLimit: cardLimit,
    fullReadLimit: ordinaryReadLimit,
    softTokenLimit: 12_000,
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
    ? readFeedbackV4({host, taskType: assessment.taskType, contentHashes}, options.feedbackPolicy || {}, options.feedbackPath)
    : new Map();
  // New ranking remains opt-in until representative recall/precision gates pass.
  const retrieval = retrievalIndex(skills, assessment.activeText, options.retrievalProfile === 'experimental');
  let ranked = skills.map((skill, index) => scoreCandidate(skill, assessment, host, options.runtimeCapabilities, feedback.get(skill.id)?.byMode?.consult, retrieval, retrieval.documents[index]))
    .filter((item) => item.score > 0);
  const explicitProviders = new Set(ranked.filter(item => item.explicit && item.skill.sourceId?.startsWith('plugin:')).map(item => item.skill.sourceId.slice(7)));
  ranked = ranked.filter(item => item.skill.sourceId?.startsWith('plugin:') || !explicitName(item.skill).some(name => explicitProviders.has(name)));
  if (filters.source) ranked = ranked.filter((item) => item.skill.sourceId === filters.source || list(item.skill.origins).some((origin) => origin.sourceId === filters.source));
  if (filters.domain) ranked = ranked.filter((item) => lexicalScore([item.capability, item.skill.category, item.skill.summaryZh, ...list(item.skill.domains)].join(' '), filters.domain));
  if (filters.phase) ranked = ranked.filter((item) => item.phase === filters.phase);
  ranked.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
  if (assessment.complexity === 'simple' && ranked.length) {
    const floor = Math.max(8, ranked[0].score * 0.82);
    ranked = ranked.filter((item) => item.score >= floor || item.explicit || item.reasons.some((reason) => reason.startsWith('matched task signal:')));
  }
  const budget = budgetFor(assessment, ranked);
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? Math.min(filters.limit, 12) : budget.consultCardLimit;
  const explicitCandidates = ranked.filter(item => item.explicit);
  const selectedCards = [...explicitCandidates, ...ranked.filter(item => !item.explicit).slice(0, Math.max(0, limit - explicitCandidates.length))];
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

export function routeTaskV4(query, options = {}) { const result = advise(query, options); return options.responseDetail === 'compact' ? compactAdviceV4(result) : result; }
export function searchSkills(query, options = {}) {
  const result = advise(query, options, {source: options.source, domain: options.domain, phase: options.phase, limit: options.limit,followup:true});
  return options.responseDetail === 'compact' ? compactAdviceV4(result) : result;
}
export function formatAgentContextV4(result) {
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
