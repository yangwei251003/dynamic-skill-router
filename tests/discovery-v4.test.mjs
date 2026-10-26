import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {discoverSkills, refreshIndex, resolveDiscoveredSkill} from '../src/discovery-v4.mjs';

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-v4-'));
  const skill = (relative, name, description = 'Description') => {
    const dir = path.join(root, relative);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
    return dir;
  };
  try { fn({root, skill}); } finally { fs.rmSync(root, {recursive: true, force: true}); }
}

const source = (id, kind, root, recursive = true) => ({id, kind, root, recursive, maxDepth: 5});

test('legacy ID wins, realpath duplicates become origins, edits change revision without writing', () => fixture(({root, skill}) => {
  const canonical = skill('legacy/alpha', 'Alpha');
  const host = path.join(root, 'host');
  fs.mkdirSync(host);
  fs.symlinkSync(canonical, path.join(host, 'alpha'), process.platform === 'win32' ? 'junction' : 'dir');
  const manifest = path.join(canonical, 'SKILL.md');
  const before = fs.statSync(manifest).mtimeMs;
  const opts = {sources: [source('legacy', 'legacy', path.join(root, 'legacy'), false), source('codex', 'host', host)], registry: [{id: 'alpha', nameZh: '旧 Alpha', summaryZh: '旧摘要', path: canonical, category: 'legacy', risk: 'low'}]};
  const first = discoverSkills(opts);
  assert.equal(first.skills.length, 1);
  assert.equal(first.skills[0].id, 'alpha');
  assert.equal(first.skills[0].origins.length, 2);
  assert.equal(first.skills[0].summaryZh, '旧摘要');
  assert.equal(fs.statSync(manifest).mtimeMs, before);
  fs.writeFileSync(manifest, '---\nname: Alpha\ndescription: changed\n---\n# Alpha\n');
  const second = discoverSkills(opts);
  assert.notEqual(second.revision, first.revision);
  assert.notEqual(second.skills[0].contentHash, first.skills[0].contentHash);
}));

test('bare aliases are ambiguous while exact legacy ID resolves', () => fixture(({root, skill}) => {
  const one = skill('legacy/alpha', 'Shared');
  skill('system/beta', 'Shared');
  const index = discoverSkills({sources: [source('legacy', 'legacy', path.join(root, 'legacy')), source('codex-system', 'system', path.join(root, 'system'))], registry: [{id: 'alpha', nameZh: 'Shared', summaryZh: 'A', path: one, aliases: ['same']}]});
  assert.equal(resolveDiscoveredSkill('alpha', index).skill.id, 'alpha');
  const shared = resolveDiscoveredSkill('Shared', index);
  assert.equal(shared.found, false);
  assert.equal(shared.ambiguous, true);
  assert.equal(shared.candidates.length, 2);
  assert.equal(index.skills.find((s) => s.sourceId === 'codex-system').id, 'codex-system:beta');
}));

test('runtime plugin inventory controls active versions, cache alone has no authority', () => fixture(({root, skill}) => {
  const active = skill('cache/plugin/2/skills/tool', 'Tool v2');
  skill('cache/plugin/1/skills/tool', 'Tool v1');
  const opts = {sources: [source('cache', 'plugin', path.join(root, 'cache'))], registry: []};
  assert.equal(discoverSkills(opts).skills.length, 0);
  const index = discoverSkills({...opts, runtimeSkills: [{path: active, provider: 'vendor', enabled: true}, {path: path.join(root, 'missing'), provider: 'vendor'}]});
  assert.equal(index.skills.length, 1);
  assert.equal(index.skills[0].sourceId, 'plugin:vendor');
  assert.equal(index.coverage.activePluginManifests, 1);
  assert.equal(index.coverage.unknownPluginManifests, 1);
  assert.equal(index.skills[0].availability.enabled, true);
}));

test('configured enabled plugin with one installed version is discovered; ambiguous versions are recorded', () => fixture(({root, skill}) => {
  skill('cache/vendor/widget/1/skills/tool', 'Widget Tool');
  skill('cache/vendor/ambiguous/1/skills/tool', 'Old');
  skill('cache/vendor/ambiguous/2/skills/tool', 'New');
  const config = path.join(root, 'config.toml');
  fs.writeFileSync(config, '[plugins."widget@vendor"]\nenabled = true\n[plugins."ambiguous@vendor"]\nenabled = true\n[plugins."disabled@vendor"]\nenabled = false\n');
  const index = discoverSkills({sources: [], registry: [], pluginConfigPath: config, pluginCacheRoot: path.join(root, 'cache')});
  assert.equal(index.skills.length, 1);
  assert.equal(index.skills[0].nameZh, 'Widget Tool');
  assert.equal(index.coverage.pluginInventory, 'configured-unverified');
  assert.equal(index.skills[0].availability.enabled, false);
  assert.equal(index.coverage.unverifiedPluginManifests, 1);
  assert.equal(index.coverage.unknownPluginManifests, 1);
}));

