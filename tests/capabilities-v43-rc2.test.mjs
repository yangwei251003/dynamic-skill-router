import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities,discoverCapabilities} from '../src/capabilities-v4.mjs';

const tool=(name,description,extra={})=>({id:`tool:${name}`,kind:'tool',name,description,enabled:true,callable:true,evidence:'runtime-tool',annotations:{},...extra});
const assess=(activeText,extra={})=>({activeText,activeClauses:[activeText],readOnly:false,...extra});
const advise=(query,capabilities,options={})=>adviseCapabilities(typeof query==='string'?assess(query):query,{capabilityIndex:{capabilities,coverage:{},errors:[],revision:'rc2-fixture'},...options});
// A registry namespace caption is not the tool's purpose. These names are
// deliberately unlike production identifiers to test the metadata boundary.
const visual=tool('visual_studio__compose','Tools in the visual_studio namespace.\n\nThe `visual_studio.compose` tool enables image generation from descriptions and editing of existing images based on specific instructions. Use it when:\n\n- Requested visual changes can preserve an existing logo.\n\nGuidelines:\n- Read unrelated repository logs first.');
const distractions=[
  tool('mcp__workspace__get_worktree_status','Check a pending worktree operation. Returns supplied images and product details while preparing existing files.'),
  tool('mcp__research__agent','Run public web research. Describe the product fields to return and preserve the supplied format.'),
  tool('mcp__editor__connect_artifact','Connect an existing spreadsheet to a local editing session. Return its references and edit the supplied image later.'),
];

test('native registry tools are retained without inventing an MCP server',()=>{
  const inventory=discoverCapabilities({host:'generic',runtimeTools:[{name:visual.name,description:visual.description,available:true}]});
  const entry=inventory.capabilities.find(x=>x.kind==='tool');
  assert.equal(entry.server,null);
  assert.equal(entry.callable,true);
  assert.equal(inventory.coverage.mcpServers,0);
  const result=adviseCapabilities(assess('Edit the supplied product photo to preserve its texture.'),{capabilityIndex:inventory});
  assert.equal(result.candidates[0]?.name,visual.name);
  assert.equal(result.candidates[0].phase,'implementation');
  assert.equal(result.candidates[0].effect,'write-or-unknown');
  assert.equal(result.candidates[0].decision,'check-scope');
});

test('native namespace captions do not hide image editing or recruit unrelated workflow tools',()=>{
  const result=advise('Edit the supplied product photo: preserve its logo and surface texture, return a PNG cutout.',[...distractions,visual]);
  assert.deepEqual(result.candidates.map(x=>x.name),[visual.name]);
  assert.match(result.candidates[0].description,/enables image generation/);
  assert.equal(result.candidates[0].explicit,false);
});

test('English picture edits and Chinese visual generation retrieve concrete image tools',()=>{
  for(const query of ['Retouch the picture and keep the original label.','生成一张海报，主题是一只读书的机器人。','编辑这张照片，保留人物面孔。']){
    const result=advise(query,[visual,...distractions]);
    assert.equal(result.candidates[0]?.name,visual.name,query);
    assert.equal(result.phase,'implementation',query);
    assert.equal(result.candidates[0].decision,'check-scope',query);
  }
});

test('image-related prose alone does not match unrelated arithmetic or Docker requests',()=>{
  for(const query of ['计算 19 加 23。','List Docker image layers in the container registry.','Create a Docker image for the service.','Generate a bootable disk image.','请解释函数闭包并给出一个例子。']){
    assert(!advise(query,[visual]).candidates.some(x=>x.name===visual.name),query);
  }
});

test('secondary workflow sentences and schema examples do not become tool-purpose evidence',()=>{
  const unrelated=tool('native__connect','Tools in the native namespace.\n\nConnect an existing spreadsheet. Use this to generate images or edit photos in another tool.\n\nexec tool declaration:\n```ts\n// edit product photo\n```');
  assert.deepEqual(advise('Edit a product photo and generate a transparent image.',[unrelated]).candidates,[]);
  assert.deepEqual(advise('Read unrelated repository logs',[visual]).candidates,[]);
});

test('read-only mode rejects image mutation even under a misleading read-only annotation',()=>{
  for(const invocationContext of [{mode:'plan'},{mode:'execute',readOnly:true}]){
    const result=advise('Edit product photo',[{...visual,annotations:{readOnlyHint:true}}],{invocationContext});
    assert.equal(result.candidates[0]?.decision,'skip');
    assert(result.candidates[0].gates.includes('read-only-scope'));
  }
});

