#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GLOBAL_ROOT, REGISTRY_PATH, SKILLS_ROOT } from './paths.mjs';
import { estimateTokens } from './coordination-planner.mjs';
import { REGISTRY_SCHEMA_VERSION } from './version.mjs';
import { getManagedSkillHosts } from './host-manifest.mjs';

const USER_ROOT = path.resolve(process.env.SKILL_ROUTER_HOME || path.join(GLOBAL_ROOT, 'home'));
const ROUTER_ID = 'dynamic-skill-router';
const hosts = getManagedSkillHosts();
const ignoredNames = new Set(['.system', '.git', 'node_modules', '_shared']);
const statePath = path.join(GLOBAL_ROOT, '技能注册表', 'sync-state.json');
const overridesPath = path.join(GLOBAL_ROOT, '技能注册表', 'routing-overrides.json');
const policyPath = path.join(GLOBAL_ROOT, '技能注册表', 'router-policy.json');
const lockPath = path.join(GLOBAL_ROOT, '技能注册表', 'sync.lock');
const archiveRoot = path.join(GLOBAL_ROOT, '路由器薄目录归档');
const defaultPolicy = {
  maxPrimary: 1,
  maxSupport: 4,
  maxPotential: 8,
  selectionThreshold: 9,
  supportThreshold: 8,
  potentialThreshold: 5.5,
  defaultDecision: 'NO_SKILL',
  excludeRouterItself: true,
  semanticRouting: {
    enabled: true,
    allowSafeUncurated: true,
    activationThreshold: 11,
  },
  feedbackCalibration: {enabled: true, minimumSamples: 5, boostMinimumSamples: 10, boostLowerBound: 0.75, penaltySuccessRate: 0.4, maxBoost: 2, maxPenalty: 3},
  coordination: {defaultProfile: 'balanced', maxAgentSlots: 4, maxLoadedSkills: 5, parallelMinimumSpeedup: 1.3},
};

function frontmatter(text) {
  const block = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const result = {};
  if (!block) return result;
  const lines = block[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const scalar = rawValue.trim();
    if (/^[|>][+-]?$/.test(scalar)) {
      const chunks = [];
      while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || lines[index + 1] === '')) {
        index += 1;
        chunks.push(lines[index].replace(/^\s+/, ''));
      }
      result[key] = scalar.startsWith('>')
        ? chunks.join(' ').replace(/\s+/g, ' ').trim()
        : chunks.join('\n').trim();
      continue;
    }
    result[key] = scalar.replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function normalizeKey(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(/[\s_$@/\\:：,，。.!！?？()（）\[\]【】'"“”‘’_-]+/g, '');
}

function removeAliasConflicts(skills) {
  const idOwners = new Map(skills.map((skill) => [normalizeKey(skill.id), skill.id]));
  const claimed = new Map(idOwners);
  for (const skill of skills) {
    let nameKey = normalizeKey(skill.nameZh);
    if (claimed.has(nameKey) && claimed.get(nameKey) !== skill.id) {
      skill.nameZh = skill.id;
      nameKey = normalizeKey(skill.nameZh);
    }
    claimed.set(nameKey, skill.id);
    skill.aliases = (skill.aliases || []).filter((alias) => {
      const key = normalizeKey(alias);
      if (!key || (claimed.has(key) && claimed.get(key) !== skill.id)) return false;
      claimed.set(key, skill.id);
      return true;
    });
  }
  return skills;
}

function findSkills(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (ignoredNames.has(entry.name) || entry.name.startsWith('.')) continue;
    const candidate = path.join(root, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillFile = path.join(candidate, 'SKILL.md');
    if (fs.existsSync(skillFile)) found.push({id: entry.name, source: candidate, root});
  }
  return found;
}

function discoverScanRoots() {
  const roots = [
    ...Object.values(hosts),
    path.join(USER_ROOT, '.agents', 'skills'),
    path.join(USER_ROOT, '.antigravity', 'skills'),
    path.join(USER_ROOT, '.gemini', 'antigravity', 'skills'),
  ];
  for (const entry of fs.readdirSync(USER_ROOT, {withFileTypes: true})) {
    if (!entry.isDirectory() || !entry.name.startsWith('.')) continue;
    const agentRoot = path.join(USER_ROOT, entry.name);
    for (const relative of ['skills', path.join('config', 'skills'), path.join('antigravity', 'skills')]) {
      const candidate = path.join(agentRoot, relative);
      if (fs.existsSync(candidate)) roots.push(candidate);
    }
  }
  return [...new Set(roots.map((item) => path.resolve(item)))];
}

function rootSignature(root) {
  if (!fs.existsSync(root)) return {exists: false, mtimeMs: 0, entries: 0};
  const stat = fs.statSync(root);
  return {exists: true, mtimeMs: Math.round(stat.mtimeMs), entries: fs.readdirSync(root).length};
}

function scanSignature(roots) {
  return Object.fromEntries(roots.map((root) => [root, rootSignature(root)]));
}

export function scanInputsChanged() {
  if (!fs.existsSync(statePath)) return true;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const roots = discoverScanRoots();
    if (!state.scanSignature || roots.length !== (state.scanRoots || []).length) return true;
    const previousRoots = new Set(state.scanRoots || []);
    if (roots.some((root) => !previousRoots.has(root))) return true;
    const current = scanSignature(roots);
    return roots.some((root) => JSON.stringify(current[root]) !== JSON.stringify(state.scanSignature[root]));
  } catch {
    return true;
  }
}

function acquireSyncLock() {
  fs.mkdirSync(path.dirname(lockPath), {recursive: true});
  try { return fs.openSync(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > 120_000) {
        fs.unlinkSync(lockPath);
        return fs.openSync(lockPath, 'wx');
      }
    } catch { /* Another process may have released the lock. */ }
    return null;
  }
}

