import fs from 'node:fs';
import path from 'node:path';
import { getHostProfile, loadHostManifest } from './host-manifest.mjs';
import { PIPELINE_STAGES, stageRank } from './skill-staging.mjs';

const QUALITY_PROFILES = {
  economy: {skillContextBudget: 8000, defaultTier: 'fast', maxAgents: 2},
  balanced: {skillContextBudget: 20000, defaultTier: 'balanced', maxAgents: 4},
  quality: {skillContextBudget: 60000, defaultTier: 'frontier', maxAgents: 4},
};

export function estimateTokens(text = '') {
  const value = String(text);
  const cjk = (value.match(/[\u3400-\u9fff]/gu) || []).length;
  const other = Math.max(0, value.length - cjk);
  return Math.max(1, Math.ceil(cjk / 1.5 + other / 4));
}

export function estimateSkillTokens(skill) {
  if (Number.isFinite(skill?.estimatedTokens)) return skill.estimatedTokens;
  try { return estimateTokens(fs.readFileSync(path.join(skill.path, 'SKILL.md'), 'utf8')); }
  catch { return 0; }
}

export function inferQualityProfile(query, requested, fallback = 'balanced') {
  if (QUALITY_PROFILES[requested]) return requested;
  if (/省\s*token|节省\s*token|低成本|快速完成|先做个简版|经济模式/i.test(query)) return 'economy';
  if (/最高质量|最佳方案|严格审查|高风险|生产环境|长期方案|电影级|发表级/i.test(query)) return 'quality';
  return QUALITY_PROFILES[fallback] ? fallback : 'balanced';
}

function classifyComplexity(query) {
  const text = String(query);
  const explanationOnly = /^(?:请(?:你)?|帮我)?\s*(?:解释|什么是|介绍一下|说明.{0,4}含义|explain|what is|define)/i.test(text)
    && !/实现|修复|修改|重构|迁移|部署|develop|implement|refactor|fix/i.test(text);
  if (explanationOnly) return {level: 'low', signals: ['explanation-only'], development: false, complexDevelopment: false};
  const development = /实现|开发|构建|编写|修复|重构|迁移|升级|集成|改造|搭建|新增|设计并实现|build|implement|develop|refactor|migrat/i.test(text);
  const systemic = /系统性|全流程|端到端|完整(?:应用|系统|平台|产品)|生产级|架构|跨(?:模块|工具|仓库|服务|系统|平台)|多个模块|多模块|分布式|前后端|数据库.{0,12}(?:部署|认证|前端|后端)|认证.{0,12}(?:数据库|部署)|重构.{0,16}(?:系统|架构|多个|跨)|迁移.{0,16}(?:系统|架构|数据库|平台)|architecture|(?:cross|across)[\s-]*(?:module|service|repository|system)|distributed|end[\s-]*to[\s-]*end|production[\s-]*grade|full[\s-]*stack|database.{0,24}(?:deploy|auth)/i.test(text);
  const coordination = /并行|多\s*agent|多智能体|agent\s*团队|分工|独立审查|多个代理|multi[\s-]*agents?|multiple\s+agents?/i.test(text);
  const investigation = /深度研究|系统审查|全面审计|根因分析|多源核验|文献综述|安全审计/i.test(text);
  const signals = [];
  if (development) signals.push('development');
  if (systemic) signals.push('systemic-scope');
  if (coordination) signals.push('coordination');
  if (investigation) signals.push('deep-investigation');

  let level = 'low';
  if (systemic || investigation || (development && coordination)) level = 'high';
  else if (development || /审查|研究|分析|设计|验证|测试|诊断|规划|review|research|analys|design|test|diagnos/i.test(text)) level = 'medium';

  return {level, signals, development, complexDevelopment: level === 'high' && development};
}

function classifyRisk(query, selected) {
  const scopes = new Set(selected.map((item) => item.mutationScope).filter(Boolean));
  const effectiveQuery = query.replace(/只读|不得修改|不要修改|不修改|不要改动|不得写入/gi, '');
  if (/删除|覆盖|清空|合并代码|合并分支|合并pr|合并这个|合并变更|合并到|推送|发布|部署|生产环境|密钥|支付|权限|安全漏洞/i.test(effectiveQuery)
      || scopes.has('external_write') || scopes.has('merge')) return 'high';
  if (/修改|编辑|安装|升级|写入|提交/i.test(effectiveQuery) || scopes.has('workspace_write')) return 'medium';
  return 'low';
}

