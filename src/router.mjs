import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CACHE_PATH, LOG_ROOT } from './paths.mjs';
import { loadRegistry, normalize, resolveAlias, validateRegistry } from './registry.mjs';
import { scanInputsChanged, synchronizeInstalledSkills } from './sync-installed-skills.mjs';
import { buildCoordinationPlan, compactCoordinationPlan } from './coordination-planner.mjs';
import { loadFeedbackCalibration } from './feedback.mjs';
import { ROUTER_VERSION } from './version.mjs';
import { canonicalHost } from './host-manifest.mjs';
import { taskText } from './task-input.mjs';
import { buildSemanticContext, scoreSemanticMatch } from './semantic-matcher.mjs';
import {
  capabilityActionCompatible,
  capabilityDirectlyRequested,
  futureOpportunity,
  inferCapability,
  makePortfolioItem,
  skillDomainCompatible,
} from './skill-staging.mjs';

let lastAutoSync = 0;
function autoSync() {
  if (Date.now() - lastAutoSync < 5_000) return;
  lastAutoSync = Date.now();
  try {
    if (scanInputsChanged()) synchronizeInstalledSkills({generateDashboard: true});
  }
  catch (error) { process.stderr.write(`[dynamic-skill-router] 自动同步失败: ${error.message}\n`); }
}

const GENERIC_SMALL_TALK = /^(你好|您好|嗨|hello|hi|谢谢|感谢|好的|可以|继续|收到|在吗|你是谁)[啊呀吗呢吧！!。.]?$/i;

