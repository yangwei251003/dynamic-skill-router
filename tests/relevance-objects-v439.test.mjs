import assert from 'node:assert/strict';
import {test} from 'node:test';
import {searchSkills} from '../src/advisor-v4.mjs';

const base={sourceId:'fixture',availability:{discovered:true,readable:true,enabled:true,compatible:true},triggers:[],aliases:[]};
const index=[
 {...base,id:'skill-assistant',nameZh:'skill-assistant',summaryZh:'管理 Agent 技能，优先安装、更新和测试技能并改进配置。'},
 {...base,id:'hv-analysis',nameZh:'hv-analysis',summaryZh:'横纵分析产品生命周期和竞品，按时间清楚提出完整研究报告。'},
 {...base,id:'client-intelligence-platform',nameZh:'client-intelligence-platform',summaryZh:'优先为客户开发本地资讯网站，自动抓取最新新闻并每日更新。'},
 {...base,id:'test-runner',nameZh:'test-runner',summaryZh:'运行代码测试和单元测试，检查函数和软件边界。'},
 {...base,id:'python-testing',nameZh:'python-testing',summaryZh:'Write unit tests for Python code.'},
 {...base,id:'rust-testing',nameZh:'rust-testing',summaryZh:'Write unit tests for Rust code.'},
 {...base,id:'typescript-testing',nameZh:'typescript-testing',summaryZh:'Write unit tests for TypeScript code.'},
 {...base,id:'csharp-testing',nameZh:'csharp-testing',summaryZh:'Write unit tests for C# and xUnit projects.'},
 {...base,id:'fsharp-testing',nameZh:'fsharp-testing',summaryZh:'Write unit tests for F# projects.'},
 {...base,id:'django-tdd',nameZh:'django-tdd',summaryZh:'Write Python unit tests for Django projects using pytest-django.'},
 {...base,id:'fastapi-patterns',nameZh:'fastapi-patterns',summaryZh:'Build FastAPI apps and write Python unit tests for endpoints.'},
 {...base,id:'data-analysis',nameZh:'data-analysis',summaryZh:'Analyze CSV data and calculate summaries for structured datasets.'},
 {...base,id:'geopandas',nameZh:'geopandas',summaryZh:'Analyze geospatial data, geographic vector files, maps and spatial joins.'},
 {...base,id:'qclaw-rules',nameZh:'qclaw-rules',summaryZh:'QClaw host rules for creating any CSV data files.'},
 {...base,id:'plugin:documents:documents-documents',nameZh:'documents',sourceId:'plugin:documents',aliases:['documents:documents'],summaryZh:'Create, edit, read, and manipulate Word documents and .docx files.'},
];
const opts={host:'codex',routeId:'fixture-v439',index,capabilityIndex:{capabilities:[],coverage:{},errors:[]},runtimeTools:[],useFeedback:false,dryRun:true,limit:12};
const run=q=>searchSkills(q,opts).consultCandidates;
const consult=(cards,id)=>cards.some(c=>c.id===id&&c.suggestedMode==='consult');

test('generic language and field labels do not establish an unrelated specialist object',()=>{
 const cards=run('请对一份虚构收藏目录的分类进行测试，更新最新编号，清楚提出一份整理报告和改进建议。');
 for(const id of ['skill-assistant','hv-analysis','client-intelligence-platform'])assert(!consult(cards,id),id);
});
test('generic verbs with an explicit skill object preserve skill management',()=>{
 assert(consult(run('请更新和测试现有技能。'),'skill-assistant'));
});
test('a software test action and its object preserve relevant testing capability',()=>{
 assert(consult(run('请测试这个函数，并检查代码边界。'),'test-runner'));
});
test('language-specific testing advice does not promote unrelated runtimes',()=>{
 const cards=run('请为 Python 程序补充单元测试并检查边界。');
 assert(consult(cards,'python-testing'));
 assert(!consult(cards,'rust-testing'));
 assert(!consult(cards,'typescript-testing'));
 assert(!consult(cards,'csharp-testing'));
 assert(!consult(cards,'fsharp-testing'));
 assert(!consult(cards,'django-tdd'));
 assert(!consult(cards,'fastapi-patterns'));
 assert(consult(run('请使用 rust-testing 检查 Python 示例。'),'rust-testing'));
 assert(consult(run('请为 Python Django 程序补充单元测试。'),'django-tdd'));
});
test('a tabular file does not automatically promote unrelated host rules or geospatial specialties',()=>{
 const cards=run('请对 sample.csv 中匿名电影评分进行汇总。');
 assert(consult(cards,'data-analysis'));
 assert(!consult(cards,'geopandas'));
 assert(!consult(cards,'qclaw-rules'));
 assert(consult(run('使用 qclaw-rules 处理 QClaw 配置。'),'qclaw-rules'));
});
test('a concrete research object preserves a relevant specialist',()=>{
 assert(consult(run('请用横纵分析研究产品的生命周期与竞品。'),'hv-analysis'));
});
test('a requested DOCX is associated with a document creation skill',()=>{
 assert(consult(run('根据给定资料制作并交付 brief.docx。'),'plugin:documents:documents-documents'));
});
test('explicit names are kept and explicit prohibitions win',()=>{
 assert(consult(run('使用 hv-analysis 研究这个产品。'),'hv-analysis'));
 assert(!consult(run('不要使用 hv-analysis，请概括产品资料。'),'hv-analysis'));
});
