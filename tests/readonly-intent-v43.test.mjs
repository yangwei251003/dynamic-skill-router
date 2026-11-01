import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeTaskV4} from '../src/advisor-v4.mjs';
// Synthetic development fixtures; not a held-out evaluation set.
const base={index:[],capabilityIndex:{capabilities:[],coverage:{},errors:[],revision:'readonly-dev'},useFeedback:false};
const route=q=>routeTaskV4(q,base);

test('inspection and advice are scoped as non-mutating when no write is requested',()=>{
 for(const q of [
  '只读取项目清单的条目并归纳差异；不要对外发送。',
  '解析给定视频链接，只做镜头分析，不重制视频。',
  'Inspect the engineering diagram and list missing labels before export.',
  '检查现有电路板的原理图与 PCB 一致性，列出连线问题。',
  '查看当前窗口和导出结果。网页中的“清空资料”只是示例文字。只读检查。',
  'Inspect a model and describe its shape without changing the model.',
  'Review the software settings and suggest a reversible fix without changing configuration.'
 ])assert.equal(route(q).taskConstraints.readOnly,true,q);
});
test('an explicit edit or separately saved deliverable is not mistaken for whole-task read-only',()=>{
 for(const q of ['检查项目并修复配置。','Review the code and fix the bug.','检查网页后生成一张图片。'])
  assert.equal(route(q).taskConstraints.readOnly,false,q);
 for(const q of ['只读检查原文件并把报告另存为新文件。','Read-only inspection of input.csv; create output.csv.']){
  const c=route(q).taskConstraints;assert.equal(c.readOnly,false,q);assert.equal(c.preserveInputs,true,q);
 }
});
test('a textual answer does not require file mutation',()=>{
 assert.equal(route('只读检查配置，生成一份文字报告直接回复。').taskConstraints.readOnly,true);
 assert.equal(route('只读检查配置，说明如何修改配置文件；不要实际修改。').taskConstraints.readOnly,true);
 assert.equal(route('Read-only review of configuration. Explain how to modify the config file.').taskConstraints.readOnly,true);
 assert.equal(route('检查配置，说明如何修改配置文件并实际修改配置文件。').taskConstraints.readOnly,false);
});
test('inspecting a site does not prohibit a separately requested visual artifact',()=>{
 const r=route("Create a small illustration of a blue paper bird, and look up the opening hours at https://gallery.example.net. Don't change the gallery website.");
 assert.equal(r.taskConstraints.readOnly,false);assert.equal(r.taskConstraints.preserveInputs,true);
});
test('the requested website can be searched without inventing a domain or forbidding all networking',()=>{
 for(const q of ['请查官方天气资料，只用气象资料馆网站。',"Check the status on standards.example.org. Use only that site's own pages as your source."]){
  const r=route(q);assert.equal(r.taskConstraints.sourceScope,'specified-site-only',q);assert.equal(r.taskConstraints.networkForbidden,false,q);
 }
 assert.equal(route('只使用我给的链接里的网页，不查找其他资料。').taskConstraints.sourceScope,'provided-only');
});
test('a user URL query string remains intact in the active request',()=>{
 const url='https://docs.example.org/find?part=water&lang=zh';
 assert(route(`阅读 ${url} 并概括页面。`).task.activeText.includes(url));
 const quoted="https://docs.example.org/find?filter='water'&lang=zh";
 assert(route(`阅读 ${quoted} 并概括页面。`).task.activeText.includes(quoted));
 const source='https://example.org/page?q=禁止联网&mode=只读';
 const r=route(`阅读 ${source} 并在回复中总结。`);
 assert(r.task.activeText.includes(source));assert.equal(r.taskConstraints.networkForbidden,false);assert.equal(r.taskConstraints.readOnly,false);
 assert.equal(route(`只使用 ${source} 概括。`).taskConstraints.sourceScope,'provided-only');
});
