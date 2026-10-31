import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adviseCapabilities, discoverCapabilities} from '../src/capabilities-v4.mjs';

// Original synthetic descriptions model a mixed read/write provider.
// These fixtures route only; they contain no runtime inventory or site IDs.
const overview = 'mcp__codex_apps__sites_read_database_overview';
const rows = 'mcp__codex_apps__sites_read_database_table_rows';
const save = 'mcp__codex_apps__sites_save_site_version';
const deploy = 'mcp__codex_apps__sites_deploy_site_version';
const access = 'mcp__codex_apps__sites_update_site_access';
const shared = 'Use Sites to build or modify websites. Use this connector for publishing, database access, saved versions, and permissions.';
const purposes = {
  [overview]: "Inspect the user tables in a deployed site's database before reading rows. Return exact table and binding names. This tool is part of plugin `Sites`.",
  [rows]: "Read one bounded page of rows from a user table in a deployed site's database using returned table and binding names. This tool is part of plugin `Sites`.",
  [save]: "Save a version of the site's source without deploying it. This tool is part of plugin `Sites`.",
  [deploy]: "Deploy a saved site version to production. This tool is part of plugin `Sites`.",
  [access]: "Update who can visit a site. This tool is part of plugin `Sites`.",
};
const sites = Object.entries(purposes).map(([name, purpose])=>({name, description:`${shared}\n\n${purpose}`, available:true}));
const readQuery = '只读检查我现有 Sites 站点的数据库：先读数据库概览，再读取概览返回的座位统计表第一页，汇总实际行数与字段含义，在聊天答复。仅授权查询现有数据，不保存新版本、不更改访问权限、不部署。';
const assess = (query, extra={})=>({activeText:query,activeClauses:query.split(/[。；;]/).filter(Boolean),readOnly:false,...extra});
const advise = (query, runtimeTools=sites, extra={}, options={})=>adviseCapabilities(assess(query, extra),{
  capabilityIndex:discoverCapabilities({host:'generic',runtimeTools}),capabilityLimit:10,...options,
});
const names = result=>result.candidates.map(card=>card.name);

test('existing Sites database reads survive the shared publishing overview without acquiring its authority',()=>{
  const result=advise(readQuery,sites,{readOnly:true});
  assert.deepEqual(new Set(names(result)),new Set([overview,rows]));
  for(const card of result.candidates){
    assert.match(card.description,/^(?:Inspect the user tables|Read one bounded page of rows)/);
    assert.equal(card.phase,'discovery');
    assert.equal(card.explicit,false);
    assert.equal(card.providerRequested,true);
    // Synthetic descriptions contain no readOnlyHint. The concrete read
    // purpose retrieves the tool but does not fabricate an effects guarantee.
    assert.equal(card.effect,'unknown');
    assert.equal(card.decision,'defer');
    assert(card.gates.includes('verify-read-only-effect-before-invocation'));
    assert.equal(card.invocation.automaticallyExecuted,false);
  }
});

test('the same provider can save a requested version while deployment remains a separate action',()=>{
  const result=advise('Save a version of my existing Sites site without deploying it.');
  const writer=result.candidates.find(card=>card.name===save);
  assert(writer);
  assert.equal(writer.effect,'write-or-unknown');
  assert.equal(writer.decision,'check-scope');
  assert(!names(result).includes(overview));
  assert(!names(result).includes(rows));
  assert(result.candidates.filter(card=>card.name===deploy).every(card=>card.decision==='defer'));
});

test('a local report does not hide a separately requested existing Sites source',()=>{
  const query='读取现有 Sites 站点数据库的统计表行数据，并生成本地单文件 HTML 报告；站点资料只读，不保存站点版本、不部署。';
  const result=advise(query,sites,{readOnly:false});
  assert(names(result).includes(overview));
  assert(names(result).includes(rows));
  assert(!result.candidates.some(card=>[save,deploy,access].includes(card.name)&&['use-now','check-scope'].includes(card.decision)));
});

test('a declared Sites source does not recruit a similarly named table reader from another service',()=>{
  const unrelated={name:'mcp__archive__sites_read_database_table_rows',available:true,annotations:{readOnlyHint:true},
    description:'Read database table rows from the Archive records service. This tool is part of plugin `Archive`.'};
  const result=advise(readQuery,[...sites,unrelated],{readOnly:true});
  assert(names(result).includes(rows));
  assert(!names(result).includes(unrelated.name));
  const local=advise('Read table rows from my local SQLite database for an offline HTML report.',sites,{readOnly:true});
  assert.deepEqual(local.candidates,[]);
});

