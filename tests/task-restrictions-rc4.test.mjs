import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRestrictions} from '../src/task-restrictions.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

test('an explicit protected object does not become a global restriction when work verbs are unfamiliar',()=>{
 for(const query of [
  '参考设计和器件资料只读；做一个本地电路；建立原理图并交付PCB和BOM',
  '参考台账只读；统筹后续交付',
  'The reference materials remain read-only; orchestrate the deliverable',
  '不要改动参考章程；筹备本地成果',
 ]){
  const r=assessRestrictions(query);assert.equal(r.readOnly,false,query);
  assert(r.protectedScopes.some(x=>x.scope==='protected-target'),query);
  assert(!r.evidence.some(x=>x.scope==='all-writes'),query);
 }
});
test('protected scope remains recorded even when requested work is solely observational',()=>{
 for(const query of ['原件只读','仅查看目录，不修改原文件','Do not edit the repository; explain its structure','Source files are read-only; explain the result']){
  const r=assessRestrictions(query);assert.equal(r.readOnly,true,query);
  assert(r.protectedScopes.some(x=>x.scope==='protected-target'),query);
  assert.equal(r.workMode,'observational-only',query);
 }
});
test('global prohibitions and invocation restrictions remain global regardless of a protected target',()=>{
 for(const query of ['全程只读；建立新的本地设计','整个任务禁止写入；参考稿只读；另写新文件','All writes are forbidden; create a separate file'])assert.equal(assessRestrictions(query).readOnly,true,query);
 for(const invocation of [{mode:'plan'},{readOnly:true}])assert.equal(assessRestrictions('参考稿只读；筹备本地成果',[],invocation).readOnly,true);
});
test('host restrictions narrow actions without granting a separate deliverable',()=>{
 assert.equal(assessRestrictions('修改代码',['只检查日志']).readOnly,true);
 const scoped=assessRestrictions('筹备本地成果',['参考稿只读']);
 assert.equal(scoped.readOnly,false);assert.equal(scoped.workMode,'unresolved');
 assert.equal(scoped.protectedScopes[0].source,'host-restriction');
 assert.equal(taskAssessment('只检查索引',{objective:'Create a new report'}).readOnly,true);
});
test('component behavior is not a prohibition on implementing the component',()=>{
 const r=assessRestrictions('实现 stdio MCP 只读工具；工具运行时不得修改检查目录');
 assert.equal(r.readOnly,false);assert(r.protectedScopes.some(x=>x.scope==='component-behavior'));
});
test('quoted source instructions, chat-only output and explained actions cannot manufacture mutation intent',()=>{
 for(const query of ['原件只读，示例：“另写新文件”','只检查源文档；说明如何建立新工程','源文件只读；生成三句解释发在聊天里'])assert.equal(taskAssessment(query).readOnly,true,query);
 assert.equal(taskAssessment('请修改文字；示例：“原件只读”').readOnly,false);
});
test('coordinated unclassified work does not disappear behind a read-only predicate',()=>{
 assert.equal(assessRestrictions('参考资料只读并筹备本地成果').readOnly,false);
 assert.equal(assessRestrictions('The source remains read-only and orchestrate the result').readOnly,false);
});
test('global task predicates are distinct from a task-owned protected input',()=>{
 for(const query of ['The task is read-only; create a local file','Current session must be read-only; create a local file','本次任务必须只读；建立本地成果'])assert.equal(assessRestrictions(query).readOnly,true,query);
 for(const query of ["This task's source files remain read-only; create a local file",'本次任务的参考资料只读；建立本地成果']){
  const r=assessRestrictions(query);assert.equal(r.readOnly,false,query);assert(r.protectedScopes.length>0,query);
 }
});
test('an explicit current-task action limit dominates unclassified descriptive clauses',()=>{
 for(const query of [
  '看一下桌面上已经打开的 PDF 阅读器当前页；此次只允许观察现有界面：不要点击、滚动、切换页面、输入、保存或打开别的文件，直接把实际读到的文字告诉我；看不清的部分标记不确定。',
  '确认屏幕上的信息；本次任务仅允许观察当前界面；把看见的内容告诉我',
  'Tell me what is visible; for this task only inspect the open page; note unclear portions',
 ]){
  const r=taskAssessment(query);assert.equal(r.readOnly,true,query);
  assert(r.restrictions.evidence.some(x=>x.scope==='all-writes'),query);
 }
 assert.equal(assessRestrictions('本次任务的参考资料只允许查看；筹备本地成果').readOnly,false);
});