test('nested parent relations, backups, invalid manifest and project isolation', () => fixture(({root, skill}) => {
  skill('host/cloudbase', 'Cloudbase');
  skill('host/cloudbase/references/storage', 'Storage');
  skill('library/ecc/skills/checker', 'Checker');
  skill('project/.codex/skills/local', 'Local');
  fs.mkdirSync(path.join(root, 'host', 'archive-old'));
  fs.mkdirSync(path.join(root, 'host', 'empty'));
  fs.writeFileSync(path.join(root, 'host', 'empty', 'SKILL.md'), '');
  const sources = [source('codex', 'host', path.join(root, 'host')), source('ecc', 'library', path.join(root, 'library/ecc/skills')), source('project-codex', 'project', '${PROJECT_ROOT}/.codex/skills')];
  const without = discoverSkills({sources, registry: []});
  assert.equal(without.skills.some((s) => s.nameZh === 'Local'), false);
  assert.ok(without.coverage.entries.some((e) => e.reason === 'archive-or-backup'));
  assert.ok(without.coverage.entries.some((e) => e.reason === 'empty-manifest'));
  assert.equal(without.coverage.invalid, 1);
  const storage = without.skills.find((s) => s.nameZh === 'Storage');
  assert.equal(storage.parentId, without.skills.find((s) => s.nameZh === 'Cloudbase').id);
  assert.ok(without.skills.some((s) => s.sourceId === 'ecc'));
  const withProject = discoverSkills({sources, registry: [], projectRoot: path.join(root, 'project')});
  assert.ok(withProject.skills.some((s) => s.nameZh === 'Local'));
}));

test('refreshIndex writes only the explicit derived output', () => fixture(({root, skill}) => {
  skill('skills/one', 'One');
  const outputPath = path.join(root, 'output', 'index.json');
  const opts = {sources: [source('legacy', 'legacy', path.join(root, 'skills'))], registry: []};
  discoverSkills(opts);
  assert.equal(fs.existsSync(outputPath), false);
  const result = refreshIndex({...opts, outputPath});
  assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).revision, result.revision);
  assert.equal(fs.readdirSync(path.join(root, 'skills', 'one')).join(','), 'SKILL.md');
}));

test('warm index invalidates for added directories and same-length manifest edits', () => fixture(({root, skill}) => {
  const firstPath = skill('skills/one', 'One', 'aaaa');
  const opts = {sources: [source('legacy', 'legacy', path.join(root, 'skills'))], registry: []};
  const first = discoverSkills(opts);
  assert.equal(discoverSkills(opts).revision, first.revision);
  skill('skills/two', 'Two');
  const added = discoverSkills(opts);
  assert.equal(added.skills.length, 2);
  const manifest = path.join(firstPath, 'SKILL.md');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('aaaa', 'bbbb'));
  const edited = discoverSkills(opts);
  assert.notEqual(edited.revision, added.revision);
  assert.equal(edited.skills.find((s) => s.nameZh === 'One').summaryZh, 'bbbb');
}));

test('plugin compatibility is host-specific', () => fixture(({root, skill}) => {
  const plugin = skill('plugin/tool', 'Plugin Tool');
  const index = discoverSkills({host: 'workbuddy', sources: [], registry: [], runtimeSkills: [{path: plugin, provider: 'vendor', host: 'codex'}]});
  assert.equal(index.skills[0].availability.compatible, false);
  assert.equal(index.skills[0].availability.toolsAvailable, false);
  assert.equal(index.coverage.sources.at(-1).status, 'runtime');
  const local = discoverSkills({host: 'workbuddy', sources: [], registry: [], runtimeSkills: [{path: plugin, provider: 'vendor'}]});
  assert.equal(local.skills[0].availability.compatible, true);
}));

