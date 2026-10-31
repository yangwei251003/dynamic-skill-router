import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities,discoverCapabilities} from '../src/capabilities-v4.mjs';
const tool=(name,description,extra={})=>({id:`tool:${name}`,kind:'tool',name,description,enabled:true,callable:true,evidence:'runtime-tool',annotations:{},...extra});
const assess=(activeText,extra={})=>({activeText,activeClauses:[activeText],...extra});
const advice=(task,capabilities,options={})=>adviseCapabilities(task,{capabilityIndex:{capabilities,coverage:{},errors:[],revision:'semantic-substrate'},capabilityLimit:10,...options}).candidates;
const shell=tool('renamed_terminal','Runs a command in a PTY, returning output or a session ID.');
const repl=tool('mcp__custom__evaluate','Execute Python in a persistent local runtime.');
const image=tool('renamed_picture_reader','View a local image file from the filesystem when visual inspection is needed.');
const appHeader='Manage the Example desktop app: find, create, and update chats; organize projects; open app panels; locate bundled libraries.';
const deps=tool('mcp__custom__locate_libraries',`${appHeader}\n\nLocate the configured bundled workspace dependency runtime paths, including libraries for documents, spreadsheets, and slide decks. This is read-only.`);
const voice=tool('mcp__custom__end_voice',`${appHeader}\n\nEnd the current voice chat. Only call if the user asks to end that chat.`);
const capNames=cards=>cards.map(x=>x.name);

