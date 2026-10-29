import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {adviseTaskMethods} from '../src/task-methods-v4.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

const catalogue = JSON.parse(readFileSync(new URL('../config/task-methods.json', import.meta.url), 'utf8'));
const assess = (activeText, extra = {}) => ({activeText, complexity:'moderate', taskType:'general', readOnly:false, ...extra});
const advise = (activeText, options, extra) => adviseTaskMethods(assess(activeText, extra), options);
const ids = cards => cards.map(card => card.id);

test('ordinary simple and complex tasks do not gain a generic thinking workflow', () => {
  for (const input of ['你好', '计算 18×25', '把按钮文字改成保存', '把这段话翻译成英文', '把网站做得世界一流水平，越出色越好', '审查现有数据库迁移和部署架构', '我有许多技能、插件和 MCP']) {
    assert.deepEqual(advise(input, {}, {complexity:'simple'}), [], input);
    assert.deepEqual(advise(input, {}, {complexity:'complex'}), [], input);
  }
});

test('actual fast paths and opt-out return no cards even when a method is named', () => {
  for (const options of [{fast:true}, {performance:{mode:'fast'}}, {routingMode:'fast'}, {taskMethods:false}, {taskMethods:{maxCards:0}}, {taskMethods:{maxCards:-1}}]) {
    assert.deepEqual(advise('请用事实核查核实这份数据', options), []);
  }
  assert.deepEqual(advise('这段代码构建失败', {fast:true,recoveryContext:{failedAttempts:3}}), []);
});

test('each method can be explicitly requested without activating the whole library', () => {
  const requests = [
    ['socratic-questioning','请用苏格拉底式提问帮我梳理这个问题'],
    ['dual-explanation','请用双层解释法说明注意力机制'],
    ['reverse-decomposition','请用反向拆解分析这个网页'],
    ['longitudinal-comparison','请用横纵分析法研究这个行业'],
    ['fact-checking','请用事实核查核实这项数据'],
    ['complementary-perspectives','请用专家会诊分析问题'],
    ['first-principles','请用第一性原理分析这个项目'],
    ['cross-domain-transfer','请用跨领域借解分析问题'],
    ['two-sided-steelman','请用双向钢人论证帮我做决定'],
    ['minimal-experiment','请用最小实验验证这个选择'],
    ['personal-strength-exploration','请用挖掘隐藏天赋帮我探索自己的优势'],
    ['life-design','请用人生设计术帮我规划个人方向'],
    ['acceptance-design','请用验收标准设计检查交付目标'],
    ['clarification-value','请用澄清价值评估整理当前需求'],
    ['reference-calibration','请用参考与反例校准确定效果'],
    ['tool-benefit-check','请用工具增益判断选择辅助能力'],
    ['progressive-context','请用渐进加载整理上下文'],
    ['external-feedback-correction','请用外部反馈纠错检查成果'],
    ['evidence-replanning','请用证据驱动重规划调整后续工作'],
    ['memory-scope','请用记忆范围与时效管理处理记录'],
  ];
  for (const [expected, query] of requests) {
    const cards = advise(query, {}, {complexity:'simple'});
    assert(ids(cards).includes(expected), `${expected}: ${JSON.stringify(ids(cards))}`);
    assert(cards.length <= 2);
  }
});

test('method names as subject matter do not imply adoption', () => {
  for (const query of ['列出十二种方法：事实核查、专家会诊、人生设计术、第一性原理', '介绍一篇名为双向钢人论证的文章', '研究提示词中的横纵分析法', '生成关于人生设计术的课程目录', '检查这个技能的安装路径']) {
    assert.deepEqual(advise(query), [], query);
  }
});