function normalizeAvailableModels(value, hostProfile) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(hostProfile.availableModels) ? hostProfile.availableModels : Object.values(hostProfile.models || {});
  return {
    models: [...new Set(source.filter((item) => typeof item === 'string' && item))],
    known: Array.isArray(value) || Array.isArray(hostProfile.availableModels),
  };
}

function resolveDispatchModel(preferredModel, environment) {
  const {availableModels, availabilityKnown, modelOverride} = environment;
  const advertised = !availabilityKnown || availableModels.includes(preferredModel);
  const model = modelOverride && advertised ? preferredModel : null;
  return {
    preferredModel,
    model,
    validateAtDispatch: true,
    fallback: 'inherit-parent',
    fallbackWhen: !modelOverride ? 'model-override-unavailable' : !advertised ? 'preferred-model-unavailable' : 'dispatch-validation-failed',
  };
}

function modelStep(role, tier, preferredModel, environment, reasoning, objective, extra = {}) {
  return {role, tier, ...resolveDispatchModel(preferredModel, environment), reasoning, objective, ...extra};
}

function workItem({id, role, phase, dependsOn = [], mutationScope, goal, acceptance, contextCapsule, escalation, model}) {
  return {
    status: 'template',
    id,
    role,
    phase,
    parallelGroup: null,
    dependsOn,
    mutationScope,
    goal,
    domain: null,
    files: {
      owner: id,
      allowed: [],
      forbidden: mutationScope === 'read_only' ? ['任何文件写入'] : ['其他工作项已拥有的文件'],
      pendingAssignment: mutationScope !== 'read_only',
    },
    acceptance,
    contextCapsule,
    escalation: {
      triggers: escalation,
      action: '停止扩大范围，把证据、未决问题和建议交回 main 决策',
    },
    dispatch: model,
    requiresMaterialization: ['domain', ...(mutationScope === 'read_only' ? [] : ['files.allowed']), 'acceptance'],
  };
}