test('unknown read effects are still deferred rather than promoted by purpose text',()=>{
  const reader=tool('visual__get_picture','Read picture dimensions and colour profile.');
  const result=advise(assess('Read picture dimensions',{readOnly:true}),[reader]);
  assert.equal(result.candidates[0]?.decision,'defer');
  assert.equal(result.candidates[0].effect,'unknown');
  assert(result.candidates[0].gates.includes('verify-read-only-effect-before-invocation'));
});

test('generation job polling is a reader and is not suggested before a job exists',()=>{
  const status=tool('media__get_generate_image_job','Check an image generation job started by compose.',{annotations:{readOnlyHint:true}});
  assert(!advise('Generate an image',[visual,status]).candidates.some(x=>x.name===status.name));
  const result=advise(assess('Read image generation job status',{readOnly:true}),[status]);
  assert.equal(result.candidates[0]?.decision,'use-now');
  assert.equal(result.candidates[0].effect,'read');
  const unknown=advise(assess('Read image generation job status',{readOnly:true}),[{...status,annotations:{}}]);
  assert.equal(unknown.candidates[0]?.decision,'defer');
});

test('background removal edits an image while actual deletion keeps its delivery gate',()=>{
  const cutout=tool('visual__remove_background','Remove the background from an image.');
  const deletion=tool('visual__delete_image','Delete an image from the shared account.');
  const result=advise('Edit the image to remove its background',[cutout,deletion]);
  assert.equal(result.candidates.find(x=>x.name===cutout.name)?.decision,'check-scope');
  assert.equal(result.candidates.find(x=>x.name===cutout.name)?.effect,'write-or-unknown');
  assert(!result.candidates.some(x=>x.name===deletion.name));
  const deleteReview=advise('Review image delete policy',[deletion]);
  assert.equal(deleteReview.candidates[0]?.decision,'defer');
  assert.equal(deleteReview.candidates[0].effect,'high-impact');
  const locked=advise(assess('Edit the image to remove its background',{readOnly:true}),[cutout]);
  assert.equal(locked.candidates[0]?.decision,'skip');
});

test('a named source provider does not suppress a separate image-generation need',()=>{
  const provider={id:'plugin:archive',kind:'plugin',name:'Archive Drive',plugin:'archive-drive',description:'Document archive',enabled:true,callable:true,tools:[]};
  const reader=tool('mcp__archive__read_document','Read Archive Drive project document',{plugin:'archive-drive',annotations:{readOnlyHint:true}});
  const assessment=assess('Use Archive Drive to read the project brief, then generate an image.',{capabilityNeeds:['Read Archive Drive project document','Generate an image'],retrievalText:'Read Archive Drive project document Generate an image'});
  const result=advise(assessment,[provider,reader,visual],{capabilityLimit:2});
  assert(result.candidates.some(x=>x.name===reader.name));
  assert(result.candidates.some(x=>x.name===visual.name));
  assert.deepEqual(result.needCoverage.uncovered,[]);
  assert.equal(result.candidates.find(x=>x.name===visual.name).explicit,false);
});

test('unavailable native metadata does not become callable from descriptive similarity',()=>{
  const inventory=discoverCapabilities({host:'generic',runtimeTools:[{name:visual.name,description:visual.description,available:false}]});
  const result=adviseCapabilities(assess('Generate an image'),{capabilityIndex:inventory});
  assert.deepEqual(result.candidates,[]);
  assert.equal(inventory.capabilities.find(x=>x.name===visual.name).runtimeAvailable,false);
});

test('precisely named tools still bypass lexical thresholds but not safety gates',()=>{
  const result=advise(assess('Use visual_studio__compose',{readOnly:true}),[visual]);
  assert.equal(result.candidates[0]?.explicit,true);
  assert.equal(result.candidates[0].decision,'skip');
});

test('scoped source protection survives in tool cards without authorizing overwrite',()=>{
  const protectedScopes=[{source:'user-request',scope:'protected-target',clause:'Do not modify the original photo'}];
  const result=advise(assess('Edit the picture and create a separate copy',{restrictions:{readOnly:false,protectedScopes,canGrantPermission:false}}),[visual]);
  const card=result.candidates[0];
  assert.equal(card.decision,'check-scope');
  assert.deepEqual(card.protectedScopes,protectedScopes);
  assert(card.gates.includes('preserve-protected-targets-and-check-output-destination'));
  assert.equal(card.invocation.automaticallyExecuted,false);
});

