import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';

const tool=(name,description,extra={})=>({id:`tool:${name}`,kind:'tool',name,description,enabled:true,callable:true,evidence:'runtime-tool',annotations:{},...extra});
const assess=(clauses,extra={})=>({activeText:clauses.join('; '),activeClauses:clauses,readOnly:false,...extra});
const advise=(assessment,capabilities,options={})=>adviseCapabilities(assessment,{capabilityIndex:{capabilities,coverage:{},errors:[],revision:'rc3-generic'},capabilityLimit:10,...options});
const inventoryReader=tool('records__read_inventory','Read remote inventory records.');
const inventoryWriter=tool('records__update_inventory','Update remote inventory records.');
const localReport=tool('native__write_json_report','Write a local inventory JSON report.');
const sourceConstraint='Remote inventory records are read-only.';

test('source reads and local writes bind to different locations and objects in either order',()=>{
  const source='Read remote inventory records';
  const output='Write a local inventory JSON report';
  for(const clauses of [[source,output],[output,source],[`${source} and ${output}`],[`${source}, then ${output}`]]){
    const assessment=assess([...clauses,sourceConstraint],{constraintClauses:[sourceConstraint],restrictions:{protectedScopes:[{source:'user-request',scope:'protected-target',clause:sourceConstraint}]}});
    const result=advise(assessment,[inventoryWriter,localReport,inventoryReader]);
    const reader=result.candidates.find(x=>x.name===inventoryReader.name);
    const report=result.candidates.find(x=>x.name===localReport.name);
    assert(reader,JSON.stringify(clauses));assert(report,JSON.stringify(clauses));
    assert.equal(reader.decision,'defer');assert.equal(reader.scopeReadOnly,true);
    assert.notEqual(report.decision,'skip');assert.equal(report.scopeReadOnly,false);
    assert(!result.candidates.some(x=>x.name===inventoryWriter.name));
    assert(reader.objectBindings.some(x=>x.actions.includes('read')));
    assert(report.objectBindings.some(x=>x.actions.includes('create')&&x.location==='local'));
  }
});

test('Chinese action separation does not attach a local output action to a remote input',()=>{
  const assessment=assess(['读取远程 inventory 记录并另建本地 inventory JSON 报告','远程 inventory 只读'],{constraintClauses:['远程 inventory 只读']});
  const result=advise(assessment,[inventoryReader,inventoryWriter,localReport]);
  assert(result.candidates.some(x=>x.name===inventoryReader.name&&x.scopeReadOnly));
  assert(result.candidates.some(x=>x.name===localReport.name&&!x.scopeReadOnly));
  assert(!result.candidates.some(x=>x.name===inventoryWriter.name));
});

test('a differently located producer of the input type is not the requested output',()=>{
  const localInventory=tool('native__create_inventory','Create a local inventory database.');
  const json=tool('native__write_json','Write a local JSON report.');
  const result=advise(assess(['Read remote inventory records','Write a local JSON report']),[localInventory,json,inventoryReader]);
  assert(result.candidates.some(x=>x.name===json.name));
  assert(!result.candidates.some(x=>x.name===localInventory.name));
});

test('global plan mode still narrows both source and output despite local-write facets',()=>{
  const result=advise(assess(['Read remote inventory records','Write a local inventory JSON report']),[inventoryReader,localReport],{invocationContext:{mode:'plan'}});
  assert.equal(result.candidates.find(x=>x.name===inventoryReader.name)?.decision,'defer');
  assert.equal(result.candidates.find(x=>x.name===localReport.name)?.decision,'skip');
});

test('coordinated read and write verbs may share the same trailing object',()=>{
  const result=advise(assess(['Write and read local JSON documents']),[
    tool('native__write_json_document','Write local JSON documents.'),
    tool('native__read_json_document','Read local JSON documents.',{annotations:{readOnlyHint:true}}),
  ]);
  assert.equal(result.candidates.length,2);
  assert(result.candidates.some(x=>x.name.includes('write_')&&x.decision==='check-scope'));
  assert(result.candidates.some(x=>x.name.includes('read_')&&x.decision==='use-now'));
});

test('Google product-family source identity and bounded coordinates recall cell reads',()=>{
  const cells=tool('mcp__apps__google_drive_get_spreadsheet_cells','Read CellData from bounded native Google Sheets ranges.',{plugin:'Google Drive'});
  const range=tool('mcp__apps__google_drive_get_spreadsheet_range','Read plain cell values from a native Google Sheet.',{plugin:'Google Drive'});
  const unrelated=[
    tool('mcp__apps__google_drive_duplicate_sheet','Duplicate an existing sheet into a newly created spreadsheet.',{plugin:'Google Drive'}),
    tool('mcp__apps__google_drive_import_spreadsheet','Upload a spreadsheet to Drive.',{plugin:'Google Drive'}),
    tool('mcp__apps__google_drive_get_document_paragraph_range','Read a document paragraph range.',{plugin:'Google Drive'}),
    tool('mcp__apps__google_drive_find_document_text_range','Find a text range in a Google Doc.',{plugin:'Google Drive'}),
  ];
  for(const request of ['Read Google Sheets B2:H90','读取 Google Sheets 中 D4:K38 的单元格']){
    const result=advise(assess([request,'Write a local JSON report','Online spreadsheet is read-only'],{constraintClauses:['Online spreadsheet is read-only']}),[...unrelated,cells,range]);
    assert.deepEqual(new Set(result.candidates.map(x=>x.name)),new Set([cells.name,range.name]));
    assert(result.candidates.every(x=>x.decision==='defer'&&x.scopeReadOnly));
  }
});

