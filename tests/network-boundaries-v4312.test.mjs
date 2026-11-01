import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4, taskAssessment} from '../src/advisor-v4.mjs';
import {constrainCapability, invocationConstraints} from '../src/invocation-constraints.mjs';

const options = {
  index: [],
  capabilityIndex: {capabilities: [], coverage: {}, errors: [], revision: 'network-test'},
  useFeedback: false,
  dryRun: true,
  routingMode: 'full',
  recoveryContext: {confidence: 'low', capabilityNeed: 'verify the source'},
};
const limits = query => invocationConstraints({...taskAssessment(query), rawText: query}, {});

test('explicit current offline and external-network bans survive host false flags', () => {
  const queries = [
    '全过程断网，完成附件分析。',
    '本任务全程保持断网。',
    '电脑始终保持离线，完成附件分析。',
    '整个任务必须断开网络。',
    '不许连接任何外网，先总结附件。',
    '不允许连接任何外部网络，基于附件完成。',
    '不许将电脑连接外网。',
    '不可以连接外网，先总结附件。',
    '整个任务不能连外网，请阅读附件。',
    '不得连接外网，依据附件归纳。',
    '请将电脑设置为断网模式，处理附件。',
  ];
  for (const query of queries) {
    const assessment = {...taskAssessment(query), rawText: query};
    const c = invocationConstraints(assessment, {invocationContext: {
      mode: 'execute', networkForbidden: false, allowedActions: ['read', 'network'],
    }});
    assert.equal(c.networkForbidden, true, query);
    const result = routeTaskV4(query, options);
    assert.equal(result.taskConstraints.networkForbidden, true, query);
    assert.equal(result.recoveryPlan.externalResearchRequired, false, query);
    assert.deepEqual(result.recoveryPlan.searchQueries, [], query);
  }
});

test('negated, descriptive, quoted and future offline language is not a current ban', () => {
  const queries = [
    '不必断网，请联网搜索。',
    '无需保持断网，请联网搜索。',
    '请不要断网，联网查询官网。',
    '不要将电脑保持离线，继续联网查询官网。',
    '没有要求全程断网，联网检索。',
    '没说全程断网，继续联网。',
    '不要求设备保持离线，请联网查询。',
    '不允许要求全程断网。',
    '不得保持离线，本次继续联网。',
    '不要禁止将设备连接外网，请正常联网。',
    '以后才需要断网，本次联网查询。',
    '下次工作时保持离线，本次联网查资料。',
    '解释“全过程断网”是什么意思，并联网查官网。',
    '用户资料中写着“不许连接任何外网”，请联网查资料。',
    '解释断网机制，并联网搜索。',
    '解释如何保持离线，并联网搜索。',
    '修复断网问题，并联网查询。',
  ];
  for (const query of queries) assert.equal(limits(query).networkForbidden, false, query);
});

test('openWorldHint does not establish that any tool is offline', () => {
  const c = invocationConstraints({}, {invocationContext: {networkForbidden: true}});
  const card = {name: 'read', decision: 'use-now', effect: 'read', phase: 'discovery', gates: []};
  for (const tool of [
    {name: 'fixed_remote', description: 'Read records from a fixed remote service.', annotations: {readOnlyHint: true, openWorldHint: false}},
    {name: 'local_logs', description: 'Read local project logs.', annotations: {readOnlyHint: true, openWorldHint: false}},
    {name: 'open_world', annotations: {readOnlyHint: true, openWorldHint: true}},
    {name: 'unspecified'},
  ]) {
    const result = constrainCapability(card, c, tool);
    assert.equal(result.decision, 'defer', tool.name);
    assert(result.gates.includes('network-forbidden-or-effects-unverified'), tool.name);
  }
  assert.equal(constrainCapability({...card, decision: 'skip'}, c, {}).decision, 'skip');
  const allowed = invocationConstraints({}, {invocationContext: {allowedActions: ['read', 'network']}});
  assert.equal(constrainCapability(card, allowed, {annotations: {openWorldHint: false}}).decision, 'use-now');
});

test('host consultation for a closed-world MCP tool cannot bypass a global ban', () => {
  const query = '请读取本机日志，全程保持断网。';
  const tool = {
    name: 'mcp__fixed__read_remote',
    description: 'Read records from a fixed remote service.',
    available: true,
    annotations: {readOnlyHint: true, openWorldHint: false},
  };
  const result = routeTaskV4(query, {
    ...options,
    runtimeTools: [tool],
    taskContext: {capabilityRequests: [{toolNames: [tool.name], evidenceRefs: ['读取本机日志']}]},
  });
  const card = result.capabilityConsultations.find(item => item.name === tool.name);
  assert(card);
  assert.equal(result.taskConstraints.networkForbidden, true);
  assert.equal(card.decision, 'defer');
  assert(card.gates.includes('network-forbidden-or-effects-unverified'));
});

test('closed-world hints do not bypass explicitly bounded source checks', () => {
  const card = {
    name: 'fixed_remote', decision: 'use-now', effect: 'read', phase: 'discovery',
    intentMatches: ['web-open'], inputEvidence: {providedUrls: []}, gates: [],
  };
  const tool = {name: 'fixed_remote', annotations: {openWorldHint: false}};
  const provided = invocationConstraints({}, {invocationContext: {sourceScope: 'provided-only'}});
  const open = constrainCapability(card, provided, tool);
  assert.equal(open.decision, 'defer');
  assert(open.gates.includes('verify-required-user-provided-source-url'));
  const search = constrainCapability({...card, intentMatches: ['web-search']}, provided, tool);
  assert.equal(search.decision, 'defer');
  assert(search.gates.includes('verify-bounded-source-query-before-search'));
  const intersection = {...provided, sourceScopes: ['provided-only', 'specified-site-only']};
  const both = constrainCapability({...card, inputEvidence: {providedUrls: ['https://example.com/a']}}, intersection, tool);
  assert.equal(both.decision, 'defer');
  assert(both.gates.includes('verify-provided-source-and-specified-site-intersection'));
});
