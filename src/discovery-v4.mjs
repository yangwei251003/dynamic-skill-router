import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {GLOBAL_ROOT, LOG_ROOT, REGISTRY_PATH, ROUTER_ROOT, SKILLS_ROOT} from './paths.mjs';
import {normalize} from './registry.mjs';

const CONFIG_PATH = path.join(ROUTER_ROOT, 'config', 'skill-sources.json');
const SKIP = new Set(['.git', 'node_modules', '__pycache__']);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const unique = (values) => [...new Set(values.filter(Boolean))];
const cleanId = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/g, '') || 'unnamed';
const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const archivedName = (name) => /^(?:backup|archive|snapshot|备份|归档|快照)(?:[._-]|$)/i.test(name) || /(?:^|[._-])(?:backup|archive|snapshot)[._-]\d{4}/i.test(name) || /^(?:版本快照|安装备份|归档区)/.test(name);
const indexCache = new Map();
// Runtime bookkeeping that churns while the skill set stays identical. Watching it
// invalidated the persisted index on every plugin activation.
const VOLATILE_WATCH = /(^|[\\/])(?:\.in_use|\.last_inuse_sweep|__pycache__|\.pytest_cache|\.DS_Store|Thumbs\.db|desktop\.ini)([\\/]|$)/i;
const WATCH_HASH_LIMIT = 64 * 1024;

// Physical identity of a directory. dev:ino is what realpathSync resolved to for the
// junctions this router walks (verified on this host), at roughly a sixth of the cost;
// realpathSync averaged ~0.9ms per call and dominated index builds on Windows.
function identity(target) {
  try {
    const stat = fs.statSync(target, {bigint: true});
    if (stat.ino !== 0n) return `${stat.dev}:${stat.ino}`;
  } catch { return null; }
  try { return pathKey(fs.realpathSync(target)); } catch { return null; }
}

function identityFromStat(stat, target) {
  return stat.ino !== 0n ? `${stat.dev}:${stat.ino}` : pathKey(path.resolve(target));
}

function fingerprint(file) {
  try {
    const stat = fs.statSync(file, {bigint: true});
    return `${stat.mtimeNs}:${stat.size}:${stat.ino}`;
  } catch { return 'missing'; }
}

