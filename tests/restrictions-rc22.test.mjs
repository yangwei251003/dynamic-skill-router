import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {taskAssessment} from '../src/advisor-v4.mjs';
import {assessRestrictions} from '../src/task-restrictions.mjs';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';

// Unit fixtures only: these names do not claim to be registered business tools.
const fixtureTools=[
 {name:'fixture_plc_connect',description:'Connect to a physical PLC controller over USB or Ethernet.',annotations:{readOnlyHint:true}},
 {name:'fixture_plc_download',description:'Download the control program to the physical PLC controller.',annotations:{readOnlyHint:false}},
 {name:'fixture_public_docs',description:'Search public vendor documentation on the web about PLC programming.',annotations:{readOnlyHint:true}},
 {name:'fixture_read_json',description:'Read a local JSON file from disk without changing it.',annotations:{readOnlyHint:true}},
 {name:'exec_command',description:'Runs a command in a local shell. Commands can read or change files.',annotations:{}}
];
const capabilityIndex={revision:'rc22-memory-fixture',errors:[],coverage:{hostConfigScanned:false},
 capabilities:fixtureTools.map(x=>({...x,id:'tool:'+x.name,kind:'tool',enabled:true,callable:true,evidence:'unit-fixture',configured:false}))};
function assess(query){return taskAssessment(query);}
function work(query){const a=assess(query);return assessRestrictions(query,[],{},a.activeClauses);}
function advice(query,options={}){
 const saved={readFileSync:fs.readFileSync,readdirSync:fs.readdirSync};
 fs.readFileSync=()=>{throw new Error('Unit fixture must not read inventory files');};
 fs.readdirSync=()=>{throw new Error('Unit fixture must not scan inventory directories');};
 try{return adviseCapabilities(assess(query),{capabilityIndex,phase:'discovery',capabilityLimit:10,...options});}
 finally{Object.assign(fs,saved);}
}
const operations=a=>a.restrictions.forbiddenOperations??[];
const unresolved=a=>a.restrictions.unresolvedConstraints??[];
const card=(query,name,options)=>{const c=advice(query,options).candidates.find(x=>x.name===name);assert.ok(c,'Named fixture candidate should be inspected: '+name);return c;};

