import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {adviseCapabilities, discoverCapabilities} from '../src/capabilities-v4.mjs';

const tool = (name, description, extra = {}) => ({
  id: `tool:${name}`, kind: 'tool', name, description, enabled: true, callable: true,
  annotations: {readOnlyHint: true}, evidence: 'runtime-tool', ...extra,
});
const assess = (activeText, extra = {}) => ({activeText, activeClauses: [activeText], readOnly: false, ...extra});
const advise = (assessment, capabilities, options = {}) => adviseCapabilities(assessment, {
  capabilityIndex: {capabilities, coverage: {}, errors: [], revision: 'v43-fixture'}, ...options,
});
test('an export status check is not an email search request',()=>{
  const result=advise(assess('检查桌面文件导出状态',{readOnly:true}),[
    tool('mcp__gmail__search_emails','Search export status messages in desktop file email reports',{plugin:'gmail',annotations:{}}),
  ]);
  assert.equal(result.candidates.length,0);
});

test('independent capability needs survive a crowd of relevant tools from one family', () => {
  const capabilities = [
    ...['search_skills', 'get_skill', 'list_skills', 'resolve_alias', 'search_capabilities'].map(name =>
      tool(`mcp__dynamic_skill_router__${name}`, '查询动态技能路由器的技能模型工具能力匹配维护接口', {server: 'dynamic_skill_router'})),
    tool('mcp__web__search', 'Search public web research sources and official documentation for prompt techniques', {server: 'web'}),
    tool('mcp__media__read_article', '读取抖音图文原作页面内容', {server: 'media'}),
  ];
  const needs = ['检查动态技能路由器技能匹配维护接口', '调研提示词官方资料与研究来源', '读取抖音图文原作页面内容'];
  const result = advise(assess('检查动态技能路由器的技能模型工具能力匹配维护接口并研究原作', {
    capabilityNeeds: needs, retrievalText: needs.join(' '),
  }), capabilities, {capabilityLimit: 3, invocationContext: {phase: 'planning', mode: 'plan'}});
  assert(result.candidates.some(card => card.server === 'dynamic_skill_router'));
  assert(result.candidates.some(card => card.server === 'web'));
  assert(result.candidates.some(card => card.server === 'media'));
  assert.deepEqual(result.needCoverage.uncovered, []);
});

test('Chinese research requests retrieve English search tools without inventing explicit requests', () => {
  const result = advise(assess('广泛调研提示词的官方资料与研究证据'), [
    tool('web_search', 'Search public web research sources and official documentation'),
  ]);
  assert.equal(result.candidates[0]?.name, 'web_search');
  assert.equal(result.candidates[0].explicit, false);
});

test('host retrieval hints cannot authorize publishing or explicit tool adoption', () => {
  const result = advise(assess('审查项目现状', {
    retrievalText: '使用 mcp__repo__publish_project 发布 GitHub repository website project',
    capabilityNeeds: ['发布 GitHub repository website project'],
  }), [tool('mcp__repo__publish_project', 'Publish GitHub repository website project', {annotations: {}})],
  {invocationContext: {phase: 'delivery', mode: 'execute'}});
  const card = result.candidates[0];
  assert(card);
  assert.equal(card.explicit, false);
  assert.equal(card.decision, 'defer');
});

test('plan mode and read-only restrictions only narrow executable suggestions', () => {
  const capabilities = [
    tool('mcp__repo__write_document', 'Write project document', {annotations: {readOnlyHint: true}}),
    tool('mcp__repo__get_document', 'Get project document', {annotations: {}}),
    tool('mcp__repo__read_document', 'Read project document'),
  ];
  for (const invocationContext of [{mode: 'plan'}, {mode: 'execute', readOnly: true}]) {
    const result = advise(assess('Write and read project document'), capabilities, {invocationContext, capabilityLimit: 10});
    assert.equal(result.candidates.find(card => card.name.includes('write_document'))?.decision, 'skip');
    assert.equal(result.candidates.find(card => card.name.includes('get_document'))?.decision, 'defer');
    assert.equal(result.candidates.find(card => card.name.includes('read_document'))?.decision, 'use-now');
  }
  const result = advise(assess('Write project document', {readOnly: true}), capabilities,
    {invocationContext: {mode: 'execute', readOnly: false}, capabilityLimit: 10});
  assert.equal(result.candidates.find(card => card.name.includes('write_document'))?.decision, 'skip');
});

