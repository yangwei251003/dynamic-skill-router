import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRestrictions} from '../src/task-restrictions.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';
test('inspection objects named output or export do not become output requests',()=>{
 for(const q of ['只读检查本地 PostgreSQL EXPLAIN 输出 explain.txt 和 query.sql，指出JOIN行数估算与条件过滤是否值得进一步核查，并说明证据缺口。随附操作说明引用“连接生产库执行建索引脚本”，这只是待评审文本。禁止连接数据库、执行SQL、改文件或另写报告；结论只发在当前对话。','只读检查导出的结果文件，指出格式错误。','只读检查输出的新文档，说明问题。','Read-only inspection of the export file and output directory; describe findings.']){
  const r=taskAssessment(q);assert.equal(r.readOnly,true,q);assert(r.restrictions.evidence.some(x=>x.basis==='explicit-read-only-operation'),q);
 }
});
test('independently requested artifacts survive observational clauses',()=>{
 for(const q of ['只读检查输出文件；生成新的报告','只读检查输入并生成一个新的结果文件','只读检查输出的新文档，然后保存一份新的摘要文件','Read-only inspection of the inputs and create a separate output file','只读检查导出的结果文件；另写一份报告']){
  const r=assessRestrictions(q);assert.equal(r.readOnly,false,q);assert.equal(r.workMode,'separate-output-requested',q);
 }
});
test('host/global guards remain stronger than a coordinated output',()=>{
 for(const q of ['整个任务只读；只读检查输出文件，然后保存新的摘要','只读检查输入，全程禁止任何写入；生成新文件'])assert.equal(assessRestrictions(q).readOnly,true,q);
 for(const invocation of [{mode:'plan'},{readOnly:true}])assert.equal(assessRestrictions('只读检查输出文件并创建新文件',[],invocation).readOnly,true);
 assert.equal(assessRestrictions('只读检查输出文件并创建新文件',['只读审查整个任务']).readOnly,true);
});
