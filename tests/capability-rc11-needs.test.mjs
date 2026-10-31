import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities,discoverCapabilities} from '../src/capabilities-v4.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

const plugin=(name,description,extra={})=>({id:`plugin:${name}@fixture`,kind:'plugin',name,plugin:`${name}@fixture`,
  description,configured:true,enabled:true,callable:false,evidence:'configuration-only',tools:[],...extra});
const localBrowser=plugin('window-lab','Open, inspect, test and screenshot local web targets in the browser, including localhost and file:// URLs.');
const remoteBrowser=plugin('remote-browser','Test websites in a remote cloud browser.');
const opaqueBrowser=plugin('automation-lab','Browser automation runtime.');
const data=plugin('HarborData','Manage projects. Execute SQL queries on PostgreSQL databases. Modify schemas and deploy functions.');
const otherData=plugin('OtherData','Read SQL queries from a remote PostgreSQL database.');
const shell=discoverCapabilities({host:'generic',runtimeTools:[{name:'exec_command',available:true,description:'Runs a command in a local terminal.'}]}).capabilities.find(x=>x.kind==='tool');
const assess=(activeText,extra={})=>({activeText,activeClauses:activeText.split(/[\n。；;，,]/),readOnly:false,...extra});
const advise=(query,entries=[localBrowser,shell],extra={},options={})=>adviseCapabilities(assess(query,extra),{
  capabilityIndex:{capabilities:entries,revision:'synthetic',coverage:{},errors:[]},...options,
}).candidates;

test('actual local page validation discovers browser entry point independently of generic execution',()=>{
 const cards=advise('制作本地 HTML 页面，运行脚本并实际检查筛选控件，交付实际渲染截图。',[localBrowser,shell],{restrictions:{networkForbidden:true}});
 const browser=cards.find(x=>x.id===localBrowser.id);
 assert(browser);assert.equal(browser.explicit,false);assert.equal(browser.capabilityRole,'browser-validation');
 assert.equal(browser.decision,'discover-first');assert.equal(browser.availability.callable,false);
 assert.equal(browser.effect,'unknown');assert.equal(browser.networkScope.purposeEvidence,'local');
 assert(browser.gates.includes('restrict-browser-to-authorized-local-target'));
 assert(cards.some(x=>x.name===shell.name));assert.equal(browser.invocation.automaticallyExecuted,false);
});

test('browser game playtesting is a distinct need even without screenshots',()=>{
 const cards=advise('制作可本地打开的浏览器小游戏，实际试玩移动、结束和重开。');
 assert(cards.some(x=>x.capabilityRole==='browser-validation'));
});

test('explanation, source inspection, future tests and generic testing marketing do not create browser adoption',()=>{
 for(const query of ['Explain how to test a local browser game.','Review the source code of a browser game without running it.',
  'Write a documentation page about browser testing.','没有浏览器试玩的授权，请只审查页面源码。']){
  assert(!advise(query).some(x=>x.capabilityRole==='browser-validation'),query);
 }
 const vague=plugin('browser-sounding','Quality workflows and reliable projects.');
 assert(!advise('Test the local HTML page and capture a screenshot.',[vague]).length);
 const future=adviseCapabilities(taskAssessment('请制作页面，以后再实际试玩。'),{
  capabilityIndex:{capabilities:[localBrowser],revision:'synthetic',coverage:{},errors:[]}});
 assert(!future.candidates.some(x=>x.capabilityRole==='browser-validation'));
});

test('local-only browser targets exclude definite remote services and defer unproven locality',()=>{
 const query='Test the local browser page and capture a screenshot.';
 assert(!advise(query,[remoteBrowser]).length);
 const unknown=advise(query,[opaqueBrowser])[0];
 assert.equal(unknown?.decision,'defer');assert.equal(unknown?.effect,'unknown');
 assert(unknown.gates.includes('verify-local-browser-target-support-before-invocation'));
 const named=advise('Use remote-browser to test a local browser page.',[remoteBrowser])[0];
 assert.equal(named?.decision,'skip');assert(named.gates.includes('remote-browser-not-authorized-for-local-target'));
});

