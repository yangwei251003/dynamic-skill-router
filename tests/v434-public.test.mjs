import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {routeTaskV4} from '../src/advisor-v4.mjs';

// A fabricated inventory; no connected account, installed skill, or business tool is used.
const tools = [
  {name:'google_drive__search', description:'Search Google Drive files and return file paths.', available:true, annotations:{readOnlyHint:true}},
  {name:'feishu_drive__search', description:'Search Feishu Drive 飞书云空间 飞书云盘 files and return file paths.', available:true, annotations:{readOnlyHint:true}},
  {name:'web__run', description:'Search the internet and open requested web pages.', available:true, annotations:{readOnlyHint:true}},
  {name:'image_gen__imagegen', description:'Generate images or illustrations.', available:true},
];
const capabilities = tools.map(t => ({id:'tool:'+t.name, kind:'tool', ...t, enabled:true, callable:true, evidence:'runtime-tool'}));
const options = {host:'codex', routingMode:'full', index:[],
  capabilityIndex:{revision:'synthetic', capabilities, coverage:{}, errors:[]},
  runtimeTools:tools, useFeedback:false, capabilityLimit:10};
const run = q => routeTaskV4(q, options);
const active = (r, name) => r.capabilityCandidates.some(c => c.name === name && !['defer','skip'].includes(c.decision));

test('metadata nouns and negative edits remain read-only', () => {
  for (const q of [
    '只读查看文件的创建时间和最后修改时间。',
    '只读检查文件的创建日期及更新人。',
    '只读检查文件，不要把文件修改时间改成明天。',
    'Check only the file creation time and last modified time; do not alter any files.',
  ]) assert.equal(run(q).taskConstraints.readOnly, true, q);
});

test('requested timestamp changes and separate output remain writable', () => {
  for (const q of [
    '检查文件，把文件修改时间改成明天。',
    '检查文件，设置文件创建时间为指定日期。',
    'Review the file then change its creation time.',
  ]) assert.equal(run(q).taskConstraints.readOnly, false, q);
  const output = run('只读检查原文件不要修改原文件并新建 result.txt。');
  assert.equal(output.taskConstraints.readOnly, false);
  assert.equal(output.taskConstraints.preserveInputs, true);
});

test('one named cloud source does not promote a competing source', () => {
  for (const q of [
    '在 Google Drive 搜索文件并导出结果到本地。',
    '在 Google Drive 搜索文件，再把文件发送给我。',
    '在 Google Drive 搜索文件并导出到本地，禁止访问飞书云空间。',
  ]) {
    const r = run(q);
    assert(active(r,'google_drive__search'), q);
    assert(!active(r,'feishu_drive__search'), q);
  }
});

test('multiple sources, broad scope and distinct tool needs remain visible', () => {
  for (const q of [
    '在 Google Drive 和飞书云空间分别查找报告并比较。',
    '查找 Google Drive 等所有网盘中的项目文档。',
    'Search Google Drive and Feishu documents for budget files.',
  ]) {
    const r = run(q);
    assert(active(r,'google_drive__search'), q);
    assert(active(r,'feishu_drive__search'), q);
  }
  const mixed = run('在 Google Drive 搜索文档并上网搜索公开信息。');
  assert(active(mixed,'google_drive__search'));
  assert(active(mixed,'web__run'));
  assert(mixed.capabilityCandidates.every(c => c.invocation.automaticallyExecuted === false));
});

