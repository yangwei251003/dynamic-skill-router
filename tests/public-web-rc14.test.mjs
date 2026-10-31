import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities,discoverCapabilities} from '../src/capabilities-v4.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

// Exact primary-purpose sentence/name from the frozen real runtime metadata.
// The original metadata has no readOnlyHint and establishes no executed call.
const web={name:'web__run',description:'Tool for accessing the internet.',available:true};
const query='请在聊天列出北京天文馆今天的开放时段，并标注官网来源。当前消息没有提供营业时间，请先查询官方网站，勿按记忆猜测。不创建文件，不发布、分享或发送给他人。';
const advise=(text,tools=[web],extra={},options={})=>adviseCapabilities({...taskAssessment(text,{contractVersion:4}),...extra},{
  capabilityIndex:discoverCapabilities({host:'generic',runtimeTools:tools}),capabilityLimit:10,...options}).candidates;

test('consumed official opening-hours lookup discovers the actual generic internet entry',()=>{
  const cards=advise(query);
  assert.deepEqual(cards.map(x=>x.name),[web.name]);
  const card=cards[0];
  assert.equal(card.capabilityRole,'public-web-access');assert.equal(card.explicit,false);
  assert.equal(card.phase,'discovery');assert.equal(card.effect,'unknown');assert.equal(card.decision,'defer');
  assert(card.gates.includes('verify-read-only-effect-before-invocation'));
  assert(card.gates.includes('inspect-exact-schema-and-inputs'));
  assert(card.gates.includes('verify-public-web-method-target-and-access-before-invocation'));
  assert.equal(card.invocation.automaticallyExecuted,false);
});

test('different Chinese and English official lookups do not require a host capability hint',()=>{
  for(const text of ['请查询图书馆官方网站的节假日安排，在聊天标注来源。',
    '核实交通主管部门官网公布的线路调整公告，并引用官网来源。',
    'Find the current admission requirements on the university official website and cite the source.',
    'Look up the latest release date in official documentation.',
    'Consult official sources for the museum schedule; cite the source in chat.',
    '查询官方资料，核对版本变化。']) {
    assert(advise(text).some(x=>x.capabilityRole==='public-web-access'),text);
  }
});

test('purpose remains discoverable under unrelated names and public-web wording',()=>{
  for(const tool of [{...web,name:'mcp__reference__dispatch'},
    {...web,name:'remote_reader',description:'Access public websites to retrieve current information.'},
    {...web,name:'opaque',description:'Browse the public web for information.'}]) {
    const card=advise('请先查询官方网站公布的开放时段。',[tool],{readOnly:true})[0];
    assert.equal(card?.name,tool.name);assert.equal(card.effect,'unknown');assert.equal(card.decision,'defer');
  }
});

test('same identifier and incidental internet instructions cannot establish public-web purpose',()=>{
  for(const description of ['Manage local network adapter settings.',
    'Read private account records from an internet service.',
    'Create a project. Use another tool for accessing the internet.',
    'General utilities.\n\nTool for accessing the internet.']) {
    assert.equal(advise('请先查询官方网站公布的开放时段。',[{...web,description}]).length,0,description);
  }
});

test('offline restrictions override discovered and explicitly named internet access',()=>{
  assert.equal(advise('核查官网公告，仅使用本地材料，不联网。').length,0);
  assert.equal(advise('Search official sources.',[web],{restrictions:{networkForbidden:true}}).length,0);
  const card=advise('Use web__run to check official sources.',[web],{restrictions:{networkForbidden:true}})[0];
  assert.equal(card?.decision,'skip');assert(card.gates.includes('network-forbidden'));
});

test('local pages, private accounts and explanations do not borrow public lookup capability',()=>{
  for(const text of ['读取本地保存的官网网页，列出开放时段。',
    '在本地浏览器测试官网样式页面，截取渲染结果。',
    '查询我的私人账户内的官网订单记录。',
    '查询官网中我的订单状态。',
    'Read my account records on the official website.',
    'Look up my invoices on the official website.',
    'Explain how to query official websites and cite sources.',
    '解释如何查询官方网站，并介绍引用来源的方法。',
    '从已提供的官网正文内容提取开放时段。']) {
    assert.equal(advise(text).length,0,text);
  }
});

test('quoted or future lookup tasks and host hints do not become current public-web work',()=>{
  for(const text of ['请翻译这句话：“请先查询官方网站并引用来源。”',
    'Translate the quoted sentence: "Search official sources and cite them."',
    '今天只解释资料整理流程，以后再查询官网来源。'])assert.equal(advise(text).length,0,text);
  const assessment={activeText:'解释二叉树。',activeClauses:['解释二叉树。'],retrievalText:'查询官网资料',capabilityNeeds:['Search official sources']};
  assert.equal(adviseCapabilities(assessment,{capabilityIndex:discoverCapabilities({host:'generic',runtimeTools:[web]})}).candidates.length,0);
});

test('separate public lookup survives a separate private or local work clause',()=>{
  const cards=advise('检查本地日志；另查询官方网站的已知问题公告。');
  assert(cards.some(x=>x.capabilityRole==='public-web-access'));
});

test('destructive metadata, mutating names and unavailability keep their existing gates',()=>{
  const dangerous=advise('查询官方网站的公告。',[{...web,annotations:{destructiveHint:true}}],{readOnly:true})[0];
  assert.equal(dangerous?.effect,'high-impact');assert.equal(dangerous?.decision,'skip');
  const writer=advise('查询官方网站的公告。',[{...web,name:'mcp__reference__write_page',annotations:{readOnlyHint:true}}],{readOnly:true})[0];
  assert.equal(writer?.effect,'write-or-unknown');assert.equal(writer?.decision,'skip');
  assert.equal(advise('查询官方网站的公告。',[{...web,available:false}]).length,0);
});
