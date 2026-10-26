import path from 'node:path';

// This module plans declared work. It performs no dispatch, filesystem I/O or model calls.
const STATUSES = new Set(['pending', 'running', 'completed', 'blocked', 'failed']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = value => typeof value === 'string' ? value.trim() : '';

export function planWorkItems(workItems, options = {}) {
  const violations = [];
  const issue = (code, message, taskIds = [], severity = 'error') => violations.push({ code, severity, taskIds, message });
  if (!record(options)) { issue('INVALID_OPTIONS', 'options must be an object.'); options = {}; }
  const integer = (value, fallback, min, max, field, ids = []) => {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) {
      issue('INVALID_NUMBER', `${field} must be an integer from ${min} to ${max}.`, ids);
      return fallback;
    }
    return value;
  };
  const strings = (value, field, ids, required = false, max = 64) => {
    if (value === undefined && !required) return [];
    if (!Array.isArray(value) || value.length > max || value.some(v => !clean(v) || v.length > 4000)) {
      issue('INVALID_LIST', `${field} must be an array of at most ${max} nonempty strings.`, ids);
      return [];
    }
    return [...new Set(value.map(v => v.trim()))];
  };
  const slots = integer(options.availableAgentSlots, 1, 1, 64, 'availableAgentSlots');
  const maxReplans = integer(options.maxReplans, 2, 0, 10, 'maxReplans');
  const replanCount = integer(options.replanCount, 0, 0, 1000, 'replanCount');
  const revision = integer(options.revision, 1, 1, 1000000, 'revision');
  const availableModels = strings(options.availableModels, 'availableModels', []);
  for (const key of ['delegationAuthorized', 'caseSensitivePaths']) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') issue('INVALID_OPTION', `${key} must be boolean.`);
  }
  if (options.workspaceRoot !== undefined && !clean(options.workspaceRoot)) issue('INVALID_OPTION', 'workspaceRoot must be a nonempty string.');
  if (!Array.isArray(workItems) || !workItems.length || workItems.length > 64) {
    issue('INVALID_WORK_ITEMS', 'Supply 1–64 concrete work items; vague requests must first be shaped by the main agent.');
    workItems = [];
  }
  const tasks = workItems.map((raw, index) => {
    if (!record(raw)) { issue('INVALID_TASK', `workItems[${index}] must be an object.`); raw = {}; }
    const id = clean(raw.id);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) issue('INVALID_ID', `workItems[${index}] needs a portable, unique id.`, [id]);
    const objective = clean(raw.objective);
    if (!objective || objective.length > 4000) issue('MISSING_OBJECTIVE', 'A bounded objective of 1–4000 characters is required.', [id]);
    const owner = clean(raw.owner);
    if (!owner || owner.length > 128) issue('MISSING_OWNER', 'Each task needs one named owner (at most 128 characters).', [id]);
    const dependsOn = strings(raw.dependsOn, 'dependsOn', [id]);
    const acceptance = strings(raw.acceptance, 'acceptance', [id], true, 16);
    if (!acceptance.length) issue('MISSING_ACCEPTANCE', 'Provide task-specific acceptance checks before dispatch.', [id]);
    if (acceptance.some(v => /^(done|works|pass|完成|通过|测试通过|质量合格)[.!。！]?$/i.test(v))) issue('GENERIC_ACCEPTANCE', 'Replace generic acceptance text with an observable check for this objective.', [id]);
    if (!record(raw.files)) issue('MISSING_SCOPE', 'Declare files.read and files.write arrays, including explicit empty arrays for work without files.', [id]);
    const files = { read: strings(raw.files?.read, 'files.read', [id], true), write: strings(raw.files?.write, 'files.write', [id], true) };
    const contextRefs = strings(raw.contextRefs, 'contextRefs', [id], true, 32);
    const evidence = strings(raw.evidence, 'evidence', [id], false, 32);
    const status = raw.status === undefined ? 'pending' : clean(raw.status);
    if (!STATUSES.has(status)) issue('INVALID_STATUS', 'status must be pending, running, completed, blocked or failed.', [id]);
    if (status === 'completed' && !evidence.length) issue('MISSING_COMPLETION_EVIDENCE', 'Completed tasks require evidence references; the main agent must verify their contents.', [id]);
    if (raw.budget !== undefined && !record(raw.budget)) issue('INVALID_BUDGET', 'budget must be an object.', [id]);
    const budget = {
      maxAttempts: integer(raw.budget?.maxAttempts, 2, 1, 5, 'budget.maxAttempts', [id]),
      maxMinutes: integer(raw.budget?.maxMinutes, 30, 1, 1440, 'budget.maxMinutes', [id]),
    };
    const attempts = integer(raw.attempts, 0, 0, 1000, 'attempts', [id]);
    const estimatedMinutes = raw.estimatedMinutes === undefined ? null : raw.estimatedMinutes;
    if (estimatedMinutes !== null && (typeof estimatedMinutes !== 'number' || !Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0 || estimatedMinutes > 1440)) issue('INVALID_ESTIMATE', 'estimatedMinutes must be a positive number at most 1440.', [id]);
    const modelPreference = clean(raw.modelPreference);
    if (raw.modelPreference !== undefined && !modelPreference) issue('INVALID_MODEL', 'modelPreference must be a nonempty string when supplied.', [id]);
    if (modelPreference && !availableModels.includes(modelPreference)) issue('MODEL_UNVERIFIED', 'The preferred model is not in the host-supplied availableModels; inherit the host model until verified.', [id], 'warning');
    return { id, objective, owner, dependsOn, files, acceptance, contextRefs, role: clean(raw.role) || 'worker',
      modelPreference: modelPreference || null, resolvedModel: modelPreference && availableModels.includes(modelPreference) ? modelPreference : 'inherit',
      estimatedMinutes, budget, attempts, status, evidence };
  });
  const byId = new Map();
  for (const task of tasks) {
    if (byId.has(task.id)) issue('DUPLICATE_ID', 'Task ids must be unique.', [task.id]);
    byId.set(task.id, task);
  }
  for (const task of tasks) for (const dep of task.dependsOn) {
    if (!byId.has(dep)) issue('UNKNOWN_DEPENDENCY', `Dependency ${dep} does not exist.`, [task.id]);
    if (dep === task.id) issue('SELF_DEPENDENCY', 'A task cannot depend on itself.', [task.id]);
  }
  const visiting = new Set(), visited = new Set(), ordered = [];
  let cyclic = false;
  const visit = (id, trail = []) => {
    if (visiting.has(id)) { cyclic = true; issue('DEPENDENCY_CYCLE', 'Remove this dependency cycle before dispatch.', [...trail.slice(trail.indexOf(id)), id]); return; }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).dependsOn) visit(dep, [...trail, id]);
    visiting.delete(id); visited.add(id); ordered.push(id);
  };
  for (const task of tasks) visit(task.id);
  const ancestors = new Map();
  if (!cyclic) for (const id of ordered) {
    const set = new Set();
    for (const dep of byId.get(id).dependsOn) { set.add(dep); for (const ancestor of ancestors.get(dep) || []) set.add(ancestor); }
    ancestors.set(id, set);
  }
  const isOrdered = (a, b) => ancestors.get(a)?.has(b) || ancestors.get(b)?.has(a);
  const root = clean(options.workspaceRoot) || process.cwd();
  const windowsPaths = /^[A-Za-z]:[\\/]|^\\\\/.test(root) || process.platform === 'win32';
  const pathApi = windowsPaths ? path.win32 : path.posix;
  const normalize = scope => {
    const value = scope.replaceAll('\\', '/');
    const resolved = pathApi.resolve(root, value).replaceAll('\\', '/').replace(/\/$/, '');
    return options.caseSensitivePaths === true ? resolved : resolved.toLowerCase();
  };
  // Unknown glob intersections are conservatively treated as overlapping at the
  // nearest literal directory. This is a scheduling guard, not a filesystem sandbox.
  const scopeBase = scope => {
    const normalized = normalize(scope);
    const wildcard = normalized.search(/[*?\[\]{}]/);
    return wildcard < 0 ? normalized : normalized.slice(0, normalized.lastIndexOf('/', wildcard) + 1).replace(/\/$/, '');
  };
  const overlaps = (a, b) => {
    const x = scopeBase(a), y = scopeBase(b);
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  };
  const conflicts = [];
  for (let i = 0; i < tasks.length; i++) for (let j = i + 1; j < tasks.length; j++) {
    const a = tasks[i], b = tasks[j];
    const writeWrite = a.files.write.some(x => b.files.write.some(y => overlaps(x, y)));
    const readWrite = a.files.write.some(x => b.files.read.some(y => overlaps(x, y))) || b.files.write.some(x => a.files.read.some(y => overlaps(x, y)));
    if (!writeWrite && !readWrite) continue;
    conflicts.push({ taskIds: [a.id, b.id], kind: writeWrite ? 'write_write' : 'read_write', ordered: Boolean(isOrdered(a.id, b.id)) });
    if (!isOrdered(a.id, b.id)) issue(writeWrite ? 'UNORDERED_WRITERS' : 'UNORDERED_READ_WRITE', 'Overlapping file scopes require an explicit dependency and handoff, or narrower nonoverlapping scopes.', [a.id, b.id]);
    if (a.status === 'running' && b.status === 'running') issue('RUNNING_SCOPE_CONFLICT', 'Running tasks overlap; the main agent must coordinate their writes before further dispatch.', [a.id, b.id]);
  }
  const running = tasks.filter(t => t.status === 'running');
  const workerSlots = Math.max(0, slots - 1);
  if (running.length > workerSlots) issue('SLOT_OVERCOMMIT', 'Running workers exceed available slots after reserving one slot for the main agent.', running.map(t => t.id));
  for (const task of tasks) {
    if (['running', 'completed'].includes(task.status) && task.dependsOn.some(id => byId.get(id)?.status !== 'completed')) issue('UNSATISFIED_STATE_DEPENDENCY', 'Running/completed tasks must have completed dependencies.', [task.id]);
    if (task.status === 'pending' && task.attempts >= task.budget.maxAttempts) issue('ATTEMPTS_EXHAUSTED', 'Attempt budget exhausted; the main agent must revise this work item before retrying.', [task.id]);
  }
  if (new Set(running.map(t => t.owner)).size < running.length) issue('OWNER_OVERCOMMIT', 'One owner cannot run two work items concurrently.', running.map(t => t.id));
  const failedIds = tasks.filter(t => ['failed', 'blocked'].includes(t.status)).map(t => t.id);
  const blockedTaskIds = tasks.filter(t => failedIds.includes(t.id) || [...(ancestors.get(t.id) || [])].some(id => failedIds.includes(id))).map(t => t.id);
  const cost = new Map(), next = new Map();
  if (!cyclic) for (const id of [...ordered].reverse()) {
    const successors = tasks.filter(t => t.dependsOn.includes(id));
    successors.sort((a, b) => (cost.get(b.id) || 0) - (cost.get(a.id) || 0) || a.id.localeCompare(b.id));
    const child = successors[0];
    cost.set(id, (byId.get(id).estimatedMinutes || 1) + (child ? cost.get(child.id) || 0 : 0));
    if (child) next.set(id, child.id);
  }
  const priority = (a, b) => (cost.get(b.id) || 0) - (cost.get(a.id) || 0) || a.id.localeCompare(b.id);
  const criticalIds = [];
  if (!cyclic && tasks.length) {
    let id = [...tasks].sort(priority)[0].id;
    while (id) { criticalIds.push(id); id = next.get(id); }
  }
  const allEstimated = tasks.length > 0 && tasks.every(t => typeof t.estimatedMinutes === 'number' && Number.isFinite(t.estimatedMinutes) && t.estimatedMinutes > 0);
  const reasons = [];
  if (violations.some(v => v.severity === 'error')) reasons.push('invalid_work_contract');
  if (options.delegationAuthorized !== true) reasons.push('delegation_not_established');
  if (workerSlots === 0) reasons.push('no_worker_slots');
  if (replanCount > maxReplans) reasons.push('replan_budget_exhausted');
  const readyWaves = [];
  if (!violations.some(v => v.severity === 'error') && workerSlots > 0) {
    const completed = new Set(tasks.filter(t => t.status === 'completed').map(t => t.id));
    const initiallyCompleted = new Set(completed);
    const pending = new Set(tasks.filter(t => t.status === 'pending' && !blockedTaskIds.includes(t.id)).map(t => t.id));
    let active = [...running], future = false;
    while (pending.size) {
      const chosen = [], owners = new Set(active.map(t => t.owner));
      const candidates = [...pending].map(id => byId.get(id)).filter(t => t.dependsOn.every(id => completed.has(id))).sort(priority);
      for (const task of candidates) {
        if (chosen.length >= workerSlots - active.length) break;
        if (owners.has(task.owner)) continue;
        chosen.push(task); owners.add(task.owner);
      }
      if (!chosen.length && !active.length) break;
      if (chosen.length) readyWaves.push({ index: readyWaves.length, taskIds: chosen.map(t => t.id),
        dispatchableNow: !future && reasons.length === 0,
        requiresCompleted: [...new Set(chosen.flatMap(t => t.dependsOn).filter(id => !initiallyCompleted.has(id)))],
        condition: future ? 'Revalidate after earlier work completes and its evidence passes acceptance.' : 'Recheck host slots and authorization immediately before dispatch.' });
      for (const task of [...active, ...chosen]) { completed.add(task.id); pending.delete(task.id); }
      active = []; future = true;
    }
  }
  const readyTaskIds = readyWaves.filter(w => w.dispatchableNow).flatMap(w => w.taskIds);
  if (!readyTaskIds.length && !reasons.length) reasons.push(running.length ? 'await_running_work' : blockedTaskIds.length ? 'blocked_dependencies' : tasks.every(t => t.status === 'completed') ? 'all_completed' : 'no_ready_work');
  const handoffContracts = tasks.map(t => ({ taskId: t.id, owner: t.owner, objective: t.objective, role: t.role,
    model: t.resolvedModel, writeScope: t.files.write, readScope: t.files.read,
    context: { mode: 'references_only', refs: t.contextRefs, upstreamTaskIds: t.dependsOn, includeFullConversation: false },
    acceptance: t.acceptance, budget: t.budget,
    returnRequired: ['changedFilesOrArtifactRefs', 'acceptanceEvidence', 'unresolvedRisks', 'nextAction'],
    integrationGate: 'The main agent verifies task-specific acceptance evidence and scope before marking completed.' }));
  return { schemaVersion: '1.0', planner: 'declared-work-dag', revision, tasks, readyTaskIds, readyWaves,
    violations, conflicts, blockedTaskIds, handoffContracts,
    criticalPath: { taskIds: criticalIds, estimatedMinutes: allEstimated && criticalIds.length ? cost.get(criticalIds[0]) : null,
      basis: allEstimated ? 'caller_supplied_estimates' : 'dependency_depth_with_unit_fallback',
      note: 'Dependency priority only; this is not a resource-constrained completion-time prediction.' },
    dispatchReadiness: { ready: readyTaskIds.length > 0, reasons, availableAgentSlots: slots, reservedMainAgentSlots: 1,
      workerSlots, occupiedWorkerSlots: running.length, freeWorkerSlots: Math.max(0, workerSlots - running.length),
      delegationAuthorized: options.delegationAuthorized === true, launchedAgents: 0, executor: 'main_agent_native_tools' },
    replanPolicy: { replanCount, maxReplans, exhausted: replanCount > maxReplans,
      triggers: ['acceptance_failure', 'attempt_or_time_budget_exhausted', 'dependency_blocked', 'scope_overlap_discovered', 'host_capacity_or_model_changed'],
      action: 'Pause affected dependents, preserve verified results, and ask the main agent to revise the smallest failing work item. Unaffected work may continue.',
      atLimit: 'Return evidence and the unresolved blocker to the main agent for a changed approach or user input only when necessary; never loop automatically.',
      retryPermission: 'No automatic retries or model escalations are executed by this planner.' },
    limitations: ['Task scope and acceptance semantics require main-agent judgment.', 'File matching is lexical and conservative; symlinks and filesystem identities are not inspected.', 'Evidence references are declared, not read or verified.', 'Budget defaults are configurable planning bounds, not performance claims.'] };
}
