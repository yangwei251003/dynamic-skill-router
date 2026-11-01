import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTaskV4} from '../src/advisor-v4.mjs';

// Entirely fictional index and requests; no installed skill registry is read.
const availability = {discovered:true, readable:true, enabled:true, compatible:true, toolsAvailable:null};
const skills = [
  {id:'archive-example', nameZh:'会议归档', summaryZh:'管理会议记录与录制，整理会议纪要。', triggers:['会议录制'], availability},
  {id:'docx', nameZh:'Word 文档', summaryZh:'Create and edit Word docx documents.', triggers:['docx'], availability},
  {id:'diagram-example', nameZh:'步骤图', summaryZh:'绘制可编辑流程图及结构图。', triggers:['流程图'], availability},
  ...Array.from({length:180}, (_, i) => ({id:`filler-${i}`, nameZh:`占位${i}`, summaryZh:`无关合成条目 ${i}`, availability}))
];
const imageTool = {name:'image_gen__imagegen', description:'Generate an image from a text description and edit existing images.'};
const imageCapability = {id:`tool:${imageTool.name}`, kind:'tool', ...imageTool,
  enabled:true, callable:true, evidence:'runtime-tool', annotations:{}};
const opts = {host:'codex', index:{revision:'fixture', skills, coverage:{}, errors:[]},
  capabilityIndex:{revision:'fixture', capabilities:[imageCapability], coverage:{}, errors:[]},
  runtimeTools:[imageTool], useFeedback:false, capabilityLimit:10};
const run = q => routeTaskV4(q, opts);
const skill = (r, id) => r.consultCandidates.find(c => c.id === id);
const imageIntent = (r, intent) => r.capabilityCandidates.some(c => c.name === imageTool.name && c.intentMatches.includes(intent));

test('a cross-word fragment alone cannot justify an unrelated recommendation', () => {
  const r = run('在目录制作一个本地天气展示网页，显示模拟温度。');
  assert(!skill(r, 'archive-example') || skill(r, 'archive-example').suggestedMode === 'skip');
});

test('generic editability does not independently justify a diagram', () => {
  const r = run('离线制作可编辑的 Word 项目清单，保存为 list.docx。');
  assert(skill(r, 'docx')?.suggestedMode === 'consult');
  assert(!skill(r, 'diagram-example') || skill(r, 'diagram-example').suggestedMode === 'skip');
});

// This custom identity fell below the consult threshold in 4.3.2 and 4.3.3.
// Its previously TODO assertion is now a required regression check.
test('a custom Word skill can be consulted when its id is not docx', () => {
  const customSkills = skills.map(s => s.id === 'docx' ? {...s, id:'word-example'} : s);
  const r = routeTaskV4('离线制作可编辑的 Word 项目清单，保存为 list.docx。',
    {...opts, index:{...opts.index, skills:customSkills}});
  assert.equal(skill(r, 'word-example')?.suggestedMode, 'consult');
});

test('explicit skill names and matching task triggers remain available', () => {
  assert(skill(run('请使用 archive-example 查询记录。'), 'archive-example')?.explicit);
  assert(skill(run('请整理会议录制并核对。'), 'archive-example'));
  assert(skill(run('请绘制流程图来展示步骤。'), 'diagram-example'));
});

test('prohibited modifications retain read-only task constraints', () => {
  for (const q of ['只读审查配置，不修改任何文件。', 'Review the project read-only without modifying existing files.']) {
    const r = run(q);
    assert.equal(r.taskConstraints.readOnly, true, q);
    assert.equal(r.requestContext.rawQuery, q);
  }
});

test('a separately requested output preserves the input without making the whole task read-only', () => {
  const r = run('只读检查原文，不修改原文件，另存报告为新文件。');
  assert.equal(r.taskConstraints.readOnly, false);
  assert.equal(r.taskConstraints.preserveInputs, true);
});

test('an actual icon asset may suggest image generation without executing it', () => {
  const r = run('Create a PNG icon for a weather dashboard.');
  assert(imageIntent(r, 'image-create'));
  assert.equal(r.capabilityCandidates.find(c => c.name === imageTool.name).invocation.automaticallyExecuted, false);
});

test('a request for component code alone is not an image-generation request', () => {
  const r = run('生成 SVG 图标组件代码。');
  assert(!imageIntent(r, 'image-create'));
  assert(!imageIntent(r, 'image-edit'));
});
