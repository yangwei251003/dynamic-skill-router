import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4} from '../src/advisor-v4.mjs';
import {requestedName} from '../src/request-entities.mjs';
import {specialistPurposeCompatible} from '../src/skill-staging-purpose.mjs';
import {inferCapability,skillDomainCompatible} from '../src/skill-staging.mjs';
import {backendImplementation,manualNeedKeys,structuredDataOperation,presentationArtifact,supportsPresentationAuthoring} from '../src/task-intents.mjs';

// Renamed metadata fixtures bind purpose to the requested object. Positive
// counterexamples protect legitimate specialist work and cross-platform tasks.
const manual=(id,summaryZh,extra={})=>({id,nameZh:id,summaryZh,sourceId:'fixture',...extra});
const options=index=>({host:'codex',routingMode:'full',index,capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false,taskMethods:false});
const pair=(purpose,unrelated,related)=>{
 const skill=manual('renamed-specialist',purpose);
 assert.equal(specialistPurposeCompatible(skill,unrelated),false,unrelated);
 assert.equal(specialistPurposeCompatible(skill,related),true,related);
};

test('complete names preserve direct Chinese and English requests, never a later domain noun',()=>{
 for(const prefix of ['请借助这台机器刚配置好的 ','使用内置的 ','Use the locally installed preferred ']){
  assert(requestedName([prefix+'latex-rescue 修复文档'],'latex-rescue'));
  assert.equal(requestedName([prefix+'latex-rescue 定位 LaTeX 编译错误'],'latex'),null);
 }
 assert.equal(requestedName(['Use file-reader to diagnose LaTeX compilation'],'latex'),null);
 assert.equal(requestedName(['Use latex-rescue to compile source.tex'],'latex'),null);
});

test('provider aliases need plugin semantics; marked plugin mentions and real manuals remain direct',()=>{
 for(const query of ['使用 LaTeX 排版','Use latex to fix source.tex'])assert.equal(requestedName([query],'latex',{providerOnly:true}),null);
 for(const query of ['请使用 latex 插件','Use the latex plugin','使用已安装的插件 latex','[$latex](app://test)','[@latex](plugin://latex)'])
  assert(requestedName([query],'latex',{providerOnly:true}),query);
 assert(requestedName(['使用 latex 定位文档错误'],'latex'));
 const installer=manual('plugin:latex:texlive-runtime-installer','Detect existing TeX Live or MacTeX first, then optionally install a full TeX Live runtime.',{nameZh:'texlive-runtime-installer',sourceId:'plugin:latex'});
 const repair=manual('latex-rescue','Fix LaTeX compilation errors in source documents.');
 const r=routeTaskV4('请使用 latex-rescue 定位 LaTeX 文档错误',options([installer,repair]));
 assert(r.consultCandidates.some(x=>x.id===repair.id&&x.explicit));
 assert(!r.consultCandidates.some(x=>x.id===installer.id));
 for(const query of ['请使用 texlive-runtime-installer','Use texlive-runtime-installer','[@latex](plugin://latex) 请安装 TeX Live'])
  assert(routeTaskV4(query,options([installer])).consultCandidates.some(x=>x.explicit),query);
});

test('return, sort, control and budget remain attached to their actual objects',()=>{
 pair('Expertise for returns authorization, refund processing, and warranty claims management.','Polish the claims in this paper and return a diff.','Assess a product return and refund decision.');
 pair('Build an evidence-backed ECC install plan by sorting skills into daily and library buckets.','Build a sorting algorithm visualization.','Sort installed skills into ECC daily and library buckets.');
 pair('Install and operate an optional agent control plane.','Compare two algorithms and control random seeds.','Operate an agent control plane.');
 pair('Offers a choice about how much response depth to consume.','Compare transcription software on a zero software-fee budget.','Give me a brief answer with a token budget of 200.');
 pair('Use when a brand needs to discover its identity through interviews.','Audit plugin discovery and runtime availability.','Discover the brand identity through interviews.');
});

test('Node diagnosis obtains backend coverage while Java frameworks and booked GPU workflows require their own stack',()=>{
 const backend=manual('api-practices','Backend architecture patterns, API design, and server-side best practices for Node.js and Express API routes.');
 const java=manual('jvm-specialist','Spring Boot and Java backend architecture patterns and API development.');
 const gpu=manual('compute-handbook','Inspect model serving on a completed Itô compute booking and hand off a serving manifest.');
 const tools=manual('interface-handbook','Use for the tool-interface layer of an agent system specifically: tool schemas and descriptions.');
 for(const query of ['诊断 Node.js 接口并发扣减数量的竞态，设计原子更新修复。','Debug a Node.js inventory API and reproduce its concurrent update failure.']){
  assert(backendImplementation(query));assert(skillDomainCompatible(backend,query));
  for(const other of [java,gpu,tools])assert(!skillDomainCompatible(other,query),other.id);
  const cards=routeTaskV4(query,options([backend,java,gpu,tools])).consultCandidates;
  assert(cards.some(x=>x.id===backend.id&&x.suggestedMode!=='skip'));
  assert(!cards.some(x=>[java.id,gpu.id,tools.id].includes(x.id)));
 }
 assert(specialistPurposeCompatible(java,'Debug a Node.js gateway and its Java Spring Boot service.'));
 assert(specialistPurposeCompatible(gpu,'Inspect serving on the booked GPU compute nodes.'));
 assert(!specialistPurposeCompatible(gpu,'Monitor a Node.js API.'));
 assert(specialistPurposeCompatible(tools,'Design tool descriptions and schemas for an MCP agent.'));
});