function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

function isArchivedForHost(host, id) {
  const names = host === 'antigravity' ? ['antigravity', 'gemini'] : [host];
  return names.some((name) => fs.existsSync(path.join(archiveRoot, name, id)));
}

function safeTime(skillPath) {
  const skillFile = path.join(skillPath, 'SKILL.md');
  const stat = fs.statSync(skillFile);
  const value = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
  return value.toISOString();
}

function isSameTarget(source, target) {
  try { return fs.realpathSync(source).toLowerCase() === fs.realpathSync(target).toLowerCase(); }
  catch { return false; }
}

function makeRegistryEntry(id, canonicalPath, previous, sourceLabel) {
  const skillText = fs.readFileSync(path.join(canonicalPath, 'SKILL.md'), 'utf8');
  const meta = frontmatter(skillText);
  const description = meta.description || previous?.summaryZh || `使用 ${meta.name || id} 技能完成与其说明匹配的任务。`;
  const estimatedTokens = estimateTokens(skillText);
  return {
    id,
    nameZh: previous?.nameZh || meta.name || id,
    aliases: [...new Set([id, ...(previous?.aliases || [])])],
    summaryZh: description,
    category: previous?.category || '自动发现',
    family: previous?.family || id,
    // Newly discovered skills are immediately addressable by name, but do not
    // compete for implicit routing until their triggers have been curated.
    implicit: previous && previous.category !== '自动发现' ? previous.implicit : false,
    status: previous?.status || 'ready',
    risk: previous?.risk || 'low',
    triggers: previous?.triggers?.length ? previous.triggers : [id, meta.name].filter(Boolean),
    negative: previous?.negative || [],
    requirements: previous?.requirements || {commands: []},
    source: previous?.source || sourceLabel,
    sourceUrl: previous?.sourceUrl || '',
    installedAt: previous?.installedAt || safeTime(canonicalPath),
    updatedAt: safeTime(canonicalPath),
    instructionChars: skillText.length,
    estimatedTokens,
    tokenTier: estimatedTokens <= 2500 ? 'small' : estimatedTokens <= 6000 ? 'medium' : 'large',
    path: canonicalPath,
  };
}

function normalizeGovernanceFields(skill) {
  const legacyRoles = {owner: 'workflow_owner', validator: 'verifier', orchestrator: 'orchestrator', specialist: 'specialist'};
  const role = skill.role || legacyRoles[skill.compositionRole] || (skill.family === 'git-delivery' ? 'publisher' : 'specialist');
  const compatible = Array.isArray(skill.compatibleHosts) ? new Set(skill.compatibleHosts) : null;
  const hostCompatibility = skill.hostCompatibility || (compatible ? Object.fromEntries(
    ['codex', 'workbuddy', 'antigravity'].map((host) => [host, compatible.has(host) ? (skill.status === 'degraded' ? 'degraded' : 'native') : 'unsupported']),
  ) : {});
  return {
    ...skill,
    role,
    phase: skill.phase || (role === 'verifier' ? 'verification' : role === 'publisher' ? 'delivery' : role === 'orchestrator' ? 'orchestration' : 'any'),
    mutationScope: skill.mutationScope || (role === 'verifier' || role === 'reference' ? 'read_only' : role === 'publisher' ? 'external_write' : 'unspecified'),
    hostCompatibility,
    requiresTools: skill.requiresTools || skill.requirements?.commands || [],
    supersedes: skill.supersedes || [],
    conflictsWith: skill.conflictsWith || [],
  };
}

