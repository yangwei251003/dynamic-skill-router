#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { routeTask, formatAgentContext, getSkillByAlias, compactRouteResult } from './router.mjs';
import { loadRegistry, validateRegistry } from './registry.mjs';
import { LOG_ROOT } from './paths.mjs';
import { ROUTER_VERSION } from './version.mjs';
import { getHostProfiles } from './coordination-planner.mjs';
import { feedbackSummary } from './feedback.mjs';
import { planWorkItems } from './work-planner.mjs';
import { routeTaskV4, searchSkills, formatAgentContextV4, taskAssessment } from './advisor-v4.mjs';
import { discoverCapabilities, adviseCapabilities } from './capabilities-v4.mjs';
import {planRecovery} from './recovery-v4.mjs';
import { discoverSkills, resolveDiscoveredSkill } from './discovery-v4.mjs';
import { validateOutcomeV4 } from './feedback-v4.mjs';

const asResult = (value) => ({content: [{type: 'text', text: JSON.stringify(value, null, 2)}], structuredContent: value});
const hostSchema = z.enum(['generic', 'codex', 'workbuddy', 'antigravity', 'claude', 'cursor']);
const runtimeCapabilitiesSchema = z.object({
  tools: z.array(z.string()).optional(), capabilities: z.array(z.string()).optional(),
  availableModels: z.array(z.string()).optional(), availableAgentSlots: z.number().int().min(1).max(8).optional(),
  parallelAgents: z.boolean().optional(), modelOverride: z.boolean().optional(),
});
const taskContextSchema = z.object({
  objective: z.string().optional(), actions: z.array(z.string()).optional(), deliverables: z.array(z.string()).optional(),
  domain: z.string().optional(), background: z.string().optional(), explicitSkills: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(), nativeApproach: z.string().optional(),
  complexity: z.enum(['low', 'medium', 'high']).optional(), complexityEvidence: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  capabilityNeeds: z.array(z.string()).optional().describe('宿主解释的当前能力缺口，仅用于检索，不授权行动'),
  evidence: z.array(z.object({source:z.enum(['user','project','runtime','reference','inference']),reference:z.string(),claim:z.string().optional()})).optional(),
});
const invocationContextSchema = z.object({
  phase:z.enum(['auto','discovery','planning','design','implementation','validation','delivery']).optional(),
  mode:z.enum(['plan','execute']).optional(),
  readOnly:z.boolean().optional().describe('true只收紧范围；false不能解除用户或宿主已有只读限制'),
});
const runtimeSkillSchema = z.object({path: z.string(), id: z.string().optional(), provider: z.string().optional(), enabled: z.boolean().optional(), host: hostSchema.optional()});
const discoveryFields = {host: hostSchema.optional().default('generic'), projectRoot: z.string().optional(), runtimeSkills: z.array(runtimeSkillSchema).optional()};
const runtimeToolSchema = z.object({name:z.string().min(1),description:z.string().max(4000).optional(),server:z.string().optional(),plugin:z.string().optional(),available:z.boolean().optional(),annotations:z.object({readOnlyHint:z.boolean().optional(),destructiveHint:z.boolean().optional(),idempotentHint:z.boolean().optional(),openWorldHint:z.boolean().optional()}).optional()});
const capabilityFields = {
  runtimeTools:z.array(runtimeToolSchema).max(3000).optional().describe('当前会话工具清单；提供真实名称、用途和可证实的插件来源。不能用配置推断可调用。'),
  runtimePlugins:z.array(z.object({id:z.string().min(1),name:z.string().optional(),description:z.string().max(4000).optional(),enabled:z.boolean().optional(),skills:z.array(z.string()).optional()})).max(500).optional(),
  invocationContext:invocationContextSchema.optional(),
  capabilityLimit:z.number().int().min(1).max(10).optional(),
};
const recoveryFields={
  recoveryContext:z.object({confidence:z.enum(['high','medium','low']).optional(),blocked:z.boolean().optional(),userRejected:z.boolean().optional(),failedAttempts:z.number().int().min(0).optional(),capabilityNeed:z.string().max(500).optional(),networkAllowed:z.boolean().optional()}).optional().describe('当前失败/信心事实；用户否定效果或低信心会要求主动外部查证。不是扩大权限。'),
};
const adaptiveFields={...recoveryFields,routingMode:z.enum(['auto','fast','full']).optional(),nativeSufficient:z.boolean().optional().describe('主模型已判断原生能力可可靠完成；遇阻/低信心/用户否定时不得靠此跳过查证。')};

