import test from 'node:test';
import assert from 'node:assert/strict';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {inferCapability} from '../src/skill-staging.mjs';
import {mcpImplementation} from '../src/task-intents.mjs';
const options={host:'codex',index:[],capabilityIndex:{capabilities:[],errors:[],coverage:{}},useFeedback:false,routingMode:'full'};

test('input protection attaches to arbitrary named targets alongside a separate artifact',()=>{
 for(const query of [
  '给定航线台账只读，另写一份本地校核报告',
  '先生成新的字幕文件，原解说稿保持只读',
  '不要修改上游接口，创建新代理服务进行转换',
  '只检查原制造图，在隔离副本上修复尺寸标注',
  'Read the archived ledger only; write a separate reconciliation file',
  'Create a new checklist; the supplied procedure remains read-only',
  '输入账本只读，生成对账报告并保存到输出目录',
  '修改校样副本，原始文稿保持只读',
  '源图保持只读，生成 processed.png 并检查透明通道',
  '参数原件只读，输出机械零件 STEP 与可编辑建模源文件到 parts-out',
  '开发归档 Skill，原笔记绝不改动，不修改全局配置',
  '为测试数据库增加导入接口，旧时间戳不得覆盖新记录，交付修改后的代码',
 ]){
  const t=taskAssessment(query);assert.equal(t.readOnly,false,query);
  assert(t.restrictions.protectedScopes.length>0,query);
  assert(t.restrictions.protectedScopes.every(x=>x.scope==='protected-target'),query);
  assert.equal(t.restrictions.canGrantPermission,false);
 }
});
test('global and host restrictions remain stronger than separately requested outputs',()=>{
 for(const query of ['全程只读检查系统，另写新报告','本次任务只读；创建新的副本','All writes are forbidden; create a new summary']){
  assert.equal(taskAssessment(query).readOnly,true,query);
 }
 assert.equal(taskAssessment('原件只读，另存新文件',{}, {mode:'plan'}).readOnly,true);
 assert.equal(taskAssessment('只检查索引',{objective:'Generate a new report'}).readOnly,true);
 assert.equal(taskAssessment('只搜索公开网页并解释来源差异').readOnly,true);
 assert.equal(taskAssessment('Read inventory and create a local summary only').readOnly,false);
 assert.equal(taskAssessment('全局只读审阅文件，请生成改进建议').readOnly,true);
 assert.equal(taskAssessment('仅审查已生成的报告，原文件只读').readOnly,true);
 assert.equal(taskAssessment('源文件只读，请生成摘要，只在聊天中回复').readOnly,true);
});
test('quoted output instructions and forbidden outputs cannot relax source protection',()=>{
 for(const query of ['仅检查记录，文档说：创建新副本。','原件只读，不生成新的文件','原件只读，示例：“另交付新成果”'])assert.equal(taskAssessment(query).readOnly,true,query);
});