test('local execution is recognized from purpose under different identifiers',()=>{
  for(const runtime of [shell,repl]){
    const cards=advice(assess('Create a local parser script and run the malformed-input tests.'),[runtime,voice]);
    assert.deepEqual(capNames(cards),[runtime.name]);assert.equal(cards[0].capabilityRole,'local-execution');assert.equal(cards[0].decision,'check-scope');
  }
});
test('equivalent runtimes do not occupy multiple independent-need slots',()=>{
  const cards=advice(assess('Read local logs and run the parser script.'),[shell,repl]);
  assert.equal(cards.length,1);
});
test('general runtime remains unknown and deferred for globally read-only diagnostics',()=>{
  const cards=advice(assess('只读诊断本地 source.tex 和 saved.log 文件',{readOnly:true}),[shell]);
  assert.equal(cards[0]?.decision,'defer');assert.equal(cards[0].effect,'unknown');
  assert(cards[0].gates.includes('verify-read-only-effect-before-invocation'));
});
test('plan mode and runtime unavailability cannot be bypassed by execution needs',()=>{
  const task=assess('Build a local data parser and run tests.');
  assert.equal(advice(task,[shell],{invocationContext:{mode:'plan'}})[0]?.decision,'defer');
  assert.equal(advice(task,[{...shell,callable:false}])[0]?.decision,'discover-first');
  assert.equal(advice(task,[{...shell,enabled:false}]).length,0);
});
test('host-only runtime needs cannot create a local execution requirement',()=>{
  assert.equal(advice(assess('Explain a binary tree',{retrievalText:'run local project tests',capabilityNeeds:['run local script']}),[shell,repl]).length,0);
});
test('explanations, arithmetic, and prohibited file reads do not need a runtime',()=>{
  for(const request of ['Explain how to run local integration tests.','介绍本地 Word 文档生成的方法。','计算 18 * 7。','Do not read secrets.log; explain logarithms.'])assert.equal(advice(assess(request),[shell,repl,deps,image]).length,0,request);
});
test('Office artifact authoring locates libraries without adopting app-management tools',()=>{
  const cards=advice(assess('从模板创建本地 report.docx 和对应 PDF，检查分页。'),[deps,voice,shell]);
  assert(cards.some(x=>x.name===deps.name));assert(!cards.some(x=>x.name===voice.name));
  assert(cards.find(x=>x.name===deps.name).description.startsWith('Locate'));
});
test('remote slides review does not imply a local document runtime or shell',()=>{
  assert.equal(advice(assess('只读检查 Google Slides 课程文件，直接回复意见。',{readOnly:true}),[deps,shell,repl]).length,0);
});
test('existing image edit needs observation but a new description-only image does not',()=>{
  for(const request of ['编辑本地 portrait.png 照片，删除背景，输出新图片。','Retouch the local photograph input.jpeg and preserve the original.'])assert(advice(assess(request),[image]).some(x=>x.name===image.name),request);
  assert.equal(advice(assess('Generate a new image of a meadow.'),[image]).length,0);
});
test('local inspection is not authorized to overwrite its protected source',()=>{
  const task=assess('编辑本地 photo.png 图片并保存新副本。',{restrictions:{protectedScopes:[{source:'user-request',scope:'protected-target',clause:'photo.png 原图只读'}]}});
  const card=advice(task,[image])[0];assert(card);assert.equal(card.effect,'unknown');assert(card.gates.includes('preserve-protected-targets-and-check-output-destination'));
});
test('long shared desktop rules yield the concrete reader purpose, not click instructions',()=>{
  const header=`## Sample Server - Core Workflows\n\n${'Shared UI guidance without a function purpose. '.repeat(120)}\n\n### Control policy\nClick only an observed button.`;
  const raw=[{name:'mcp__sample__read_tree',description:`${header}\n\nCapture a compact element tree of the current window.`,available:true},{name:'mcp__sample__press_control',description:`${header}\n\nClick a previously observed button in a window.`,available:true}];
  const index=discoverCapabilities({host:'generic',runtimeTools:raw});
  assert(index.capabilities.find(x=>x.name===raw[0].name).description.length>4000);
  const cards=adviseCapabilities(assess('观察当前窗口的界面文字，不点击。',{readOnly:true}),{capabilityIndex:index}).candidates;
  assert.deepEqual(capNames(cards),[raw[0].name]);assert.equal(cards[0].decision,'defer');assert(cards[0].description.startsWith('Capture'));
});
test('screen observation and a UI implementation are different capabilities',()=>{
  const observer=tool('mcp__sample__read_panel','Reads an observed element by ID, or an explicit whole window.');
  assert(advice(assess('Inspect the existing window and read the warning text.',{readOnly:true}),[observer]).length);
  assert.equal(advice(assess('Implement a warning dialog in a local HTML UI.'),[observer]).length,0);
});
test('provider input and local implementation preserve two independent requirements',()=>{
  const provider=tool('mcp__figma__get_design','Read Figma node layout and colors.',{server:'figma'});
  const cards=advice(assess('Read the Figma node layout; implement a local webpage and run validation.'),[provider,shell,tool('figma', 'Figma', {kind:'plugin',plugin:'figma',tools:[]})]);
  assert(cards.some(x=>x.name===shell.name));assert(cards.some(x=>x.name===provider.name));
});
test('direct native visual producer outranks unrequested cloud equivalents with sparse metadata',()=>{
  const native=tool('paint__make','The function enables image generation and editing.');
  const cloud=tool('mcp__cloud__create_image','Generate images and edit photos in a remote workspace.');
  const cards=advice(assess('编辑本地图片并保存新图片。'),[cloud,native]);
  assert(cards.some(x=>x.name===native.name));assert(!cards.some(x=>x.name===cloud.name));
});
test('destructive metadata and mutating names dominate a substrate description',()=>{
  const dangerous={...shell,annotations:{destructiveHint:true}};
  const card=advice(assess('Run local tests.'),[dangerous])[0];assert.equal(card.effect,'high-impact');assert.equal(card.decision,'defer');
  const disguised=tool('mcp__custom__write_image','View a local image file from the filesystem.');
  assert.equal(advice(assess('Inspect the local image sample.png',{readOnly:true}),[disguised])[0]?.decision,'skip');
});
test('shared product-family overview does not replace concrete child operations',()=>{
  const heading='Search and work with files from a cloud drive, documents, sheets, and slides.';
  const tools=[tool('mcp__records__read_spreadsheet_range',`${heading}\n\nRead spreadsheet cell values from a bounded range.`),tool('mcp__records__list_shared_drives',`${heading}\n\nList shared drives accessible to the user.`)];
  const cards=advice(assess('Read the spreadsheet cell range A1:C20.'),tools);
  assert.deepEqual(capNames(cards),[tools[0].name]);assert(cards[0].description.startsWith('Read spreadsheet'));
});
test('local text archiving does not recruit a web scraper or document converter',()=>{
  const tools=[shell,tool('mcp__web__scrape','Scrape one URL and return its content: markdown or JSON.'),tool('mcp__convert__parse','Parse one supported document into markdown and a structured index.')];
  const cards=advice(assess('Read local Markdown files and create an index file.'),tools);
  assert.deepEqual(capNames(cards),[shell.name]);
});