test('cloud document providers are scoped without excluding explicit cross-provider work',()=>{
 const lark=manual('cloud-files','飞书云空间文件管理与检索。');
 assert(!specialistPurposeCompatible(lark,'Search the Google Drive folder.'));
 assert(specialistPurposeCompatible(lark,'Compare files in Google Drive and 飞书云空间.'));
 assert(specialistPurposeCompatible(lark,'检索飞书云空间中的文件。'));
 pair('Create and edit native Google Docs through connected tools.','Search a Google Drive folder read-only.','Edit a native Google Docs document.');
});

test('game canvas, plan annotation, surface texture and photo batches require different work',()=>{
 pair('Create beautiful visual art in PNG and PDF documents.','Build an HTML Canvas game.','Create a static poster in PNG.');
 pair('Open plans and HTML artifacts in a browser canvas where a human annotates elements.','Build an HTML Canvas game.','Present a plan for review and human feedback.');
 pair('Three.js textures - UV mapping, cubemaps, and material settings.','Remove the background of one product image and preserve its texture.','Adjust the Three.js UV texture mapping.');
 pair('Apply consistent photo adjustments across a set of images.','Cut out one product photo with a transparent background.','Batch edit a set of photos with the same style.');
 assert(specialistPurposeCompatible(manual('static-art','Create visual art in PNG documents.'),'Build a browser game and create a PNG poster.'));
});

test('installing a TeX runtime needs an observed environment gap, not every LaTeX error',()=>{
 pair('Detect existing TeX Live or MacTeX first, then optionally install TeX Live.','Fix an Undefined control sequence in a LaTeX source file.','Install TeX Live because the LaTeX compiler is not found.');
});

test('authoring a data-cleaning skill does not claim to execute its embedded operation',()=>{
 assert.equal(structuredDataOperation('Create a skill for cleaning CSV rows.'),false);
 assert.equal(structuredDataOperation('编写一个用于 CSV 清洗和去重的 Skill。'),false);
 assert(structuredDataOperation('Create a skill for cleaning CSV rows; then clean the supplied CSV and verify missing values.'));
 assert(structuredDataOperation('编写 CSV 清洗 Skill；同时清洗附件 CSV 并校验异常行。'));
 assert(structuredDataOperation('Clean the supplied CSV and aggregate the rows.'));
});

test('editable PowerPoint authoring has a producer need distinct from a style or HTML-only deck',()=>{
 const producer=manual('deck-workbench','Read, generate, and adjust PowerPoint slides, layouts, and templates.');
 const style=manual('swiss-style','A Swiss grid, neutral colors and typographic guidance for a teaching deck.');
 const html=manual('web-deck','Create HTML presentations with CSS slides and transitions.');
 const content=manual('lecture-outline','Create an academic presentation. This skill governs CONTENT and STRUCTURE decisions. For technical work, also read the pptx skill.');
 for(const query of ['Create an editable PowerPoint training deck with a worked example.','制作可编辑 PowerPoint 教学课件。']){
  assert(presentationArtifact(query));assert(supportsPresentationAuthoring(producer,query));
  assert(manualNeedKeys(producer,inferCapability(producer),query).includes('presentation-artifact'));
  for(const other of [style,html,content])assert(!manualNeedKeys(other,inferCapability(other),query).includes('presentation-artifact'),other.id);
  const cards=routeTaskV4(query,options([producer,style,html,content])).consultCandidates;
  assert(cards.some(x=>x.id===producer.id&&x.suggestedMode!=='skip'));
 }
 assert(supportsPresentationAuthoring(html,'Create an HTML presentation.'));
 const unavailable={...producer,availability:{toolsAvailable:false}};
 const blocked=routeTaskV4('制作可编辑 PowerPoint 教学课件。',options([unavailable])).consultCandidates;
 assert.equal(blocked.find(x=>x.id===producer.id)?.suggestedMode,'skip');
});

test('reasonable auxiliary and explicit named specialist requests are not globally disabled',()=>{
 const postgres=manual('database-advice','PostgreSQL query and schema best practices.');
 assert(specialistPurposeCompatible(postgres,'Design a PostgreSQL column migration.'));
 const motion=manual('animation-advice','Motion animation patterns and performance guidance.');
 assert(specialistPurposeCompatible(motion,'Create an interactive sorting demo with reduced motion.'));
 const refund=manual('refund-workbook','Expertise for returns authorization and refund processing.');
 assert(routeTaskV4('请使用 refund-workbook 解释这个问题',options([refund])).consultCandidates.some(x=>x.id===refund.id&&x.explicit));
});