export function synchronizeInstalledSkills({generateDashboard = true} = {}) {
  const lock = acquireSyncLock();
  if (lock == null) return {timestamp: new Date().toISOString(), skipped: true, reason: '另一个同步进程正在运行'};
  try {
  fs.mkdirSync(SKILLS_ROOT, {recursive: true});
  const registry = fs.existsSync(REGISTRY_PATH)
    ? JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    : {schemaVersion: REGISTRY_SCHEMA_VERSION, policy: defaultPolicy, skills: []};
  registry.schemaVersion = REGISTRY_SCHEMA_VERSION;
  const configuredPolicy = fs.existsSync(policyPath) ? JSON.parse(fs.readFileSync(policyPath, 'utf8')) : {};
  registry.policy = {
    ...defaultPolicy,
    ...(registry.policy || {}),
    ...configuredPolicy,
    semanticRouting: {...defaultPolicy.semanticRouting, ...(registry.policy?.semanticRouting || {}), ...(configuredPolicy.semanticRouting || {})},
    feedbackCalibration: {...defaultPolicy.feedbackCalibration, ...(registry.policy?.feedbackCalibration || {}), ...(configuredPolicy.feedbackCalibration || {})},
    coordination: {...defaultPolicy.coordination, ...(registry.policy?.coordination || {}), ...(configuredPolicy.coordination || {})},
  };
  const previous = new Map((registry.skills || []).map((skill) => [skill.id, skill]));
  const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};
  const scanRoots = discoverScanRoots();
  const discovered = scanRoots.flatMap(findSkills);
  const copied = [], mapped = [], conflicts = [];

  for (const item of discovered) {
    if (item.id === ROUTER_ID) continue;
    const canonical = path.join(SKILLS_ROOT, item.id);
    if (!fs.existsSync(canonical)) {
      fs.cpSync(item.source, canonical, {recursive: true, dereference: true, errorOnExist: true});
      copied.push({id: item.id, from: item.source});
    }
  }

  const canonicalSkills = findSkills(SKILLS_ROOT);
  for (const skill of canonicalSkills) {
    for (const [host, root] of Object.entries(hosts)) {
      fs.mkdirSync(root, {recursive: true});
      const destination = path.join(root, skill.id);
      if (isArchivedForHost(host, skill.id)) continue;
      if (!fs.existsSync(destination)) {
        fs.symlinkSync(skill.source, destination, 'junction');
        mapped.push({host, id: skill.id});
      } else if (!isSameTarget(destination, skill.source)) {
        conflicts.push({host, id: skill.id, path: destination, reason: '宿主已有独立副本，已保留未覆盖'});
      }
    }
  }

  registry.skills = removeAliasConflicts(canonicalSkills.map((skill) => normalizeGovernanceFields({...makeRegistryEntry(
    skill.id,
    skill.source,
    previous.get(skill.id),
    discovered.find((item) => item.id === skill.id)?.root || '个人全局技能库',
  ), ...(overrides[skill.id] || {})})).sort((a, b) => Date.parse(b.installedAt) - Date.parse(a.installedAt) || a.id.localeCompare(b.id, 'en')));
  registry.updatedAt = new Date().toISOString();
  registry.canonicalRoot = SKILLS_ROOT;
  registry.registryRevision = createHash('sha256').update(JSON.stringify({
    policy: registry.policy,
    skills: registry.skills.map((skill) => ({
      id: skill.id,
      updatedAt: skill.updatedAt,
      status: skill.status,
      triggers: skill.triggers,
      role: skill.role,
      hostCompatibility: skill.hostCompatibility,
    })),
  })).digest('hex').slice(0, 16);
  writeJsonAtomic(REGISTRY_PATH, registry);
  const result = {timestamp: new Date().toISOString(), scanRoots, scanSignature: scanSignature(scanRoots), hosts, copied, mapped, conflicts, total: registry.skills.length};
  writeJsonAtomic(statePath, result);

  if (generateDashboard) {
    execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'generate-dashboard.mjs')], {stdio: ['ignore', 'ignore', 'pipe']});
  }
  return result;
  } finally {
    fs.closeSync(lock);
    try { fs.unlinkSync(lockPath); } catch { /* Lock cleanup is best effort. */ }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(synchronizeInstalledSkills(), null, 2));
}