// Content is recorded for small files so that hosts rewriting a config with identical
// content (fresh mtime) do not invalidate the index, while real edits still do.
function contentSignature(file) {
  try {
    const stat = fs.statSync(file, {bigint: true});
    if (!stat.isFile() || stat.size > BigInt(WATCH_HASH_LIMIT)) return null;
    return hash(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

function watchDrifted(entry) {
  const [file, signature, content] = entry;
  if (fingerprint(file) === signature) return false;
  if (!content) return true;
  return contentSignature(file) !== content;
}

function snapshot(paths) {
  return [...new Set(paths.filter((item) => !VOLATILE_WATCH.test(item)).map((item) => pathKey(path.resolve(item))))]
    .map((item) => [item, fingerprint(item), contentSignature(item)]);
}

function cacheKey(options) {
  return JSON.stringify({
    host: options.host || 'codex',
    projectRoot: options.projectRoot || null,
    runtimeSkills: options.runtimeSkills ?? null,
    sources: options.sources ?? null,
    registry: options.registry ?? null,
    pluginConfigPath: options.pluginConfigPath || null,
    pluginCacheRoot: options.pluginCacheRoot || null,
  });
}

function indexOutputPath(options, key = cacheKey(options)) {
  if (options.outputPath) return path.resolve(options.outputPath);
  return path.join(path.resolve(options.snapshotRoot || LOG_ROOT), `skill-index-v4-${hash(key).slice(0, 16)}.json`);
}

function cachedIndex(key) {
  const previous = indexCache.get(key);
  if (!previous || previous.watch.some(watchDrifted)) return null;
  return structuredClone(previous.index);
}

function persistedIndex(key, outputPath) {
  let data;
  try { data = JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch { return null; }
  if (data?.schemaVersion !== 4 || data?._cache?.key !== key || !Array.isArray(data._cache.watch)) return null;
  if (data._cache.watch.some(watchDrifted)) return null;
  const {_cache, ...index} = data;
  indexCache.set(key, {index, watch: _cache.watch});
  return structuredClone(index);
}

function parseFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const result = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    if (!field) continue;
    let value = field[2].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const folded = value.startsWith('>');
      const chunks = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) chunks.push(lines[++i].replace(/^\s+/, ''));
      value = folded ? chunks.join(' ').replace(/\s+/g, ' ').trim() : chunks.join('\n').trim();
    }
    result[field[1]] = value.replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function variables(projectRoot) {
  return {HOME: os.homedir(), GLOBAL_ROOT, SKILLS_ROOT, ROUTER_ROOT, PROJECT_ROOT: projectRoot || ''};
}

function expandRoot(root, projectRoot) {
  if (!root || (root.includes('${PROJECT_ROOT}') && !projectRoot)) return null;
  const expanded = root.replace(/\$\{([A-Z_]+)\}/g, (_, key) => variables(projectRoot)[key] ?? '');
  return path.resolve(expanded);
}

function sourceList(sources) {
  if (sources == null) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).sources;
  if (typeof sources === 'string') return JSON.parse(fs.readFileSync(sources, 'utf8')).sources;
  return Array.isArray(sources) ? sources : sources.sources || [];
}

function registryList(registry) {
  if (registry === null) return [];
  if (registry == null) return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')).skills || [];
  if (typeof registry === 'string') return JSON.parse(fs.readFileSync(registry, 'utf8')).skills || [];
  return Array.isArray(registry) ? registry : registry.skills || [];
}

function enumerate(root, recursive, maxDepth = Infinity, excluded = [], directories = new Set(), memo = new Map()) {
  const found = [];
  const seen = new Set();
  function walk(dir, depth, parentPath, inherited) {
    const real = inherited ?? identity(dir);
    if (!real) { excluded.push({path: dir, reason: 'unreadable-path'}); return; }
    const memoKey = `${real}|${recursive ? maxDepth - depth : 0}`;
    const previous = memo.get(memoKey);
    if (previous) {
      for (const item of previous.found) found.push({path: path.join(dir, item.relative), parentPath: item.parentRelative === null ? parentPath : path.join(dir, item.parentRelative), identity: item.identity});
      for (const item of previous.excluded) excluded.push({path: path.join(dir, item.relative), reason: item.reason});
      return;
    }
    directories.add(dir);
    if (seen.has(real)) { excluded.push({path: dir, reason: 'link-cycle'}); return; }
    seen.add(real);
    const foundStart = found.length;
    const excludedStart = excluded.length;
    let entries;
    try { entries = fs.readdirSync(dir, {withFileTypes: true}); }
    catch { excluded.push({path: dir, reason: 'unreadable-directory'}); return; }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (archivedName(entry.name)) { excluded.push({path: path.join(dir, entry.name), reason: 'archive-or-backup'}); continue; }
      if (SKIP.has(entry.name)) { excluded.push({path: path.join(dir, entry.name), reason: 'dependency-directory'}); continue; }
      if (entry.name.startsWith('.') && entry.name !== '.system') { excluded.push({path: path.join(dir, entry.name), reason: 'hidden-directory'}); continue; }
      const candidate = path.join(dir, entry.name);
      let stat;
      try { stat = fs.statSync(candidate, {bigint: true}); }
      catch { excluded.push({path: candidate, reason: 'broken-link-or-unreadable-path'}); continue; }
      if (!stat.isDirectory()) continue;
      const childIdentity = identityFromStat(stat, candidate);
      const skillFile = path.join(candidate, 'SKILL.md');
      const isSkill = fs.existsSync(skillFile);
      if (isSkill) found.push({path: candidate, parentPath, identity: childIdentity});
      if (recursive && depth < maxDepth) walk(candidate, depth + 1, isSkill ? candidate : parentPath, childIdentity);
      else if (recursive && depth >= maxDepth) excluded.push({path: candidate, reason: 'depth-limit', scope: 'descendants'});
    }
    memo.set(memoKey, {
      found: found.slice(foundStart).map((item) => ({relative: path.relative(dir, item.path), identity: item.identity, parentRelative: item.parentPath && path.relative(dir, item.parentPath).startsWith('..') ? null : item.parentPath ? path.relative(dir, item.parentPath) : null})),
      excluded: excluded.slice(excludedStart).map((item) => ({relative: path.relative(dir, item.path), reason: item.reason})),
    });
  }
  if (fs.existsSync(root)) {
    const rootIsSkill = fs.existsSync(path.join(root, 'SKILL.md'));
    if (rootIsSkill) found.push({path: root, parentPath: null, identity: identity(root)});
    walk(root, 0, rootIsSkill ? root : null, undefined);
  }
  return found;
}