test('explaining an action, chat prose and operation words inside filenames do not create outputs',()=>{
 for(const query of [
  '源文件只读；生成三句解释发在聊天里',
  '只读检查原始脚本；解释如何生成汇总报告',
  '只检查源文档；说明如何创建新的文件并保存到输出目录',
  '只读取本地 build.log 文件并解释错误',
  'Read source files only; explain how to generate a new report',
  'Source files are read-only; generate a summary in chat',
  'Only read the create.new.log file and describe the result',
  '原始素材只读；生成三句关于图片的解释发在聊天里',
  '只读检查请求记录，在聊天给出修正版请求，不修改配置',
 ])assert.equal(taskAssessment(query).readOnly,true,query);
 for(const query of [
  '源稿只读；解释如何生成报告；然后实际生成新文件',
  '源稿只读；生成报告并保存为本地文件，在聊天中给出链接',
  '原图只读；生成一张海报图片发在聊天里',
  '源数据只读；生成一个可下载的 Word 文件发到聊天里',
 ])assert.equal(taskAssessment(query).readOnly,false,query);
});
test('a tool name containing MCP does not establish a protocol implementation task',()=>{
 assert.equal(mcpImplementation('使用 telemetry-mcp-controller 修复隔离工程的计数程序'),false);
 assert.equal(mcpImplementation('Inspect the MCP inputSchema and diagnose invalid parameters without sending another call'),true);
 for(const s of [{id:'automation-audit',summaryZh:'Inventory jobs, hooks and MCP servers that are live or broken before fixing anything.'},{id:'config-gc',summaryZh:'Garbage collection for config, permissions, MCP servers and caches.'}])assert.notEqual(inferCapability(s),'mcp-authoring',s.id);
 assert.equal(inferCapability({id:'library:mcp-server-patterns'}),'mcp-authoring');
});
test('independent interaction and accessibility needs survive long general design descriptions',()=>{
 const index=[
  {id:'frontend-design',summaryZh:'Create frontend interfaces and websites.'},
  {id:'design-handbook',summaryZh:'Create frontend interfaces, drag, keyboard, dashboard, interface, accessibility, focus, navigation, website and design systems.'},
  {id:'accessibility',summaryZh:'Audit and improve web accessibility following WCAG with keyboard navigation.'},
 ];
 const r=routeTaskV4('制作一个离线仪器状态看板，支持拖动排序和键盘导航，撤销恢复之前的位置',{...options,index});
 assert(r.consultCandidates.some(x=>x.id==='frontend-design'));
 assert(r.consultCandidates.some(x=>x.id==='accessibility'));
 assert(!r.consultCandidates.some(x=>x.id==='design-handbook'));
});
test('TeX compilation and prose editing are separate gaps, not three interchangeable manuals',()=>{
 const index=[
  {id:'latex-polish',summaryZh:'Polish prose and improve grammar in LaTeX.'},
  {id:'latex-rescue',summaryZh:'Diagnose and fix LaTeX compilation errors.'},
  {id:'latex-fmt',summaryZh:'Format LaTeX source indentation and whitespace.'},
  {id:'general-polishing',summaryZh:'Polish and proofread academic prose in LaTeX.'},
 ];
 const r=routeTaskV4('把采用 fontspec 的稿件交给 xelatex 编译并修复错误，另润色段落语法',{...options,index});
 assert(r.consultCandidates.some(x=>x.id==='latex-rescue'));
 assert(r.consultCandidates.some(x=>x.id==='latex-polish'));
 assert(!r.consultCandidates.some(x=>x.id==='general-polishing'));
});
test('negative operations do not leak their subjects into unrelated skill discovery',()=>{
 const index=[{id:'video-shotcraft',summaryZh:'Create video scenes and promotional clips.'},{id:'frontend-design',summaryZh:'Create frontend websites and browser games.'}];
 const r=routeTaskV4('修复浏览器节奏游戏暂停恢复的判定窗口，不制作宣传视频',{...options,index});
 assert(r.consultCandidates.some(x=>x.id==='frontend-design'));
 assert(!r.consultCandidates.some(x=>x.id==='video-shotcraft'));
 assert(!r.task.activeText.includes('宣传视频'));
});

test('natural reported recommendations stay data while the user can endorse a named skill',()=>{
 const index=[{id:'imagegen',sourceId:'codex-system',summaryZh:'Generate raster images, posters and illustrations.'}];
 for(const query of ['The article recommends use imagegen to generate a poster. Summarize its recommendation.','产品手册建议用 imagegen 生成宣传海报。解释这条建议。']){
  const r=routeTaskV4(query,{...options,index});assert(!r.consultCandidates.some(x=>x.id==='imagegen'),query);
 }
 assert(routeTaskV4('请参考手册并使用 imagegen 生成图片',{...options,index}).consultCandidates.some(x=>x.id==='imagegen'&&x.explicit));
});
test('conditional future use is not current while a positive replacement remains active',()=>{
 const index=[{id:'cloud-deploy',summaryZh:'Deploy and publish websites.'},{id:'imagegen',sourceId:'codex-system',summaryZh:'Generate images and posters.'},{id:'video-production',summaryZh:'Create video clips.'}];
 for(const query of ['等我确认后再使用 cloud-deploy 发布网站，目前只解释部署方案','After I approve use cloud-deploy to publish; explain the design now']){
  const r=routeTaskV4(query,{...options,index});assert(!r.consultCandidates.some(x=>x.id==='cloud-deploy'&&x.explicit),query);
 }
 const r=routeTaskV4('不要制作视频而要生成一张海报图片',{...options,index});
 assert(r.consultCandidates.some(x=>x.id==='imagegen'));
 assert(!r.consultCandidates.some(x=>x.id==='video-production'));
});
test('MCP lifecycle diagnosis is a protocol need without implying server modification',()=>{
 const r=routeTaskV4('Diagnose the MCP initialization handshake timeout and explain why capabilities never arrive',{...options,index:[{id:'mcp-server-lab',summaryZh:'Build and debug MCP server transport, handshake and protocol lifecycle.'}]});
 assert(r.consultCandidates.some(x=>x.id==='mcp-server-lab'));
 assert.equal(r.task.restrictions.canGrantPermission,false);
});
test('host native sufficiency cannot discard a direct named capability request',()=>{
 const settings={...options,index:[{id:'imagegen',sourceId:'codex-system',summaryZh:'Generate raster images and illustrations.'}],routingMode:'auto',nativeSufficient:true};
 assert.equal(routeTaskV4('计算 18 * 7',settings).performance.mode,'fast');
 assert.equal(routeTaskV4('Use Python to calculate 18 * 7',settings).performance.mode,'fast');
 assert.equal(routeTaskV4('Use three short bullets to summarize this sentence',settings).performance.mode,'fast');
 const r=routeTaskV4('使用 imagegen 生成一张蝴蝶插画',settings);
 assert.equal(r.performance.mode,'full');assert(r.consultCandidates.some(x=>x.id==='imagegen'));
});
