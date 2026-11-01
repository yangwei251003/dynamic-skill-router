import fs from 'node:fs';
import path from 'node:path';
import {LOG_ROOT} from './paths.mjs';
import {ROUTER_VERSION} from './version.mjs';
import {z} from 'zod';

const MODES = new Set(['skip', 'consult', 'adapt', 'execute']);
const OUTCOMES = new Set(['helpful', 'wrong', 'unnecessary', 'unknown']);
const KINDS = new Set(['validation', 'user', 'self']);

// Shared by the MCP tool and explicit CLI entry so both accept the same data.
const outcomeHostSchema = z.enum(['generic', 'codex', 'workbuddy', 'antigravity', 'claude', 'cursor']);
export const reportOutcomeSchema = z.object({
      contractVersion: z.union([z.literal(3), z.literal(4)]).optional().default(3),
      taskType: z.string().min(1).optional(),modelId:z.string().min(1).optional(),observedAt:z.string().optional(),revoked:z.boolean().optional(),
      decisions: z.array(z.object({skillId: z.string().min(1), contentHash: z.string().min(1), mode: z.enum(['skip','consult','adapt','execute']), shown: z.boolean(), read: z.boolean(), adopted: z.boolean(), outcome: z.enum(['helpful','wrong','unnecessary','unknown']), evidence: z.array(z.object({kind: z.enum(['validation','user','self']), reference: z.string().min(1), passed: z.boolean().optional()}))})).optional(),
      routeId: z.string().optional(),
      registryRevision: z.string().optional(),
      host: outcomeHostSchema.optional(),
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
    });


export function validateOutcomeV4(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {ok: false, errors: ['entry must be an object'], entry: null};
  if (value.contractVersion !== 4) errors.push('contractVersion must be 4');
  if (typeof value.taskType !== 'string' || !value.taskType.trim()) errors.push('taskType is required');
  if (typeof value.host !== 'string' || !value.host.trim()) errors.push('host is required');
  if (value.modelId !== undefined && (typeof value.modelId !== 'string' || !value.modelId.trim())) errors.push('modelId must be a non-empty runtime identifier');
  if (value.observedAt !== undefined && (typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)))) errors.push('observedAt must be an ISO date');
  if (value.revoked !== undefined && typeof value.revoked !== 'boolean') errors.push('revoked must be boolean');
  if (!Array.isArray(value.decisions)) errors.push('decisions must be an array');
  const decisions = Array.isArray(value.decisions) ? value.decisions : [];
  for (const [i, decision] of decisions.entries()) {
    if (!decision || typeof decision !== 'object') { errors.push(`decisions[${i}] must be an object`); continue; }
    if (typeof decision.skillId !== 'string' || !decision.skillId.trim()) errors.push(`decisions[${i}].skillId is required`);
    if (typeof decision.contentHash !== 'string' || !decision.contentHash.trim()) errors.push(`decisions[${i}].contentHash is required`);
    if (!MODES.has(decision.mode)) errors.push(`decisions[${i}].mode is invalid`);
    for (const key of ['shown', 'read', 'adopted']) if (typeof decision[key] !== 'boolean') errors.push(`decisions[${i}].${key} must be boolean`);
    if (!OUTCOMES.has(decision.outcome)) errors.push(`decisions[${i}].outcome is invalid`);
    if (!Array.isArray(decision.evidence)) errors.push(`decisions[${i}].evidence must be an array`);
    for (const [j, evidence] of (Array.isArray(decision.evidence) ? decision.evidence : []).entries()) {
      if (!evidence || !KINDS.has(evidence.kind) || typeof evidence.reference !== 'string' || !evidence.reference.trim()) errors.push(`decisions[${i}].evidence[${j}] is invalid`);
      if (evidence && evidence.passed !== undefined && typeof evidence.passed !== 'boolean') errors.push(`decisions[${i}].evidence[${j}].passed must be boolean`);
    }
  }
  return {ok: errors.length === 0, errors, entry: value};
}

const OUTCOME_POLICY = '需要 routeId、可靠 modelId、当前内容hash与90天内 observedAt/timestamp 才参与校准；过期、未来、撤销或冲突记录不计分。仅对已采用且有验证或用户证据的同宿主、任务类型、内容版本和采用方式进行有界校准；不是模型训练。仅记录必要依据，避免在 query 或 note 中写入完整请求或敏感信息。';

// Only explicit calls reach this writer. No model identity is inferred.
export function recordOutcomeV4(value, {dryRun = false} = {}) {
  const parsed = reportOutcomeSchema.safeParse(value);
  if (!parsed.success) return {recorded: false, errors: parsed.error.issues.map(issue => `${issue.path.join('.') || 'entry'}: ${issue.message}`)};
  if (parsed.data.contractVersion !== 4) return {recorded: false, errors: ['contractVersion must be 4']};
  const checked = validateOutcomeV4(parsed.data);
  if (!checked.ok) return {recorded: false, errors: checked.errors};
  const result = {recorded: false, routerVersion: ROUTER_VERSION, taskIdentityPresent: Boolean(parsed.data.routeId?.trim()),
    modelIdentityPresent: Boolean(parsed.data.modelId?.trim()), policy: OUTCOME_POLICY};
  if (dryRun) return {...result, dryRun: true, valid: true, wouldRecord: true};
  fs.mkdirSync(LOG_ROOT, {recursive: true});
  fs.appendFileSync(path.join(LOG_ROOT, 'feedback-v4.jsonl'), `${JSON.stringify({...checked.entry, routerVersion: ROUTER_VERSION, timestamp: new Date().toISOString()})}\n`, 'utf8');
  return {...result, recorded: true};
}

