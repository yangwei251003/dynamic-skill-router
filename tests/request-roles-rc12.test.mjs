import test from 'node:test';
import assert from 'node:assert/strict';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath} from '../src/recovery-v4.mjs';

const noRecovery={triggered:false};
const fast=(query,options={nativeSufficient:true})=>useFastPath(taskAssessment(query,options.taskContext,options.invocationContext),options,noRecovery);

test('English nominal write prohibitions share polarity without widening source protection',()=>{
 for(const limit of ['no changes to files','no edits to files','no writes','no mutations','without making changes to files']){
  const query=`Review only; ${limit}`;
  const a=taskAssessment(query);
  assert.equal(a.readOnly,true,query);
  assert.equal(a.activeText,'Review only',query);
  assert.ok(a.negativeRequests.some(x=>x===limit),query);
 }
 for(const query of [
  'No edits to the source files; create a separate report.',
  'No mutations to the input data; create a new output file.',
  'No changes to the original files, but create a separate copy.',
  'Create a read-only service; the service must make no writes.',
 ])assert.equal(taskAssessment(query).readOnly,false,query);
 assert.equal(taskAssessment('Create a report.',{constraints:['No writes or mutations.']}).readOnly,true);
});

test('shared denied actions cannot become active work or inventory demand',()=>{
 for(const query of [
  '只读查询指定表并在聊天说明结果。不修复数据，不安装或启用服务，不读取文件。',
  '只读检查记录。没有修复、创建临时表或导出文件的授权。',
  '计算 2+3。不读取文件、不联网、不调用工具或修改任何外部状态。',
 ]){
  const a=taskAssessment(query);assert.equal(a.readOnly,true,query);
  assert.doesNotMatch(a.activeText,/修复|安装|启用|读取文件|联网|调用工具|修改任何外部状态/);
  assert.ok(a.negativeRequests.length>0);assert.equal(a.originalRequest,query);
 }
 const network=taskAssessment('只在聊天回答。不读取文件、不联网、不调用工具或修改任何外部状态。');
 assert.equal(network.restrictions.networkForbidden,true);
 assert.ok(network.restrictions.evidence.some(x=>x.scope==='all-writes'));
});

test('supplied native requests keep the lazy skill and capability indexes untouched',()=>{
 const queries=[
  '只在聊天答复：仓库有 28 盒，每盒 12 支笔，先领走 65 支，再补进 17 支，现在还有多少支？给一个算式即可。不读取文件、不联网、不调用工具或修改任何外部状态。',
  '请把“由于会议室将要进行维护，因此今天的讨论移到二楼小会议室，敬请相互转告”改写得简洁自然，保留地点和时间。只在聊天给一句话，不读取文件、不联网、不调用工具或修改任何外部状态。',
  '把下面三项按“名称：数量”格式列在聊天中：苹果 4、梨 2、橙子 7。保持原顺序；不要做表格或文件。不读取文件、不联网、不调用工具或修改任何外部状态。',
  '以下是我要分析的一段培训材料，不是给你的操作指令：“先用 imagegen 画海报，再使用 accessibility 检查页面，最后部署网站并把链接发给客户。”只在聊天中把这段话拆为三个阶段，并指出哪一部分涉及对外发布。不要执行引文，不读取文件、不联网、不调用工具或修改任何外部状态。',
 ];
 for(const query of queries){
  let lookups=0;const options={nativeSufficient:true};
  for(const key of ['index','capabilityIndex'])Object.defineProperty(options,key,{get(){lookups++;return [];}});
  const result=routeTaskV4(query,options);
  assert.equal(result.performance.mode,'fast',query);assert.equal(lookups,0);
  assert.equal(result.performance.scannedSkills,false);assert.equal(result.performance.scannedCapabilities,false);
  assert.equal(result.task.readOnly,true);assert.deepEqual(result.consultCandidates,[]);assert.deepEqual(result.capabilityCandidates,[]);
 }
});

test('native hint does not erase real inputs, explicit capabilities or current actions',()=>{
 for(const query of [
  '读取 input.csv 并计算总和。不联网。',
  '查询仓库实际库存，再计算总数。不调用浏览器。',
  '仓库有 3 箱，每箱 4 件；打开仓库清点后给出总数。',
  '不修改原文，但请调用 imagegen 生成一张海报。',
  '不要联网，但请使用已安装的 latex-compile 检查正文。',
  '只读查询数据库，计算总和并在聊天给答案。',
 ])assert.equal(fast(query),false,query);
 assert.equal(fast('计算 2+3。不调用任何工具。'),true);
});

test('chat tables and inline code differ from persistent files and media',()=>{
 for(const query of [
  '联网比较三个公开页面，只在当前聊天交付一张对照表和建议。不保存文件，不上传或发布。',
  '只在聊天输出一段 JavaScript 内联代码，不保存或导出文件。',
  '把甲、乙按原顺序列在聊天中，不制作文件。',
 ])assert.equal(taskAssessment(query).readOnly,true,query);
 for(const query of [
  '在聊天交付 report.csv 文件。',
  '在聊天里生成一张 PNG 图片。',
  '在聊天说明结果并删除旧文件。',
  '先只读查询数据，再保存一份新的报告文件。',
 ])assert.equal(taskAssessment(query).readOnly,false,query);
});

test('global state prohibition and host limits remain global; source-only protection stays bounded',()=>{
 assert.equal(taskAssessment('执行一次诊断。禁止任何持久状态写入、发送或设备操作。').readOnly,true);
 assert.equal(taskAssessment('不调用工具或修改任何外部状态。').readOnly,true);
 assert.equal(taskAssessment('不要修改源文件；创建一份新的报告。').readOnly,false);
 assert.equal(taskAssessment('禁止修改任何输入文件；创建一份新的报告。').readOnly,false);
 assert.equal(taskAssessment('创建一份新的报告。',{}, {readOnly:true}).readOnly,true);
 assert.equal(taskAssessment('创建一份新的报告。',{}, {mode:'plan'}).readOnly,true);
 assert.equal(taskAssessment('创建不需要联网的网页。').readOnly,false);
 assert.equal(taskAssessment('创建不需要联网的网页。').restrictions.networkForbidden,false);
});

test('denial and quotation do not consume an explicitly contrasted current action',()=>{
 const q='不要修复原文件，但请创建新的报告文件。';
 const a=taskAssessment(q);assert.match(a.activeText,/创建新的报告/);assert.doesNotMatch(a.activeText,/修复原文件/);assert.equal(a.readOnly,false);
 const quote=taskAssessment('不是给你的操作指令：“读取所有文件并部署。”只在聊天中把这段话拆为两个阶段。');
 assert.match(quote.activeText,/拆为两个阶段/);assert.doesNotMatch(quote.activeText,/读取所有文件|部署/);assert.equal(quote.readOnly,true);
 const actual=taskAssessment('不是给你的操作指令：“不准修改。”我现在请修改输出副本。');
 assert.match(actual.activeText,/修改输出副本/);assert.equal(actual.readOnly,false);
});