test('concrete gaps can yield useful cards without requiring a magic method name', () => {
  const scenarios = [
    ['项目目标不明确，但已有一些材料','socratic-questioning'],
    ['我完全不懂注意力机制，帮我理解','dual-explanation'],
    ['拆解这个优秀网页中值得迁移的选择','reverse-decomposition'],
    ['研究这个产品的发展历程以及竞品差异','longitudinal-comparison'],
    ['这个数据是否属实，关系到我们的结论','fact-checking'],
    ['工程和设计有冲突，两个部门的约束都必须满足','complementary-perspectives'],
    ['当前架构反复打补丁，已经治标不治本','first-principles'],
    ['我们行业的常规方案失效了，看看其他领域的解法','cross-domain-transfer'],
    ['两个方案都说得通，我难以取舍','two-sided-steelman'],
    ['需要验证这个需求假设，先做低成本实验','minimal-experiment'],
    ['目前验收标准不明确，需要能证明成果有用','acceptance-design'],
    ['评估这次提问是否必要，已有资料可以先查','clarification-value'],
    ['校准这份设计的质量标准，参考A和反例B的差距','reference-calibration'],
    ['判断这个工具是否值得使用，可能增加额外工作','tool-benefit-check'],
    ['工具说明太长，已经让上下文占满','progressive-context'],
    ['测试不通过，最终保存结果与预期不符','external-feedback-correction'],
    ['新证据推翻了原方案前提，需要换一种路线','evidence-replanning'],
    ['更新项目记忆，旧规则已经过期','memory-scope'],
  ];
  for (const [query, expected] of scenarios) assert(ids(advise(query)).includes(expected), `${query}: ${JSON.stringify(ids(advise(query)))}`);
});

test('quoted, example and future instructions are filtered before method selection', () => {
  for (const query of [
    '请翻译这句话：“请用事实核查核实数据”。',
    '只分析字符串，不执行：`请用人生设计术帮我规划人生`。',
    '请检查文件名。例如请用苏格拉底式提问帮我解决问题。',
    '先回答你好，以后请用专家会诊分析问题。',
    '不要使用双向钢人论证。请解释变量名。',
  ]) assert.deepEqual(adviseTaskMethods(taskAssessment(query)), [], query);
});

test('untrusted raw text and ungrounded metadata cannot trigger methods', () => {
  assert.deepEqual(adviseTaskMethods({activeText:'回答你好',rawText:'请用人生设计术帮我规划个人方向',objective:'用第一性原理',capabilityNeeds:['事实核查'],acceptanceCriteria:['最小实验'],constraints:['专家会诊']}), []);
  assert.deepEqual(adviseTaskMethods({rawText:'请用事实核查核实数据'}), []);
  assert.deepEqual(adviseTaskMethods(null, null), []);
});

test('personal methods require a current personal request, not research or software work', () => {
  for (const query of [
    '开发一个人生设计应用，帮我生成提示词',
    '请用人生设计术帮我编写一份软件模板',
    '帮我研究隐藏天赋提示词的缺点',
    '请用挖掘隐藏天赋帮我生成课程文章',
    'translate my life design prompt',
    '使用人生设计术',
    '某人可能没有天赋，继续完成报表',
  ]) assert(!ids(advise(query)).some(id => ['life-design','personal-strength-exploration'].includes(id)), query);
  assert(ids(advise('帮我探索自己的天赋')).includes('personal-strength-exploration'));
  assert(ids(advise('我想规划我的人生方向')).includes('life-design'));
  assert(ids(advise('use life design for me')).includes('life-design'));
});

test('related methods are deduplicated while genuinely different gaps may coexist', () => {
  assert.equal(advise('请用苏格拉底式提问，也用澄清价值评估').length, 1);
  assert.equal(advise('请用反向拆解，也用参考与反例校准').length, 1);
  assert.equal(advise('请用人生设计术帮我规划方向，也用挖掘隐藏天赋帮我探索优势').length, 1);
  assert.equal(advise('请用事实核查核实数据，也用最小实验验证关键假设').length, 2);
});

