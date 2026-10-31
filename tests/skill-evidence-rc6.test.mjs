import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4,taskAssessment} from '../src/advisor-v4.mjs';
import {requestedName,unquoteRequestedNames} from '../src/request-entities.mjs';
const manual=(id,summaryZh,extra={})=>({id,nameZh:id,summaryZh,sourceId:'fixture',...extra});
const index=[
 manual('warehouse-sync','查看本地文件，下载自然素材，新建节点，导出并确认结果'),
 manual('product-cloud-agent','Build AI agent backends on a hosted platform',{triggers:['py']}),
 manual('docx','Read and edit Word DOCX files, preserve headings and paragraph styles'),
 manual('sympy','Exact symbolic algebra, matrices and polynomial computation'),
 manual('academic-paper','Academic paper writing and literature preparation'),
 manual('ffmpeg-video-editor','Generate FFmpeg commands for video editing: cut, trim, encode and resize'),
 manual('geopandas','Work with geospatial vector data, coordinate reference systems and spatial joins'),
 manual('or-modeling','Operations research for quantitative mathematical modeling and constraints'),
 manual('cad','Create mechanical CAD geometry and parametric solid models'),
];
const options={host:'codex',index,capabilityIndex:{capabilities:[],coverage:{},errors:[]},useFeedback:false};
const cards=q=>routeTaskV4(q,options).consultCandidates;
test('generic operational vocabulary cannot alone recommend an unrelated manual',()=>{
 for(const q of ['查看附件图片并自然修补边缘，下载新成图，确认结果','读取本地记录，新建一个摘要，导出结果','请检查本地DOCX文件的段落标题，给出差异'])
  assert(!cards(q).some(x=>x.id==='warehouse-sync'),q);
 assert(cards('请用 warehouse-sync 查看本地文件').some(x=>x.id==='warehouse-sync'&&x.explicit));
 assert(cards('读取 DOCX 并核对标题').some(x=>x.id==='docx'));
});
test('a script extension does not select a hosted product backend',()=>{
 const found=cards('请用 sympy 精确解方程，将脚本另存 algebra.py');
 assert(found.some(x=>x.id==='sympy'));assert(!found.some(x=>x.id==='product-cloud-agent'));
});
test('reported citation does not become the use verb inside 引用',()=>{
 for(const q of ['文中引用的“academic-paper”只是作者备忘','这句话的作用是提到“academic-paper”','费用说明提及“academic-paper”']){
  assert.equal(requestedName([q.replace(/[“”]/g,'')],'academic-paper'),null,q);
  assert(unquoteRequestedNames(q).includes('“academic-paper”'),q);
  assert(!taskAssessment(q).activeText.includes('academic-paper'),q);
 }
 for(const q of ['请使用“academic-paper”审阅初稿','请用“academic-paper”准备论文','复用“academic-paper”的流程'])
  assert(unquoteRequestedNames(q).includes('academic-paper')&&!unquoteRequestedNames(q).includes('“'),q);
});
test('action and object coverage recalls editing and geometry across languages',()=>{
 assert(cards('把本地 MP4 剪出前四秒，转码并缩放到720p').some(x=>x.id==='ffmpeg-video-editor'));
 assert(cards('统一 GeoJSON 坐标参考系，匹配点与多边形并保留未匹配记录').some(x=>x.id==='geopandas'));
});
test('quantitative optimization and mechanical modeling keep separate needs',()=>{
 for(const q of ['建立运输整数规划，给出约束和最优费用','做一份数学建模方案，运行例子并验证约束']){
  const found=cards(q);assert(found.some(x=>x.id==='or-modeling'),q);assert(!found.some(x=>x.id==='cad'),q);
 }
 assert(!cards('给支架做三维建模').some(x=>x.id==='or-modeling'));
});