test('generic database and statistical language does not identify a Sites source or inference task',()=>{
  assert.deepEqual(advise('读取数据库概览和统计表行数据，汇总字段与实际行数。',sites,{readOnly:true}).candidates,[]);
  const statistics={name:'mcp__analysis__hypothesis_test',available:true,annotations:{readOnlyHint:true},
    description:'Perform statistical hypothesis testing and infer treatment effects from sample data.'};
  assert(!names(advise(readQuery,[...sites,statistics],{readOnly:true})).includes(statistics.name));
  assert(names(advise('Perform statistical hypothesis testing and infer treatment effects from sample data.',[statistics],{readOnly:true})).includes(statistics.name));
});

test('an explicit tool survives object retrieval gates but never a read-only effect restriction',()=>{
  const reader=advise(`请使用 ${rows} 读取现有数据。`,[sites.find(item=>item.name===rows)],{readOnly:true}).candidates[0];
  assert.equal(reader?.explicit,true);
  assert.equal(reader?.decision,'defer');
  assert.match(reader?.description||'',/^Read one bounded page/);
  const writer=advise(`请使用 ${save}。`,sites,{readOnly:true}).candidates.find(card=>card.name===save);
  assert.equal(writer?.explicit,true);
  assert.equal(writer?.decision,'skip');
  assert(writer.gates.includes('read-only-scope'));
});

test('shared overview recognition is structural and does not require the Sites brand',()=>{
  const records={name:'mcp__harbor__read_ledger',available:true,annotations:{readOnlyHint:true},
    description:'Use Harbor to build or modify customer portals. Use this connector for publishing, storage, and access controls.\n\nRead ledger records from the existing Harbor account. This tool is part of plugin `Harbor`.'};
  const card=advise('Read ledger records from the existing Harbor account.',[records],{readOnly:true}).candidates[0];
  assert.equal(card?.name,records.name);
  assert.equal(card?.description,'Read ledger records from the existing Harbor account. This tool is part of plugin `Harbor`.');
});

test('network restrictions apply to main purpose even when a tool is annotated read-only',()=>{
  const web={name:'web__run',available:true,annotations:{readOnlyHint:true},description:'Tool for accessing the internet.'};
  const cloud={name:'local__read_records',available:true,annotations:{readOnlyHint:true},description:'Read records from a remote cloud service.'};
  const offline={restrictions:{networkForbidden:true},readOnly:true};
  assert.deepEqual(advise('Read records from a remote cloud service and inspect internet sources.',[web,cloud],offline).candidates,[]);
  const explicit=advise(`Use ${web.name} to check internet sources.`,[web],offline).candidates[0];
  assert.equal(explicit?.decision,'skip');
  assert.equal(explicit?.networkScope.purposeEvidence,'network');
  assert(explicit.gates.includes('network-forbidden'));
});

test('offline scope retains local execution and relies on purpose rather than a network-looking name',()=>{
  const shell={name:'exec_command',available:true,description:'Runs a command in a local terminal.'};
  const local={name:'mcp__cloud__read_ledger',available:true,annotations:{readOnlyHint:true},description:'Read ledger records from an offline local file.'};
  const result=advise('Run a local script to inspect data.json and read ledger records from an offline local file.',[shell,local],{restrictions:{networkForbidden:true}});
  assert(names(result).includes(shell.name));
  assert(names(result).includes(local.name));
  assert(result.candidates.every(card=>card.networkScope.purposeEvidence==='local'));
  assert(result.candidates.every(card=>card.gates.includes('preserve-offline-scope')));
});

test('unknown network behavior remains unverified rather than being called offline',()=>{
  const reader={name:'mcp__offline__read_ledger',available:true,annotations:{readOnlyHint:true},description:'Read ledger records.'};
  const card=advise('Read ledger records.',[reader],{restrictions:{networkForbidden:true},readOnly:true}).candidates[0];
  assert.equal(card?.networkScope.purposeEvidence,'unknown');
  assert.equal(card?.decision,'defer');
  assert(card.gates.includes('verify-no-network-before-invocation'));
});

test('a locally stored provider snapshot is local, while a mixed network purpose remains unverified',()=>{
  const local={name:'read_snapshot',available:true,annotations:{readOnlyHint:true},description:'Read ledger records from a local GitHub repository snapshot.'};
  const mixed={name:'read_cached_records',available:true,annotations:{readOnlyHint:true},description:'Read ledger records from a local cache and a remote cloud service.'};
  const result=advise('Read ledger records from local snapshots and caches.',[local,mixed],{restrictions:{networkForbidden:true},readOnly:true});
  assert.equal(result.candidates.find(card=>card.name===local.name)?.networkScope.purposeEvidence,'local');
  assert.equal(result.candidates.find(card=>card.name===mixed.name)?.decision,'defer');
});