test('opaque names still classify a Chinese generation purpose as a mutation',()=>{
  const producer=tool('studio__compose','生成插画并返回 PNG 图片。',{annotations:{readOnlyHint:true}});
  const result=advise(assess('生成一张插画',{readOnly:true}),[producer]);
  assert.equal(result.candidates[0]?.decision,'skip');
  assert.equal(result.candidates[0].effect,'write-or-unknown');
});

test('Canvas is not a plural spelling of the Canva provider',()=>{
  const canva=tool('mcp__app__canva_generate_design','Create a Canva animated web design.',{plugin:'Canva'});
  for(const query of ['Build a single-file Canvas game.','Create a Canvas animation inside a local HTML page.'])assert.deepEqual(advise(query,[canva]).candidates,[]);
  const explicit=advise('Create an animation in Canva for the Canvas game',[canva]);
  assert.equal(explicit.candidates[0]?.name,canva.name);
});

test('open-source comparisons using official evidence retrieve research instead of opening panels',()=>{
  const search=tool('web__search','Search the public web for official documentation and research sources.',{annotations:{readOnlyHint:true}});
  const open=tool('workspace__open_document','Open an existing source document in a desktop panel.',{annotations:{readOnlyHint:true}});
  const speech=tool('audio__generate_speech','Generate speech from supplied text.');
  const result=advise('Compare current open-source speech recognition using official docs.',[open,speech,search]);
  assert.equal(result.candidates[0]?.name,search.name);
  assert.equal(result.candidates[0].decision,'use-now');
  assert(!result.candidates.some(x=>x.name===open.name||x.name===speech.name));
  assert(!advise('Compare the two local arrays',[search]).candidates.length);
});

test('a local single-file deliverable does not imply creating cloud files',()=>{
  const cloud=[
    tool('mcp__apps__github_create_file','Create a file in a GitHub repository.',{plugin:'GitHub'}),
    tool('mcp__apps__google_drive_create_file','Create a file in Google Drive.',{plugin:'Google Drive'}),
    tool('mcp__apps__figma_create_new_file','Create a new design file in Figma.',{plugin:'Figma'}),
    tool('mcp__windows__file_open','Open a local file in its default application.'),
    tool('mcp__coverage__get_file_coverage','Get coverage for a source file.'),
    tool('mcp__editor__create_latex_project','Create a new TeX project directory containing the main file.'),
  ];
  for(const query of ['Create a single local HTML file for the game.','Create an offline Canvas animation in a single file.'])assert.deepEqual(advise(query,cloud).candidates,[],query);
  const reader=tool('mcp__apps__figma_get_design_context','Read the Figma design node for implementation.',{plugin:'Figma',annotations:{readOnlyHint:true}});
  const named=advise('Read Figma design context and implement a local HTML file',[reader]);
  assert.equal(named.candidates[0]?.name,reader.name);
});

test('generic actions cannot recruit tools or plugin containers without a matching object',()=>{
  const unrelated=[
    tool('cloud__search_design_system','Search the design system for assets.'),
    tool('cloud__generate_design','Generate a visual design.'),
    {id:'plugin:bundles',kind:'plugin',name:'Creative Bundle',description:'Generate, inspect and test projects.',enabled:true,callable:false,tools:[]},
  ];
  assert.deepEqual(advise('Use frontend-design to implement and test a local sorting tutorial.',unrelated).candidates,[]);
  assert.deepEqual(advise('设计一个实验，生成运行顺序并测试测量误差。',unrelated).candidates,[]);
});

test('Chinese public-source verification recalls broad readers but not specialized paper search',()=>{
  const publicWeb=tool('native__web_search','Search public web sources.');
  const papers=tool('research__search_papers','Search academic research papers and sources.');
  const result=advise('核实公共数据门户的许可并打开主管机构说明。',[papers,publicWeb]);
  assert.equal(result.candidates[0]?.name,publicWeb.name);
  assert(!result.candidates.some(x=>x.name===papers.name));
  assert(!advise('核实本地CSV里这两行是否重复。',[publicWeb]).candidates.length);
});

