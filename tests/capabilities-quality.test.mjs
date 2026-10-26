import assert from 'node:assert/strict';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';
const tool=(name,description,plugin)=>({id:'tool:'+name,kind:'tool',name,description,plugin,enabled:true,callable:true,evidence:'runtime-tool',annotations:{}});
const capabilities=[
 {id:'plugin:figma',kind:'plugin',name:'Figma',plugin:'figma',enabled:true,callable:true,tools:[],description:''},
 {id:'plugin:vercel',kind:'plugin',name:'Vercel',plugin:'vercel',enabled:true,callable:true,tools:[],description:''},
 {id:'plugin:google-drive',kind:'plugin',name:'Google Drive',plugin:'Google Drive',enabled:true,callable:true,tools:[],description:''},
 tool('mcp__apps__figma_get_design_context','Get design context for a Figma node — the primary tool for design-to-code workflows.','figma'),
 tool('mcp__apps__figma_generate_design','Capture a live web page by URL into an existing Figma design file.','figma'),
 tool('mcp__apps__figma_generate_deck','Generate presentation decks in Figma. Do not use this tool for websites.','figma'),
 tool('mcp__apps__vercel_get_build_logs','Read Vercel deployment build logs to debug errors.','vercel'),
 tool('mcp__freecad__get_debug_logs','Read debugging logs from CAD system.',null),
 tool('mcp__apps__google_drive_search','Search Google Drive and return file metadata.','Google Drive'),
 tool('mcp__apps__google_drive_fetch_file_revision','Read Google Drive file revision.','Google Drive'),
 tool('mcp__apps__google_drive_search_spreadsheet_rows','Search Google Drive spreadsheet document rows.','Google Drive'),
];
const options={capabilityIndex:{capabilities,coverage:{},errors:[],revision:'fixture'}};
const candidates=q=>adviseCapabilities(taskAssessment(q),options).candidates;
const figma=candidates('读取 Figma 设计稿并实现网页');
assert.equal(figma[0].name,'mcp__apps__figma_get_design_context');
assert(!figma.some(x=>/generate/.test(x.name)));
const logs=candidates('检查 Vercel 部署日志，定位错误');
assert.equal(logs[0].name,'mcp__apps__vercel_get_build_logs');assert(!logs.some(x=>/freecad/.test(x.name)));
const drive=candidates('用 Google Drive 查找项目文档');
assert.equal(drive[0].name,'mcp__apps__google_drive_search');assert(!drive.some(x=>/revision|rows/.test(x.name)));
assert.equal(candidates('计算 2+2').length,0);
assert.equal(candidates('创建简单本地 HTML 页面').length,0);
console.log('PASS: design read direction, provider isolation, file search specificity, native-task abstention');
