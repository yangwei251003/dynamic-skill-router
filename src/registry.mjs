import fs from 'node:fs';
import path from 'node:path';
import { REGISTRY_PATH, SKILLS_ROOT } from './paths.mjs';

export function loadRegistry() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  registry.skills = registry.skills.map((skill) => ({...skill, path: path.join(SKILLS_ROOT, skill.id)}));
  return registry;
}

export function normalize(value = '') {
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/[\s_$@/\\:：,，。.!！?？()（）\[\]【】"'“”‘’_-]+/g, '');
}

export function validateRegistry(registry = loadRegistry()) {
  const errors = [];
  const validRoles = new Set(['workflow_owner', 'orchestrator', 'specialist', 'verifier', 'publisher', 'reference']);
  const validHostStates = new Set(['native', 'degraded', 'unsupported']);
  const seenIds = new Set();
  const seenAliases = new Map();
  for (const skill of registry.skills) {
    if (!skill.id || !skill.nameZh || !skill.summaryZh) errors.push(`字段不完整: ${skill.id || '(无ID)'}`);
    if (seenIds.has(skill.id)) errors.push(`重复ID: ${skill.id}`);
    seenIds.add(skill.id);
    if (skill.role && !validRoles.has(skill.role)) errors.push(`无效角色 ${skill.role}: ${skill.id}`);
    if (skill.estimatedTokens != null && (!Number.isFinite(skill.estimatedTokens) || skill.estimatedTokens < 0)) errors.push(`无效Token估算: ${skill.id}`);
    for (const [host, state] of Object.entries(skill.hostCompatibility || {})) {
      if (!validHostStates.has(state)) errors.push(`无效宿主状态 ${host}=${state}: ${skill.id}`);
    }
    if (!fs.existsSync(path.join(skill.path, 'SKILL.md'))) errors.push(`缺少SKILL.md: ${skill.id}`);
    for (const alias of [skill.id, skill.nameZh, ...(skill.aliases || [])]) {
      const key = normalize(alias);
      if (seenAliases.has(key) && seenAliases.get(key) !== skill.id) errors.push(`别名冲突: ${alias}`);
      else seenAliases.set(key, skill.id);
    }
  }
  for (const skill of registry.skills) {
    for (const target of [...(skill.supersedes || []), ...(skill.conflictsWith || [])]) {
      if (!seenIds.has(target)) errors.push(`治理引用不存在 ${skill.id} -> ${target}`);
    }
  }
  return {ok: errors.length === 0, errors, count: registry.skills.length};
}

export function resolveAlias(name, registry = loadRegistry()) {
  const key = normalize(name);
  if (!key) return null;
  for (const skill of registry.skills) {
    for (const alias of [skill.id, skill.nameZh, ...(skill.aliases || [])]) {
      if (normalize(alias) === key) return skill;
    }
  }
  return null;
}
