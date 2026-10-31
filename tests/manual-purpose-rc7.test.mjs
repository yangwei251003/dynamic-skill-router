import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4} from '../src/advisor-v4.mjs';
import {inferCapability,skillDomainCompatible,capabilityActionCompatible} from '../src/skill-staging.mjs';
import {manualNeedKeys} from '../src/task-intents.mjs';

// Metadata fixtures paraphrase the actual manuals' primary contract. Renamed
// fixtures ensure the exclusions depend on purpose rather than known case IDs.
const manual=(id,summaryZh)=>({id,nameZh:id,summaryZh,sourceId:'fixture'});
const docx=manual('docx','Create and edit Word DOCX documents, preserving styles, tables and page layout.');
const extraction=manual('file-reader','Convert local documents and supported media to token-efficient Markdown for analysis, preserving useful structure. Use when reading PDFs, Word, PowerPoint, Excel, HTML, CSV or JSON.');
const backend=manual('backend-patterns','Backend architecture patterns, API design, and server-side best practices for Node.js, Express, and API routes.');
const social=manual('social-client','X/Twitter API integration for posting tweets, threads, reading timelines, search, and analytics.');
const cloud=manual('provider-http','Use CloudBase HTTP API to access CloudBase platform features.');
const canvas=manual('graph-file','Create and edit JSON Canvas files (.canvas) with nodes, edges, groups, and connections. Use when working with visual canvases and Obsidian.');
const room=manual('research-room','Turn messy user research notes, interviews, support tickets, surveys, and product context into an evidence-backed decision room: a single HTML artifact with an evidence ledger, theme map, and experiment queue.');
const council=manual('decision-council','Convene a four-voice council for ambiguous decisions, tradeoffs, and go/no-go calls. Use when multiple valid paths exist and you need structured disagreement before choosing.');
const mathematics=manual('math-modeling','Mathematical modeling for real problem solving, including simulation, model construction, solution analysis and sensitivity.');
const spreadsheet=manual('spreadsheets','Create and edit spreadsheet workbooks, formulas, charts and cell styles.');
const numerical=manual('numerical-methods','Numerical computation with error analysis, ODE integration and convergence checks.');
const index=[docx,extraction,backend,social,cloud,canvas,room,council,mathematics,spreadsheet,numerical];
const options={host:'codex',index,capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const cards=q=>routeTaskV4(q,options).consultCandidates;

test('Word authorship requires an authoring purpose, while extraction remains supported',()=>{
 const author='Create an editable Word DOCX brief with headings and a table';
 assert(skillDomainCompatible(docx,author));assert(!skillDomainCompatible(extraction,author));
 assert(skillDomainCompatible(extraction,'Convert the attached DOCX to Markdown for analysis'));
 assert(skillDomainCompatible(extraction,'Read the supplied Word document and summarize its contents'));
 assert(cards(author).some(x=>x.id===docx.id));assert(!cards(author).some(x=>x.id===extraction.id));
});
test('HTTP verbs establish no social or cloud platform requirement',()=>{
 const local='Implement a local Node.js HTTP server with a POST endpoint and return JSON';
 assert(skillDomainCompatible(backend,local));
 for(const skill of [social,cloud])assert(!skillDomainCompatible(skill,local),skill.id);
 assert(skillDomainCompatible(social,'Use the X/Twitter API to read a timeline'));
 assert(skillDomainCompatible(cloud,'Implement a CloudBase HTTP API endpoint'));
 assert(!cards(local).some(x=>[social.id,cloud.id].includes(x.id)));
});
test('a JSON filename does not establish the JSON Canvas graph contract',()=>{
 assert(!skillDomainCompatible(canvas,'Write a configuration JSON file with timeout and retry values'));
 assert(!skillDomainCompatible(canvas,'Create an HTML Canvas game and save scores as JSON'));
 assert(skillDomainCompatible(canvas,'Create a JSON Canvas graph with nodes and edges'));
 assert(skillDomainCompatible(canvas,'Edit the Obsidian diagram.canvas graph'));
});
test('finite numerical computation is distinct from tabular output formatting',()=>{
 const query='Implement numerical ODE integration, compare Euler and Heun convergence, export errors.csv';
 assert.equal(inferCapability(numerical),'numerical-computation');
 assert(skillDomainCompatible(numerical,query));assert(skillDomainCompatible(mathematics,query));
 assert(!skillDomainCompatible(spreadsheet,query));
 assert(skillDomainCompatible(spreadsheet,query+' and create an Excel workbook with cell formulas'));
 assert(!skillDomainCompatible(numerical,'Clean a CSV inventory file and aggregate quantities'));
 assert(!skillDomainCompatible(numerical,'Write a note to numerical-computation.json'));
 assert(cards(query).some(x=>[mathematics.id,numerical.id].includes(x.id)));
});
test('a local choice does not imply a qualitative user research synthesis room',()=>{
 const query='Compare three supplier options using the supplied costs and capacity constraints, recommend a choice';
 assert(!skillDomainCompatible(room,query));
 assert.equal(inferCapability(council),'requirements');
 assert(capabilityActionCompatible('requirements',query));assert(skillDomainCompatible(council,query));
 assert(skillDomainCompatible(room,'Research user interview notes and surveys, then build a decision room'));
 assert(skillDomainCompatible(manual('consulting-analysis','Professional consulting analysis and decision-oriented summaries.'),query));
 assert(cards(query).some(x=>x.id===council.id));assert(!cards(query).some(x=>x.id===room.id));
});
test('explicit manual requests retain the intentional specialist bypass',()=>{
 for(const id of [extraction.id,social.id,cloud.id,canvas.id,room.id]){
  const selected=cards(`请使用 ${id} 完成这个任务`);
  assert(selected.some(x=>x.id===id&&x.explicit),id);
 }
});
test('primary specialist preconditions cannot be supplied by generic protocol words',()=>{
 const postCard=manual('social-art','Realistic X post card with engagement metrics (likes, reposts, views), suited to video overlays or shareable image cards.');
 const cache=manual('digest-cache','Cache expensive file processing results using SHA-256 content hashes — path-independent, auto-invalidating.');
 const dataframe=manual('fast-frame','High-performance DataFrame library for Python ETL, analytics, and pandas migration.');
 const prediction=manual('market-research','Research prediction markets as data sources or oracle signals for products, agents, dashboards, and corporate decision intelligence.');
 assert(!skillDomainCompatible(postCard,'Implement a local HTTP POST endpoint'));
 assert(skillDomainCompatible(postCard,'Create a realistic X post card for a tweet'));
 assert(!skillDomainCompatible(cache,'Create an MCP file tool that returns SHA256 hashes'));
 assert(skillDomainCompatible(cache,'Cache repeated file processing using SHA256 hashes'));
 assert(!skillDomainCompatible(dataframe,'Implement an HTTP service to deduplicate incoming CSV orders'));
 assert(skillDomainCompatible(dataframe,'Clean a large-scale CSV dataset using a Python DataFrame'));
 assert(!skillDomainCompatible(prediction,'Research the supplied vendor options and compare cost constraints'));
 assert(skillDomainCompatible(prediction,'Research prediction markets as data sources'));
});

test('visual direction is classified by purpose even under a frontend implementation name',()=>{
 const description='Use for visually strong websites, apps, prototypes and game UI. Enforces restrained composition, image-led hierarchy, typography and tasteful motion.';
 for(const id of ['interface-artistry','frontend-patterns','web-lookbook']){
  const art=manual(id,description);
  assert.equal(inferCapability(art),'visual-design',id);
  assert(skillDomainCompatible(art,'Design the game UI typography and layout'));
  assert(!skillDomainCompatible(art,'Compute numerical integration convergence for an ODE'));
 }
});

test('visual guidance cannot alone satisfy browser state implementation coverage',()=>{
 const art=manual('interface-artistry','Use for a visually strong website or game UI with restrained composition, cohesive imagery and tasteful motion.');
 const implementation=manual('frontend-implementation','Build functional browser interfaces with working JavaScript code, interactive state and persistence.');
 const query='Build a browser memory game with turn state, timer cancellation on restart and saved progress after refresh';
 assert.equal(manualNeedKeys(art,inferCapability(art),query).some(key=>['web-implementation','game-implementation'].includes(key)),false);
 assert(manualNeedKeys(implementation,inferCapability(implementation),query).includes('game-implementation'));
 const result=routeTaskV4(query,{...options,index:[art,implementation]}).consultCandidates;
 assert(result.some(card=>card.id===implementation.id));
});
