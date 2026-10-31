import test from 'node:test';
import assert from 'node:assert/strict';
import {semanticTaskText,taskStructure,hasProducedFormat,requestedRasterWork} from '../src/task-structure.mjs';
import {webImplementation,numericalComputation,imageArtifact,supportsNumericalComputation} from '../src/task-intents.mjs';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';

const manual=(id,summaryZh,extra={})=>({id,nameZh:id,summaryZh,sourceId:'fixture',...extra});
const frontend=manual('frontend-design','Create frontend websites and browser applications.');
const raster=manual('imagegen','Generate and edit raster images and illustrations.',{sourceId:'codex-system'});
const math=manual('numerical-methods','Numerical computation with ODE integration, quadrature and convergence checks.');
const options={host:'codex',index:[frontend,raster,math],capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const cards=(query,index=options.index)=>routeTaskV4(query,{...options,index}).consultCandidates;

test('basename and parent-directory renaming does not invent specialist intent',()=>{
 const queries=['Read ordinary.txt; create summary.json','Read numerical-computation.txt; create imagegen.json','Read C:/work/latex-papers/original.txt; create summary.json'];
 for(const query of queries){
  const assessment=taskAssessment(query);
  assert(!numericalComputation(assessment.retrievalText),query);
  assert(!imageArtifact(assessment.retrievalText),query);
  assert(!cards(query).some(x=>['imagegen','numerical-methods'].includes(x.id)),query);
 }
 assert.equal(semanticTaskText('Read source.txt; save report.json'),semanticTaskText('Read renamed.txt; save anything.json'));
});
test('technology names survive advisory filename projection',()=>{
 for(const name of ['Node.js','Three.js','Next.js'])assert(semanticTaskText(`Implement a service using ${name}`).includes(name),name);
 assert(semanticTaskText('Write SKILL.md').includes('SKILL.md'));
});
test('explicit specialist names survive projection even when shaped like filenames',()=>{
 for(const id of ['custom-raster','custom-raster.png']){
  const skill=manual(id,'Generate raster images.');
  assert(cards(`Please use ${id} for this task`,[skill]).some(x=>x.id===id&&x.explicit),id);
  assert(!cards(`Read ${id} and summarize its contents`,[skill]).some(x=>x.explicit),id);
 }
});
test('an HTML input and unrelated JSON output never imply webpage authoring',()=>{
 for(const query of ['Read source.html; create summary.json','Create summary.json. Read source.html','读取 source.html，创建 summary.json','Read source.html and create summary.json']){
  const assessment=taskAssessment(query);
  assert(!webImplementation(assessment.retrievalText),query);
  assert(!cards(query).some(x=>x.id===frontend.id),query);
 }
 assert(!hasProducedFormat('Read source.html; create summary.json',/^html?$/));
});
test('true webpage outputs survive punctuation and independent output order',()=>{
 for(const query of ['Create a web page; deliver index.html; save checks.json','Save checks.json. Create a web page. Deliver renamed.html','创建网页，交付 main.html；保存 checks.json']){
  assert(webImplementation(taskAssessment(query).retrievalText),query);
  assert(cards(query).some(x=>x.id===frontend.id),query);
  assert(!cards(query).some(x=>x.id===raster.id),query);
 }
});
test('previews of another artifact do not become primary raster work',()=>{
 for(const query of ['Create a Word report; save a preview as page.png','Save a screenshot as view.png; create a web page','编写 LaTeX 文件；实际渲染预览 page.png']){
  const structure=taskStructure(query);
  assert(!requestedRasterWork(query),query);
  assert(!imageArtifact(taskAssessment(query).retrievalText),query);
  assert(structure.artifacts.filter(x=>x.format==='png').every(x=>x.role==='verification'),query);
 }
});
test('primary raster edits remain active when preview delivery is in the same clause',()=>{
 for(const query of ['Edit portrait.png; save a preview as check.png','Edit portrait.png and save a preview as check.png','编辑 portrait.png，保存预览 check.png']){
  assert(requestedRasterWork(query),query);
  assert(imageArtifact(taskAssessment(query).retrievalText),query);
  assert(cards(query).some(x=>x.id===raster.id),query);
 }
});
test('an explicit raster generation deliverable is distinct from a preview',()=>{
 for(const query of ['Generate logo.png with a transparent background','生成 logo.png，背景透明','Generate a transparent PNG portrait']){
  assert(imageArtifact(taskAssessment(query).retrievalText),query);
  assert(cards(query).some(x=>x.id===raster.id),query);
 }
});
test('numerical requirements stay invariant under supplementary artifact renaming',()=>{
 for(const tail of ['Save errors.csv and convergence.png','Save observations.csv and chart.png','Save record.json; save errors.csv']){
  const query=`Implement forward Euler for an ODE and compare numerical error. ${tail}`;
  assert(numericalComputation(taskAssessment(query).retrievalText),query);
  assert(cards(query).some(x=>x.id===math.id),query);
  assert(!cards(query).some(x=>x.id===raster.id),query);
 }
 for(const query of ['Check the floating point display error in HTTP order totals','比较两家商店的会员积分规则和预算'])assert(!numericalComputation(query),query);
 assert(!supportsNumericalComputation(manual('symbolic-guide','Exact symbolic algebra. Prefer NumPy or SciPy when floating point approximations suffice.')));
 assert(supportsNumericalComputation(manual('solver-guide','Numerical ODE computation with convergence and error analysis.')));
});
