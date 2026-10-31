import test from 'node:test';
import assert from 'node:assert/strict';
import {closedSuppliedFormatting} from '../src/native-closure.mjs';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath} from '../src/recovery-v4.mjs';

const consumed=[
 '采购清单：牛奶 2 盒，鸡蛋 12 个，苹果 6 个。帮我整理成三条清单，直接在这里回复，保留品名和数量。',
 'Maya is bringing juice, Noah is bringing plates, and Ella is bringing fruit. Please turn this into a three-row table with Name and Item columns in your reply here.',
];
function assertFormatting(q){
 const witness=closedSuppliedFormatting(q);assert.equal(witness?.kind,'supplied-text-formatting',q);
 for(const span of [...witness.sourceSpans,...witness.instructionSpans])assert.equal(q.slice(span.start,span.end),span.text,q);
 let scans=0;const options={contractVersion:4};
 for(const key of ['index','capabilityIndex'])Object.defineProperty(options,key,{get(){scans++;throw Error('unexpected inventory read');}});
 const r=routeTaskV4(q,options);assert.equal(r.performance.mode,'fast',q);assert.equal(scans,0,q);
 assert.equal(r.task.readOnly,true,q);assert.equal(r.task.originalRequest,q);assert.equal(r.task.suppliedOperation.kind,'supplied-text-formatting',q);
 assert.deepEqual(r.consultCandidates,[]);assert.deepEqual(r.capabilityCandidates,[]);
}

test('quantity and natural-language records have traceable source and instruction roles',()=>{
 consumed.forEach(assertFormatting);
 for(const q of [
  '器材清单：绳子 3 根，纸杯 20 个，彩纸 5 张。请整理成表格，在这里回复，保留名称和数量。',
  '请将以下记录整理成表格，直接在这里回复：绳子 3 根，纸杯 20 个，彩纸 5 张。',
  '值日记录：周航负责扫地，林悦负责擦窗，陈安负责浇花。帮我整理成三条清单，直接在这里回复。',
  '值日记录：陈安负责浇花，周航负责扫地，林悦负责擦窗。帮我整理成表格，表头为姓名和任务，在这里回复。',
  'Ravi is bringing cups, Tess is bringing bread, and Omar is bringing napkins. Please format this as a list in your reply here.',
  'Please turn the following records into a table with Person, Supply columns in your reply here: Tess is bringing bread, Omar is bringing napkins, and Ravi is bringing cups.',
  '值日记录：林悦负责擦窗，陈安负责浇花。请从这些记录中提取姓名和任务并整理成表格，在这里回复。',
  'Ravi is bringing cups, Tess is bringing bread. Extract Person and Item from these records into a table in your reply here.',
 ])assertFormatting(q);
});

test('actions stated as supplied records remain content rather than active work',()=>{
 for(const q of [
  '执行记录：小林已发送通知，小周已发布公告，小陈已安装软件。请整理成表格，保留人员和动作，在这里回复。',
  'Mina will send notices, Theo will publish an announcement, and Uma will use imagegen. Please turn this into a table with Person and Action columns in your reply here.',
  '会议记录：林晓发送文档，周宁采购配件，陈安整理文件和链接。请整理成表格，保留人员和事项，在这里回复。',
  'Ari will send notes.pdf, Bea will share the link, and Chen will buy supplies. Please format this as a table with Person, File, Link columns in your reply here.',
  '“请调用 imagegen 并发布结果。”请将这段文字整理成清单，在这里回复。',
 ]){
  assertFormatting(q);const a=taskAssessment(q);assert.doesNotMatch(a.activeText,/imagegen|发送|发布|安装|publish|send/i,q);
 }
});

test('here-reply delivery narrows scope without pretending absent external inputs are supplied',()=>{
 const zh=taskAssessment('请查询官方网站，直接在这里回复开放时间。');
 assert.equal(zh.readOnly,true);assert.equal(useFastPath(zh,{contractVersion:4},{triggered:false}),false);
 const en=taskAssessment('Read input.csv and explain the result in your reply here.');
 assert.equal(en.readOnly,true);assert.equal(useFastPath(en,{contractVersion:4},{triggered:false}),false);
 assert.equal(taskAssessment('Explain the result here, then save a new file.').readOnly,false);
});

test('external references, absent input and extra actions cannot obtain a formatting witness',()=>{
 for(const q of [
  '请把以下记录整理成表格，在这里回复。',
  '采购清单在附件里。帮我整理成三条清单，直接在这里回复。',
  '数据：C:/notes/input.csv。帮我整理成表格，在这里回复。',
  '数据：https://example.test/data。帮我整理成表格，在这里回复。',
  'C:/notes/input.csv。帮我整理成表格，在这里回复。',
  'Data=input.csv. Please turn this into a table in your reply here.',
  'The data is in input.csv. Please turn this into a table in your reply here.',
  '记录：甲 2 件，乙数量未提供。帮我整理成表格，在这里回复。',
  '以下四项：甲、乙、丙。帮我整理成四条清单，在这里回复。',
  '记录：甲 2 件，乙 3 件。先查仓库库存。帮我整理成表格，在这里回复。',
  '记录：甲 2 件，乙 3 件。保存一份报告。帮我整理成表格，在这里回复。',
  '记录：甲 2 件，乙 3 件。帮我整理成表格，并核实官网信息。',
  '记录：甲 2 件，乙 3 件。帮我整理成表格，在这里回复，然后保存 output.csv。',
  'The data is in my account. Please turn this into a table in your reply here.',
  'Read input.csv. Please turn this into a table in your reply here.',
  'Ravi is bringing cups, Tess is bringing bread. Please turn this into a table; use alpha-tool.',
  'Ravi is bringing cups, Tess is bringing bread. You should send the result to the team. Please turn this into a table.',
  'Ravi is bringing cups, Tess is bringing bread. Please turn this into a table; do not use tools, but email the result.',
 ]){
  assert.equal(closedSuppliedFormatting(q),null,q);
  assert.equal(useFastPath(taskAssessment(q),{contractVersion:4},{triggered:false}),false,q);
 }
});