test('CLI applies verified feedback only for the matching model and honors opt-out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-public-fixture-'));
  const feedbackPath = path.join(dir, 'synthetic-feedback.jsonl');
  const contentHash = 'synthetic-content-hash';
  const skill = {id:'demo-doc', nameZh:'文档整理', summaryZh:'整理设计文档', triggers:['设计文档'], contentHash,
    availability:{discovered:true,readable:true,enabled:true,compatible:true,toolsAvailable:null}};
  const entries = Array.from({length:20}, (_, i) => ({contractVersion:4, host:'codex', taskType:'general',
    routeId:`fixture-task-${i}`, modelId:'fixture-model-a', observedAt:'2026-10-31T00:00:00Z',
    decisions:[{skillId:skill.id, contentHash, mode:'consult', shown:true, read:true, adopted:true,
      outcome:'helpful', evidence:[{kind:'validation', reference:'synthetic-check', passed:true}]}]}));
  fs.writeFileSync(feedbackPath, entries.map(x=>JSON.stringify(x)).join('\n')+'\n');
  const before = fs.readFileSync(feedbackPath, 'utf8');
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const fixtureOptions = {host:'codex', contractVersion:4, routingMode:'full', routeId:'fixture-current',
    index:{skills:[skill], revision:'fixture', coverage:{}, errors:[]},
    capabilityIndex:{capabilities:[], revision:'fixture', coverage:{}, errors:[]},
    feedbackPolicy:{nowMs:Date.parse('2026-11-01T00:00:00Z')}, feedbackPath};
  function call(command, patch={}, extra=[]) {
    const input = JSON.stringify({query:'请使用 demo-doc 整理设计文档。', options:{...fixtureOptions,...patch}});
    const proc = spawnSync(process.execPath, [cli, command, '--contract-version', '4', '--input-json', '--dry-run', ...extra],
      {input, encoding:'utf8', timeout:30000});
    assert.equal(proc.status,0,proc.stderr);
    return JSON.parse(proc.stdout).consultCandidates.find(c => c.id === skill.id)?.calibrationByMode?.consult?.adjustment || 0;
  }
  try {
    assert(call('route',{currentModel:'fixture-model-a'}) > 0);
    assert(call('search',{currentModel:'fixture-model-a'}) > 0);
    assert.equal(call('route',{currentModel:'fixture-model-b'}), 0);
    assert.equal(call('route'), 0);
    assert.equal(call('route',{currentModel:'fixture-model-a'},['--no-feedback']), 0);
    assert.equal(call('route',{currentModel:'fixture-model-a',useFeedback:true},['--no-feedback']), 0);
    assert.equal(fs.readFileSync(feedbackPath,'utf8'),before);
  } finally {
    fs.unlinkSync(feedbackPath);
    fs.rmdirSync(dir);
  }
});
test('plain arithmetic can skip discovery, but extra work cannot', () => {
  const quick = routeTaskV4('17 + 29 等于多少？', {...options, routingMode:'auto'});
  assert.equal(quick.performance.mode,'fast');
  assert.equal(quick.performance.scannedSkills,false);
  assert.equal(quick.performance.scannedCapabilities,false);
  const full = routeTaskV4('17 + 29 等于多少？请联网搜索核实最新数据。', {...options, routingMode:'auto'});
  assert.equal(full.performance.mode,'full');
});

test('a matching custom document skill can be consulted without a literal docx id', () => {
  const available = {discovered:true,readable:true,enabled:true,compatible:true,toolsAvailable:null};
  const fake = [
    {id:'word-example', nameZh:'Word 文档', summaryZh:'Create and edit Word docx documents and reports.', triggers:['docx'], availability:available},
    {id:'diagram-example', nameZh:'步骤图', summaryZh:'绘制可编辑流程图。', triggers:['流程图'], availability:available},
    ...Array.from({length:120},(_,i)=>({id:`filler-${i}`,summaryZh:`无关合成条目 ${i}`,availability:available})),
  ];
  const r = routeTaskV4('离线制作可编辑的 Word 项目清单，保存为 list.docx。',
    {...options,index:{revision:'synthetic',skills:fake,coverage:{},errors:[]}});
  assert.equal(r.consultCandidates.find(c=>c.id==='word-example')?.suggestedMode,'consult');
  assert(!['consult','adapt','execute'].includes(r.consultCandidates.find(c=>c.id==='diagram-example')?.suggestedMode));
});

test('AI instructions are distinct from an ordinary installation command', () => {
  const available = {discovered:true,readable:true,enabled:true,compatible:true,toolsAvailable:null};
  const promptSkill = {id:'synthetic-prompt-guide',nameZh:'AI 提示词顾问',
    summaryZh:'将项目需求改写为 AI Agent 可执行的任务说明和开发指令，明确交付、验收、安全边界。 Create agent task instructions and acceptance criteria.',availability:available};
  const fake = [promptSkill,...Array.from({length:120},(_,i)=>({id:`padding-${i}`,summaryZh:`无关条目 ${i}`,availability:available}))];
  const consult = q => routeTaskV4(q,{...options,index:{revision:'synthetic',skills:fake,coverage:{},errors:[]}})
    .consultCandidates.some(c=>c.id===promptSkill.id && c.suggestedMode==='consult');
  assert(consult('为 AI Agent 写一份网站开发任务说明，列出交付和验收方法。'));
  assert(!consult('为 AI Agent 写一条 shell 安装指令，运行后检查结果。'));
});

// Known limitation in both the previous public version and this candidate:
// a paraphrased AI-directed request can miss a generic prompt manual.
test.todo('a generic prompt manual is consulted for a paraphrased AI work instruction', () => {
  const available = {discovered:true,readable:true,enabled:true,compatible:true,toolsAvailable:null};
  const manual = {id:'prompt-example',nameZh:'项目提示词架构',
    summaryZh:'为各种项目生成提示词并满足需求，同时安排交付物。',availability:available};
  const fake = [manual,...Array.from({length:180},(_,i)=>({id:`other-${i}`,summaryZh:`无关合成条目 ${i}`,availability:available}))];
  const r = routeTaskV4('请把需求转为 AI 能执行的工作说明，写清应交付的成果。',
    {...options,index:{revision:'synthetic',skills:fake,coverage:{},errors:[]}});
  assert.equal(r.consultCandidates.find(c=>c.id===manual.id)?.suggestedMode,'consult');
});