function asciiWords(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function exactPhraseMatch(query, phrase) {
  const rawPhrase = String(phrase || '');
  if (!rawPhrase.trim()) return false;
  if (/[a-z0-9]/i.test(rawPhrase) && !/[\u3400-\u9fff]/u.test(rawPhrase)) {
    const haystack = ` ${asciiWords(query)} `;
    const needle = asciiWords(rawPhrase);
    return Boolean(needle) && haystack.includes(` ${needle} `);
  }
  return normalize(query).includes(normalize(rawPhrase));
}

function phraseScore(query, phrase) {
  if (!exactPhraseMatch(query, phrase)) return 0;
  const norm = normalize(phrase);
  return (normalize(query) === norm ? 28 : 10) + Math.min(8, Math.ceil(norm.length / 2));
}

function isExplicitActivation(query, alias) {
  const queryNorm = normalize(query);
  const aliasNorm = normalize(alias);
  if (!aliasNorm) return false;
  if (queryNorm === aliasNorm || String(query).includes(`$${alias}`)) return true;
  const index = queryNorm.indexOf(aliasNorm);
  if (index < 0) return false;
  const before = queryNorm.slice(Math.max(0, index - 12), index);
  const after = queryNorm.slice(index + aliasNorm.length, index + aliasNorm.length + 12);
  if (/不要(?:用|使用|调用|启用)$|不得(?:用|使用|调用|启用)$|禁止(?:用|使用|调用|启用)$|别(?:用|使用|调用|启用)$/.test(before)) return false;
  return /用|使用|调用|启用|采用|通过|让/.test(before)
    || /帮我|来|执行|处理|完成|生成|写|制作|运行/.test(after);
}

function isNegatedSkillMention(query, skill) {
  const queryNorm = normalize(query);
  for (const alias of [skill.id, skill.nameZh, ...(skill.aliases || [])]) {
    const aliasNorm = normalize(alias);
    if (!aliasNorm) continue;
    let index = queryNorm.indexOf(aliasNorm);
    while (index >= 0) {
      const before = queryNorm.slice(Math.max(0, index - 24), index);
      if (/(?:不要|不得|禁止|别)(?:用|使用|调用|启用)$|(?:donot|dont|never|avoid)(?:use|using|call|calling|invoke|invoking|activate|activating)?$/.test(before)) return true;
      index = queryNorm.indexOf(aliasNorm, index + aliasNorm.length);
    }
  }
  return false;
}

function explicitMentions(query, registry) {
  const matches = [];
  for (const skill of registry.skills) {
    for (const alias of [skill.id, skill.nameZh, ...(skill.aliases || [])]) {
      const aliasNorm = normalize(alias);
      if (aliasNorm.length >= 2 && exactPhraseMatch(query, alias) && isExplicitActivation(query, alias)) {
        matches.push({skill, alias});
        break;
      }
    }
  }
  return matches.filter((item) => !matches.some((other) => other.skill.id !== item.skill.id
    && normalize(other.alias).length > normalize(item.alias).length
    && normalize(other.alias).includes(normalize(item.alias))));
}

export function scoreSkill(query, skill, explicit, host = 'generic', feedback = new Map(), semanticContext = null) {
  let score = explicit ? 100 : 0;
  const reasons = [];
  if (explicit) reasons.push(`明确提到“${explicit.alias}”`);
  if (isNegatedSkillMention(query, skill)) {
    return {skill, score: -1000, reasons: ['用户明确要求不要调用该技能'], explicit: false};
  }
  if (!explicit && !skillDomainCompatible(skill, query)) {
    return {skill, score: -1000, relevanceScore: -1000, reasons: ['任务领域或动作不匹配，保留原生能力'], explicit: false};
  }
  const hostStatus = skill.hostCompatibility?.[host];
  if (host !== 'generic' && (hostStatus === 'unsupported' || hostStatus === 'degraded')) {
    return {skill, score: -1000, reasons: [`当前宿主 ${host} 的能力状态为 ${hostStatus}`], explicit: Boolean(explicit)};
  }
  if (host !== 'generic' && Array.isArray(skill.compatibleHosts) && !skill.compatibleHosts.includes(host)) {
    return {skill, score: -1000, reasons: [`当前宿主 ${host} 不兼容`], explicit: Boolean(explicit)};
  }
  const calibration = feedback.get(skill.id);
  if (calibration?.adjustment) {
    score += calibration.adjustment;
    reasons.push(`历史反馈校准 ${calibration.adjustment > 0 ? '+' : ''}${calibration.adjustment}`);
  }
  if (skill.status === 'degraded' || skill.status === 'unsupported') {
    return {skill, score: -1000, reasons: [`技能状态为 ${skill.status}，已通过能力门阻止调用`], explicit: Boolean(explicit)};
  }
  const semantic = semanticContext
    ? scoreSemanticMatch(skill, semanticContext)
    : {score: 0, strong: false, reasons: []};
  let bestTrigger = null;
  for (const phrase of skill.triggers || []) {
    const value = phraseScore(query, phrase);
    if (value > 0 && (!bestTrigger || value > bestTrigger.value)) bestTrigger = {phrase, value};
  }
  if (bestTrigger) {
    score += bestTrigger.value;
    if (reasons.length < 3) reasons.push(`匹配任务信号“${bestTrigger.phrase}”`);
  }
  if (semantic.score > 0) {
    score += semantic.score;
    for (const reason of semantic.reasons) if (reasons.length < 4) reasons.push(reason);
  }
  for (const phrase of skill.negative || []) {
    const value = phraseScore(query, phrase);
    if (value > 0) {
      score -= Math.max(14, value);
      reasons.push(`存在排除信号“${phrase}”`);
    }
  }
  const relevanceScore = score;
  // Explicit-only skills may still be activated by strong semantic evidence.
  // This opens safe, well-described skills without letting weak similarities
  // make all 300+ skills compete on every request.
  const allowSemanticImplicit = semanticContext?.policy?.allowSafeUncurated !== false
    && skill.status === 'ready'
    && (skill.risk || 'low') === 'low'
    && semantic.strong;
  if (!skill.implicit && !explicit && !allowSemanticImplicit) score -= 100;
  if (skill.status === 'needs-config' && !explicit) score -= 3;
  return {
    skill,
    score,
    relevanceScore,
    reasons,
    explicit: Boolean(explicit),
    triggerMatch: bestTrigger?.phrase || null,
    matchMode: explicit ? 'explicit' : bestTrigger ? 'trigger' : allowSemanticImplicit || semantic.score > 0 ? 'semantic' : 'none',
    semantic,
  };
}

function hardCompatible(left, right) {
  if (!left || !right || left.skill.id === right.skill.id) return false;
  if (left.skill.compositionMode === 'exclusive' || right.skill.compositionMode === 'exclusive') return false;
  if ((left.skill.conflictsWith || []).includes(right.skill.id) || (right.skill.conflictsWith || []).includes(left.skill.id)) return false;
  if ((left.skill.supersedes || []).includes(right.skill.id) || (right.skill.supersedes || []).includes(left.skill.id)) return false;
  return true;
}

function canCompose(primary, candidate, query, selected = [], effectiveScore = candidate.relevanceScore ?? candidate.score, supportThreshold = 8) {
  if (!primary || primary.skill.id === candidate.skill.id) return false;
  if (!hardCompatible(primary, candidate)) return false;
  const primaryCapability = inferCapability(primary.skill);
  const candidateCapability = inferCapability(candidate.skill);
  if (selected.some((item) => item.capability === candidateCapability)) return false;
  if (primary.skill.family === candidate.skill.family && primaryCapability === candidateCapability) return false;
  if (!capabilityActionCompatible(candidateCapability, query)) return false;
  if (primaryCapability === 'motion' && candidateCapability === 'frontend-implementation'
      && !/完整|从零|网页应用|完整页面|开发网站|开发网页/i.test(query)) return false;
  if (primaryCapability === 'asset-analysis' && ['prompt-engineering', 'motion', 'video-production', 'image-production'].includes(candidateCapability)) return false;
  if (primary.skill.id === 'impeccable' && ['accessibility', 'performance'].includes(candidateCapability)
      && !/专项|单独|wcag|core web vitals|lcp|inp|cls|page speed/i.test(query)) return false;
  if (candidateCapability === 'deployment'
      && !/(?:立即|现在|直接|马上).{0,10}(?:部署|上线|发布)|(?:部署|上线|发布).{0,10}(?:到|至|生产环境|预览环境|edgeone|cloudflare|vercel)/i.test(query)) return false;
  const ids = new Set([primary.skill.id, candidate.skill.id]);
  const q = normalize(query);
  const primaryRole = primary.skill.role || primary.skill.compositionRole;
  const candidateRole = candidate.skill.role || candidate.skill.compositionRole;
  if ((primaryRole === 'workflow_owner' || primaryRole === 'owner' || primaryRole === 'specialist')
      && (candidateRole === 'verifier' || candidateRole === 'validator')
      && /核验|验证|统计|引用|审查|检查/.test(q)) return true;
  if (new Set([primaryRole, candidateRole]).has('orchestrator') && /并行|多agent|多智能体|分工|agent团队/.test(q)) return true;
  if (ids.has('frontend-dev') && /设计|ui|ux|动效|动画|落地页|作品集|高级感|视觉/.test(q)) return true;
  if (ids.has('wechat-official-article-designer') && /文档|word|pdf|ppt|提取/.test(q)) return true;
  if (ids.has('web-scraper') && ids.has('playwright') && /动态|登录|点击|渲染/.test(q)) return true;
  if (ids.has('web-access') && ids.has('web-scraper') && /登录|批量|动态/.test(q)) return true;
  const direct = candidate.explicit || candidate.triggerMatch
    || capabilityDirectlyRequested(candidateCapability, query, primaryCapability);
  if (!direct) return false;
  return candidate.semantic?.strong || effectiveScore >= supportThreshold;
}

function potentialCandidates(query, primary, selected, ranked, policy = {}) {
  const maxPotential = policy.maxPotential ?? 8;
  const potentialThreshold = policy.potentialThreshold ?? 5.5;
  const selectedIds = new Set(selected.map((item) => item.id));
  const usedCapabilities = new Set(selected.map((item) => item.capability));
  const scored = ranked.map((candidate) => {
    const opportunity = futureOpportunity(candidate, query);
    const base = candidate.relevanceScore ?? candidate.score;
    return {candidate, opportunity, portfolioScore: base + opportunity.score};
  }).sort((a, b) => b.portfolioScore - a.portfolioScore
    || (b.candidate.skill.routingPriority ?? 0) - (a.candidate.skill.routingPriority ?? 0)
    || a.candidate.skill.id.localeCompare(b.candidate.skill.id));
  const potential = [];
  const tryAdd = (item) => {
    if (potential.length >= maxPotential) return;
    const {candidate, opportunity, portfolioScore} = item;
    if (selectedIds.has(candidate.skill.id) || potential.some((entry) => entry.id === candidate.skill.id) || candidate.score <= -900) return;
    if (candidate.skill.status !== 'ready') return;
    if ((candidate.skill.risk || 'low') !== 'low' && !candidate.skill.implicit && !candidate.explicit) return;
    if (portfolioScore < potentialThreshold) return;
    const capability = inferCapability(candidate.skill);
    if (capability === 'general' || usedCapabilities.has(capability)) return;
    if (!skillDomainCompatible(candidate.skill, query)) return;
    if (!capabilityActionCompatible(capability, query) && opportunity.score <= 0) return;
    if (primary && !hardCompatible(primary, candidate)) return;
    if (potential.some((entry) => !hardCompatible({skill: entry._skill}, candidate))) return;
    const hasEvidence = candidate.explicit || candidate.triggerMatch || candidate.semantic?.score > 0 || opportunity.score > 0;
    if (!hasEvidence) return;
    const portfolioItem = makePortfolioItem(candidate, 'potential', 'potential', query, opportunity);
    potential.push({...portfolioItem, _skill: candidate.skill});
    usedCapabilities.add(capability);
  };
  // Preserve independent verification as a high-value future gate before
  // filling the remaining pool with optional design and delivery enhancements.
  for (const item of scored.filter(({candidate, opportunity}) => inferCapability(candidate.skill) === 'verification' && opportunity.score > 0)) tryAdd(item);
  for (const item of scored) tryAdd(item);
  if (!usedCapabilities.has('verification') && policy.requireVerifierSkill === true) {
    const verifier = scored.find(({candidate, opportunity}) => inferCapability(candidate.skill) === 'verification'
      && opportunity.score > 0 && candidate.score > -900 && candidate.skill.status === 'ready'
      && skillDomainCompatible(candidate.skill, query)
      && (!primary || hardCompatible(primary, candidate)));
    if (verifier) {
      const entry = makePortfolioItem(verifier.candidate, 'potential', 'potential', query, verifier.opportunity);
      potential.unshift({...entry, _skill: verifier.candidate.skill});
      usedCapabilities.add('verification');
      if (potential.length > maxPotential) potential.pop();
    }
  }
  return potential.map(({_skill, ...item}) => item);
}

function ensurePotentialCapability(query, capability, primary, selected, potential, ranked, policy = {}) {
  if ([...selected, ...potential].some((item) => item.capability === capability)) return potential;
  const eligible = ranked.map((candidate) => ({candidate, opportunity: futureOpportunity(candidate, query)}))
    .filter(({candidate, opportunity}) => inferCapability(candidate.skill) === capability
      && opportunity.score > 0
      && candidate.score > -900
      && candidate.skill.status === 'ready'
      && skillDomainCompatible(candidate.skill, query)
      && (!primary || hardCompatible(primary, candidate)))
    .sort((a, b) => (b.candidate.relevanceScore + b.opportunity.score) - (a.candidate.relevanceScore + a.opportunity.score)
      || (b.candidate.skill.routingPriority ?? 0) - (a.candidate.skill.routingPriority ?? 0));
  if (!eligible.length) return potential;
  const entry = makePortfolioItem(eligible[0].candidate, 'potential', 'potential', query, eligible[0].opportunity);
  return [entry, ...potential].slice(0, policy.maxPotential ?? 8);
}

export function routeTask(query, options = {}) {
  const startedAt = performance.now();
  const originalQuery = String(query || '').trim();
  const text = taskText(originalQuery);
  const strictReadOnly = /只读|不得修改|不要修改|不修改|不要改动|不得写入/i.test(text);
  const routeOptions = {...options, originalQuery, host: canonicalHost(options.host)};
  if (strictReadOnly && options.writeLog === undefined) routeOptions.writeLog = false;
  // Routing reads the index. Synchronization is an explicit maintenance action.
  if (!options.registry && options.autoSync === true && !strictReadOnly) autoSync();
  const registry = options.registry || loadRegistry();
  const validation = validateRegistry(registry);
  if (!validation.ok) throw new Error(`技能注册表无效: ${validation.errors.join('; ')}`);
  if (!text || GENERIC_SMALL_TALK.test(text)) return finalize(text, 'NO_SKILL', [], [], [], registry, routeOptions, '任务不需要专门技能', startedAt);

  const explicit = explicitMentions(text, registry);
  const explicitMap = new Map(explicit.map((item) => [item.skill.id, item]));
  const feedback = registry.policy.feedbackCalibration?.enabled === false || routeOptions.useFeedback === false
    ? new Map()
    : loadFeedbackCalibration(registry.policy.feedbackCalibration);
  const semanticContext = buildSemanticContext(text, registry, registry.policy.semanticRouting || {});
  const ranked = registry.skills.map((skill) => scoreSkill(text, skill, explicitMap.get(skill.id), routeOptions.host, feedback, semanticContext))
    .sort((a, b) => b.score - a.score || (b.skill.routingPriority ?? 0) - (a.skill.routingPriority ?? 0) || a.skill.id.localeCompare(b.skill.id));
  const selectionThreshold = registry.policy.selectionThreshold ?? 9;
  for (const mention of explicit) {
    const hostState = mention.skill.hostCompatibility?.[routeOptions.host];
    const blocked = mention.skill.status === 'degraded' || mention.skill.status === 'unsupported' || hostState === 'degraded' || hostState === 'unsupported';
    if (!blocked || !mention.skill.fallbackSkillId) continue;
    const fallback = ranked.find((candidate) => candidate.skill.id === mention.skill.fallbackSkillId);
    if (fallback) {
      fallback.score = Math.max(fallback.score, selectionThreshold + 5);
      fallback.reasons.unshift(`“${mention.skill.id}”不可用，回退到兼容技能`);
    }
  }
  ranked.sort((a, b) => b.score - a.score || (b.skill.routingPriority ?? 0) - (a.skill.routingPriority ?? 0) || a.skill.id.localeCompare(b.skill.id));
  // When a task contains both production/review work and a check, keep the
  // validator independent instead of letting it become the workflow owner.
  const nonOwnerRoles = new Set(['verifier', 'validator', 'orchestrator', 'reference']);
  const primary = ranked.find((candidate) => candidate.score >= selectionThreshold && !nonOwnerRoles.has(candidate.skill.role || candidate.skill.compositionRole))
    || ranked.find((candidate) => candidate.score >= selectionThreshold);
  if (!primary) {
    const potential = potentialCandidates(text, null, [], ranked, registry.policy);
    const explanation = potential.length
      ? '没有技能需要立即启动，已记录后续可能有用的高质量候选'
      : '没有候选技能达到立即执行或潜在候选阈值';
    return finalize(text, 'NO_SKILL', [], potential, ranked, registry, routeOptions, explanation, startedAt);
  }

  const selected = [makePortfolioItem(primary, 'primary', 'core', text)];
  const supportThreshold = registry.policy.supportThreshold ?? 8;
  const supportRanked = ranked.map((candidate) => {
    const opportunity = futureOpportunity(candidate, text);
    return {candidate, opportunity, effectiveScore: (candidate.relevanceScore ?? candidate.score) + opportunity.score};
  }).sort((a, b) => b.effectiveScore - a.effectiveScore
    || (b.candidate.skill.routingPriority ?? 0) - (a.candidate.skill.routingPriority ?? 0)
    || a.candidate.skill.id.localeCompare(b.candidate.skill.id));
  for (const {candidate, opportunity, effectiveScore} of supportRanked) {
    if (selected.length >= 1 + (registry.policy.maxSupport ?? 4)) break;
    if (candidate.score <= -900 || candidate.skill.status !== 'ready') continue;
    if ((candidate.skill.risk || 'low') !== 'low' && !candidate.skill.implicit && !candidate.explicit) continue;
    if (effectiveScore < supportThreshold || !canCompose(primary, candidate, text, selected, effectiveScore, supportThreshold)) continue;
    const selectedIds = new Set(selected.map((item) => item.id));
    const normalizedQuery = normalize(text);
    if (candidate.skill.id === 'web-access' && selectedIds.has('playwright') && !/登录态|我的浏览器|保留登录态|小红书|微博/.test(normalizedQuery)) continue;
    if (candidate.skill.id === 'playwright' && selectedIds.has('web-access') && !/填表|测试|e2e|截图|点击/.test(normalizedQuery)) continue;
    selected.push(makePortfolioItem(candidate, 'support', 'support', text, opportunity));
  }
  let potential = potentialCandidates(text, primary, selected, ranked, registry.policy);
  if (registry.policy.requireVerifierSkill === true) potential = ensurePotentialCapability(text, 'verification', primary, selected, potential, ranked, registry.policy);
  const explanation = potential.length
    ? '已选择立即执行技能，并记录可在后续阶段按条件激活的潜在技能'
    : '已选择覆盖当前任务所需阶段的技能组合';
  return finalize(text, selected.length > 1 ? 'COMPOSED' : 'ONE_SKILL', selected, potential, ranked, registry, routeOptions, explanation, startedAt);
}

function finalize(query, decision, selected, potential, ranked, registry, options, explanation, startedAt) {
  // A small, phase-local skill set protects model autonomy and startup context.
  const policy = registry.policy.nativeFirst || {};
  if (policy.enabled !== false) {
    const maxActive = policy.maxActive ?? 2;
    const budget = policy.skillTokenBudget ?? 8000;
    let tokens = 0;
    const active = [];
    const deferred = [];
    const firstPhase = selected[0]?.phase;
    for (const item of selected) {
      const explicit = item.matchMode === 'explicit';
      const fits = active.length < maxActive && tokens + item.estimatedTokens <= budget;
      const currentPhase = item.phase === firstPhase || item.capability === 'orchestration';
      if (explicit || item.role === 'primary' || (fits && currentPhase)) {
        active.push(item);
        tokens += item.estimatedTokens;
      } else {
        deferred.push({...item, tier: 'potential', role: 'potential', deferredFromActive: true,
          activationCondition: `任务确实需要“${item.responsibility}”，进入 ${item.phase} 阶段时再评估并完整读取`,
          reason: `${item.reason}；按阶段或上下文预算延迟加载`});
      }
    }
    selected = active;
    const candidates = [...deferred, ...potential].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
    const required = candidates.filter((item) => item.deferredFromActive || item.directlyRequested);
    const optional = candidates.filter((item) => !item.deferredFromActive && !item.directlyRequested);
    potential = [...required, ...optional.slice(0, Math.max(0, (policy.maxPotential ?? 3) - required.length))];
    decision = selected.length > 1 ? 'COMPOSED' : selected.length ? 'ONE_SKILL' : 'NO_SKILL';
    explanation = selected.length ? '原生能力优先；只启动当前阶段有明确用途的技能，其余按条件加载' : '使用原生能力启动；仅在实际需要专长时加载候选';
  }
  const retainedIds = new Set([...selected, ...potential].map((item) => item.id));
  const rejected = (ranked || []).filter((item) => !retainedIds.has(item.skill.id)).slice(0, 12).map((item) => ({
    id: item.skill.id,
    nameZh: item.skill.nameZh,
    score: Math.round(item.score * 10) / 10,
    reason: item.score < 0 ? '被排除词、显式调用限制或依赖状态降权' : '相关度不足或已有同类技能更合适',
  }));
  const coordination = buildCoordinationPlan(query, selected, {
    potential,
    host: options.host || 'generic',
    qualityProfile: options.qualityProfile,
    defaultQualityProfile: registry.policy.coordination?.defaultProfile,
    availableAgentSlots: options.availableAgentSlots ?? registry.policy.coordination?.maxAgentSlots,
    availableModels: options.availableModels,
    currentModel: options.currentModel,
    parallelAgents: options.parallelAgents,
    modelOverride: options.modelOverride,
    maxLoadedSkills: registry.policy.coordination?.maxLoadedSkills,
  });
  const result = {
    routeId: randomUUID(),
    routerVersion: ROUTER_VERSION,
    registryRevision: registry.registryRevision || null,
    timestamp: new Date().toISOString(),
    query: options.originalQuery ?? query,
    taskQuery: query,
    decision,
    selected,
    potential,
    explanation,
    rejected,
    coordination,
    metrics: {
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
      candidates: registry.skills.length,
      activeSkills: selected.length,
      potentialSkills: potential.length,
      selectedSkillTokens: coordination.tokenPlan.selectedSkillTokens,
    },
    policy: registry.policy,
  };
  if (options.writeLog !== false) writeRouteLog(result);
  return result;
}

export function compactRouteResult(result) {
  const includeCoordination = result.decision !== 'NO_SKILL'
    || result.potential.length > 0
    || result.coordination.mode !== 'single-agent'
    || result.coordination.profile !== 'balanced';
  return {
    decision: result.decision,
    task: result.coordination.task,
    selected: result.selected.map(({role, tier, id, nameZh, reason, path: skillPath, status, matchMode, phase, capability, responsibility, activationCondition}) => ({role, tier, id, nameZh, reason, path: skillPath, status, matchMode, phase, capability, responsibility, activationCondition})),
    potential: result.potential.map(({tier, id, nameZh, reason, path: skillPath, status, matchMode, phase, capability, responsibility, activationCondition, confidence}) => ({tier, id, nameZh, reason, path: skillPath, status, matchMode, phase, capability, responsibility, activationCondition, confidence})),
    explanation: result.explanation,
    routeId: result.routeId,
    registryRevision: result.registryRevision,
    coordination: includeCoordination ? compactCoordinationPlan(result.coordination) : undefined,
    metrics: result.metrics,
  };
}

export function formatAgentContext(result) {
  const needsCoordinationHint = result.coordination.mode !== 'single-agent' || result.coordination.profile !== 'balanced';
  const tierPath = result.coordination.modelPlan.map((item) => item.tier).join('→');
  const coordinationHint = needsCoordinationHint
    ? `\n[协作建议] 复杂度 ${result.coordination.task.complexity}；${result.coordination.mode}；总槽位 ${result.coordination.maxConcurrentAgents} 含主 Agent。复杂开发有独立工作时必须原生协作；主模型保持，按 ${tierPath} 选择可用子模型。先用 plan_agents 检查具体工作项，再派发并持续推进主线。`
    : '';
  if (result.decision === 'NO_SKILL' && !result.potential.length) return `[动态技能路由器] NO_SKILL；复杂度 ${result.coordination.task.complexity}：原生能力执行，不加载个人技能。${coordinationHint}`;
  const activeLines = result.selected.map((item) => `- ${item.role === 'primary' ? '主' : '辅'}：${item.nameZh}(${item.id})｜${item.phase}｜${item.responsibility}｜${item.reason}｜${path.join(item.path, 'SKILL.md')}`);
  const potentialLines = result.potential.map((item) => `- 候选：${item.nameZh}(${item.id})｜${item.phase}｜触发：${item.activationCondition}｜${item.reason}｜${path.join(item.path, 'SKILL.md')}`);
  const phaseLines = result.coordination.phasePlan.map((phase, index) => {
    const active = phase.activeSkills.length ? phase.activeSkills.join(',') : '无';
    const candidates = phase.potentialSkills.length ? phase.potentialSkills.join(',') : '无';
    return `${index + 1}. ${phase.phase}：立即[${active}]；候选[${candidates}]；完成门：${phase.exitCondition}`;
  });
  return [
    '[动态技能路由器]',
    result.decision === 'NO_SKILL' ? '当前没有立即技能；保留以下潜在候选。' : '立即启用技能：',
    ...activeLines,
    ...(potentialLines.length ? ['潜在技能（记录但暂不加载）：', ...potentialLines] : []),
    '技能协同阶段：',
    ...phaseLines,
    `先核对任务领域与动作，再在实际使用前完整读取适用技能；误匹配可跳过并说明。潜在技能只在领域与触发条件都满足时升级，不预加载。同一任务不重复路由。${coordinationHint}`,
  ].join('\n');
}

export function writeRouteLog(result) {
  fs.mkdirSync(LOG_ROOT, {recursive: true});
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const day = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(path.join(LOG_ROOT, `${day}.jsonl`), `${JSON.stringify(result)}\n`, 'utf8');
}

export function getSkillByAlias(name) { return resolveAlias(name); }