test('unbounded nested discovery reaches plugin style skill depth; explicit caps report omissions', () => fixture(({root, skill}) => {
  const parent = skill('skills/frontend-slides', 'Frontend Slides');
  skill('skills/frontend-slides/plugins/frontend-slides/skills/frontend-slides', 'Deep Slides');
  const rootSkills = path.join(root, 'skills');
  const registry = [{id: 'frontend-slides', nameZh: 'Frontend Slides', summaryZh: 'Parent', path: parent}];
  const all = discoverSkills({sources: [{id: 'legacy', kind: 'legacy', root: rootSkills, recursive: true}], registry});
  assert.equal(all.skills.length, 2);
  const deep = all.skills.find((s) => s.nameZh === 'Deep Slides');
  assert.equal(deep.parentId, 'frontend-slides');
  assert.notEqual(deep.id, 'frontend-slides');
  const capped = discoverSkills({sources: [{id: 'legacy', kind: 'legacy', root: rootSkills, recursive: true, maxDepth: 2}], registry: []});
  assert.equal(capped.skills.length, 1);
  assert.ok(capped.coverage.entries.some((entry) => entry.reason === 'depth-limit'));
}));

test('explicit snapshot is reused read-only across processes and invalidates on edit', () => fixture(({root, skill}) => {
  const dir = skill('skills/one', 'One', 'aaaa');
  const outputPath = path.join(root, 'derived', 'index.json');
  const opts = {sources: [{id: 'legacy', kind: 'legacy', root: path.join(root, 'skills'), recursive: true}], registry: [], outputPath};
  const initial = refreshIndex(opts);
  const unchanged = fs.readFileSync(outputPath);
  const moduleUrl = pathToFileURL(fileURLToPath(new URL('../src/discovery-v4.mjs', import.meta.url))).href;
  const child = `import {discoverSkills} from ${JSON.stringify(moduleUrl)}; const i=discoverSkills(${JSON.stringify(opts)}); console.log(JSON.stringify({revision:i.revision, count:i.skills.length}));`;
  const run = () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  };
  assert.deepEqual(run(), {revision: initial.revision, count: 1});
  assert.deepEqual(fs.readFileSync(outputPath), unchanged);
  const manifest = path.join(dir, 'SKILL.md');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('aaaa', 'bbbb'));
  assert.notEqual(run().revision, initial.revision);
  assert.deepEqual(fs.readFileSync(outputPath), unchanged);
}));

test('default snapshots for different hosts coexist in one snapshot directory', () => fixture(({root, skill}) => {
  skill('skills/one', 'One');
  const common = {sources: [{id: 'legacy', kind: 'legacy', root: path.join(root, 'skills'), recursive: true}], registry: [], snapshotRoot: path.join(root, 'snapshots')};
  const codex = refreshIndex({...common, host: 'codex'});
  const workbuddy = refreshIndex({...common, host: 'workbuddy'});
  assert.notEqual(codex.outputPath, workbuddy.outputPath);
  assert.match(path.basename(codex.outputPath), /^skill-index-v4-[a-f0-9]{16}\.json$/);
  assert.ok(fs.existsSync(codex.outputPath));
  assert.ok(fs.existsSync(workbuddy.outputPath));
  assert.equal(discoverSkills({...common, host: 'codex'}).revision, codex.revision);
  assert.equal(discoverSkills({...common, host: 'workbuddy'}).revision, workbuddy.revision);
}));