function origin(source, skillPath, enabled = true) {
  return {sourceId: source.id, path: skillPath, enabled, ...(source.kind === 'host-plugin' ? {host: source.host, pluginId: source.pluginId, version: source.version, activationState: source.activationState} : source.kind === 'plugin' ? {host: source.host} : {})};
}

function inferredCompatibility(host, group) {
  const ids = new Set(group.map((entry) => entry.source.id));
  const hostPlugin = group.find((entry) => entry.source.kind === 'host-plugin');
  if (hostPlugin) return host === hostPlugin.source.host || host === 'gemini' && hostPlugin.source.host === 'antigravity';
  const runtimePlugin = group.find((entry) => entry.source.kind === 'plugin');
  if (runtimePlugin) return host === runtimePlugin.source.host;
  if (ids.has('codex-system')) return host === 'codex';
  const hostSources = {codex: 'codex', workbuddy: 'workbuddy', antigravity: 'gemini', gemini: 'gemini', claude: 'claude'};
  if (hostSources[host] && ids.has(hostSources[host])) return true;
  if (group.some((entry) => entry.source.kind === 'host') && !ids.has('legacy') && !ids.has('agents')) return false;
  return null;
}

function configuredPluginSkills(configPath, cacheRoot, coverage, errors, watchPaths) {
  watchPaths.add(configPath);
  let config;
  try { config = fs.readFileSync(configPath, 'utf8'); }
  catch (error) { coverage.pluginInventory = 'unknown'; errors.push(`plugin inventory: ${error.message}`); return []; }
  const entries = [];
  let plugin = null;
  for (const line of config.split(/\r?\n/)) {
    const section = line.match(/^\[plugins\."([^\"]+)"\]\s*$/);
    if (section) { plugin = {id: section[1], enabled: false}; entries.push(plugin); continue; }
    if (/^\[/.test(line)) { plugin = null; continue; }
    const enabled = line.match(/^\s*enabled\s*=\s*(true|false)\s*$/);
    if (plugin && enabled) plugin.enabled = enabled[1] === 'true';
  }
  coverage.pluginInventory = 'configured-unverified';
  coverage.configuredPlugins = entries.filter((entry) => entry.enabled).length;
  const result = [];
  for (const entry of entries.filter((item) => item.enabled)) {
    const at = entry.id.lastIndexOf('@');
    if (at < 1) { coverage.unknownPluginManifests++; coverage.entries.push({sourceId: `plugin:${entry.id}`, included: false, reason: 'invalid-plugin-id'}); continue; }
    const pluginName = entry.id.slice(0, at);
    const provider = entry.id.slice(at + 1);
    const pluginRoot = path.join(cacheRoot, provider, pluginName);
    watchPaths.add(pluginRoot);
    let versions;
    try { versions = fs.readdirSync(pluginRoot, {withFileTypes: true}).filter((item) => item.isDirectory()); }
    catch { coverage.unknownPluginManifests++; coverage.entries.push({sourceId: `plugin:${entry.id}`, path: pluginRoot, included: false, reason: 'missing-installed-plugin'}); continue; }
    if (versions.length !== 1) {
      coverage.unknownPluginManifests++;
      coverage.entries.push({sourceId: `plugin:${entry.id}`, path: pluginRoot, included: false, reason: 'ambiguous-or-missing-active-version'});
      continue;
    }
    const skillsRoot = path.join(pluginRoot, versions[0].name, 'skills');
    watchPaths.add(skillsRoot);
    if (!fs.existsSync(skillsRoot)) continue;
    for (const found of enumerate(skillsRoot, true, Infinity, [], watchPaths)) result.push({path: found.path, id: path.relative(skillsRoot, found.path).split(path.sep).join('.'), provider: entry.id, enabled: false, inventoryVerified: false});
  }
  return result;
}

export function discoverSkills(options = {}) {
  const key = cacheKey(options);
  if (!options.force) {
    const previous = cachedIndex(key);
    if (previous) return previous;
    const saved = persistedIndex(key, indexOutputPath(options, key));
    if (saved) return saved;
  }
  const {host = 'codex', projectRoot, runtimeSkills, sources, registry} = options;
  const watchPaths = new Set([fileURLToPath(import.meta.url)]);
  const enumerationMemo = new Map();
  if (sources == null || typeof sources === 'string') watchPaths.add(sources || CONFIG_PATH);
  if (registry == null || typeof registry === 'string') watchPaths.add(registry || REGISTRY_PATH);
  const errors = [];
  const coverage = {sources: [], entries: [], discovered: 0, readable: 0, enabled: 0, excluded: 0, invalid: 0, activePluginManifests: 0, unverifiedPluginManifests: 0, unknownPluginManifests: 0};
  const excludedKeys = new Map();
  const physicalKeys = new Map();
  function physicalKey(target) {
    const cached = physicalKeys.get(target);
    if (cached !== undefined) return cached;
    const key = identity(target) ?? pathKey(path.resolve(target));
    physicalKeys.set(target, key);
    return key;
  }
  function recordExcluded(sourceId, item) {
    const key = `${physicalKey(item.path || item.reason || sourceId)}:${item.reason}`;
    if (excludedKeys.has(key)) { excludedKeys.get(key).origins.push({sourceId, path: item.path}); return; }
    const entry = {sourceId, ...item, included: false, origins: [{sourceId, path: item.path}]};
    excludedKeys.set(key, entry);
    coverage.entries.push(entry);
  }
  let configured, legacy;
  try { configured = sourceList(sources); } catch (error) { configured = []; errors.push(`sources: ${error.message}`); }
  try { legacy = registryList(registry); } catch (error) { legacy = []; errors.push(`registry: ${error.message}`); }
  const byLegacyPath = new Map(legacy.filter((s) => s.path).map((s) => [pathKey(path.resolve(s.path)), s]));
  const byLegacyId = new Map(legacy.map((s) => [s.id, s]));
  const candidates = [];

  function hostPluginSource(source) {
    const inventoryPath = expandRoot(source.inventory, projectRoot);
    const settingsPath = expandRoot(source.settings, projectRoot);
    const marketplaceRoot = expandRoot(source.marketplaceRoot, projectRoot);
    const installRoot = expandRoot(source.installRoot, projectRoot);
    for (const item of [inventoryPath, settingsPath, installRoot].filter(Boolean)) watchPaths.add(item);
    let inventory;
    try { inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')); }
    catch {
      coverage.sources.push({id: source.id, kind: source.kind, host: source.host, root: inventoryPath, present: false, status: 'inventory-unknown', count: 0, installed: 0, enabled: 0, disabled: 0, unknown: 0});
      if (marketplaceRoot && fs.existsSync(marketplaceRoot)) recordExcluded(source.id, {path: marketplaceRoot, reason: 'unverified-marketplace-cache'});
      return;
    }
    let settings = {};
    if (settingsPath) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
      catch { settings = {}; }
    }
    const installed = [];
    if (source.inventoryType === 'gemini') {
      for (const [pluginId, detail] of Object.entries(inventory.plugins || {})) {
        if (!/^[\w.-]+$/.test(pluginId)) { recordExcluded(source.id, {path: installRoot, reason: 'invalid-plugin-id'}); continue; }
        installed.push({pluginId, installPath: path.join(installRoot, pluginId), activation: typeof detail?.enabled === 'boolean' ? detail.enabled : null});
      }
      if (installRoot && fs.existsSync(installRoot)) {
        const known = new Set(installed.map((item) => item.pluginId));
        for (const entry of fs.readdirSync(installRoot, {withFileTypes: true})) {
          if (entry.isDirectory() && !known.has(entry.name)) recordExcluded(source.id, {path: path.join(installRoot, entry.name), reason: 'unverified-plugin-directory'});
        }
      }
    } else {
      for (const [pluginId, records] of Object.entries(inventory.plugins || {})) {
        const switchValue = settings.enabledPlugins?.[pluginId];
        for (const record of Array.isArray(records) ? records : []) {
          if (record.scope === 'project' || record.scope === 'local') {
            const declaredProject = record.projectPath || record.projectRoot;
            if (!projectRoot || !declaredProject || pathKey(path.resolve(declaredProject)) !== pathKey(path.resolve(projectRoot))) {
              recordExcluded(source.id, {path: record.installPath || inventoryPath, reason: 'outside-current-project'});
              continue;
            }
          }
          installed.push({pluginId, installPath: record.installPath, version: record.version, activation: typeof switchValue === 'boolean' ? switchValue : null});
        }
      }
      if (marketplaceRoot && fs.existsSync(marketplaceRoot)) recordExcluded(source.id, {path: marketplaceRoot, reason: 'unverified-marketplace-cache'});
    }
    const summary = {id: source.id, kind: source.kind, host: source.host, root: inventoryPath, present: true, status: 'installed-inventory', count: 0, installed: installed.length, enabled: 0, disabled: 0, unknown: 0};
    for (const item of installed) {
      const state = item.activation === true ? 'enabled-at-rest' : item.activation === false ? 'disabled' : 'unknown';
      if (item.activation === true) summary.enabled++;
      else if (item.activation === false) summary.disabled++;
      else summary.unknown++;
      if (!item.installPath) { recordExcluded(source.id, {path: inventoryPath, reason: 'missing-plugin-install-path'}); continue; }
      const pluginPath = path.resolve(item.installPath);
      watchPaths.add(pluginPath);
      if (!fs.existsSync(pluginPath)) { recordExcluded(source.id, {path: pluginPath, reason: 'missing-plugin-install-path'}); continue; }
      let version = item.version;
      if (source.inventoryType === 'gemini') {
        for (const metaName of ['plugin.json', 'installed_version.json']) {
          const metaPath = path.join(pluginPath, metaName);
          watchPaths.add(metaPath);
          try { const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); version ||= meta.version; }
          catch { /* Metadata is optional; the config and installation directory are the evidence. */ }
        }
      }
      const excluded = [];
      const found = enumerate(pluginPath, true, Infinity, excluded, watchPaths, enumerationMemo);
      const pluginSource = {...source, id: `${source.id}:${cleanId(item.pluginId)}:${cleanId(version || path.basename(pluginPath))}`, root: pluginPath, pluginId: item.pluginId, version: version || null, activationState: state};
      for (const skipped of excluded) { recordExcluded(pluginSource.id, skipped); watchPaths.add(skipped.path); }
      for (const foundSkill of found) {
        const relative = path.relative(pluginPath, foundSkill.path).split(path.sep).join('.');
        candidates.push({...foundSkill, source: pluginSource, enabled: item.activation === true, runtime: {id: relative || item.pluginId.split('@')[0]}});
      }
      summary.count += found.length;
    }
    coverage.sources.push(summary);
  }

  for (const source of configured) {
    if (source.kind === 'project' && !projectRoot) continue;
    if (source.kind === 'host-plugin') { hostPluginSource(source); continue; }
    if (source.kind === 'plugin') continue; // Runtime inventory is authoritative.
    const root = expandRoot(source.root, projectRoot);
    if (!root) continue;
    watchPaths.add(root);
    const present = fs.existsSync(root);
    if (!present) {
      try { fs.lstatSync(root); recordExcluded(source.id, {path: root, reason: 'broken-source-link'}); }
      catch { /* A missing source is represented by its source status. */ }
    }
    const excluded = [];
    const found = present ? enumerate(root, source.recursive === true, source.maxDepth ?? Infinity, excluded, watchPaths, enumerationMemo) : [];
    coverage.sources.push({id: source.id, kind: source.kind, root, present, status: !present ? 'missing' : source.enabled === false ? 'disabled' : 'available', count: found.length});
    for (const item of excluded) { recordExcluded(source.id, item); watchPaths.add(item.path); }
    for (const item of found) candidates.push({...item, source, enabled: source.enabled !== false});
  }

  // The Codex plugin inventory is only authoritative for the Codex host. Scanning it for
  // other hosts pulled in ~200 unusable skills and the deepest trees of the index build.
  const codexInventoryApplies = Boolean(options.pluginConfigPath) || host === 'codex';
  const pluginSkills = runtimeSkills === undefined && codexInventoryApplies && (sources === undefined || options.pluginConfigPath)
    ? configuredPluginSkills(options.pluginConfigPath || path.join(os.homedir(), '.codex', 'config.toml'), options.pluginCacheRoot || path.join(os.homedir(), '.codex', 'plugins', 'cache'), coverage, errors, watchPaths)
    : runtimeSkills;
  if (pluginSkills !== undefined && !Array.isArray(pluginSkills)) errors.push('runtimeSkills must be an array');
  if (Array.isArray(runtimeSkills)) coverage.pluginInventory = 'runtime';
  if (!coverage.pluginInventory) coverage.pluginInventory = 'not-provided';
  for (const item of Array.isArray(pluginSkills) ? pluginSkills : []) {
    if (!item || !item.path) { coverage.unknownPluginManifests++; coverage.entries.push({sourceId: 'plugin', path: item?.path || null, included: false, reason: 'unknown-plugin-manifest'}); continue; }
    const itemPath = path.resolve(item.path);
    const manifest = path.basename(itemPath).toLowerCase() === 'skill.md' ? itemPath : path.join(itemPath, 'SKILL.md');
    watchPaths.add(manifest);
    const skillPath = path.dirname(manifest);
    const source = {id: `plugin:${cleanId(item.provider || item.plugin || 'unknown')}`, kind: 'plugin', host: item.host || host};
    if (!fs.existsSync(manifest)) {
      coverage.unknownPluginManifests++;
      coverage.entries.push({sourceId: source.id, path: skillPath, included: false, reason: 'missing-plugin-manifest'});
      continue;
    }
    if (item.inventoryVerified === false) coverage.unverifiedPluginManifests++;
    else coverage.activePluginManifests++;
    candidates.push({path: skillPath, parentPath: null, source, enabled: item.enabled !== false, runtime: item});
  }

  const groups = new Map();
  for (const candidate of candidates) {
    watchPaths.add(path.join(candidate.path, 'SKILL.md'));
    const real = candidate.identity ?? identity(candidate.path);
    if (!real) {
      coverage.invalid++;
      coverage.entries.push({sourceId: candidate.source.id, path: candidate.path, included: false, reason: 'unreadable-path'});
      errors.push(`${candidate.path}: unreadable-path`);
      continue;
    }
    if (!groups.has(real)) groups.set(real, []);
    groups.get(real).push(candidate);
  }

  const skills = [];
  const pathToId = new Map();
  const skillGroup = new WeakMap();
  for (const [realKey, group] of groups) {
    group.sort((a, b) => {
      const rank = {legacy: 0, system: 1, plugin: 2, project: 3, library: 4, host: 5};
      return (rank[a.source.kind] ?? 9) - (rank[b.source.kind] ?? 9);
    });
    const chosen = group[0];
    const skillFile = path.join(chosen.path, 'SKILL.md');
    let skillText;
    try { skillText = fs.readFileSync(skillFile, 'utf8'); } catch (error) {
      coverage.invalid++;
      coverage.entries.push({sourceId: chosen.source.id, path: chosen.path, included: false, reason: 'unreadable-manifest'});
      errors.push(`${skillFile}: ${error.message}`);
      continue;
    }
    if (!skillText.trim()) {
      coverage.invalid++;
      coverage.entries.push({sourceId: chosen.source.id, path: chosen.path, included: false, reason: 'empty-manifest'});
      continue;
    }
    const meta = parseFrontmatter(skillText);
    const directLegacyChild = chosen.source.kind === 'legacy' &&
      pathKey(path.dirname(path.resolve(chosen.path))) === pathKey(expandRoot(chosen.source.root, projectRoot));
    const legacySkill = byLegacyPath.get(pathKey(path.resolve(chosen.path))) ||
      (directLegacyChild ? byLegacyId.get(path.basename(chosen.path)) : undefined);
    const relativeName = chosen.source.root
      ? (path.relative(expandRoot(chosen.source.root, projectRoot), chosen.path).split(path.sep).join('.') || path.basename(chosen.path))
      : path.basename(chosen.path);
    const slug = cleanId(chosen.runtime?.id || relativeName);
    const id = legacySkill?.id || `${chosen.source.id}:${slug}`;
    const nameZh = legacySkill?.nameZh || meta.name || path.basename(chosen.path);
    // Some legacy registry entries contain only a generated placeholder.
    // Prefer the actual manifest description in that narrow case, while
    // retaining intentionally curated registry summaries and the old fallback.
    const legacySummary = legacySkill?.summaryZh;
    const isPlaceholder = value => typeof value === 'string'
      && /^使用\s+.{1,100}\s+技能完成与其说明匹配的任务[。.]?$/u.test(value.trim());
    const placeholderSummary = isPlaceholder(legacySummary);
    const description = typeof meta.description === 'string' ? meta.description.trim() : '';
    const usableDescription = description && !isPlaceholder(description)
      && !/^(?:null|undefined|none|n\/?a|todo|tbd|待完善|待补充|暂无|无)[.!。\s]*$/i.test(description) ? description : '';
    const summaryZh = (placeholderSummary && usableDescription ? usableDescription : legacySummary)
      || usableDescription || skillText.replace(/^---[\s\S]*?---\s*/, '').split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, '') || nameZh;
    const enabled = group.some((entry) => entry.enabled) && !['disabled', 'archived'].includes(legacySkill?.status);
    const hostState = legacySkill?.hostCompatibility?.[host];
    const compatible = hostState === 'unsupported' ? false : hostState ? true : inferredCompatibility(host, group);
    const toolsAvailable = chosen.source.kind === 'plugin' && host !== (chosen.source.host || 'codex') || chosen.source.kind === 'host-plugin' && compatible === false ? false : null;
    const skill = {
      ...(legacySkill || {}), id, nameZh, summaryZh, path: chosen.path,
      ...(placeholderSummary && !usableDescription ? {summaryQuality:'placeholder'} : {}),
      aliases: unique([...(legacySkill?.aliases || []), meta.name, path.basename(chosen.path)]),
      triggers: legacySkill?.triggers?.length ? legacySkill.triggers : unique([meta.name, path.basename(chosen.path)]),
      category: legacySkill?.category || chosen.source.kind,
      status: legacySkill?.status || (enabled ? 'ready' : chosen.source.activationState === 'unknown' ? 'unverified' : 'disabled'),
      risk: legacySkill?.risk || 'unknown',
      estimatedTokens: legacySkill?.estimatedTokens ?? Math.ceil(skillText.length / 4),
      sourceId: chosen.source.id, contentHash: hash(skillText), parentId: null,
      origins: group.map((entry) => origin(entry.source, entry.path, entry.enabled)),
      availability: {discovered: true, readable: true, enabled, compatible, toolsAvailable},
    };
    skills.push(skill);
    skillGroup.set(skill, realKey);
    for (const entry of group) pathToId.set(pathKey(path.resolve(entry.path)), id);
    pathToId.set(realKey, id);
    coverage.entries.push({sourceId: chosen.source.id, path: chosen.path, included: true, id, origins: group.length});
  }

  for (const skill of skills) {
    const group = groups.get(skillGroup.get(skill)) || [];
    const parent = group.find((entry) => entry.parentPath)?.parentPath;
    if (parent) skill.parentId = pathToId.get(pathKey(path.resolve(parent))) || null;
  }
  skills.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  coverage.discovered = skills.length;
  coverage.readable = skills.length;
  coverage.enabled = skills.filter((s) => s.availability.enabled).length;
  coverage.excluded = coverage.entries.filter((e) => !e.included).length;
  coverage.sources.push({id: 'plugin-inventory', kind: 'plugin', root: null, present: coverage.pluginInventory !== 'unknown' && coverage.pluginInventory !== 'not-provided', status: coverage.pluginInventory, count: coverage.activePluginManifests + coverage.unverifiedPluginManifests, active: coverage.activePluginManifests, unverified: coverage.unverifiedPluginManifests, unknown: coverage.unknownPluginManifests});
  const revision = hash(JSON.stringify(skills)).slice(0, 16);
  const index = {schemaVersion: 4, revision, skills, coverage, errors};
  indexCache.set(key, {index, watch: snapshot([...watchPaths])});
  if (indexCache.size > 8) indexCache.delete(indexCache.keys().next().value);
  return structuredClone(index);
}

export function resolveDiscoveredSkill(name, index) {
  const skills = index?.skills || [];
  const exact = skills.find((skill) => skill.id === name);
  if (exact) return {found: true, ambiguous: false, skill: exact};
  const key = normalize(name);
  if (!key) return {found: false, ambiguous: false};
  const matches = skills.filter((skill) => [skill.nameZh, ...(skill.aliases || [])].some((alias) => normalize(alias) === key));
  if (matches.length === 1) return {found: true, ambiguous: false, skill: matches[0]};
  if (matches.length > 1) return {found: false, ambiguous: true, candidates: matches.map(({id, nameZh, path, sourceId}) => ({id, nameZh, path, sourceId}))};
  return {found: false, ambiguous: false};
}

export function refreshIndex(options = {}) {
  const index = discoverSkills({...options, force: true});
  const outputPath = indexOutputPath(options);
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  const watch = indexCache.get(cacheKey(options))?.watch || [];
  fs.writeFileSync(outputPath, `${JSON.stringify({...index, _cache: {key: cacheKey(options), watch}}, null, 2)}\n`, 'utf8');
  return {...index, outputPath};
}