test('version history is a distinct read object, not a generic request to revise content',()=>{
  const provider={id:'plugin:drive',kind:'plugin',name:'Google Drive',plugin:'Google Drive',enabled:true,callable:true,tools:[],description:''};
  const revisions=[
    tool('cloud__google_drive_list_file_revisions','List version-history revisions for a Google Drive file.',{plugin:'Google Drive'}),
    tool('cloud__google_drive_fetch_file_revision','Fetch text from one Drive revision.',{plugin:'Google Drive'}),
  ];
  const extras=[provider,tool('cloud__google_drive_get_document_tables','Read Google Drive document tables.',{plugin:'Google Drive'})];
  for(const query of ['只读比较 Google Drive 文档当前版与上一版。','Read the previous version of the Google Drive document.']){
    const result=advise(assess(query,{readOnly:true}),[...extras,...revisions]);
    assert.deepEqual(new Set(result.candidates.map(x=>x.name)),new Set(revisions.map(x=>x.name)));
    assert(result.candidates.every(x=>x.decision==='defer'&&x.effect==='unknown'));
  }
  assert.deepEqual(advise('修订现有课件，拆开章节并保留备注。',revisions).candidates,[]);
});

test('shared desktop workflows do not become every tool purpose or grant write permission',()=>{
  const shared='### 1. WINDOW TARGETING (Required First Step)\nFind a window, then click controls and save files.\n\n### 2. UI INTERACTION\nRead text, inspect state, type and drag.';
  const tools=[tool('mcp__windows_control__ui_click',shared),tool('mcp__windows_control__ui_read',shared),tool('mcp__windows_control__ui_read_table',shared),tool('mcp__windows_control__ui_select',shared)];
  for(const query of ['只观察当前窗口标题，不点击保存或关闭窗口。','Read the current desktop window title without clicking controls.']){
    const result=advise(assess(query,{readOnly:true}),tools);
    assert.deepEqual(result.candidates.map(x=>x.name),['mcp__windows_control__ui_read']);
    assert.equal(result.candidates[0].decision,'defer');
    assert.equal(result.candidates[0].effect,'unknown');
  }
});

test('a unique native short name is explicit and its alternative producers do not crowd the choice',()=>{
  const native=tool('native__paintmaker','Generate an image or edit a photo.');
  const cloud=tool('cloud__generate_image','Generate an image or edit a photo.',{plugin:'Visual Cloud'});
  const reader=tool('native__inspect_image','Inspect image quality.',{annotations:{readOnlyHint:true}});
  const result=advise('使用当前原生 paintmaker 生成图片并检查图片质量。',[cloud,reader,native]);
  assert(result.candidates.some(x=>x.name===native.name&&x.explicit));
  assert(!result.candidates.some(x=>x.name===cloud.name));
  assert(result.candidates.some(x=>x.name===reader.name));
});

test('a direct native producer is preferred over an unrequested equivalent cloud producer',()=>{
  const cloud=tool('cloud__generate_image','Generate an image or edit a photo.',{plugin:'Visual Cloud'});
  const native=tool('native__paintmaker','Generate an image or edit a photo.');
  assert.deepEqual(advise('Edit this photo',[cloud,native]).candidates.map(x=>x.name),[native.name]);
  assert(advise('Edit this photo',[cloud]).candidates.some(x=>x.name===cloud.name));
  assert(advise('Edit this photo using Visual Cloud',[cloud,native]).candidates.some(x=>x.name===cloud.name));
});

test('a local code task does not imply installing or resetting runtime dependencies',()=>{
  const tools=[tool('runtime__load_dependencies','Load Node.js dependencies.'),tool('runtime__js_reset','Reset the Node.js session.'),tool('runtime__js','Run Node.js code.')];
  assert.deepEqual(advise('Implement a Node.js local service',[...tools]).candidates.map(x=>x.name),['runtime__js']);
  assert(advise('Load Node.js dependencies',tools).candidates.some(x=>x.name==='runtime__load_dependencies'));
});

test('read-only local diagnostics do not request cloud sources or an explicitly excluded compiler',()=>{
  const tools=[
    tool('cloud__github_fetch','Fetch public source material from GitHub.',{plugin:'GitHub'}),
    tool('tex__compile_latex_document','Compile a LaTeX source document.'),
    tool('tex__create_latex_project','Create a new LaTeX project.'),
  ];
  assert.deepEqual(advise(assess('仅审阅本地 thesis.tex 日志，不运行编译、不修改文件。',{readOnly:true}),tools).candidates,[]);
  assert.deepEqual(advise('核实公共网站的原始资料和来源',[tools[0]]).candidates,[]);
});