test('source root may be a skill; skipped and broken directories have coverage reasons', () => fixture(({root, skill}) => {
  const direct = skill('direct', 'Direct');
  const container = path.join(root, 'container');
  fs.mkdirSync(path.join(container, '.hidden'), {recursive: true});
  fs.mkdirSync(path.join(container, 'node_modules'), {recursive: true});
  fs.symlinkSync(path.join(root, 'missing-target'), path.join(container, 'broken'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(container, path.join(container, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  const index = discoverSkills({sources: [source('direct', 'library', direct), source('container', 'host', container)], registry: []});
  assert.ok(index.skills.some((s) => s.nameZh === 'Direct'));
  const reasons = new Set(index.coverage.entries.filter((entry) => !entry.included).map((entry) => entry.reason));
  assert.ok(reasons.has('hidden-directory'));
  assert.ok(reasons.has('dependency-directory'));
  assert.ok(reasons.has('broken-link-or-unreadable-path'));
  assert.ok(reasons.has('link-cycle'));
}));

test('WorkBuddy installed paths and switches determine host plugin availability', () => fixture(({root, skill}) => {
  const plugins = path.join(root, 'workbuddy', 'plugins');
  const active = skill('workbuddy/plugins/cache/vendor/active/1.2.3', 'Active Root');
  skill('workbuddy/plugins/cache/vendor/active/1.2.3/skills/child', 'Nested Child');
  const disabled = skill('workbuddy/plugins/cache/vendor/disabled/2.0.0', 'Disabled Root');
  const unknown = skill('workbuddy/plugins/cache/vendor/unknown/3.0.0', 'Unknown Root');
  const marketplace = skill('workbuddy/plugins/marketplaces/uninstalled/skills/ghost', 'Ghost');
  fs.mkdirSync(plugins, {recursive: true});
  const inventoryPath = path.join(plugins, 'installed_plugins.json');
  const settingsPath = path.join(root, 'workbuddy', 'settings.json');
  fs.writeFileSync(inventoryPath, JSON.stringify({version: 2, plugins: {'active@vendor': [{scope: 'user', installPath: active, version: '1.2.3'}], 'disabled@vendor': [{scope: 'user', installPath: disabled, version: '2.0.0'}], 'unknown@vendor': [{scope: 'user', installPath: unknown, version: '3.0.0'}]}}));
  fs.writeFileSync(settingsPath, JSON.stringify({enabledPlugins: {'active@vendor': true, 'disabled@vendor': false}}));
  const source = {id: 'workbuddy-plugins', kind: 'host-plugin', host: 'workbuddy', inventoryType: 'workbuddy', inventory: inventoryPath, settings: settingsPath, marketplaceRoot: path.join(plugins, 'marketplaces')};
  const index = discoverSkills({host: 'workbuddy', sources: [source], registry: []});
  assert.equal(index.skills.length, 4);
  assert.equal(index.skills.some((s) => s.nameZh === 'Ghost'), false);
  assert.equal(index.skills.find((s) => s.nameZh === 'Active Root').availability.enabled, true);
  assert.equal(index.skills.find((s) => s.nameZh === 'Disabled Root').availability.enabled, false);
  assert.equal(index.skills.find((s) => s.nameZh === 'Unknown Root').status, 'unverified');
  assert.equal(index.skills.find((s) => s.nameZh === 'Nested Child').parentId, index.skills.find((s) => s.nameZh === 'Active Root').id);
  assert.equal(index.skills.find((s) => s.nameZh === 'Active Root').origins[0].version, '1.2.3');
  assert.equal(index.coverage.sources[0].enabled, 1);
  assert.equal(index.coverage.sources[0].disabled, 1);
  assert.equal(index.coverage.sources[0].unknown, 1);
  assert.ok(index.coverage.entries.some((entry) => entry.path === path.dirname(path.dirname(path.dirname(marketplace))) && entry.reason === 'unverified-marketplace-cache'));
  const codex = discoverSkills({host: 'codex', sources: [source], registry: []});
  assert.equal(codex.skills.find((s) => s.nameZh === 'Active Root').availability.compatible, false);
}));

test('Gemini config plugins require matching installed roots; Claude marketplace is unverified', () => fixture(({root, skill}) => {
  const geminiRoot = path.join(root, 'gemini', 'config', 'plugins');
  const installed = skill('gemini/config/plugins/android/skills/tool', 'Android Tool');
  skill('gemini/config/plugins/unlisted/skills/ghost', 'Unlisted');
  fs.writeFileSync(path.join(root, 'gemini', 'config', 'config.json'), JSON.stringify({plugins: {android: {enabled: true}, missing: {enabled: true}}}));
  fs.writeFileSync(path.join(geminiRoot, 'android', 'plugin.json'), JSON.stringify({name: 'android', version: '4.2.0'}));
  const claudeMarket = skill('claude/plugins/marketplaces/ghost/skills/tool', 'Claude Ghost');
  const sources = [
    {id: 'gemini-plugins', kind: 'host-plugin', host: 'antigravity', inventoryType: 'gemini', inventory: path.join(root, 'gemini', 'config', 'config.json'), installRoot: geminiRoot},
    {id: 'claude-plugins', kind: 'host-plugin', host: 'claude', inventoryType: 'workbuddy', inventory: path.join(root, 'claude', 'plugins', 'installed_plugins.json'), marketplaceRoot: path.join(root, 'claude', 'plugins', 'marketplaces')},
  ];
  const index = discoverSkills({host: 'antigravity', sources, registry: []});
  assert.equal(index.skills.length, 1);
  assert.equal(index.skills[0].path, installed);
  assert.equal(index.skills[0].availability.compatible, true);
  assert.equal(index.skills[0].origins[0].version, '4.2.0');
  assert.equal(index.skills.some((s) => s.nameZh === 'Unlisted' || s.nameZh === 'Claude Ghost'), false);
  assert.ok(index.coverage.entries.some((entry) => entry.reason === 'unverified-plugin-directory'));
  assert.ok(index.coverage.entries.some((entry) => entry.reason === 'unverified-marketplace-cache'));
  assert.equal(index.coverage.sources.find((s) => s.id === 'claude-plugins').status, 'inventory-unknown');
  assert.equal(index.coverage.sources.find((s) => s.id === 'gemini-plugins').installed, 2);
}));
