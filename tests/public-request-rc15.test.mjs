import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities,discoverCapabilities} from '../src/capabilities-v4.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

// Observed generic internet primary purpose, without readOnlyHint or auth proof.
const tool={name:'web__run',description:'Tool for accessing the internet.',available:true};
const advise=(text,extra={},item=tool)=>adviseCapabilities({...taskAssessment(text,{contractVersion:4}),...extra},{
  capabilityIndex:discoverCapabilities({host:'generic',runtimeTools:[item]})}).candidates;

test('consumed conversational public lookup retains unknown-effect schema gates',()=>{
 const q='请查一下杭州图书馆官网，确认目前读者证怎么办理、需要哪些材料，在聊天里给我简短说明和官网链接。';
 const [card]=advise(q);assert.equal(card?.name,tool.name);assert.equal(card.capabilityRole,'public-web-access');
 assert.equal(card.effect,'unknown');assert.equal(card.decision,'defer');assert.equal(card.explicit,false);
 assert(card.gates.includes('inspect-exact-schema-and-inputs'));
 assert(card.gates.includes('verify-read-only-effect-before-invocation'));
 assert(card.gates.includes('verify-public-web-method-target-and-access-before-invocation'));
 assert.equal(card.invocation.automaticallyExecuted,false);
});

test('ordinary lookup aspect and reduplication bind to varied public sources',()=>{
 for(const text of ['请查一下科技馆官网的预约规则。','请查一查大学官方网站的招生材料。',
  '帮我查交通主管部门官网的最新公告。','查阅官方文档里的兼容要求。','搜索官方网站公布的开馆时间。',
  '搜一下官网的退票规则。','请去官网看看目前怎么办理。','去官方网站看一下假期安排。',
  '到官网看一看申请条件。','看看公开网页上的公告。','先核对官方来源再简短回答。',
  '请在官网确认目前需要哪些材料。']) {
   assert(advise(text).some(x=>x.capabilityRole==='public-web-access'),text);
 }
});

test('an explicit adjacent source instruction qualifies retrieval but unrelated sources do not',()=>{
 for(const text of ['请查一查办证要求，来源用官方网站。','请以官网为准，查一下办理材料。',
  'Look up the entry requirements; use the official website as the source.'])assert(advise(text).length,text);
 for(const text of ['请查一下本地日志，来源用官方网站。','解释查一查的意思；来源用官方网站。',
  '请查一下本地文件。另一个文档介绍官方网站。','制作一份官网调查表。'])assert.equal(advise(text).length,0,text);
});

test('colloquial lookup does not escape local, account or supplied-content boundaries',()=>{
 for(const text of ['查一下本地保存的官网页面。','请去本地官网样式页面看看布局。',
  '查一查我的账户里的官网订单。','去官网看看我的账单。','查看私人账户的官方网站记录。',
  '请根据给定材料查一查官网办证要求。','查阅已提供的官网正文内容。',
  '只用粘贴的文本，查一下官网写的哪些材料。'])assert.equal(advise(text).length,0,text);
});

test('explanations, quotations and deferred work do not become live lookups',()=>{
 for(const text of ['只解释如何去官网看看，不实际查询。','请介绍如何查阅官方网站。',
  '请翻译：“去官网看看目前的申请规则。”','分析这句任务指令：“请查一下官网材料。”',
  '今天只解释流程，以后去官网看看。'])assert.equal(advise(text).length,0,text);
});

test('purpose and offline limits survive conversational wording and renamed dispatchers',()=>{
 const text='去官方网站看看今天的安排。';
 const renamed={...tool,name:'mcp__reference__dispatch'};
 const [card]=advise(text,{readOnly:true},renamed);
 assert.equal(card?.name,renamed.name);assert.equal(card.effect,'unknown');assert.equal(card.decision,'defer');
 assert.equal(advise(text,{restrictions:{networkForbidden:true}}).length,0);
 assert.equal(advise(text,{}, {...tool,description:'Manage local network interfaces.'}).length,0);
});