function buildAgentPlan({mode, readOnly, complexity, slotLimit, models}) {
  const main = workItem({
    id: 'main',
    role: readOnly ? 'analyst-reviewer' : 'owner-integrator',
    phase: readOnly ? 'analysis+integration' : 'architecture+implementation+integration',
    mutationScope: readOnly ? 'read_only' : 'task-scope',
    goal: readOnly
      ? '确定问题边界、综合证据并对最终结论负责'
      : '拥有架构与集成，并亲自完成至少一个有意义的实现切片',
    acceptance: readOnly
      ? ['结论与证据可追溯', '所有委派发现已被主 Agent 复核和整合']
      : ['架构决策和接口边界明确', '主 Agent 完成一个可验证的核心实现切片', '所有工作项集成后形成完整增量'],
    contextCapsule: ['用户目标与明确约束', '当前系统边界与相关文件', '子工作项回传的证据和变更摘要'],
    escalation: ['工作项边界冲突', '需要扩大用户授权范围', '关键架构假设无法验证'],
    model: {
      preferredModel: models.architect,
      model: models.current,
      validateAtDispatch: false,
      fallback: 'keep-current-root-model',
      advisory: 'Astra 适合作为新主任务的首选；运行中的主 Agent 不切换模型',
    },
  });
  if (mode === 'single-agent') return [main];

  const reviewer = workItem({
    id: 'reviewer',
    role: 'independent-reviewer',
    phase: 'verification',
    dependsOn: readOnly ? ['main'] : mode === 'parallel-staged' ? ['executor-complex'] : ['main'],
    mutationScope: 'read_only',
    goal: '独立检查需求覆盖、证据、边界和未决风险',
    acceptance: ['复核与本次变更相称的检查证据', '指出具体遗漏或明确记录无未决高风险'],
    contextCapsule: ['用户验收目标', '变更摘要或分析结论', '已运行的定向检查及结果'],
    escalation: ['发现未决高风险', '验收证据不足', '实现超出约定文件边界'],
    model: resolveDispatchModel(models.reviewer, models.environment),
  });

  if (mode === 'review-pair') return [main, reviewer];
  if (readOnly) {
    const lookupCount = Math.max(1, Math.min(2, slotLimit - 1));
    const lookups = Array.from({length: lookupCount}, (_, index) => workItem({
      id: `lookup-${index + 1}`,
      role: 'bounded-evidence-explorer',
      phase: 'discovery',
      mutationScope: 'read_only',
      goal: '在互不重叠的证据范围内完成只读查找并回传引用',
      acceptance: ['只返回与分配问题直接相关的证据', '标明来源、限制和不确定性'],
      contextCapsule: ['一个明确的查找问题', '允许访问的来源范围', '期望的证据格式'],
      escalation: ['证据范围重叠', '需要写入或外部副作用', '来源不可访问'],
      model: resolveDispatchModel(models.lookup, models.environment),
    }));
    reviewer.dependsOn = ['main', ...lookups.map((item) => item.id)];
    lookups.forEach((item) => { item.parallelGroup = 'read-only-discovery'; });
    return [main, ...lookups, reviewer];
  }

  const executors = [];
  const complexExecutor = workItem({
    id: 'executor-complex',
    role: 'bounded-complex-executor',
    phase: 'implementation',
    dependsOn: ['main'],
    mutationScope: 'single-owner-files',
    goal: complexity.complexDevelopment
      ? '在主 Agent 定义的接口内完成一个复杂且可独立验收的实现工作项'
      : '完成最需要深入推理的有界实现工作项',
    acceptance: ['仅修改拥有的文件范围', '交付完整实现、定向检查证据和集成说明'],
    contextCapsule: ['冻结的接口与架构决策', '唯一文件所有权', '工作项验收标准与相关现有代码'],
    escalation: ['需要改变架构或公共接口', '发现跨工作项文件依赖', '验证失败且原因超出工作项'],
    model: resolveDispatchModel(models.complexExecutor, models.environment),
  });
  complexExecutor.parallelGroup = 'discovery';
  complexExecutor.executionParallelGroup = 'non-overlapping-implementation';
  executors.push(complexExecutor);

  if (slotLimit >= 3) {
    const routineExecutor = workItem({
      id: 'executor-routine',
      role: 'bounded-routine-executor',
      phase: 'implementation',
      dependsOn: ['main'],
      mutationScope: 'single-owner-files',
      goal: '完成接口稳定、风险较低的常规实现或机械性适配',
      acceptance: ['仅修改拥有的文件范围', '完成分配实现并提供最小充分的定向检查'],
      contextCapsule: ['稳定接口', '唯一文件所有权', '明确输入、输出和验收示例'],
      escalation: ['任务需要架构判断', '发现隐含跨模块耦合', '分配范围无法单独验证'],
      model: resolveDispatchModel(models.routineExecutor, models.environment),
    });
    routineExecutor.parallelGroup = 'discovery';
    routineExecutor.executionParallelGroup = 'non-overlapping-implementation';
    executors.push(routineExecutor);
  }
  reviewer.dependsOn = executors.map((item) => item.id);
  main.integrationDependsOn = ['reviewer'];
  return [main, ...executors, reviewer];
}

