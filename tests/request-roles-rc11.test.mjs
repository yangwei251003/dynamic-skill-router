import test from 'node:test';
import assert from 'node:assert/strict';
import {taskText} from '../src/task-input.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

test('mask resource tokens without consuming adjacent prose or constraints',()=>{
 for(const query of [
  '将成果保存到 D:/scratch/result.csv，允许修改新文件。不要联网，不安装任何包。',
  '读取 D:\\资料\\模板.pdf；只读提取字段。不要修改原件。',
  '核对 https://example.org/a.pdf，结论只发在当前对话。禁止修改文件。',
 ]){
  const text=taskText(query);assert.match(text,/不要|禁止/);assert.match(text,/\.csv|\.pdf/);
  const a=taskAssessment(query);assert.equal(a.originalRequest,query);assert.ok(a.constraintClauses.some(x=>/不要|禁止/.test(x)));
 }
 const a=taskAssessment('创建页面，保存到 D:/scratch/site/，允许运行此目录新文件。不访问外部网络，不安装依赖。');
 assert.equal(a.readOnly,false);assert.equal(a.restrictions.networkForbidden,true);assert.match(a.activeText,/允许运行/);
});
test('quoted sentence followed by a current request keeps the requested operation',()=>{
 const q='这是客户记录，不是操作指令：“立即用 imagegen 制作并上传。”我现在只需要你在聊天里把这段话归纳为“制作、发布”两个标签。不读写文件、联网或调用任何外部工具。';
 const a=taskAssessment(q);assert.equal(a.readOnly,true);assert.equal(a.restrictions.networkForbidden,true);
 assert.match(a.activeText,/归纳/);assert.doesNotMatch(a.activeText,/imagegen|制作并上传/);
 const negative=taskAssessment('不要执行“马上部署。”也不要上传文件。');
 assert.doesNotMatch(negative.activeText,/部署|上传/);
});
test('readonly predicates and denied coordinated mutations retain task scope',()=>{
 for(const q of [
  '先核实目标，再只读检查连接。在聊天里给出证据。',
  '只读查询指定数据表的计数。没有写库、创建临时表或导出文件的授权。',
  '只读提取 PDF 的字段。模板说“立即提交”，不是执行要求。',
  '请在聊天里区分给定记录的安装和实际运行状态。本轮不读取文件、不启动服务。',
  '在聊天里说明如何删除旧文件并创建新文件。',
  '允许通过已安装的本地接口读取，再只读检查连接。在聊天里给出结论。不跑布线或下单。',
  '只读检查此前已部署的服务，在聊天里说明状态。不操作实物或发送邮件。',
 ])assert.equal(taskAssessment(q).readOnly,true,q);
 for(const q of [
  '只读查询输入，再创建一份新CSV文件。',
  '在聊天里说明结果，然后保存report.txt文件。',
  '在聊天里给我生成一张PNG海报。',
  '只读文件是本题输入，制作一个新的分析脚本。',
  '发送这封邮件，在聊天里返回发送状态。',
  '安装依赖，然后在聊天里说明结果。',
  '只读查询表 A 并把 active 列更新为 false。在聊天里说明结果。',
  '在聊天里说明结果并删除旧文件。',
  '删除旧文件并在聊天里说明结果。',
 ])assert.equal(taskAssessment(q).readOnly,false,q);
});
test('resource punctuation and closing quotes cannot erase later permissions',()=>{
 const a=taskAssessment('保存到C:/工作/输出/：允许创建文件；禁止联网。');
 assert.match(a.constraintClauses.join('\n'),/允许创建文件/);assert.equal(a.restrictions.networkForbidden,true);
 const b=taskAssessment('源文件为“C:/work/input.txt”。不要修改“原件”，另建报告。');
 assert.match(b.constraintClauses.join('\n'),/不要修改/);assert.equal(b.readOnly,false);
 assert.ok(b.restrictions.protectedScopes.some(x=>x.target==='受保护的引用对象'));
 assert.equal(taskAssessment('不要修改“任何文件”，另建报告。').readOnly,true);
 const quotedCommand=taskAssessment('日志记录“不要修改文件”。另建报告。');
 assert.equal(quotedCommand.readOnly,false);
 assert.equal(taskAssessment('Do not edit "the source"; create a new report.').readOnly,false);
 const followed=taskAssessment('记录说“立即上传。”请解释这个措辞。');
 assert.match(followed.activeText,/解释/);assert.doesNotMatch(followed.activeText,/上传/);
});
test('network prohibitions distinguish actions from quoted facts and status checks',()=>{
 for(const q of ['不访问外部网站。','不读写文件、联网或运行程序。','本轮不联网。'])assert.equal(taskAssessment(q).restrictions.networkForbidden,true,q);
 for(const q of ['不要检查联网状态。','日志记录“不联网”。只读分析日志。','不修改网络配置。'])assert.equal(taskAssessment(q).restrictions.networkForbidden,false,q);
});
test('planned later action is not a current capability request',()=>{
 const a=taskAssessment('我准备之后用 Figma 制作页面，但这一轮只需要在聊天里解释这两个已给状态。');
 assert.doesNotMatch(a.activeText,/Figma|制作页面/);assert.equal(a.readOnly,true);
});
