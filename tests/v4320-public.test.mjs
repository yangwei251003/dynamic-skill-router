import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4,searchSkills} from '../src/advisor-v4.mjs';
import {taskPurposeMatches,prohibitedDeclaredProduct} from '../src/task-purpose-v4.mjs';
import {specialtyMismatch} from '../src/specialty-alignment-v4.mjs';

// These descriptions and requests are synthetic; no private skill inventory,
// business service, software account or third-party manual is used.
const base={sourceId:'fixture',availability:{discovered:true,readable:true,enabled:true,compatible:true},aliases:[],triggers:[]};
const frontend={...base,id:'fictional-webcraft',nameZh:'fictional-webcraft',summaryZh:'Create frontend interfaces and web components. Generates HTML and CSS code.'};
const filler=Array.from({length:30},(_,i)=>({...base,id:`fixture-${i}`,nameZh:`fixture-${i}`,summaryZh:`independent subject ${i}`}));
const opts={host:'generic',contractVersion:4,routingMode:'full',dryRun:true,useFeedback:false,runtimeTools:[],capabilityIndex:{capabilities:[],coverage:{},errors:[]}};
const recommended=(result,id)=>(result.consultCandidates||[]).some(c=>c.id===id&&c.suggestedMode!=='skip');

test('an implementation can consult a frontend manual in both routing stages',()=>{
  const request='开发可在本机运行的网页，用键盘浏览列表。';
  const options={...opts,index:[frontend,...filler],limit:12};
  const first=routeTaskV4(request,options);
  const phase=searchSkills(request,{...options,routeId:first.routeId,phase:'implementation'});
  assert(recommended(first,frontend.id));
  assert(recommended(phase,frontend.id));
  assert.equal(phase.routeId,first.routeId);
});

test('a non-implementation explanation does not match a frontend action',()=>{
  const active='请解释网页中的颜色对比度，不需要开发或修改软件。';
  assert(!taskPurposeMatches(frontend,{activeText:active,activeClauses:[active]}).some(m=>m.group==='frontend-work'));
});

test('specific declared product aliases can express a whole-product ban',()=>{
  const skill={...base,id:'novadraw-api',nameZh:'novadraw-api',summaryZh:'NovaDraw software for editing diagrams. Trigger on: "星绘工坊NVD", "NovaDraw", "diagram editor". 星绘工坊NVD 的英文名 NovaDraw.'};
  assert(prohibitedDeclaredProduct(skill,['不要使用星绘工坊 NVD']));
  assert(prohibitedDeclaredProduct(skill,['不要使用 NovaDraw']));
  assert.equal(prohibitedDeclaredProduct(skill,['不要上传到星绘工坊 NVD']),null);
});

test('a personal website is not classified as an agent persona',()=>{
  const site={...base,id:'fictional-site',summaryZh:'Create personal homepages.'};
  const persona={...base,id:'fictional-persona',summaryZh:'Create a persona for an agent.'};
  assert.equal(specialtyMismatch(site,'制作网页'),null);
  assert(specialtyMismatch(persona,'制作网页'));
});

test('a multi-output request keeps named and distinct relevant capabilities',()=>{
  const decks=Array.from({length:5},(_,i)=>({...base,id:`deck-${i}`,nameZh:`deck-${i}`,summaryZh:'Create and edit PowerPoint slides and presentation decks.'}));
  const request='请用 deck-4 制作可编辑的四页演示稿，并开发一个展示植物的响应式网页。';
  const options={...opts,index:[...decks,frontend,...filler],limit:12};
  const first=routeTaskV4(request,options);
  const phase=searchSkills(request,{...options,routeId:first.routeId,phase:'implementation'});
  for(const result of [first,phase]){
    assert(recommended(result,'deck-4'));
    assert(recommended(result,frontend.id));
  }
  const consulted=phase.consultCandidates.filter(c=>c.id.startsWith('deck-')&&c.suggestedMode!=='skip');
  assert(consulted.length<=3,`too many similar candidates: ${consulted.length}`);
});
