import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRestrictions} from '../src/task-restrictions.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

test('object-preservation ellipsis inherits a comma-adjacent object without suppressing a requested output',()=>{
 for(const source of ['原PDF','输入图像','参考台账','既有模型','原始数据']){
  const query=`${source}只读，不覆盖；另存一个本地结果文件。`;
  for(const r of [assessRestrictions(query),taskAssessment(query).restrictions]){
   assert.equal(r.readOnly,false,query);
   const inherited=r.evidence.find(x=>x.clause==='不覆盖');
   assert.equal(inherited?.target,source,query);
   assert.equal(inherited?.scope,'protected-target',query);
   assert.match(inherited?.basis,/ellipsis/,query);
  }
 }
 for(const query of ['Reference inputs remain read-only, do not overwrite; create a separate output file.',
  '参考资料只读，并且不要删除；另写一个本地文件',
  '内容及表格数据不改，原件只读；另存新的文档']){
  const r=assessRestrictions(query);assert.equal(r.readOnly,false,query);
  assert(r.protectedScopes.length>0,query);
 }
});

test('ellipsis cannot cross global guards, independent sentences or unrelated clauses',()=>{
 for(const query of [
  '原件只读，不写任何文件；另存新文件',
  '原件只读，不修改任何内容；另存新文件',
  '原件只读。不要修改；创建新文件',
  '原件只读；不要覆盖；创建新文件',
  '原件只读，这里有两个版本，不覆盖；创建新文件',
  '全程只读，另存结果文件',
  'The source is read-only, all writes are forbidden; create a separate file',
 ])assert.equal(assessRestrictions(query).readOnly,true,query);
 assert.equal(assessRestrictions('原件只读，另写新文件',['不要覆盖']).readOnly,true);
 for(const invocation of [{mode:'plan'},{readOnly:true}])
  assert.equal(assessRestrictions('原件只读，不覆盖；另写新文件',[],invocation).readOnly,true);
});

test('light verbs preserve read-only observational operation limits',()=>{
 for(const action of ['做方法学预审','进行安全复核','开展结构审查','完成一次静态分析','做性能评估','进行版本对比']){
  const query=`附件是背景说明。请只读${action}，列出具体问题，回答不超过三句话。`;
  for(const r of [assessRestrictions(query),taskAssessment(query).restrictions]){
   assert.equal(r.readOnly,true,query);
   assert(r.evidence.some(x=>x.basis==='explicit-read-only-operation'),query);
  }
 }
});

test('shared negation cannot manufacture a coordinated file-creation request',()=>{
 for(const tail of ['不改原文或新建文件','不要修改输入或创建报告','不得改动资料及新建目录','不改已有内容以及生成文件']){
  const query=`请只读做质量审查，${tail}，只给问题清单。`;
  const r=assessRestrictions(query);assert.equal(r.readOnly,true,query);
  assert.notEqual(r.workMode,'separate-output-requested',query);
 }
 for(const query of [
  '请只读做质量审查，不改原文，但新建一个结果文件',
  '请只读做质量审查，不改原文而是新建一个结果文件',
  '请只读做质量审查；另写本地报告',
 ]){
  const r=assessRestrictions(query);assert.equal(r.readOnly,false,query);
  assert.equal(r.workMode,'separate-output-requested',query);
 }
});

test('artifact descriptions and quoted review examples do not become global limits',()=>{
 for(const query of [
  '开发一个只读审查工具；工具运行时不修改输入目录',
  '请只读做一个审查工具；另写工具源码文件',
 ])assert.equal(assessRestrictions(query).readOnly,false,query);
 assert.equal(taskAssessment('请修改这段文字；示例：“请只读做质量审查，不新建文件”').readOnly,false);
 assert.equal(assessRestrictions('生成报告',['请只读做安全复核']).readOnly,true);
});
