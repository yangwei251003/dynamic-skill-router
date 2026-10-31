import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';
import {sourceCodeReview,supportsSourceCodeReview,latexBuild,latexFailure,supportsLatexBuild,cadArtifact} from '../src/task-intents.mjs';
import {languageEvidence} from '../src/purpose-evidence.mjs';
const manual=(id,summaryZh)=>({id,nameZh:id,summaryZh,sourceId:'fixture'});
const review=manual('code-review','Review changed code for correctness, security and documented intent.');
const narrow=manual('complexity-review','Code review focused exclusively on over-engineering.');
const dart=manual('dart-code-review','Review Dart code for state management and correctness.');
const maps=manual('geo-map','Map service integration and geographical navigation. Also review code using this API.');
const compile=manual('latex-compile','Compile a TeX project with a bundled engine or fall back to detected TeX Live.');
const repair=manual('latex-rescue','Diagnose and fix LaTeX compilation errors.');
const doctor=manual('latex-doctor','Detect TeX availability and perform a compile smoke test.');
const cad=manual('cad','Create parametric mechanical parts and export STEP models.');
const options={host:'codex',index:[review,narrow,dart,maps,compile,repair,doctor,cad],capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const cards=q=>routeTaskV4(q,options).consultCandidates.map(x=>x.id);

test('primary review scope separates data structures, services and exclusive specialties',()=>{
 const q='全程只读：审查Go代码中map及互斥锁的并发正确性，报告缺陷。';
 assert(sourceCodeReview(q));assert.deepEqual(cards(q),[review.id]);
 assert(supportsSourceCodeReview(narrow,'Review this code for over-engineering and complexity.'));
 assert(!supportsSourceCodeReview(dart,q));
});
test('code behavior supplies the object even without a generic code label',()=>{
 const q='全程只读：审查页面把外部字符串赋给innerHTML的做法，只报告攻击条件和替代方案。';
 const host={objective:'修复并部署演示版',actions:['修改页面','审查输入到DOM的路径'],capabilityNeeds:['部署页面','检查DOM写入']};
 const a=taskAssessment(q,host,{readOnly:true});
 assert(sourceCodeReview(a.retrievalText));assert(a.readOnly);
 assert.equal(a.originalRequest,q);assert.deepEqual(a.capabilityNeeds,host.capabilityNeeds);
 assert(!/部署|修复|修改/.test(a.retrievalText));
 assert.deepEqual(a.interpretation.retrievalCapabilityNeeds,['检查DOM写入']);
 assert(cards(q).includes(review.id));
 assert(sourceCodeReview('Create a report and review the supplied C++ patch.'));
 assert(sourceCodeReview('创建报告并审查给定代码。'));
});
test('routine successful compilation is different from observed errors and environment checks',()=>{
 const routine='创建LaTeX便笺，实际编译到引用稳定，交付PDF，确认无未解析引用。';
 assert(latexBuild(routine));assert(!latexFailure(routine));assert(supportsLatexBuild(compile));
 assert(!supportsLatexBuild(doctor));assert(cards(routine).includes(compile.id));
 assert(!cards(routine).includes(repair.id));
 const broken='修复LaTeX源码出现的undefined control sequence，实际编译PDF。';
 assert(latexFailure(broken));assert(cards(broken).includes(repair.id));
});
test('geometry, physical units and an output-format relation establish a CAD artifact',()=>{
 const q='制作一个60×25×3 mm平板，钻两个直径4 mm通孔，交付可编辑实体和STEP。';
 assert(cadArtifact(q));assert(cards(q).includes(cad.id));
 assert(!cadArtifact('Write a step by step guide with three steps.'));
});
test('language identities preserve punctuation and do not treat ordinary go as a language',()=>{
 assert.deepEqual(languageEvidence('Review C++ code'),['c++']);
 assert.deepEqual(languageEvidence('Review C# code'),['c#']);
 assert.deepEqual(languageEvidence('Go ahead and review the supplied Java patch'),['java']);
 assert.deepEqual(languageEvidence('review go code'),['go']);
});