function lowerBound(successes, count) {
  if (!count) return 0;
  const z = 1.645;
  const p = successes / count;
  return (p + z * z / (2 * count) - z * Math.sqrt((p * (1 - p) + z * z / (4 * count)) / count)) / (1 + z * z / count);
}

function hashFor(context, id) {
  const hashes = context.contentHashes;
  if (hashes instanceof Map) return hashes.get(id);
  return hashes && typeof hashes === 'object' ? hashes[id] : undefined;
}

export function computeFeedbackCalibrationV4(entries, context = {}, policy = {}) {
  const stats = new Map();
  const now = Number.isFinite(policy.nowMs) ? policy.nowMs : Date.now();
  const maxAgeMs = (policy.maxAgeDays ?? 90) * 86400000;
  const identity = (entry, decision) => JSON.stringify([entry.host,entry.taskType,entry.routeId,entry.modelId || null,decision.skillId,decision.mode,decision.contentHash]);
  const revoked = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.revoked === true && validateOutcomeV4(entry).ok)
      for (const decision of entry.decisions) revoked.add(identity(entry,decision));
  }
  // Retries and repeated reports from one task are not independent observations.
  // Records without task identity remain readable audit history, not calibration.
  const observations = new Map();
  for (const raw of Array.isArray(entries) ? entries : []) {
    const checked = validateOutcomeV4(raw);
    if (!checked.ok) continue;
    const entry = checked.entry;
    if (typeof entry.routeId !== 'string' || !entry.routeId.trim()) continue;
    if (context.host && entry.host !== context.host) continue;
    if (context.taskType && entry.taskType !== context.taskType) continue;
    if (!context.modelId || !entry.modelId || entry.modelId !== context.modelId) continue;
    if (entry.revoked === true) continue;
    const observed = Date.parse(entry.observedAt || entry.timestamp || '');
    // Undated legacy records remain readable audit history, but cannot be
    // assumed current forever. MCP-written records already have a timestamp.
    if (!Number.isFinite(observed) || observed > now || now - observed > maxAgeMs) continue;
    for (const decision of entry.decisions) {
      if (revoked.has(identity(entry,decision))) continue;
      if (!decision.shown || !decision.read || !decision.adopted || decision.mode === 'skip') continue;
      if (!['helpful', 'wrong', 'unnecessary'].includes(decision.outcome)) continue;
      const expectedHash = hashFor(context, decision.skillId);
      if (!expectedHash || expectedHash !== decision.contentHash) continue;
      if (context.mode && decision.mode !== context.mode) continue;
      const trusted = decision.evidence.some((item) => (item.kind === 'validation' || item.kind === 'user')
        && item.reference.trim() && (decision.outcome !== 'helpful' || item.kind === 'user' || item.passed === true));
      if (!trusted) continue;
      const key = `${decision.skillId}\u0000${decision.mode}\u0000${decision.contentHash}`;
      const observationKey = identity(entry,decision);
      const previous = observations.get(observationKey);
      if (previous) {
        if (previous.outcome !== decision.outcome) previous.conflicted = true;
        continue;
      }
      observations.set(observationKey, {key, decision, outcome: decision.outcome, conflicted: false});
    }
  }
  for (const {key, decision, conflicted} of observations.values()) {
      if (conflicted) continue;
      const item = stats.get(key) || {skillId: decision.skillId, mode: decision.mode, contentHash: decision.contentHash, samples: 0, helpful: 0, negative: 0};
      item.samples++;
      if (decision.outcome === 'helpful') item.helpful++;
      else item.negative++;
      stats.set(key, item);
  }
  const result = new Map();
  const minimumSamples = policy.minimumSamples ?? 5;
  const boostMinimumSamples = policy.boostMinimumSamples ?? 10;
  const boostLowerBound = policy.boostLowerBound ?? 0.75;
  const penaltySuccessRate = policy.penaltySuccessRate ?? 0.4;
  for (const [, item] of stats) {
    const successRate = item.helpful / item.samples;
    const bound = lowerBound(item.helpful, item.samples);
    let adjustment = 0;
    if (item.samples >= boostMinimumSamples && bound >= boostLowerBound) adjustment = bound >= 0.9 ? 2 : 1;
    else if (item.samples >= minimumSamples && successRate <= penaltySuccessRate) adjustment = successRate <= 0.15 ? -3 : successRate <= 0.3 ? -2 : -1;
    const calibrated = {...item, successRate, lowerBound: bound, adjustment: Math.max(-3, Math.min(2, adjustment))};
    if (context.mode) {
      const prior = result.get(item.skillId);
      result.set(item.skillId, prior && prior.contentHash !== item.contentHash
        ? {adjustment: 0, ambiguousContentHashes: true, byHash: {...(prior.byHash || {[prior.contentHash]: prior}), [item.contentHash]: calibrated}}
        : calibrated);
    }
    else {
      const prior = result.get(item.skillId) || {adjustment: 0, byMode: {}};
      const previousMode = prior.byMode[item.mode];
      prior.byMode[item.mode] = previousMode && previousMode.contentHash !== item.contentHash
        ? {adjustment: 0, ambiguousContentHashes: true, byHash: {...(previousMode.byHash || {[previousMode.contentHash]: previousMode}), [item.contentHash]: calibrated}}
        : calibrated;
      result.set(item.skillId, prior);
    }
  }
  return result;
}

export function readFeedbackV4(context = {}, policy = {}, feedbackPath = path.join(LOG_ROOT, 'feedback-v4.jsonl')) {
  let content;
  try { content = fs.readFileSync(feedbackPath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const entries = content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  return computeFeedbackCalibrationV4(entries, context, policy);
}