export function buildCoordinationPlan(query, selected = [], options = {}) {
  const hostProfile = getHostProfile(options.host);
  const host = hostProfile.id;
  const complexity = classifyComplexity(query);
  let profileName = inferQualityProfile(query, options.qualityProfile, options.defaultQualityProfile);
  if (!options.qualityProfile && complexity.complexDevelopment && profileName === 'economy' && !/经济模式/i.test(query)) {
    profileName = 'balanced';
  }
  let profile = QUALITY_PROFILES[profileName];
  const risk = classifyRisk(query, selected);
  const readOnly = /只读|不得修改|不要修改|不修改|不要改动|不得写入/i.test(query);
  const explicitParallel = /并行|多\s*agent|多智能体|分工|多个\s*agent|agent\s*团队|multi[\s-]*agents?|multiple\s+agents?/i.test(query)
    || selected.some((item) => item.executionRole === 'orchestrator');
  const potential = Array.isArray(options.potential) ? options.potential : [];
  const requestedSlots = Number.isFinite(options.availableAgentSlots) ? options.availableAgentSlots : hostProfile.maxAgents;
  const slotLimit = Math.max(1, Math.min(8, requestedSlots, hostProfile.maxAgents, profile.maxAgents));
  const parallelAgents = Boolean(hostProfile.parallelAgents && (options.parallelAgents ?? true));
  const nativeParallelAvailable = parallelAgents && slotLimit > 1;

  let mode = 'single-agent';
  if ((complexity.complexDevelopment || explicitParallel) && nativeParallelAvailable) mode = 'parallel-staged';
  else if ((complexity.level === 'high' || risk === 'high') && nativeParallelAvailable) mode = 'review-pair';

  const selectedTokenCost = selected.reduce((total, item) => total + estimateSkillTokens(item), 0);
  if (!options.qualityProfile && profileName === 'balanced' && selectedTokenCost > profile.skillContextBudget
      && selectedTokenCost <= QUALITY_PROFILES.quality.skillContextBudget) {
    profileName = 'quality';
    profile = QUALITY_PROFILES.quality;
  }
  const contextWithinBudget = selectedTokenCost <= profile.skillContextBudget;
  const frontierNeeded = risk === 'high' || complexity.level === 'high' || profileName === 'quality';
  const availableModelState = normalizeAvailableModels(options.availableModels, hostProfile);
  const availableModels = availableModelState.models;
  const modelOverride = Boolean((options.modelOverride ?? hostProfile.capabilities?.parallelAgents?.modelOverride) && hostProfile.parallelAgents);
  const environment = {availableModels, availabilityKnown: availableModelState.known, modelOverride};
  const hostModels = hostProfile.models || {};
  const models = {
    environment,
    current: typeof options.currentModel === 'string' && options.currentModel ? options.currentModel : null,
    architect: hostModels.architect || 'gpt-6-astra',
    complexExecutor: hostModels.frontier || 'gpt-5.6-sol',
    routineExecutor: hostModels.balanced || 'gpt-5.6-terra',
    lookup: hostModels.fast || 'gpt-5.6-luna',
    reviewer: hostModels.reviewer || hostModels.frontier || 'gpt-5.6-sol',
  };

  const fullModelPlan = readOnly ? [
    modelStep('discovery', 'fast', models.lookup, environment, complexity.level === 'high' ? 'medium' : 'low', '有界、只读地收集互不重叠的证据'),
    {
      role: 'analysis', tier: 'architect', preferredModel: models.architect, model: models.current,
      validateAtDispatch: false, fallback: 'keep-current-root-model', reasoning: frontierNeeded ? 'high' : 'medium',
      objective: '由主 Agent 综合证据、识别冲突并对结论负责',
    },
    modelStep('verification', 'frontier', models.reviewer, environment, risk === 'high' ? 'high' : 'medium', '由独立 Agent 复核证据与结论，不产生写入'),
  ] : [
    {
      role: 'architecture+integration', tier: 'architect', preferredModel: models.architect, model: models.current,
      validateAtDispatch: false, fallback: 'keep-current-root-model', reasoning: frontierNeeded ? 'high' : 'medium',
      objective: '主 Agent 负责架构、集成和至少一个有意义的实现切片',
    },
    modelStep('execution-complex', 'frontier', models.complexExecutor, environment, frontierNeeded ? 'high' : 'medium', '完成边界清晰的复杂实现工作项'),
    modelStep('execution-routine', 'balanced', models.routineExecutor, environment, 'medium', '完成接口稳定的常规实现工作项'),
    modelStep('verification', 'frontier', models.reviewer, environment, risk === 'high' || complexity.level === 'high' ? 'high' : 'medium', '独立复核与本次变更相称的检查和未决风险'),
  ];

  const modelPlan = fullModelPlan.filter((step) => {
    if (mode === 'parallel-staged') return true;
    if (mode === 'review-pair') return step.role === 'analysis' || step.role === 'architecture+integration' || step.role === 'verification';
    return step.role === 'analysis' || step.role === 'architecture+integration';
  });
  const agentPlan = buildAgentPlan({mode, readOnly, complexity, slotLimit, models});
  const dispatchPolicy = {
    nativeRequired: complexity.complexDevelopment && nativeParallelAvailable,
    nativeNeededIfFeasible: complexity.complexDevelopment,
    conditionalOn: '主 Agent 已识别至少一个真正独立、有文件边界且可独立验收的工作项',
    nativeAvailable: nativeParallelAvailable,
    planStatus: 'assessment',
    dispatchable: false,
    requiresWorkItems: mode !== 'single-agent',
    dispatchAuthority: 'plan_agents',
    rootConsumesSlot: true,
    slotLimit,
    maxSubagentsAtOnce: Math.max(0, slotLimit - 1),
    modelValidation: {
      availableModels,
      availabilityKnown: availableModelState.known,
      reasoningEfforts: hostProfile.reasoningEfforts || {},
      overrideSupported: modelOverride,
      timing: 'validate-at-dispatch',
      reasoningValidation: 'validate-at-dispatch',
      unavailableFallback: 'inherit-parent',
    },
    lanes: agentPlan.filter((item) => item.id !== 'main').map((item) => ({
      id: item.id,
      after: item.dependsOn,
      parallelGroup: item.executionParallelGroup || item.parallelGroup,
      preferredModel: item.dispatch.preferredModel,
      model: item.dispatch.model,
      reasoning: modelPlan.find((step) => step.preferredModel === item.dispatch.preferredModel)?.reasoning || 'medium',
      fallback: item.dispatch.fallback,
    })),
    rules: [
      '主 Agent 保留架构、集成和至少一个有意义的实现切片',
      '只派发边界清晰、文件所有权不重叠且可独立验收的工作项',
      'Reviewer 在实现工作项之后独立运行，并保持只读',
      '派发时验证模型与推理档可用性；不可用时省略覆盖并继承父 Agent',
    ],
  };

  const allScheduled = [
    ...selected.map((item, index) => ({...item, state: 'active', scheduleIndex: index})),
    ...potential.map((item, index) => ({...item, state: 'potential', scheduleIndex: selected.length + index})),
  ];
  const skillSchedule = allScheduled.map((item, index) => {
    const prior = allScheduled.filter((other) => stageRank(other.phase) < stageRank(item.phase) && other.state === 'active');
    const nearestRank = prior.length ? Math.max(...prior.map((other) => stageRank(other.phase))) : -1;
    const dependsOn = prior.filter((other) => stageRank(other.phase) === nearestRank).map((other) => other.id);
    return {
      id: item.id,
      nameZh: item.nameZh,
      state: item.state,
      routeRole: item.role,
      executionRole: item.executionRole || (index === 0 ? 'workflow_owner' : 'specialist'),
      phase: item.phase || (item.executionRole === 'verifier' ? 'verification' : 'implementation'),
      capability: item.capability || 'general',
      responsibility: item.responsibility || '在其专长范围内提供阶段性支持',
      activationCondition: item.activationCondition || '进入对应阶段时',
      load: item.state === 'active' ? 'read-before-use-after-scope-check' : 'read-only-after-activation',
      apply: `在 ${item.phase || 'implementation'} 阶段按职责插入`,
      dependsOn,
      estimatedTokens: estimateSkillTokens(item),
    };
  }).sort((a, b) => stageRank(a.phase) - stageRank(b.phase)
    || (a.state === b.state ? 0 : a.state === 'active' ? -1 : 1));

  const phaseObjectives = {
    discovery: ['扫描现状、约束和证据边界', '关键输入与风险已记录'],
    planning: ['明确范围、依赖、分工和验收标准', '计划可执行且依赖无冲突'],
    design: ['确定内容、视觉、交互或方案基线', '设计输入足以支持实现'],
    implementation: ['完成唯一 owner 管理的实现或主要产物', '形成可检查的完整增量'],
    analysis: ['处理材料或数据并形成可解释结论', '结论与中间产物可追溯'],
    verification: ['执行与变更相称的确定性检查和独立复核', '无未决高风险且证据充分'],
    optimization: ['按专项能力改善质量指标', '专项指标达到任务要求'],
    delivery: ['整理交付物、汇报或经授权上线', '交付物可访问、可复用、可回滚'],
    operations: ['进入持续运行、观察或维护', '运行责任与后续触发条件明确'],
  };
  const phasePlan = PIPELINE_STAGES.map((phase) => {
    const entries = skillSchedule.filter((item) => item.phase === phase);
    if (!entries.length) return null;
    const [objective, exitCondition] = phaseObjectives[phase];
    return {
      phase,
      order: stageRank(phase) + 1,
      objective,
      activeSkills: entries.filter((item) => item.state === 'active').map((item) => item.id),
      potentialSkills: entries.filter((item) => item.state === 'potential').map((item) => item.id),
      entryCondition: entries.some((item) => item.state === 'active')
        ? '前序阶段完成后直接进入'
        : entries.map((item) => `${item.id}: ${item.activationCondition}`).join('；'),
      exitCondition,
    };
  }).filter(Boolean);
  const handoffs = phasePlan.slice(1).map((phase, index) => ({
    fromPhase: phasePlan[index].phase,
    toPhase: phase.phase,
    fromSkills: [...phasePlan[index].activeSkills, ...phasePlan[index].potentialSkills],
    toSkills: [...phase.activeSkills, ...phase.potentialSkills],
    handoffArtifact: phasePlan[index].exitCondition,
    gate: phase.entryCondition,
  }));

  const notes = [];
  if ((explicitParallel || complexity.complexDevelopment) && !nativeParallelAvailable) notes.push(`${host} 当前没有足够且已验证的原生 Agent 槽位，计划保持单 Agent；复杂开发的原生多 Agent 要求仍保留为待满足条件`);
  if (!contextWithinBudget) notes.push('选中技能说明超出当前档位预算；仍遵守完整读取要求，但应避免额外参考资料并考虑切换 quality 档');
  if (mode === 'parallel-staged') notes.push('只有文件所有权不重叠且可独立验收的工作项可以并行；独立 Reviewer 在执行工作项之后运行');
  if (potential.length) notes.push('潜在技能只记录入口和触发条件；未满足条件时不得加载，满足后可在同一任务内升级调用而无需重新路由');

  return {
    version: 3,
    recommendationOnly: true,
    host,
    profile: profileName,
    task: {
      assessment: 'local-heuristics-refine-with-project-evidence',
      complexity: complexity.level,
      complexitySignals: complexity.signals,
      complexDevelopment: complexity.complexDevelopment,
      risk,
      explicitParallel,
      readOnly,
    },
    mode,
    maxConcurrentAgents: mode === 'single-agent' ? 1 : slotLimit,
    modelPlan,
    agentPlan,
    dispatchPolicy,
    skillSchedule,
    phasePlan,
    handoffs,
    tokenPlan: {
      strategy: 'registry-first + active-skill-read-before-use-after-scope-check + potential-skill-lazy-activation',
      skillContextBudget: profile.skillContextBudget,
      selectedSkillTokens: selectedTokenCost,
      potentialSkillTokens: potential.reduce((total, item) => total + estimateSkillTokens(item), 0),
      withinBudget: contextWithinBudget,
      maxLoadedSkills: options.maxLoadedSkills ?? 5,
      activeSkillCount: selected.length,
      potentialSkillCount: potential.length,
    },
    verificationPolicy: {
      scope: 'change-proportional',
      checks: readOnly ? '复核支撑结论的来源、推理和边界' : '运行能验证本次变更行为和主要风险的定向检查',
      independentReview: {
        required: complexity.level === 'high' || risk === 'high' || explicitParallel,
        scheduled: agentPlan.some((item) => item.role === 'independent-reviewer'),
      },
      authorization: '沿用用户对当前任务已经给出的授权；只有实际扩大范围时升级处理',
    },
    mergeGate: readOnly
      ? `支撑结论的证据已复核${complexity.level === 'high' || risk === 'high' || explicitParallel ? '，独立审查无未决高风险' : '，无未决高风险'}`
      : `与本次变更相称的检查通过，集成边界清楚${complexity.level === 'high' || risk === 'high' || explicitParallel ? '，独立审查无未决高风险' : '，无未决高风险'}`,
    notes,
  };
}