test('synthetic inspection regression: export nouns do not authorize output',()=>{
 const query='统计程序先前导出的数量有误。先只查看导出过程与记录，给出原因与修复建议；不要改代码、数据或线上配置。';
 const a=assess(query);
 assert.equal(a.readOnly,true);
 assert.ok(!a.restrictions.protectedScopes.some(x=>x.target==='先'));
 assert.notEqual(work(query).workMode,'separate-output-requested');
 assert.ok(a.negativeRequests.includes('不要改代码、数据或线上配置'));
});
test('exclusive inspection governs an export noun despite temporal prefix',()=>{
 const q='原报告已生成的条目有重复。再仅检查导出配置，给出修改建议。';
 assert.equal(assess(q).readOnly,true);
 assert.notEqual(work(q).workMode,'separate-output-requested');
});
test('English exclusive inspection does not turn export logic into an export command',()=>{
 const q='The exported totals differ. First only inspect the export logic and give modification advice.';
 assert.equal(assess(q).readOnly,true);
 assert.notEqual(work(q).workMode,'separate-output-requested');
});
test('a separately requested artifact stays writable while the inspected source stays protected',()=>{
 const a=assess('先只查看 input.json，但请另行创建新的报告文件 report.md。');
 assert.equal(a.readOnly,false);
 assert.ok(a.restrictions.protectedScopes.some(x=>String(x.target).includes('input.json')));
 assert.ok(!a.restrictions.protectedScopes.some(x=>x.target==='先'));
});
test('English separate output is not blocked by source-only inspection',()=>{
 const a=assess('Only inspect input.json; create a separate report file report.md.');
 assert.equal(a.readOnly,false);
 assert.ok(a.restrictions.protectedScopes.some(x=>String(x.target).includes('input.json')));
});
test('Chinese and English advice alone do not create persistent mutations',()=>{
 for(const q of ['先给离线修改建议。','Please give offline modification advice.']){
  assert.notEqual(work(q).workMode,'separate-output-requested',q);
 }
});
test('quoted inspection or device prohibitions do not become current restrictions',()=>{
 const a=assess('资料写着：“只查看配置，不要连接设备。”请新建本地报告文件 report.md。');
 assert.equal(a.readOnly,false);
 assert.deepEqual(operations(a),[]);
});
test('negative creation is not positive output work',()=>{
 const q='不要新建报告；先只查看导出日志，给出原因。';
 assert.equal(assess(q).readOnly,true);
 assert.notEqual(work(q).workMode,'separate-output-requested');
});
test('synthetic offline review: preserve device ban without blanket internet ban',()=>{
 const q='请审查一份本地PLC示例程序。先给离线修改建议，不要连接或下载到设备。';
 const a=assess(q),rows=operations(a);
 assert.ok(rows.some(x=>x.clause==='不要连接或下载到设备'&&x.actions.includes('connect')&&x.actions.includes('download')));
 assert.equal(a.restrictions.networkForbidden,false);
 assert.notEqual(work(q).workMode,'separate-output-requested');
 assert.equal(a.restrictions.canGrantPermission,false);
});
test('English shared device prohibition retains both actions and original clause',()=>{
 const a=assess('Review the PLC program offline and give modification advice. Do not connect to or download a program to the controller.');
 assert.ok(operations(a).some(x=>x.actions.includes('connect')&&x.actions.includes('download')&&x.clause.startsWith('Do not connect')));
 assert.equal(a.restrictions.networkForbidden,false);
});
test('device restriction does not ban a separately requested local artifact',()=>{
 const a=assess('不要连接设备；请另行生成本地补丁文件 patch.txt。');
 assert.equal(a.readOnly,false);
 assert.ok(operations(a).some(x=>x.actions.includes('connect')));
 assert.equal(a.restrictions.networkForbidden,false);
});
test('known device actions are gated even if a connector claims readOnlyHint',()=>{
 const q='只评估 fixture_plc_connect 和 fixture_plc_download 的可用性，不要连接或下载到设备。';
 for(const name of ['fixture_plc_connect','fixture_plc_download']){
  const c=card(q,name);
  assert.equal(c.decision,'skip');
  assert.ok(c.gates.includes('device-operation-forbidden'));
  assert.ok(c.operationRestrictions.some(x=>x.clause==='不要连接或下载到设备'));
 }
});
test('device prohibition permits independent public documentation retrieval',()=>{
 const c=card('请用 fixture_public_docs 查询 PLC 厂商公开文档；不要连接或下载到设备。','fixture_public_docs');
 assert.equal(c.decision,'use-now');
 assert.ok(!c.gates.includes('network-forbidden'));
 assert.ok(!c.gates.includes('device-operation-forbidden'));
});
test('explicit global network ban still gates the web fixture',()=>{
 const c=card('只评估 fixture_public_docs；全程离线，不要联网。','fixture_public_docs');
 // A recognized network reader is skipped; an unverified transport is deferred.
 // Both must keep the explicit network prohibition, never permit invocation.
 assert.ok(['skip','defer'].includes(c.decision));
 assert.equal(c.networkScope.forbidden,true);
 assert.ok(c.gates.includes('network-forbidden')||c.gates.includes('verify-no-network-before-invocation'));
});
test('unclassified negative clause remains visible and requires scope checking',()=>{
 const q='请用 fixture_read_json 查看本地 JSON 文件；不要触发外部告警。';
 const a=assess(q);
 assert.ok(unresolved(a).some(x=>x.clause==='不要触发外部告警'));
 const c=card(q,'fixture_read_json');
 assert.equal(c.decision,'check-scope');
 assert.ok(c.gates.includes('resolve-unclassified-user-constraint-before-invocation'));
 assert.ok(c.unresolvedConstraints.some(x=>x.clause==='不要触发外部告警'));
});
test('general execution remains effect-unknown under an exclusive read request',()=>{
 const c=card('先只查看本地导出日志；评估 exec_command 是否适合读取。','exec_command');
 assert.equal(c.effect,'unknown');
 assert.equal(c.decision,'defer');
 assert.ok(c.gates.includes('verify-read-only-effect-before-invocation'));
});

for(const [language,query,clause] of [
 ['Chinese','不要连接备用PLC；请用 fixture_plc_connect 连接测试PLC。','不要连接备用PLC'],
 ['English','Do not connect to the standby controller; use fixture_plc_connect to connect to the test controller.','Do not connect to the standby controller']
])test(language+' qualified device target is not widened into a blanket device ban',()=>{
 const a=assess(query);
 assert.deepEqual(operations(a),[]);
 assert.ok(unresolved(a).some(x=>x.clause===clause));
 const c=card(query,'fixture_plc_connect',{phase:'implementation'});
 assert.equal(c.decision,'check-scope');
 assert.ok(!c.gates.includes('device-operation-forbidden'));
 assert.ok(c.unresolvedConstraints.some(x=>x.clause===clause));
});
