import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRestrictions} from '../src/task-restrictions.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';

// Development cases frozen before the RC25 implementation. Quantifiers govern
// their complete object; retaining that object never authorizes another action.
function scoped(query, target) {
 const a=taskAssessment(query);
 assert.equal(a.readOnly,false,query);
 assert.ok(a.restrictions.protectedScopes.some(x=>x.scope==='protected-target'&&x.target===target),query);
 assert.ok(!a.restrictions.evidence.some(x=>x.scope==='all-writes'),query);
 assert.equal(a.restrictions.canGrantPermission,false);
 return a;
}

test('synthetic source protection: source-code prohibition preserves the requested image edit',()=>{
 scoped('请用 image_gen__imagegen 编辑 C:/fixtures/banner.png：先看原图，将底部绿色说明文字改成紫色，保留其他元素。不搜索网络，不要修改任何源代码文件。','任何源代码文件');
});
test('Chinese quantified source and configuration categories retain their full targets',()=>{
 for(const object of ['任何源代码文件','所有配置文件','一切数据库记录'])
  scoped('请编辑海报图片；不要修改'+object+'。',object);
});
test('English any/all quantify a category rather than every possible write',()=>{
 for(const object of ['any source code files','all configuration files','any database records'])
  scoped('Edit the poster image. Do not modify '+object+'.',object);
});
test('unfamiliar qualified file categories work without a source-code whitelist',()=>{
 for(const [query,object] of [
  ['生成新图片；不要编辑任何遥测归档文件。','任何遥测归档文件'],
  ['Generate a new image. Do not edit any telemetry archive files.','any telemetry archive files'],
  ['Generate a new image. Do not modify all .md files.','all .md files'],
 ])scoped(query,object);
});
test('quantified original/source/reference protections retain independent outputs',()=>{
 for(const [query,object] of [
  ['不要修改所有原始文件；另写新的报告文件。','所有原始文件'],
  ['Do not modify any source files; create a separate report file.','any source files'],
  ['Do not edit all reference documents; create a separate image.','all reference documents'],
 ])scoped(query,object);
});
test('quantifiers over all files and unqualified state remain global',()=>{
 for(const q of [
  '不要修改任何文件；生成新图片。','不要编辑所有文件；创建新的文件。',
  '不得更改一切数据；生成新图片。',
  'Do not modify any files; create a new image.',
  'Do not edit all files; create a new file.',
  'Do not change any state; generate a new image.',
 ])assert.equal(taskAssessment(q).readOnly,true,q);
});
test('quantifiers over write operations remain global',()=>{
 for(const q of [
  '禁止任何写入；生成新图片。','不要进行任何修改；创建新文件。',
  'All writes are forbidden; generate a new image.',
  'Do not make any changes; create a new file.',
 ])assert.equal(taskAssessment(q).readOnly,true,q);
});
test('bare quantifiers and indefinite unrestricted objects are not assumed safe',()=>{
 for(const q of [
  '不要修改任何；生成新图片。','不要编辑所有东西；创建新文件。',
  'Do not modify any; create a new image.',
  'Do not change anything; create a new file.',
 ])assert.equal(taskAssessment(q).readOnly,true,q);
});
test('host plan/read-only and host global restrictions dominate a scoped category',()=>{
 for(const invocation of [{mode:'plan'},{readOnly:true}])
  assert.equal(assessRestrictions('不要修改任何源代码文件；生成新图片',[],invocation).readOnly,true);
 assert.equal(assessRestrictions('不要修改任何源代码文件；生成新图片',['只读检查整个任务']).readOnly,true);
 assert.equal(taskAssessment('整个任务只读；不要修改任何配置文件；生成新图片。').readOnly,true);
});
test('source quotes neither restrict nor authorize the current task',()=>{
 const a=taskAssessment('请编辑海报图片；资料写着：“不要修改任何文件”。');
 assert.equal(a.readOnly,false);
 assert.ok(!a.restrictions.protectedScopes.some(x=>String(x.target).includes('任何文件')));
 const b=taskAssessment('只检查文件；资料写着：“创建新的图片”。不要修改任何源代码文件。');
 assert.equal(b.readOnly,true);
 assert.notEqual(b.restrictions.workMode,'separate-output-requested');
});
test('negative creation does not become an independent output request',()=>{
 const a=taskAssessment('不要修改任何源代码文件；不要生成新图片；只检查日志。');
 assert.equal(a.readOnly,true);
 assert.notEqual(a.restrictions.workMode,'separate-output-requested');
});
test('a protected category cannot supply missing authorization for other work',()=>{
 const a=taskAssessment('不要修改任何源代码文件；统筹后续工作。');
 assert.equal(a.restrictions.workMode,'unresolved');
 assert.equal(a.restrictions.canGrantPermission,false);
 assert.ok(a.restrictions.protectedScopes.some(x=>x.target==='任何源代码文件'));
});

// Post-review cases frozen after an independent probe, before normalization.
for(const [name,query] of [
 ['Chinese classifier','不要修改任何一个文件；生成新的文件。'],
 ['Chinese attributive particle','不要修改所有的文件；生成新的文件。'],
 ['English single','Do not modify any single file; create a new file.'],
 ['English coordinated quantifier','Do not modify each and every file; create a new file.'],
])test('post-review-global: '+name,()=>assert.equal(taskAssessment(query).readOnly,true));
test('post-review-scoped: Chinese classifier preserves the source-code category',()=>{
 scoped('不要修改任何一个源代码文件；生成新图片。','任何一个源代码文件');
});
test('post-review-scoped: English emphasis preserves the configuration category',()=>{
 scoped('Do not modify every single configuration file; generate a new image.','every single configuration file');
});