test('bounded cell coordinates do not make a document text range a spreadsheet read',()=>{
  const doc=tool('mcp__apps__google_drive_find_document_text_range','Find a text range in a Google Doc.',{plugin:'Google Drive'});
  assert.equal(advise(assess(['Read Google Docs document text range']),[doc]).candidates[0]?.name,doc.name);
  const cells=tool('native__read_spreadsheet_cells','Read cells from a spreadsheet.');
  assert.deepEqual(advise(assess(['Inspect device B2:H90 firmware labels']),[cells]).candidates,[]);
});

test('duplicate copy and import operations cannot claim read-only from misleading annotations',()=>{
  for(const verb of ['duplicate','copy','import','export','move','rename','save','persist']){
    const operation=tool(`records__${verb}_inventory`,`${verb} remote inventory records.`,{annotations:{readOnlyHint:true}});
    const result=advise(assess([`Use ${operation.name}`],{readOnly:true}),[operation]);
    assert.equal(result.candidates[0]?.decision,'skip',verb);
    assert.equal(result.candidates[0]?.effect,'write-or-unknown',verb);
  }
});

test('host retrieval context can find a tool but cannot transfer a mutation onto a read object',()=>{
  const result=advise(assess(['Read remote inventory records'],{retrievalText:'Update remote inventory records',capabilityNeeds:['Update remote inventory records']}),[inventoryReader,inventoryWriter]);
  assert(result.candidates.some(x=>x.name===inventoryReader.name));
  assert(!result.candidates.some(x=>x.name===inventoryWriter.name));
});

test('an existing job or workspace creation is not inferred from creative production nouns',()=>{
  const worktree=tool('workspace__get_worktree_creation_status','Check a pending worktree creation operation.');
  assert.deepEqual(advise(assess(['Use video-creation-director to produce a narrated clip']),[worktree]).candidates,[]);
  assert(advise(assess(['Read worktree creation status']),[worktree]).candidates.some(x=>x.name===worktree.name));
});

test('plain public-source lookup does not start a structured multi-step research job',()=>{
  const agent=tool('research__agent','Run web research that returns structured data across several sites.');
  const search=tool('web__search','Search public web research sources.');
  const plain=advise(assess(['核查主办方公告与公开来源','只搜公开资料']),[agent,search]);
  assert(plain.candidates.some(x=>x.name===search.name));assert(!plain.candidates.some(x=>x.name===agent.name));
  assert(advise(assess(['Conduct deep web research and create a structured dataset']),[agent,search]).candidates.some(x=>x.name===agent.name));
});

test('a generic internet dispatcher remains a reader of unknown effects, not proven read-only',()=>{
  const web=tool('web__run','Tool for accessing the internet.');
  const result=advise(assess(['Research official web sources'],{readOnly:true}),[web]);
  assert.equal(result.candidates[0]?.decision,'defer');
  assert.equal(result.candidates[0]?.effect,'unknown');
});

test('a timing window is not a request to inspect a desktop window',()=>{
  const reader=tool('mcp__windows_control__ui_read','### 1. WINDOW TARGETING\nRead a window, then click controls.');
  assert.deepEqual(advise(assess(['修复游戏判定窗口在暂停恢复后的计时','在浏览器验证结果']),[reader]).candidates,[]);
  assert(advise(assess(['读取当前桌面窗口标题'],{readOnly:true}),[reader]).candidates.some(x=>x.name===reader.name));
});

test('function words and experimental design do not identify a design application object',()=>{
  const cards=[tool('design__get_dataset','Verify whether a design has data fields and if so list them.'),tool('design__generate_design','Create a design. Do not use obsolete tools.')];
  assert.deepEqual(advise(assess(['Design a pilot test so room and day effects are not confounded']),cards).candidates,[]);
});

test('resources is not a substring alias for public research sources',()=>{
  const generic=tool('list_mcp_resources','List resources supplied by configured context providers.');
  assert.deepEqual(advise(assess(['Research public web sources and official announcements']),[generic]).candidates,[]);
  assert(advise(assess(['List configured MCP resources']),[generic]).candidates.some(x=>x.name===generic.name));
});

test('generic public documentation search is not constrained by the subject resource type',()=>{
  const search=tool('public__search','Search official documentation and research sources on the public web.',{annotations:{readOnlyHint:true}});
  for(const subject of ['image generation techniques','video editing techniques','spreadsheet analysis methods']){
    const result=advise(assess([`Research ${subject} with primary sources`],{readOnly:true}),[search]);
    assert.equal(result.candidates[0]?.name,search.name,subject);
    assert.equal(result.candidates[0]?.decision,'use-now',subject);
  }
});