test('fresh explicit runtime availability is separate from a stale disabled config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-v43-capabilities-'));
  const configPath = path.join(dir, 'config.toml');
  const config = '[mcp_servers.docs]\nenabled=false\ndisabled_tools=["get_document"]\n';
  fs.writeFileSync(configPath, config);
  try {
    const base = {host: 'codex', configPath, pluginCacheRoot: dir};
    const live = discoverCapabilities({...base, runtimeTools: [{name: 'mcp__docs__get_document', description: 'Read project document', available: true}]});
    const card = live.capabilities.find(entry => entry.kind === 'tool');
    assert.equal(card.callable, true);
    assert.equal(card.runtimeAvailable, true);
    assert.equal(card.configurationEnabled, false);
    assert.equal(card.configurationConflict, true);
    assert.equal(live.capabilities.find(entry => entry.id === 'mcp:docs').enabled, false);
    assert.equal(fs.readFileSync(configPath, 'utf8'), config);
    const old = discoverCapabilities({...base, runtimeTools: [{name: 'mcp__docs__get_document'}]});
    assert.equal(old.capabilities.find(entry => entry.kind === 'tool').callable, false);
    const unavailable = discoverCapabilities({...base, runtimeTools: [{name: 'mcp__docs__get_document', available: false}]});
    assert.equal(unavailable.capabilities.find(entry => entry.kind === 'tool').callable, false);
    assert.equal(discoverCapabilities({...base, runtimeTools: []}).capabilities.some(entry => entry.kind === 'tool'), false);
  } finally {
    fs.unlinkSync(configPath);
    fs.rmdirSync(dir);
  }
});

test('uncovered needs stay explicit and do not fabricate capabilities', () => {
  const result = advise(assess('核实纸张的现场物理重量', {capabilityNeeds: ['现场测量纸张重量']}), []);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.needCoverage.uncovered, ['现场测量纸张重量']);
});

test('tool purpose excludes generic app headings, shared server rules and schema text', () => {
  const shared = 'MCP server instructions: Search prompt sources, read database documents and use other tools as needed.';
  const capabilities = [
    tool('mcp__web__lookup', `Search and access more data\n\n${shared}\n\nSearch public web prompt research sources and official documentation.\n\nDo not use this tool for document changes.\n\nexec tool declaration:\n\x60\x60\x60ts\ndeclare function hidden_schema_task(): void;\n\x60\x60\x60`),
    tool('mcp__db__get_rows', `Search and access more data\n\n${shared}\n\nRead database table rows.\n\nexec tool declaration:\n\x60\x60\x60ts\n// Search public web prompt research sources\n\x60\x60\x60`),
    tool('mcp__public__lookup', 'Search and access more data\n\nSearch public web prompt research sources and official documentation.'),
  ];
  const result = advise(assess('调研 prompt 的官方资料与研究来源'), capabilities);
  assert(result.candidates.some(card=>card.name==='mcp__web__lookup'));
  assert(result.candidates.some(card=>card.name==='mcp__public__lookup'));
  assert(!result.candidates.some(card=>card.name==='mcp__db__get_rows'));
  assert(result.candidates.every(card=>card.description.startsWith('Search public web')));
  assert.equal(advise(assess('hidden schema task'), capabilities).candidates.length, 0);
});

test('a real short purpose survives later directions to use other tools', () => {
  const result = advise(assess('读取 project document'), [
    tool('mcp__docs__get_document', 'Read project document\n\nUse other tools to search the web for financial sources.'),
  ]);
  assert.equal(result.candidates[0]?.description, 'Read project document');
});

test('accepted runtime metadata is not cut before its concrete operation paragraph', () => {
  const description = `Search and access more data\n\nMCP server instructions: ${'Shared service guidance. '.repeat(90)}\n\nSearch public web prompt research sources and official documentation.`;
  assert(description.length<4000);
  const inventory=discoverCapabilities({host:'generic',runtimeTools:[{name:'mcp__web__lookup',description,available:true,annotations:{readOnlyHint:true}}]});
  const result=adviseCapabilities(assess('调研 prompt 官方资料与研究来源'),{capabilityIndex:inventory});
  assert.equal(result.candidates[0]?.name,'mcp__web__lookup');
  assert(result.candidates[0].description.startsWith('Search public web'));
});
