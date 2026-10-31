import test from 'node:test';
import assert from 'node:assert/strict';
import {taskAssessment} from '../src/advisor-v4.mjs';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';
const provider='LedgerLake';
const tool=(name,description,extra={})=>({id:`tool:${name}`,kind:'tool',name,description,plugin:provider,enabled:true,callable:true,evidence:'runtime-tool',annotations:{readOnlyHint:true},...extra});
const catalogue=tool('lookup_resources','List LedgerLake resources you own in the selected account. Reuse a known resource_id instead of listing.');
const schema=tool('inspect_structure','Inspect user tables in the connected database before reading rows.');
const rows=tool('read_entries','Read one bounded page of rows from a user table in the connected database. Call inspect_structure first with exact identifiers.');
const write=tool('delete_records','Read records from a database.',{annotations:{destructiveHint:true}});
const other=tool('other_read','Read records from a user table in a database.',{plugin:'DifferentStore'});
const inventory={capabilities:[catalogue,schema,rows,write,other],coverage:{},errors:[]};
const advise=(query,options={})=>adviseCapabilities(taskAssessment(query),{capabilityIndex:inventory,...options}).candidates;
const roles=cards=>cards.filter(x=>x.decision!=='skip').map(x=>x.capabilityRole);

test('business table inspection preserves resource, schema and records as separate needs',()=>{
 for(const query of ['查看我的 LedgerLake 报名表，按渠道统计人数并检查重复邮箱。','只读检查 LedgerLake 库存记录，分组计数并查看是否重复。','Read the LedgerLake table records and count duplicate entries.']){
  const cards=advise(query);
  for(const role of ['record-resource-discovery','record-schema','record-read'])assert(roles(cards).includes(role),query+' '+role);
  assert(!cards.some(x=>x.id===other.id));
  const read=cards.find(x=>x.id===rows.id);assert.equal(read.invocation.automaticallyExecuted,false);
  assert.match(read.recordReadEvidence.scope,/authentication.*unverified/);
  assert(cards.every(x=>!x.explicit));
 }
});

test('layout, explanations, methods and quoted examples cannot request database reads',()=>{
 for(const query of ['查看 LedgerLake 报名表的页面布局。','解释 LedgerLake 报名表怎样分组统计人数。','只给方法：检查 LedgerLake 报名表并统计重复邮箱。','解释这句话：“查看 LedgerLake 报名表并统计重复邮箱”。']){
  assert(!advise(query).some(x=>x.recordReadEvidence),query);
 }
 assert(!advise('只读检查本地报名表，统计人数和重复邮箱。').some(x=>x.recordReadEvidence));
});

test('record discovery never weakens read-only, network or destructive guards',()=>{
 const cards=advise('只读检查 LedgerLake 报名表，统计重复邮箱，不修改，不联网。');
 assert(cards.filter(x=>x.recordReadEvidence).every(x=>['defer','skip'].includes(x.decision)));
 const dangerous=cards.find(x=>x.id===write.id);
 assert(!dangerous||dangerous.decision==='skip');
 assert(cards.filter(x=>x.recordReadEvidence).every(x=>x.networkScope?.forbidden));
});
