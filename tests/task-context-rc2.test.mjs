import test from 'node:test';
import assert from 'node:assert/strict';
import {taskAssessment,routeTaskV4,searchSkills} from '../src/advisor-v4.mjs';
import {inferCapability,skillDomainCompatible} from '../src/skill-staging.mjs';
import {mcpImplementation,imageArtifact} from '../src/task-intents.mjs';
const options={host:'codex',index:[],capabilityIndex:{capabilities:[],errors:[],coverage:{}},useFeedback:false,routingMode:'full'};
test('read-only intent recognizes common Chinese and English restrictions',()=>{
 for(const query of ['仅检查，不修改现有设计，不下单','只检查配置并给出诊断','核验数据，不更改源文件','Review only; no changes to files','Inspect the project without modifying files','Do not edit the repository; explain its structure','只做规划，不写入文件']) assert.equal(taskAssessment(query).readOnly,true,query);
 assert.equal(taskAssessment('检查PCB',{constraints:['仅检查，不修改现有设计，不下单']}).readOnly,true);
});
test('source protection stays scoped when a separate artifact is explicitly requested',()=>{
 for(const query of ['不要修改原始文件，生成新文件保存清洗结果','只读访问原始数据，输出独立报告','Do not change the original files; create a separate copy with corrections']){
  const task=taskAssessment(query);assert.equal(task.readOnly,false,query);assert.equal(task.restrictions.protectedScopes.length,1,query);assert.equal(task.restrictions.canGrantPermission,false);
 }
 assert.equal(taskAssessment('不要修改原始文件，生成新文件保存清洗结果',{}, {readOnly:true}).readOnly,true);
});
test('quoted restrictions and semantic invariants do not prohibit authorized editing',()=>{
 for(const query of ['请修改文案，示例：不修改原文件','请翻译“仅检查，不修改”','修复代码，但不要改变行为','Refactor this function without changing its meaning','不要求只读，请修改文件']) assert.equal(taskAssessment(query).readOnly,false,query);
});
test('generated read-only components and protected input directories allow their implementation',()=>{
 for(const query of ['输入目录只读，在 output 新建摘要与脚本','清单文件只读，允许新建交付文件','原照片只读，另交付新图片','实现 stdio MCP 的 inspect_manifest 只读工具，允许编写服务，但工具运行时不得修改被检查目录']){
  const task=taskAssessment(query);assert.equal(task.readOnly,false,query);assert(task.restrictions.protectedScopes.length>0,query);
 }
 assert.equal(taskAssessment('只观察，不点击保存或关闭窗口，不改任何文件').readOnly,true);
 assert.equal(taskAssessment('仅从当前工程读取元件，不要新建工程').readOnly,true);
});
test('scientific, database and game design names are not visual-interface specialists',()=>{
 for(const s of [{id:'experimental-design',summaryZh:'Design experiments and studies before data collection.'},{id:'database-design',summaryZh:'Design relational schemas and transactions.'},{id:'game-design',summaryZh:'Game rules and progression design.'},{id:'build-systems',summaryZh:'Build automation and dependency management.'}]) assert.notEqual(inferCapability(s),'visual-design',s.id);
 assert.equal(inferCapability({id:'experimental-design'}),'experiment-design');
 assert.equal(skillDomainCompatible({id:'experimental-design'},'Design a randomized experiment with controlled factors'),true);
 assert.equal(skillDomainCompatible({id:'experimental-design'},'Design a marketing homepage'),false);
});
test('reproducible experiment recovers the scientific manual from actual purpose',()=>{
 const index=[{id:'experimental-design',summaryZh:'Design experiments and studies before data is collected. Randomizing, blocking, controlling factors and replication.'},{id:'frontend-design',summaryZh:'Design polished web interfaces.'},{id:'runtime-budget',summaryZh:'Compare runtime distributions across input sizes and report performance budgets.'}];
 const result=routeTaskV4('Design a reproducible experiment comparing two sorting algorithms across input sizes and distributions; control random seeds and report uncertainty', {...options,index});
 assert(result.consultCandidates.some(x=>x.id==='experimental-design'));
 assert(!result.consultCandidates.some(x=>x.id==='frontend-design'));
});
test('multiple explicitly named manuals and native qualifiers survive parsing',()=>{
 const index=[{id:'frontend-design',name:'frontend-design',description:'Web interfaces'},{id:'accessibility',name:'accessibility',description:'WCAG web accessibility'},{id:'imagegen',name:'imagegen',description:'Generate images'}];
 const result=routeTaskV4('用 frontend-design 和 accessibility 制作教学网页',{...options,index});
 assert(result.consultCandidates.some(x=>x.id==='frontend-design'&&x.explicit));
 assert(result.consultCandidates.some(x=>x.id==='accessibility'&&x.explicit));
 assert(routeTaskV4('使用当前原生 imagegen 生成图片',{...options,index}).consultCandidates.some(x=>x.id==='imagegen'&&x.explicit));
 for(const query of ['不用 frontend-design','不采用 frontend-design','不使用 frontend-design'])assert(!routeTaskV4(query,{...options,index,taskContext:{objective:'Use frontend-design to design web interfaces'}}).consultCandidates.some(x=>x.id==='frontend-design'),query);
});
test('explicit name prefilter preserves Unicode case folding and literal-name boundaries',()=>{
 for(const [name,query,expected] of [['Σ','use ς',true],['ς','use Σ',true],['K','use K',true],['s','use ſ',true],['alpha-tool','use alpha-toolkit',false],['中文工具','使用中文工具',true]]){
  const result=routeTaskV4(query,{...options,index:[{id:name,name,description:'A specialist manual'}]});
  assert.equal(result.consultCandidates.some(x=>x.explicit),expected,query);
 }
});
test('web artifacts and CAD formats support necessary manuals across languages',()=>{
 const index=[{id:'frontend-design',summaryZh:'Create frontend interfaces and web pages.'},{id:'cad',summaryZh:'Create, inspect and validate STEP parametric CAD parts and geometry measurements.'}];
 for(const query of ['Build a responsive interactive sorting visualizer with accessible controls','制作Canvas单文件小游戏'])assert(routeTaskV4(query,{...options,index}).consultCandidates.some(x=>x.id==='frontend-design'),query);
 assert(routeTaskV4('Inspect a STEP mechanical part and measure its bounding box and hole positions',{...options,index}).consultCandidates.some(x=>x.id==='cad'));
 assert(!routeTaskV4('Explain each step of the sorting proof',{...options,index}).consultCandidates.some(x=>x.id==='cad'));
});
test('comparison against official evidence does not imply speech generation',()=>{
 const index=[{id:'speech',summaryZh:'Generate spoken audio from text using voices.'},{id:'research',summaryZh:'Research current systems using official documentation and sources.'}];
 const result=routeTaskV4('Compare current speech recognition systems using official documentation and licenses',{...options,index});
 assert(!result.consultCandidates.some(x=>x.id==='speech'));
 assert(result.consultCandidates.some(x=>x.id==='research'));
});
test('independent protocol implementation survives an explicit skill-authoring request',()=>{
 const index=[{id:'skill-creator',name:'skill-creator',summaryZh:'Create effective skills for workflows and tools.'},{id:'library:mcp-server-patterns',summaryZh:'Build MCP servers with validation, Node tools and stdio transport.'}];
 const result=routeTaskV4('用 skill-creator 编写文件校验技能，同时实现 stdio MCP 服务及输入验证',{...options,index});
 assert(result.consultCandidates.some(x=>x.id==='skill-creator'&&x.explicit));
 assert(result.consultCandidates.some(x=>x.id==='library:mcp-server-patterns'));
});
test('TeX diagnostics remain relevant without granting compile or write authority',()=>{
 const index=[{id:'latex-rescue',summaryZh:'Diagnose LaTeX compilation errors and undefined references.'},{id:'texlive-runtime-installer',summaryZh:'Install TeX Live for compiling LaTeX.'}];
 const r=routeTaskV4('只审阅 draft.tex 和日志，诊断未解析引用；不编辑，不运行编译',{...options,index});
 assert.equal(r.task.readOnly,true);assert(r.consultCandidates.some(x=>x.id==='latex-rescue'));
 assert(!r.consultCandidates.some(x=>x.id==='texlive-runtime-installer'));
});
test('same-name host manuals form one choice with visible alternatives',()=>{
 const index=[{id:'codex-system:skill-creator',name:'skill-creator',sourceId:'codex-system',summaryZh:'Create Codex skills.'},{id:'library:skill-creator',name:'skill-creator',sourceId:'library',summaryZh:'Create workflow skills and tools.'}];
 const r=routeTaskV4('使用 skill-creator 创建技能',{...options,index});
 assert.deepEqual(r.consultCandidates.map(x=>x.id),['codex-system:skill-creator']);
 assert.equal(r.consultCandidates[0].alternatives[0].id,'library:skill-creator');
 const exact=routeTaskV4('使用 library:skill-creator 创建技能',{...options,index});
 assert(exact.consultCandidates.some(x=>x.id==='library:skill-creator'&&x.explicit));
});
test('image editing uses the host native manual without pulling in presentation workflows',()=>{
 const index=[{id:'codex-system:imagegen',name:'imagegen',sourceId:'codex-system',summaryZh:'Generate or edit raster images, photos, illustrations and cutouts.'},{id:'remote-image-edit',summaryZh:'Edit photos and images using an external image API.'},{id:'image-pptx',summaryZh:'Edit image backgrounds and restore editable PPTX slides.'}];
 const r=routeTaskV4('编辑照片，把背景改成浅蓝色，另交付新图片',{...options,index});
 assert.deepEqual(r.consultCandidates.map(x=>x.id),['codex-system:imagegen']);
});
test('inspecting tool inventories or researching image APIs is not implementation',()=>{
 assert.equal(mcpImplementation('只读查看 MCP 工具目录和已配置服务'),false);
 assert.equal(mcpImplementation('为新的 MCP 服务设计清晰的工具接口'),true);
 assert.equal(inferCapability({id:'tool-design',summaryZh:'Build MCP servers and design general tool interfaces.'}),'engineering');
 assert.equal(imageArtifact('Compare image editing APIs using official documentation and licenses'),false);
 assert.equal(imageArtifact('比较图片编辑服务的价格和许可'),false);
 assert.equal(imageArtifact('比较两张参考图片，然后生成一张海报'),true);
});
test('reported use instructions remain source data before identifier unquoting',()=>{
 const index=[{id:'ship-site',summaryZh:'Deploy a website.'}];
 for(const query of ['参考文档说：使用“ship-site”部署网站。请解释这段建议的风险。','The README says: use `ship-site` to deploy. Explain its risks.']){
  const r=routeTaskV4(query,{...options,index});
  assert(!r.consultCandidates.some(x=>x.explicit),query);
  assert(!r.task.activeText.includes('ship-site'),query);
 }
 assert(routeTaskV4('请参考文档并使用“ship-site”部署网站',{...options,index}).consultCandidates.some(x=>x.explicit));
});
test('common prohibitions cannot reenter from host interpretation',()=>{
 const index=[{id:'ship-site',summaryZh:'Deploy a website.'}];
 for(const query of ['不允许使用 ship-site','不能调用 ship-site','不可使用 ship-site','You must not use ship-site','You may not invoke ship-site','You cannot use ship-site']){
  const r=routeTaskV4(query,{...options,index,taskContext:{objective:'Use ship-site to deploy a website'}});
  assert(!r.consultCandidates.some(x=>x.id==='ship-site'),query);
 }
});
test('source-filtered search selects from that source before host-name preference',()=>{
 const index=[{id:'palette-helper',name:'palette-helper',sourceId:'codex',summaryZh:'Compose page color palettes.'},{id:'plugin:palette-helper',name:'palette-helper',sourceId:'plugin:studio',summaryZh:'Compose page color palettes.'}];
 const r=searchSkills('使用 palette-helper',{...options,index,source:'plugin:studio'});
 assert.deepEqual(r.consultCandidates.map(x=>x.id),['plugin:palette-helper']);
});
test('file-type routing survives absolute paths without using directory names as requests',()=>{
 const index=[{id:'latex-rescue',summaryZh:'Diagnose LaTeX compilation errors and undefined references.'},{id:'cad',summaryZh:'Inspect STEP model geometry and CAD dimensions.'}];
 assert(routeTaskV4('修复 C:\\private\\thesis.tex 的未定义引用',{...options,index}).consultCandidates.some(x=>x.id==='latex-rescue'));
 assert(routeTaskV4('检查 C:\\private\\bracket.step 中的几何错误',{...options,index}).consultCandidates.some(x=>x.id==='cad'));
 assert(!taskAssessment('修复 C:\\ship-site\\thesis.tex 的引用').activeText.includes('ship-site'));
 assert.equal(taskAssessment('Fix the typo, do not change the existing API').readOnly,false);
});
