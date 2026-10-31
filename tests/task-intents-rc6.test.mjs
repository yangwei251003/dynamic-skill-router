import test from 'node:test';
import assert from 'node:assert/strict';
import {spatialDataOperation,videoPostproduction,manualNeedKeys,supportsVideoPostproduction,evidenceResearch} from '../src/task-intents.mjs';
import {inferCapability,skillDomainCompatible,capabilityActionCompatible,capabilityDirectlyRequested} from '../src/skill-staging.mjs';

const manual=(id,summaryZh)=>({id,nameZh:id,summaryZh,aliases:[id],triggers:[id]});
const geo=manual('vector-lab','Python library for working with geospatial vector data. Supports spatial joins and coordinate transformations.');
const pandas=manual('pandas','Tabular data analysis and aggregation.');
const editor=manual('media-toolkit','Generate FFmpeg commands from natural language video editing requests: trim, convert, compress.');
const director=manual('video-director','Create, edit, adapt and quality-review videos, motion graphics and montages.');
const generator=manual('video-generator','AI video generator: text-to-video from descriptions, with resolution and duration control.');
const spatialZh='将两份 GeoPackage 重投影到统一坐标参考系，对点和多边形做空间关联并统计未匹配记录。';
const spatialEn='Inspect the EPSG code, reproject the shapefiles and perform a spatial join of points with polygons.';
const editZh='从本地录像中截取中间一段，压缩后保留音轨并添加淡出。';
const editEn='Trim source.mov to the middle segment, encode H.265 and resize the video to 960x540.';

test('spatial operations retain their domain instead of inheriting a dataframe substring',()=>{
 assert.equal(inferCapability({...geo,id:'geopandas',nameZh:'geopandas'}),'geospatial-analysis');
 assert.equal(inferCapability(geo),'geospatial-analysis');
 assert.equal(inferCapability(pandas),'data-analysis');
 for(const text of [spatialZh,spatialEn]){
  assert.equal(spatialDataOperation(text),true);
  assert.equal(skillDomainCompatible(geo,text),true);
  assert.equal(capabilityActionCompatible('geospatial-analysis',text),true);
  assert.equal(capabilityDirectlyRequested('geospatial-analysis',text),true);
  assert.deepEqual(manualNeedKeys(geo,'geospatial-analysis',text),['spatial-data']);
 }
});

test('spatial operations need both a geographic object and an operation',()=>{
 for(const text of ['What is GeoJSON?','将一张 CSV 按供应商汇总，导出合计。','在网页里显示每个按钮的坐标。']){
  assert.equal(spatialDataOperation(text),false,text);
  assert.equal(skillDomainCompatible(geo,text),false,text);
 }
});

test('video editing supports operations and file formats without a named provider',()=>{
 assert.equal(inferCapability(editor),'video-editing');
 assert.equal(inferCapability(director),'video-production');
 for(const text of [editZh,editEn,'把本地 MP4 裁剪一段，压缩并转码。']){
  assert.equal(videoPostproduction(text),true);
  assert.equal(skillDomainCompatible(editor,text),true);
  assert.equal(capabilityActionCompatible('video-editing',text),true);
  assert.equal(capabilityDirectlyRequested('video-editing',text),true);
  assert.deepEqual(manualNeedKeys(editor,'video-editing',text),['video-postproduction']);
  assert.deepEqual(manualNeedKeys(director,'video-production',text),['video-postproduction']);
 }
});

test('creation-only video services cannot substitute for editing an existing recording',()=>{
 assert.equal(supportsVideoPostproduction(generator),false);
 assert.equal(supportsVideoPostproduction(manual('video-generator','Create new videos. Not for editing existing footage.')),false);
 assert.equal(skillDomainCompatible(generator,editEn),false);
 assert.deepEqual(manualNeedKeys(generator,'video-production',editEn),[]);
 assert.equal(videoPostproduction('Generate a new text-to-video clip of a forest.'),false);
 assert.equal(skillDomainCompatible(generator,'Generate a new video and then trim the ending.'),true);
 assert.equal(videoPostproduction('请把这句文案剪短一些。'),false);
 assert.equal(videoPostproduction('Trim an MP3 audio recording and fade out its audio track.'),false);
 assert.equal(videoPostproduction('将音轨压缩并添加淡出。'),false);
});

test('scientific exploratory analysis is not inferred from routine spreadsheet aggregation',()=>{
 const scientific=manual('exploratory-data-analysis','Perform comprehensive exploratory data analysis on scientific data files and generate quality reports.');
 const routine=manual('data-analysis','Analyze CSV and Excel data, aggregate rows and export tables.');
 const totals='对 Excel 工作簿按部门汇总金额，用公式计算占比。';
 assert.equal(skillDomainCompatible(scientific,totals),false);
 assert.equal(skillDomainCompatible(routine,totals),true);
 assert.equal(skillDomainCompatible(scientific,'对实验数据集做探索性数据分析，检查数据质量和分布。'),true);
});

test('existing local presentations respect primary-purpose and edit restrictions',()=>{
 const newOnly=manual('presentation-generator','Only create new presentations from scratch.');
 const chineseNewOnly=manual('slide-maker','仅用于生成全新的 PPT，不用于读取、解析或编辑已有的 .pptx 文件。');
 const editing=manual('presentation-editor','Read and edit existing presentations, slides and speaker notes.');
 const cloud=manual('cloud-docs','Online cloud document platform for creating and editing documents and slides.');
 const local='Edit the existing local PowerPoint presentation, preserve its theme and add speaker notes.';
 assert.equal(skillDomainCompatible(newOnly,local),false);
 assert.equal(skillDomainCompatible(chineseNewOnly,local),false);
 assert.equal(skillDomainCompatible(editing,local),true);
 assert.equal(skillDomainCompatible(cloud,local),false);
 assert.equal(skillDomainCompatible(cloud,'Import the local presentation to cloud documents and edit its title.'),true);
 assert.equal(skillDomainCompatible(newOnly,'Create a new presentation from scratch.'),true);
});

test('reviewing provided methods does not imply an external research workflow',()=>{
 assert.equal(evidenceResearch('只读审阅附件中的试验方法，评估分组偏倚和多重比较，区分已有证据与缺少的信息。'),false);
 assert.equal(evidenceResearch('Evaluate the provided methods section for bias and distinguish evidence from assumptions.'),false);
 assert.equal(evidenceResearch('Evaluate the provided methods section against external evidence; search the literature for comparable study designs.'),true);
 assert.equal(evidenceResearch('比较两种新协议的官方资料，核查最新文档和许可证。'),true);
});