function createServer() {
  const server = new McpServer({name: 'dynamic-skill-router', version: ROUTER_VERSION}, {capabilities: {tools: {listChanged: false}}});

  server.registerTool('route_task', {
    title: '动态路由任务',
    description: '任务开始时调用一次。contractVersion:4 联合扫描技能、插件与 MCP，传 runtimeTools 获取当前工具的具体调用时机和收益建议；主 Agent 在既有授权内调用。阶段变化复用 routeId，用 search_skills 或 search_capabilities。省略版本保留 V3。',
    inputSchema: z.object({
      query: z.string().min(1).describe('用户本轮完整任务'),
      includeAgentContext: z.boolean().optional().default(true),
      ...discoveryFields,
      ...capabilityFields,
      ...adaptiveFields,
      contractVersion: z.union([z.literal(3), z.literal(4)]).optional().default(3),
      taskContext: taskContextSchema.optional(),
      responseDetail: z.enum(['compact', 'full']).optional().default('compact'),
      runtimeCapabilities: runtimeCapabilitiesSchema.optional(),
      qualityProfile: z.enum(['economy', 'balanced', 'quality']).optional(),
      availableAgentSlots: z.number().int().min(1).max(8).optional(),
      availableModels: z.array(z.string()).optional().describe('当前原生协作工具实际可调用的模型 ID；未知则省略'),
      currentModel: z.string().optional(),
      parallelAgents: z.boolean().optional(),
      modelOverride: z.boolean().optional(),
      useFeedback: z.boolean().optional().default(true),
      dryRun: z.boolean().optional().default(false).describe('严格只读：不自动同步、不写路由日志'),
    }),
  }, async ({query, includeAgentContext, dryRun, contractVersion, ...options}) => {
    if (contractVersion === 4) {
      const result = routeTaskV4(query, {...options, dryRun});
      const agentContext = includeAgentContext ? formatAgentContextV4(result) : undefined;
      return {content: [{type: 'text', text: agentContext || JSON.stringify(result)}], structuredContent: {...result, agentContext}};
    }
    const result = routeTask(query, {...options, autoSync: false, writeLog: dryRun ? false : undefined});
    const agentContext = includeAgentContext ? formatAgentContext(result) : undefined;
    const value = {...compactRouteResult(result), agentContext};
    return {content: [{type: 'text', text: agentContext || `${result.decision}: ${result.explanation}`}], structuredContent: value};
  });

  server.registerTool('search_skills', {
    title: '按阶段查找技能手册',
    description: '沿用已有 routeId，在阶段变化或出现能力缺口时只读检索手册。候选是参考材料，由主模型判断是否完整查阅和采用。',
    inputSchema: z.object({query: z.string().min(1), routeId: z.string().min(1), ...discoveryFields, ...capabilityFields,...recoveryFields,
      source: z.string().optional(), domain: z.string().optional(), phase: z.string().optional(),
      limit: z.number().int().min(1).max(30).optional(), taskContext: taskContextSchema.optional(), runtimeCapabilities: runtimeCapabilitiesSchema.optional(),
      responseDetail: z.enum(['compact', 'full']).optional().default('compact'), useFeedback: z.boolean().optional().default(true),
    }),
  }, async ({query, ...options}) => asResult(searchSkills(query, options)));

  server.registerTool('scan_capabilities', {
    title:'扫描插件、MCP 与当前工具',
    description:'只读扫描本机插件/MCP 配置，合并宿主传入的运行时工具。配置不等于可调用；不启动服务器、不请求端点、不读取或返回凭证。普通任务由 route_task 自动扫描，不需重复全量调用。',
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    inputSchema:z.object({...discoveryFields,...capabilityFields,runtimeCapabilities:runtimeCapabilitiesSchema.optional(),kind:z.enum(['plugin','mcp','tool']).optional(),offset:z.number().int().min(0).optional().default(0),limit:z.number().int().min(1).max(100).optional().default(30)}),
  }, async ({kind,offset,limit,...options})=>{
    const result=discoverCapabilities(options), items=result.capabilities.filter(x=>!kind||x.kind===kind);
    return asResult({revision:result.revision,coverage:result.coverage,errors:result.errors,count:items.length,capabilities:items.slice(offset,offset+limit),nextOffset:offset+limit<items.length?offset+limit:null,scanExecutesTools:false});
  });

  server.registerTool('search_capabilities', {
    title:'按任务阶段选择插件与 MCP',
    description:'复用 routeId，在阶段变化或能力缺口时挑选确实有帮助的插件/MCP/工具，返回调用时机、收益、范围检查及精确工具名。主 Agent 核对真实输入和既有授权后调用；路由器不代执行业务动作。',
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    inputSchema:z.object({query:z.string().min(1),routeId:z.string().min(1),...discoveryFields,...capabilityFields,...recoveryFields,runtimeCapabilities:runtimeCapabilitiesSchema.optional(),taskContext:taskContextSchema.optional(),phase:z.enum(['discovery','planning','design','implementation','validation','delivery']).optional()}),
  }, async ({query,routeId,...options})=>{const task=taskAssessment(query,options.taskContext,options.invocationContext);return asResult({routeId,...adviseCapabilities(task,options),recoveryPlan:planRecovery({...task,rawText:query},options)});});

  server.registerTool('plan_recovery',{
    title:'遇阻后检索资源与补足能力',
    description:'复用 routeId，低成本判断遇阻、低信心、用户否定效果后的行动顺序。返回必须查证的条件、公开检索词、真实可用搜索入口、工具安装条件和回到原任务的验收步骤。不联网、不安装、不执行外部动作；由主 Agent 主动落实。',
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    inputSchema:z.object({query:z.string().min(1),routeId:z.string().min(1),...recoveryFields,invocationContext:invocationContextSchema.optional(),runtimeTools:z.array(runtimeToolSchema).max(3000).optional(),runtimeCapabilities:runtimeCapabilitiesSchema.optional(),taskContext:taskContextSchema.optional()}),
  },async ({query,routeId,...options})=>asResult({routeId,...planRecovery({...taskAssessment(query,options.taskContext,options.invocationContext),rawText:query},options)}));

  server.registerTool('plan_agents', {
    title: '校验任务分工与 Agent 调度',
    description: '主 Agent 调查项目后提交具体子任务 workItems（必需 id、objective、owner、files:{read:[],write:[]}、acceptance:[]、contextRefs:[]；可选 dependsOn、modelPreference、status、evidence、budget），检查依赖环、文件冲突、槽位和交接，返回可调度批次。总槽位含保留的主 Agent；不创建或启动 Agent，不重复技能路由。',
    inputSchema: z.object({
      workItems: z.array(z.unknown()).min(1).max(64),
      options: z.object({
        availableAgentSlots: z.number().int().min(1).max(8).optional(),
        delegationAuthorized: z.boolean().optional().describe('当前用户或生效全局规则已授权委派，无需重复确认'),
        availableModels: z.array(z.string()).optional(),
        caseSensitivePaths: z.boolean().optional(),
        workspaceRoot: z.string().optional(),
        revision: z.number().int().positive().optional(),
        maxReplans: z.number().int().nonnegative().optional(),
        replanCount: z.number().int().nonnegative().optional(),
      }).optional(),
    }),
  }, async ({workItems, options}) => asResult(planWorkItems(workItems, options)));

  server.registerTool('resolve_alias', {
    title: '解析中文技能名',
    description: '把中文技能名、英文 ID 或别名解析为真实技能路径。',
    inputSchema: z.object({name: z.string().min(1), contractVersion: z.union([z.literal(3), z.literal(4)]).optional().default(3), ...discoveryFields}),
  }, async ({name, contractVersion, ...options}) => {
    if (contractVersion === 4) {
      const resolved = resolveDiscoveredSkill(name, discoverSkills(options));
      if (!resolved.found) return asResult(resolved);
      const {skill} = resolved;
      return asResult({found: true, ambiguous: false, id: skill.id, nameZh: skill.nameZh, path: skill.path, sourceId: skill.sourceId, contentHash: skill.contentHash, availability: skill.availability});
    }
    const skill = getSkillByAlias(name);
    return asResult(skill ? {found: true, id: skill.id, nameZh: skill.nameZh, path: skill.path, status: skill.status, summaryZh: skill.summaryZh} : {found: false});
  });

  server.registerTool('get_skill', {
    title: '读取已选技能',
    description: '读取技能全文。V4 请传候选卡 contentHash 作为 expectedContentHash 核对版本；变化时返回 content-hash-mismatch，重新评估后读取。歧义名称返回候选，读取不执行脚本。',
    inputSchema: z.object({name: z.string().min(1), contractVersion: z.union([z.literal(3), z.literal(4)]).optional().default(3), purpose: z.enum(['consult', 'adapt', 'execute']).optional().default('consult'), expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(), ...discoveryFields}),
  }, async ({name, contractVersion, purpose, expectedContentHash, ...options}) => {
    if (contractVersion === 4) {
      const resolved = resolveDiscoveredSkill(name, discoverSkills(options));
      if (!resolved.found) return asResult(resolved);
      const {skill} = resolved;
      const skillFile = path.join(skill.path, 'SKILL.md');
      try {
        const bytes = fs.readFileSync(skillFile);
        const contentHash = createHash('sha256').update(bytes).digest('hex');
        if (expectedContentHash && contentHash !== expectedContentHash.toLowerCase()) return asResult({found: false, id: skill.id, reason: 'content-hash-mismatch', expectedContentHash, contentHash, action: 'Re-evaluate the changed manual before reading or applying it.'});
        return asResult({found: true, id: skill.id, nameZh: skill.nameZh, path: skillFile, purpose, sourceId: skill.sourceId, contentHash, parentId: skill.parentId, availability: skill.availability, content: bytes.toString('utf8')});
      }
      catch (error) { return asResult({found: false, id: skill.id, reason: 'skill-unreadable-or-removed', error: error.message}); }
    }
    const skill = getSkillByAlias(name);
    if (!skill) return asResult({found: false});
    const skillFile = path.join(skill.path, 'SKILL.md');
    return asResult({found: true, id: skill.id, nameZh: skill.nameZh, path: skillFile, content: fs.readFileSync(skillFile, 'utf8')});
  });

  server.registerTool('list_skills', {
    title: '列出个人全局技能',
    description: '列出路由器管理的个人全局技能及中文名称、类别和可用状态。',
    inputSchema: z.object({category: z.string().optional(), source: z.string().optional(), contractVersion: z.union([z.literal(3), z.literal(4)]).optional().default(3), ...discoveryFields}),
  }, async ({category, source, contractVersion, ...options}) => {
    if (contractVersion === 4) {
      const index = discoverSkills(options);
      const skills = index.skills.filter(s => (!category || s.category?.includes(category)) && (!source || s.sourceId === source));
      return asResult({contractVersion: 4, revision: index.revision, count: skills.length, skills: skills.map(({id,nameZh,category,sourceId,status,summaryZh,path,contentHash,parentId,availability}) => ({id,nameZh,category,sourceId,status,summaryZh,path,contentHash,parentId,availability}))});
    }
    let skills = loadRegistry().skills;
    if (category) skills = skills.filter((skill) => skill.category.includes(category));
    return asResult({count: skills.length, skills: skills.map(({id, nameZh, category: group, status, summaryZh, path: skillPath}) => ({id, nameZh, category: group, status, summaryZh, path: skillPath}))});
  });

  server.registerTool('health_check', {
    title: '检查路由器健康状态',
    description: '校验注册表、技能目录和核心服务。',
    inputSchema: z.object({contractVersion: z.union([z.literal(3), z.literal(4)]).optional().default(3), ...discoveryFields}),
  }, async ({contractVersion, ...options}) => {
    if (contractVersion === 4) {
      const index = discoverSkills(options);
      return asResult({routerVersion: ROUTER_VERSION, contractVersion: 4, revision: index.revision, count: index.skills.length, coverage: index.coverage, errors: index.errors, ok: index.errors.length === 0, sessionVerification: 'This response verifies this MCP process only; other host sessions are not implied.'});
    }
    const registry = loadRegistry();
    const validation = validateRegistry(registry);
    return asResult({routerVersion: ROUTER_VERSION, schemaVersion: registry.schemaVersion, ...validation, router: 'ok', managedSkills: registry.skills.length, hostProfiles: getHostProfiles(), feedbackCalibration: feedbackSummary(registry.policy.feedbackCalibration)});
  });

  server.registerTool('report_outcome', {
    title: '记录路由效果',
    description: '记录本次技能选择是否合适，供以后调优；不会自动改写路由规则。',
    inputSchema: z.object({
      contractVersion: z.union([z.literal(3), z.literal(4)]).optional().default(3),
      taskType: z.string().min(1).optional(),
      decisions: z.array(z.object({skillId: z.string().min(1), contentHash: z.string().min(1), mode: z.enum(['skip','consult','adapt','execute']), shown: z.boolean(), read: z.boolean(), adopted: z.boolean(), outcome: z.enum(['helpful','wrong','unnecessary','unknown']), evidence: z.array(z.object({kind: z.enum(['validation','user','self']), reference: z.string().min(1), passed: z.boolean().optional()}))})).optional(),
      routeId: z.string().optional(),
      registryRevision: z.string().optional(),
      modelId:z.string().min(1).optional().describe('实际运行时模型标识，未知时省略，不凭模型自述猜测'),
      observedAt:z.string().optional(),
      revoked:z.boolean().optional().describe('撤销同任务、模型、技能版本与采用方式的校准证据，保留审计历史'),
      host: hostSchema.optional(),
      query: z.string().optional(),
      selectedIds: z.array(z.string()).optional(),
      affectedSkillId: z.string().optional().describe('组合路由中只有一个技能有问题时填写，避免把结果错误归因给所有技能'),
      missingSkillId: z.string().optional(),
      desiredIds: z.array(z.string()).optional(),
      outcome: z.enum(['helpful', 'wrong', 'missing', 'unnecessary']).optional(),
      execution: z.object({
        inputTokens: z.number().nonnegative().optional(),
        cachedInputTokens: z.number().nonnegative().optional(),
        outputTokens: z.number().nonnegative().optional(),
        cost: z.number().nonnegative().optional(),
        latencyMs: z.number().nonnegative().optional(),
        retries: z.number().int().nonnegative().optional(),
        agentCount: z.number().int().positive().optional(),
        qualityScore: z.number().min(0).max(1).optional(),
        success: z.boolean().optional(),
      }).optional(),
      note: z.string().optional(),
    }),
  }, async (feedback) => {
    if (feedback.contractVersion === 4) {
      const checked = validateOutcomeV4(feedback);
      if (!checked.ok) return asResult({recorded: false, errors: checked.errors});
      fs.mkdirSync(LOG_ROOT, {recursive: true});
      fs.appendFileSync(path.join(LOG_ROOT, 'feedback-v4.jsonl'), `${JSON.stringify({...checked.entry, timestamp: new Date().toISOString()})}\n`, 'utf8');
      return asResult({recorded: true, taskIdentityPresent: Boolean(feedback.routeId?.trim()), policy: '有 routeId 才参与校准；同一任务、模型、技能版本、采用方式仅计一个样本，冲突或撤销报告不计分。只采用可归因的验证或用户证据，保留unknown；已知模型按模型隔离，带日期证据90天过期。不是模型训练或自动改写全局规则。'});
    }
    if (typeof feedback.query !== 'string' || !feedback.selectedIds || !feedback.outcome) return asResult({recorded: false, errors: ['V3 requires query, selectedIds and outcome']});
    fs.mkdirSync(LOG_ROOT, {recursive: true});
    fs.appendFileSync(path.join(LOG_ROOT, 'feedback.jsonl'), `${JSON.stringify({...feedback, timestamp: new Date().toISOString()})}\n`, 'utf8');
    return asResult({recorded: true, policy: '达到最少样本数后仅进行 -3 到 +2 分的有界校准；不会自动改写触发词或权限规则'});
  });
  return server;
}

serveStdio(() => createServer(), {legacy: 'serve', onerror: (error) => process.stderr.write(`[dynamic-skill-router] ${error.message}\n`)});