test('a named database provider is discovered for real aggregate reads without inventing effects or authentication',()=>{
 const cards=advise('只读查询指定 HarborData 项目的数据表，统计行数并按类型分组计数，在聊天回复。不读取本地文件。没有写库、创建临时表、导出文件的授权。',[data,otherData,shell],{readOnly:true});
 assert.deepEqual(cards.map(x=>x.id),[data.id]);
 const card=cards[0];assert.equal(card.explicit,false);assert.equal(card.providerRequested,true);
 assert.equal(card.capabilityRole,'database-access');assert.equal(card.phase,'discovery');
 assert.equal(card.decision,'discover-first');assert.equal(card.availability.evidence,'configuration-only');
 assert.equal(card.availability.callable,false);assert.equal(card.effect,'unknown');
 assert(card.gates.includes('verify-database-target-query-and-authentication-before-invocation'));
 assert.match(card.discoveryEvidence.scope,/authentication and effects unverified/);
 assert.equal(card.invocation.tool,null);assert.equal(card.invocation.automaticallyExecuted,false);
});

test('database discovery binds provider and actual read need, not arbitrary names or generic metadata',()=>{
 for(const query of ['Explain PostgreSQL aggregate queries.','只读查询指定 OtherData 项目的数据表并统计行数。',
  '检查 HarborData 项目的页面布局。','解释 HarborData 查询数据库的方式。']){
  assert(!advise(query,[data]).some(x=>x.capabilityRole==='database-access'),query);
 }
 const unknown=plugin('HarborData','General project tools.');
 assert(!advise('只读查询指定 HarborData 项目的表并统计行数。',[unknown]).length);
 assert(!advise('只读查询指定 HarborData 项目的表并统计行数。',[{...data,enabled:false}]).length);
});

test('provider metadata can explain its exact child without turning the child into a callable tool',()=>{
 const child={id:'plugin-mcp:HarborData@fixture:query-endpoint',kind:'mcp',name:'query-endpoint',plugin:data.plugin,
  description:'',configured:true,enabled:true,callable:false,evidence:'configuration-only',tools:[],transport:'remote'};
 const cards=advise('Read aggregate row counts from the HarborData database.',[data,child]);
 assert.equal(cards.length,1);assert.equal(cards[0].capabilityRole,'database-access');
 assert.equal(cards[0].discoveryEvidence.sourceId,data.id);assert.equal(cards[0].availability.callable,false);
});

test('a separate local output can retain execution alongside database source discovery',()=>{
 const cards=advise('读取 HarborData 数据库的表并统计行数，另写本地 summary.json 文件。',[data,shell]);
 assert(cards.some(x=>x.capabilityRole==='database-access'));
 assert(cards.some(x=>x.capabilityRole==='local-execution'));
});

test('a generic runtime sharing provider words cannot displace a database entry point',()=>{
 const runtime={...shell,description:'Runs a command in a local terminal for HarborData projects.'};
 const cards=advise('Read rows from the HarborData database and run a local script to create summary.json.',[data,runtime]);
 assert(cards.some(x=>x.id===data.id));assert(cards.some(x=>x.id===runtime.id));
});

test('explicit no-network restriction still blocks definite remote database discovery',()=>{
 const remote={...data,description:'Execute SQL queries on remote PostgreSQL databases.'};
 assert(!advise('只读查询指定 HarborData 项目的表并统计行数。',[remote],{readOnly:true,restrictions:{networkForbidden:true}}).length);
 const named=advise('Use HarborData to read database row counts.',[remote],{readOnly:true,restrictions:{networkForbidden:true}})[0];
 assert.equal(named?.decision,'skip');assert(named.gates.includes('network-forbidden'));
});