export function compactCoordinationPlan(plan) {
  return {
    profile: plan.profile,
    task: plan.task,
    mode: plan.mode,
    maxConcurrentAgents: plan.maxConcurrentAgents,
    modelTiers: plan.modelPlan.map(({role, tier, model, preferredModel, reasoning, validateAtDispatch, fallback}) => ({role, tier, model, preferredModel, reasoning, validateAtDispatch, fallback})),
    agentPlan: plan.agentPlan.map(({id, status, role, phase, dependsOn, integrationDependsOn, mutationScope, goal, dispatch, requiresMaterialization}) => ({
      id,
      status,
      role,
      phase,
      dependsOn,
      ...(integrationDependsOn ? {integrationDependsOn} : {}),
      mutationScope,
      goal,
      dispatch,
      requiresMaterialization,
    })),
    dispatchPolicy: plan.dispatchPolicy,
    verificationPolicy: plan.verificationPolicy,
    skillTokens: plan.tokenPlan.selectedSkillTokens,
    skillTokenBudget: plan.tokenPlan.skillContextBudget,
    withinBudget: plan.tokenPlan.withinBudget,
    activeSkillCount: plan.tokenPlan.activeSkillCount,
    potentialSkillCount: plan.tokenPlan.potentialSkillCount,
    skillSchedule: plan.skillSchedule,
    phasePlan: plan.phasePlan,
    handoffs: plan.handoffs,
    mergeGate: plan.mergeGate,
    notes: plan.notes,
  };
}

export function getHostProfiles() {
  return structuredClone(loadHostManifest().hosts);
}
