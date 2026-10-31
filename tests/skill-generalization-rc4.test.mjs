import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4} from '../src/advisor-v4.mjs';
import {experimentWork,experimentDesign,electricalDesign,databaseMigration,businessAnalysis} from '../src/task-intents.mjs';
import {inferCapability,skillDomainCompatible} from '../src/skill-staging.mjs';

const manual=(id,summaryZh,extra={})=>({id,nameZh:id.split(':').at(-1),summaryZh,sourceId:'fixture',...extra});
const manuals=[
 manual('threejs-interaction','Three.js pointer picking, raycasting and object interaction'),
 manual('frontend-design','Build frontend web pages, interactive interfaces and visual applications'),
 manual('database-migrations','Database schema migrations, backward compatibility and rollback strategies'),
 manual('experimental-design','Design experiments and studies with randomization, blocking and replicates'),
 manual('experiment-log','Maintain experiment log entries and lab notebook records'),
 manual('consulting-analysis','Produce business and market analysis reports with financial reasoning'),
 manual('easyeda-api','EasyEDA EDA software, circuit and PCB design, schematic editing and footprints'),
 manual('journal-statistics','Audit manuscript statistical reporting, p values and confidence intervals',{category:'academic research'}),
 manual('codex-system:skill-creator','Create or update a Codex skill with instructions and supporting resources',{sourceId:'codex-system'}),
 manual('create-skill','Create Agent skills and write SKILL.md format'),
 manual('growth-log','Record personal growth and development logs'),
 manual('frame-light','Design a photographic light leak preset'),
 ...Array.from({length:160},(_,i)=>manual('unrelated-'+i,'Unrelated catalogue material')),
];
const options={host:'codex',index:manuals,capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const ids=q=>routeTaskV4(q,options).consultCandidates.map(x=>x.id);

test('complete dotted technical identities survive a broad frontend candidate',()=>{
 for(const query of ['用 Three.js 开发可交互的浏览器三维应用，点击选择对象','Build a Three.js interactive web page with raycast picking']){
  assert(ids(query).includes('threejs-interaction'),query);
  assert(ids(query).includes('frontend-design'),query);
 }
});
test('output filenames do not create a specialist subject',()=>{
 for(const suffix of ['','，文件放 growth-log-skill','，文件放 frame-light-project']){
  const result=ids('为 Codex 编写可复用 Skill，交付 SKILL.md 和脚本'+suffix);
  assert(result.includes('codex-system:skill-creator'));
  assert(!result.includes('growth-log'));
  assert(!result.includes('frame-light'));
 }
});
test('actual electrical work stays distinct from statistical research vocabulary',()=>{
 const query='在 EasyEDA 设计比较器电路及 PCB，核实器件资料和引脚连接';
 assert(electricalDesign(query));
 assert.equal(inferCapability(manuals.find(x=>x.id==='easyeda-api')),'electrical-design');
 assert(ids(query).includes('easyeda-api'));
 assert(!ids(query).includes('journal-statistics'));
 assert(skillDomainCompatible(manuals.find(x=>x.id==='journal-statistics'),'审查论文统计方法、p值及置信区间'));
});
test('instrument commerce does not become an experiment while real studies retain their design need',()=>{
 const query='用给定表格做实验仪器市场分析报告，比较收费方案和盈亏';
 assert(businessAnalysis(query));assert(!experimentWork(query));
 assert(ids(query).includes('consulting-analysis'));assert(!ids(query).includes('experiment-log'));
 const study='设计一个随机分组对照实验，控制混杂，安排重复测量与复现';
 assert(experimentDesign(study));assert(ids(study).includes('experimental-design'));
});
test('schema migration remains a distinct need across phrasing and unrelated high scoring matches',()=>{
 for(const query of ['为 PostgreSQL 设计数据库迁移，旧版服务继续运行，提供回滚','Plan a database schema migration with compatibility and rollback']){
  assert(databaseMigration(query));assert(ids(query).includes('database-migrations'));
 }
 assert(!databaseMigration('解释数据库是什么'));
});
