import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';
import {wordDocumentInspection,electricalInspection,accessibilityNeed} from '../src/task-intents.mjs';
import {skillDomainCompatible} from '../src/skill-staging.mjs';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';
const manual=(id,summaryZh)=>({id,nameZh:id,summaryZh,sourceId:'fixture'});
const index=[
 manual('frontend-design','Create frontend interfaces, web pages and HTML applications'),
 manual('accessibility','Audit web accessibility, keyboard controls and reduced motion preferences'),
 manual('docx','Read, edit and generate Word documents, paragraphs, tables and styles'),
 manual('easyeda-api','EasyEDA EDA software for PCB design, schematic editing, inspecting symbols and projects'),
 manual('kicad-design','KiCad PCB design, schematic editing and inspecting existing circuit projects'),
 manual('server-development','Backend server development and deployment'),
];
const options={host:'codex',index,capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const ids=q=>routeTaskV4(q,options).consultCandidates.map(x=>x.id);

test('negative object attributes preserve the governing request and its subject',()=>{
 for(const query of ['创建一个无需联网的网页，让键盘用户可以切换图层','制作不用安装依赖的网页，尊重减少动态效果偏好','Create a web page without a server, with accessible keyboard controls']){
  assert(ids(query).includes('frontend-design'),query);
  assert(ids(query).includes('accessibility'),query);
 }
 for(const query of ['不需要创建网页，请解释一段文字','不要制作不需要服务器的网页']){
  assert(!ids(query).includes('frontend-design'),query);
 }
 assert(!taskAssessment('制作一个无需服务器的网页').activeText.includes('服务器'));
 assert(taskAssessment('制作一个无需服务器的网页').constraintClauses.some(x=>x.includes('无需服务器')));
});
test('inspecting a Word artifact has the same format need without authorizing edits',()=>{
 for(const query of ['只读核对两份 Word 通知的段落和表格，指出差异','Read the supplied DOCX and compare paragraph dates without editing it']){
  assert(wordDocumentInspection(query));assert(ids(query).includes('docx'),query);
 }
 assert(!wordDocumentInspection('用一句话解释 Word 是什么'));
});
test('electrical inspection retains the chosen application instead of requiring a design mutation',()=>{
 for(const query of ['只读检查嘉立创 EDA 当前工程，确认供电及文档身份','Inspect the EasyEDA schematic and report connector polarity']){
  assert(electricalInspection(query));assert(ids(query).includes('easyeda-api'),query);
  assert(!ids(query).includes('kicad-design'),query);
 }
 const other='Read the KiCad PCB and inspect current connections';
 assert(ids(other).includes('kicad-design'));assert(!ids(other).includes('easyeda-api'));
});
test('input-device users and motion preferences independently establish accessibility',()=>{
 for(const text of ['让键盘用户调整数值','尊重减少动画的系统偏好','support prefers-reduced-motion'])assert(accessibilityNeed(text),text);
 assert(!accessibilityNeed('键盘价格是多少'));
});

test('specialized operations are not justified by their programming language alone',()=>{
 const crypto=manual('nodejs-keccak256','Prevent Ethereum hashing bugs in JavaScript. Use when computing Keccak-256 selectors.');
 const ai=manual('ai-model-nodejs','Use when developing Node.js model inference services');
 assert(!skillDomainCompatible(crypto,'为 Node.js 服务增加用户查询接口'));
 assert(skillDomainCompatible(crypto,'Compute Ethereum Keccak hashing in Node.js'));
 assert(!skillDomainCompatible(ai,'实现 Node.js 库存查询服务'));
 assert(skillDomainCompatible(ai,'实现 Node.js 大模型调用接口'));
 const data=manual('exploratory-data-analysis','Explore scientific datasets and assess data quality');
 assert(!skillDomainCompatible(data,'只读比较 Word 段落、标题与附件编号是否一致'));
 assert(skillDomainCompatible(data,'从 Word 表格提取数据集，清洗并汇总缺失值'));
});

test('provider and explicit applicability boundaries survive generic project vocabulary',()=>{
 const tool=(name,description)=>({id:'tool:'+name,name,description,kind:'tool',enabled:true,callable:true,annotations:{readOnlyHint:true}});
 const apple=tool('mcp__xcodebuildmcp__get_app_bundle_id','Extract bundle id from .app.');
 const scoped=tool('mcp__catalog__workflow_repositories','Only use for an explicitly requested Atlas Security task. List repositories with security workflows.');
 const projects=tool('mcp__codex_app__list_projects','List local and remote projects available for task creation.');
 const capabilityIndex={capabilities:[apple,scoped,projects],coverage:{},errors:[]};
 const names=q=>adviseCapabilities(taskAssessment(q),{capabilityIndex}).candidates.map(x=>x.name);
 assert(!names('读取 Node.js app 的 id 字段并检查本地项目目录').includes(apple.name));
 assert(names('Read the iOS .app bundle id').includes(apple.name));
 assert(!names('List repositories with security workflows').includes(scoped.name));
 assert(names('For Atlas Security, list repositories with security workflows').includes(scoped.name));
 assert(!names('List local project files for a Codex Skill').includes(projects.name));
 assert(names('List Codex projects available for a new chat').includes(projects.name));
});
