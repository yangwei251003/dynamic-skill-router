import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';
import {webImplementation,structuredDataOperation,backendImplementation,publicInformationSearch} from '../src/task-intents.mjs';
import {inferCapability,skillDomainCompatible,capabilityActionCompatible} from '../src/skill-staging.mjs';
const skill=(id,summaryZh,extra={})=>({id,nameZh:id.split(':').at(-1),summaryZh,sourceId:'fixture',...extra});
const index=[
 skill('figma','Read Figma files, components, comments and metadata',{triggers:['figma']}),
 skill('plugin:figma:figma-design-to-code','Implement Figma designs as code and working components',{sourceId:'plugin:figma'}),
 skill('ecc:fastapi-patterns','FastAPI transactional service layers and request validation'),
 skill('ecc:backend-patterns','Backend API patterns for Node.js and Express'),
 skill('frontend-design','Create frontend interfaces, web pages and HTML applications'),
 skill('docx','Create and edit Word documents, with PDF rendering'),
 skill('pdf','Read and edit PDF files',{triggers:['pdf']}),
 skill('statistical-analysis','Choose statistical tests and analyze datasets, checking assumptions'),
 skill('data-analysis','Clean CSV records and aggregate structured data'),
 skill('git-ship','Git workflow publishing: commit, push, PR and merge; repair tests and conflicts'),
 skill('codex:codex-computer-operator','Inspect desktop applications and read the current interface'),
 skill('codex-system:imagegen','Generate and edit images',{sourceId:'codex-system'}),
 skill('video-creation-director','Create video projects with editable titles'),
 skill('latex-rescue','Diagnose LaTeX compilation errors and undefined references'),
 skill('citation-helper','Add citations to manuscript passages and find references'),
 skill('paper-writer','Academic paper writing pipeline: literature, figures and references'),
 skill('market-research','Size markets, analyze competitors and validate opportunities'),
 skill('skill-creator','Create reusable skills with instructions and supporting resources'),
 skill('experimental-design','Design controlled experiments, randomization and blocking'),
 skill('rare-rust-patterns','Rust programs'),
 ...Array.from({length:120},(_,i)=>skill('unrelated-'+i,'Unrelated corpus material')),
];
const options={host:'codex',index,capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const route=query=>routeTaskV4(query,options);
const ids=result=>result.consultCandidates.map(s=>s.id);

test('originality audits are verification even with a visual-research catalogue family',()=>{
 const manual={id:'website-originality-audit',family:'visual-research',summaryZh:'Audit a website against its reference pages for originality and plagiarism risk.'};
 assert.equal(inferCapability(manual),'verification');
 for(const query of ['检查网页和参考站是否存在抄袭','Audit this design for distinctive copying']){
  assert(skillDomainCompatible(manual,query));
  assert(capabilityActionCompatible(inferCapability(manual),query));
 }
 assert.equal(skillDomainCompatible(manual,'发布前做一次完整网页质量审计'),false);
 assert.equal(skillDomainCompatible(manual,'Review the page for accessibility and performance'),false);
});
test('design source and implementation action select the specialized workflow',()=>{
 const result=route('将 Figma 的仪表盘设计稿实现成 Vue 页面，做好空状态。');
 assert(ids(result).includes('plugin:figma:figma-design-to-code'));
});
test('named backend technology outranks inferred generic backend vocabulary',()=>{
 const result=route('在已有 FastAPI 服务实现库存更新接口。补单测，非法行整批回滚。');
 assert(ids(result).includes('ecc:fastapi-patterns'));
 assert(!ids(result).includes('ecc:backend-patterns'));
 assert(!ids(result).includes('statistical-analysis'));
 assert(!ids(result).includes('git-ship'));
});
test('artwork used in a game preserves both requested outcomes',()=>{
 const result=route('请用 imagegen 生成一张透明角色图片，再用于一个浏览器音乐小游戏，按钮使用 CSS。');
 assert(ids(result).includes('codex-system:imagegen'));
 assert(ids(result).includes('frontend-design'));
 assert(webImplementation(result.task.activeText));
});
test('editable Word plus PDF retains the editable source workflow',()=>{
 const result=route('把给定经历整理为可编辑 Word，交付同版式 PDF，逐页核对。');
 assert(ids(result).includes('docx'));
});
test('data filenames and execution consistency are not statistical analysis',()=>{
 const query='把 network.csv 做成最短路径网页，实际运行并验证最终距离一致，交付验证记录。';
 assert.equal(structuredDataOperation(query),false);
 assert(!ids(route(query)).some(id=>['statistical-analysis','data-analysis'].includes(id)));
});
test('real cleanup and joins still preserve structured-data coverage',()=>{
 assert(ids(route('读取学生 CSV 记录，按编号关联，检查缺失日期并汇总异常行。')).includes('data-analysis'));
 assert(ids(route('抓取需要登录的网站数据，整理成 Excel，生成分析报告并制作演示文稿')).includes('data-analysis'));
});

test('drafting a paper and manuscript review are real scholarly work',()=>{
 for(const query of ['起草一篇研究论文初稿','审稿并核验 DOI','Draft an academic manuscript from these findings']){
  assert(skillDomainCompatible(index.find(s=>s.id==='paper-writer'),query),query);
 }
});

test('technical services and data units remain concrete independent needs',()=>{
 assert(backendImplementation('为 Node.js 报名服务实现幂等请求及结构化冲突错误'));
 assert(!backendImplementation('用 Node.js 读取本地表格并打印摘要'));
 assert(structuredDataOperation('读取 Google Sheets 的指定范围，检查零件单位是否一致，另建本地转换脚本'));
 assert(!structuredDataOperation('根据 CSV 实现页面，并确认按钮焦点样式一致'));
 const academic={id:'aminer-search',summaryZh:'Search academic papers and scholar citations'};
 assert(!skillDomainCompatible(academic,'核查科研展览是否延期，只搜主办方公告'));
 assert(skillDomainCompatible(academic,'检索机器人领域的论文和作者引用'));
 const proposal={id:'research-proposal-writer',summaryZh:'Proposal-first scientific writing pipeline'};
 assert(!skillDomainCompatible(proposal,'核查科研展览是否延期，只搜主办方公告'));
 assert(skillDomainCompatible(proposal,'起草科研项目申请书和研究计划'));
});
test('desktop reading chooses observation and does not imply PDF editing or shipping',()=>{
 const result=route('观察桌面上已打开的 PDF 阅读器当前页，读取屏幕上的提示。全局只读，不点击、不保存。');
 assert(ids(result).includes('codex:codex-computer-operator'));
 assert(!ids(result).some(id=>['pdf','git-ship'].includes(id)));
 assert(result.task.readOnly);
});
test('screen-reader accessibility is not a desktop observation request',()=>{
 assert(!ids(route('把 Figma 设计稿实现成 React 页面，并检查屏幕阅读器名称。')).includes('codex:codex-computer-operator'));
});
test('compilation references do not turn into citation writing',()=>{
 const result=route('修复 LaTeX 双栏论文编译，bibliography 能找到但文献未显示，输出 PDF。');
 assert(ids(result).includes('latex-rescue'));
 assert(!ids(result).some(id=>['citation-helper','paper-writer','statistical-analysis'].includes(id)));
});
test('technical identity works without unrelated supporting vocabulary',()=>{
 const result=routeTaskV4('Review Rust',{...options,index:index.map(s=>s.id==='rare-rust-patterns'?{...s,id:'rust-patterns',nameZh:'rust-patterns'}:s)});
 assert(ids(result).includes('rust-patterns'));
});
test('generic role words alone do not become a subject',()=>{
 assert(!ids(routeTaskV4('请给出通用建议',{...options,index:[skill('general-expert','General expert workflow')]})).length);
});
test('follow-skill naming supports Chinese instruction forms and quotes',()=>{
 for(const query of ['按 video-creation-director 技能制作短片','请按照“video-creation-director”技能制作短片','遵循 video-creation-director 手册制作短片']){
  assert(route(query).consultCandidates.some(s=>s.id==='video-creation-director'&&s.explicit),query);
 }
});
test('quoted, source, negative and future skill references stay inactive',()=>{
 for(const query of ['解释这段话：“按 video-creation-director 技能制作短片”。','文档说：按 video-creation-director 技能制作短片。现在解释 CSV 字段。','不要按 video-creation-director 技能制作短片。解释 CSV 字段。','以后按 video-creation-director 技能制作短片。现在解释 CSV 字段。']){
  assert(!route(query).consultCandidates.some(s=>s.id==='video-creation-director'&&s.explicit),query);
 }
});
test('negative delivery variants do not contaminate current work',()=>{
 const query='实现 FastAPI 接口；不公开发布，也不替我上传仓库，没有线上发布需求。';
 const task=taskAssessment(query);
 assert.equal(task.originalRequest,query);
 assert(!/发布|上传/.test(task.activeText));
 assert(!ids(route(query)).includes('git-ship'));
});
test('skill creation is separate from the domain of its input examples',()=>{
 const result=route('写一个归档实验笔记的 Skill，交付完整 SKILL.md 和本地脚本。');
 assert(ids(result).includes('skill-creator'));
 assert(!ids(result).includes('experimental-design'));
});
test('direct shipping request remains eligible',()=>{
 assert(ids(route('使用 git-ship 完成分支提交推送与合并')).includes('git-ship'));
});
test('native fast path still scans neither catalog',()=>{
 const result=routeTaskV4('计算 7+8',{...options,nativeSufficient:true});
 assert.equal(result.performance.mode,'fast');
 assert.equal(result.performance.scannedSkills,false);
 assert.equal(result.performance.scannedCapabilities,false);
});

test('current public evidence acquisition has its own need independent of report analysis',()=>{
 const acquisition=skill('source-checker','使用网络信息搜索获取近期公开资料，结合原始来源核实关键事实。');
 const analysis=skill('deep-research','Deep research reports, evidence synthesis and source comparison');
 const query='核查社区讲座的最新安排，搜索公开资料并比对官方公告，保留来源日期。';
 const result=routeTaskV4(query,{...options,index:[acquisition,analysis]});
 assert.equal(inferCapability(acquisition),'public-information-search');
 assert.equal(inferCapability(analysis),'research');
 assert(ids(result).includes('source-checker'));
 assert.equal(result.consultCandidates.find(s=>s.id==='source-checker').phase,'discovery');
});
test('classification depends on leading purpose, not a provider or the word search in its name',()=>{
 assert.equal(inferCapability(skill('public-evidence-client','Retrieve current public information and check original sources.')),'public-information-search');
 assert.notEqual(inferCapability(skill('Search','Deep research powered by a search service. Use for literature reviews and competitive analysis.')),'public-information-search');
 assert.notEqual(inferCapability(skill('report-writer','Create analytical reports. Search current public information as one supporting step.')),'public-information-search');
});
test('local-only source checks do not create an external information acquisition gap',()=>{
 for(const query of ['只依据本地公告核查最新日期','仅使用已提供资料核查官方通知','Use only supplied sources to check the latest announcement','核查最新日期，不联网，现有资料足够'])assert.equal(publicInformationSearch(query),false,query);
 for(const query of ['联网搜索近期交通通知','Find the latest official opening schedule','搜索公开资料核实许可条款'])assert(publicInformationSearch(query),query);
 const acquisition=skill('news-reader','Web search for current public information');
 assert(!ids(routeTaskV4('只依据本地资料核查日期，不联网搜索',{...options,index:[acquisition]})).includes('news-reader'));
});
test('public-information manual stays inactive for local code, math, and file rendering',()=>{
 const acquisition=skill('generic-information-client','使用网络信息搜索获取最新资讯与公开来源。');
 for(const query of ['在 FastAPI 仓库增加导入接口并跑测试','根据 CSV 建立整数规划求解脚本','把本地 Word 文档渲染成 PDF']){
  assert(!ids(routeTaskV4(query,{...options,index:[...index,acquisition]})).includes(acquisition.id),query);
 }
});
test('external lookup references remain quoted, future, or negative data',()=>{
 const acquisition=skill('generic-information-client','Web search for current public information');
 for(const query of ['解释这句话：“联网搜索最新公告”。','以后联网搜索最新公告，现在说明本地表格字段。','不要联网搜索最新公告，只整理已有记录。']){
  assert(!ids(routeTaskV4(query,{...options,index:[acquisition]})).includes(acquisition.id),query);
 }
});