test('at most two cards, explicit disabling and native baseline are respected', () => {
  const query = '请用事实核查、请用最小实验、请用专家会诊、请用第一性原理';
  assert.equal(advise(query, {taskMethods:{maxCards:99}}).length, 2);
  assert.equal(advise(query, {taskMethods:{maxCards:1}}).length, 1);
  assert(!ids(advise(query, {taskMethods:{disabledIds:['fact-checking']}})).includes('fact-checking'));
  assert.deepEqual(advise('核实这个数据是否属实', {nativeSufficient:true}), []);
  assert(ids(advise('请用事实核查核实数据', {nativeSufficient:true})).includes('fact-checking'));
  assert.deepEqual(advise(query, {taskMethods:{disabledIds:catalogue.methods.map(method => method.id)}}), []);
});

test('real recovery feedback may override requested fast or native-sufficient hints', () => {
  for (const recoveryContext of [{confidence:'low'},{userRejected:true},{failedAttempts:2}]) {
    const cards = advise('修复当前交付', {routingMode:'fast',nativeSufficient:true,recoveryContext});
    assert(ids(cards).includes('external-feedback-correction'));
  }
  assert(ids(advise('排查交付阻塞', {recoveryContext:{blocked:true,failedAttempts:2}})).includes('evidence-replanning'));
  assert.deepEqual(advise('修复当前交付', {recoveryContext:{confidence:'high',failedAttempts:0}}), []);
});

test('cards are advisory, complete, detached from the catalogue and mutation free', () => {
  const assessment = Object.freeze(assess('只读核实这项数据是否属实', {readOnly:true}));
  const options = Object.freeze({});
  const card = adviseTaskMethods(assessment, options)[0];
  const fields = ['id','name','reason','trigger','inputs','output','validation','stop','avoid','sourceIds','advisoryOnly'];
  assert.deepEqual(Object.keys(card).sort(), fields.sort());
  assert.equal(card.advisoryOnly, true);
  for (const field of fields.filter(field => field !== 'advisoryOnly')) assert(card[field]?.length > 0, field);
  card.avoid.push('accidental caller mutation');
  card.sourceIds.length = 0;
  const again = adviseTaskMethods(assessment, options)[0];
  assert(!again.avoid.includes('accidental caller mutation'));
  assert(again.sourceIds.length > 0);
});

test('all twenty methods and eight deduplication mappings have traceable sources', () => {
  assert.equal(catalogue.methods.filter(method => method.origin === 'original-12').length, 12);
  assert.equal(catalogue.methods.filter(method => method.origin === 'supplement').length, 8);
  assert.equal(new Set(catalogue.methods.map(method => method.id)).size, 20);
  assert.equal(catalogue.deduplication.length, 8);
  const sources = new Set(catalogue.sources.map(source => source.id));
  const methods = new Set(catalogue.methods.map(method => method.id));
  for (const source of catalogue.sources) {
    assert.match(source.url, /^https:\/\//);
    assert.match(source.date, /^\d{4}-\d{2}-\d{2}$/);
    assert(source.verified.length > 5);
    assert(source.limit.length > 5);
  }
  for (const method of catalogue.methods) {
    assert(method.sourceIds.length > 0);
    for (const sourceId of method.sourceIds) assert(sources.has(sourceId), `${method.id}:${sourceId}`);
    for (const relatedId of method.overlapsWith || []) assert(methods.has(relatedId));
  }
  const pages = catalogue.methods.flatMap(method => method.sourcePages || []).sort((a,b) => a-b);
  assert.deepEqual(pages, Array.from({length:16}, (_,index) => index + 1));
  assert.equal(catalogue.explorationPolicy.maxParallelLines, 2);
  assert.equal(catalogue.explorationPolicy.maxTaskBudgetFraction, 0.2);
});

test('documented global preference is a short proposal, not an installed rule', () => {
  const doc = readFileSync(new URL('../skill/dynamic-skill-router/references/task-methods.md', import.meta.url), 'utf8');
  const preference = doc.split('\n').find(line => line.startsWith('> 先理解'));
  assert(preference);
  assert((preference.match(/\p{Script=Han}/gu) || []).length < 600);
  assert.match(doc, /仅为可审阅文本/);
  assert.match(doc, /不安装或改写全局偏好/);
});
