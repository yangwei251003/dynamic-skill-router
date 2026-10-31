import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRestrictions} from '../src/task-restrictions.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

test('read-only governs an inspection operation despite descriptive or unfamiliar clauses',()=>{
 for(const query of [
  '只读核对本地两份 Word 培训通知：一份为初稿、一份为会后版本。检查日期、报名条件、表格列标题与附件编号是否一致，给出段落或表格定位及差异清单；不要改文件、加批注、生成修订稿、转格式或发送给任何人。',
  '只读检查嘉立创 EDA 专业版中当前运放采集板：先确认工程与文档身份，再对照随附数据手册核对运放供电极性、输入共模范围和连接器针序，指出需要改的网络及证据。当前原理图、PCB、器件属性全部保持原样，不点击保存、不运行自动布线、不下单。',
  '请只读核查两个版本；其中一份是归档版本；告诉我差异在哪里',
  'Conduct a read-only comparison of the documents; one is the draft; identify changes needed and give a revision checklist',
  'Inspect the open project in read-only mode; it belongs to a different release; suggest fixes',
 ]){
  const r=taskAssessment(query);assert.equal(r.readOnly,true,query);
  assert(r.restrictions.evidence.some(x=>x.scope==='all-writes'&&x.basis==='explicit-read-only-operation'),query);
  assert.equal(r.restrictions.canGrantPermission,false,query);
 }
});

test('suggesting edits is descriptive output, while applying coordinated edits is actual work',()=>{
 for(const query of [
  '只读核对原稿；给出修改建议和差异清单',
  '只读审阅原稿；提出修复和重写建议',
  'Read-only review of the source; provide recommendations to modify the configuration',
  'Read-only audit of the source; list changes to implement',
 ])assert.equal(assessRestrictions(query).readOnly,true,query);
 for(const query of [
  '只读检查原稿；给出修改建议并实际修改副本',
  'Read-only review of the source; suggest corrections and create a separate corrected file',
  '只读核对输入资料；给出清单并保存到新的本地文件',
 ])assert.equal(assessRestrictions(query).readOnly,false,query);
});

test('object restrictions and actual independent artifacts stay scoped',()=>{
 for(const query of [
  '只读检查输入文件；另写本地报告文件',
  '只读核对原始参数；生成新的工程文件',
  '只读核对原始参数；生成并发脚本',
  'Read-only comparison of the inputs; write a separate JSON file',
  'Read-only source documents; orchestrate the deliverable',
  '参考资料只读；统筹后续交付',
 ]){
  const r=assessRestrictions(query);assert.equal(r.readOnly,false,query);
  assert(r.protectedScopes.length>0,query);
 }
});

test('host and global restrictions still narrow; quoted instructions do not gain authority',()=>{
 assert.equal(assessRestrictions('创建新报告',['只读核对资料']).readOnly,true);
 for(const query of ['全程只读核对；另写新文件','This task is read-only; create a new file'])assert.equal(assessRestrictions(query).readOnly,true,query);
 for(const invocation of [{mode:'plan'},{readOnly:true}])assert.equal(assessRestrictions('只读核对源文件；另写新文件',[],invocation).readOnly,true);
 assert.equal(taskAssessment('请修改文案；示例：“只读核对资料并给出清单”').readOnly,false);
 assert.equal(taskAssessment('实现只读检查工具；工具运行时不得修改输入目录').readOnly,false);
});
