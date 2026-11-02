import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {ROUTER_ROOT} from '../src/paths.mjs';
import {ROUTER_VERSION} from '../src/version.mjs';

test('documented Codex profile discovers a different user home through the actual MCP process',async()=>{
  const runtime=path.join(ROUTER_ROOT,'.runtime');fs.mkdirSync(runtime,{recursive:true});
  const base=fs.mkdtempSync(path.join(runtime,'codex-transfer-'));
  const core=path.join(base,'core'),home=path.join(base,'new-user'),data=path.join(base,'private-data');
  const project=path.join(base,'project'),logs=path.join(data,'logs');
  const put=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  for(const name of ['src','config','skill'])fs.cpSync(path.join(ROUTER_ROOT,name),path.join(core,name),{recursive:true});
  fs.copyFileSync(path.join(ROUTER_ROOT,'examples/skill-sources.codex.json'),path.join(core,'config/skill-sources.json'));
  fs.mkdirSync(path.join(data,'skills'),{recursive:true});
  put(path.join(data,'技能注册表/skills.json'),JSON.stringify({schemaVersion:3,skills:[],policy:{}}));
  put(path.join(home,'.codex/config.toml'),'[mcp_servers.transfer_fixture]\ncommand="never-start-this-business-tool"\n');
  const manual='---\nname: transfer-review\ndescription: Review code for correctness using a local checklist.\n---\n# Transfer review\nLOCAL_FULL_MANUAL_SENTINEL\nCheck the actual diff and runnable behavior.\n';
  put(path.join(home,'.agents/skills/transfer-review/SKILL.md'),manual);
  put(path.join(home,'.codex/skills/legacy-local/SKILL.md'),'---\nname: legacy-local\ndescription: Local legacy skill fixture.\n---\nLegacy local fixture.\n');
  put(path.join(project,'.agents/skills/project-local/SKILL.md'),'---\nname: project-local\ndescription: Review this project using its local conventions.\n---\nProject fixture.\n');
  const pluginPath=path.join(home,'.codex/plugins/cache/transfer-plugin/skills/plugin-local/SKILL.md');
  put(pluginPath,'---\nname: plugin-local\ndescription: Read project debugging logs.\n---\nPlugin fixture.\n');
  const guidance=fs.readFileSync(path.join(ROUTER_ROOT,'examples/codex-global-rules.md'),'utf8');
  assert(!/[A-Z]:[\\/]Users[\\/]/iu.test(guidance));
  for(const marker of ['dynamic-skill-router-v4','depth-first-task-brief']){
    assert.equal(guidance.split(`<!-- ${marker}:begin -->`).length,2);
    assert.equal(guidance.split(`<!-- ${marker}:end -->`).length,2);
  }
  const installed=guidance.replaceAll('{{ROUTER_ROOT}}',core.replaceAll('\\','/'))
    .replaceAll('{{DATA_ROOT}}',data.replaceAll('\\','/')).replaceAll('{{LOG_ROOT}}',logs.replaceAll('\\','/'));
  put(path.join(home,'.codex/AGENTS.md'),installed);
  assert(installed.includes('深入而不是更大')&&!/\{\{[A-Z_]+\}\}/u.test(installed));
  const env={...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,'.codex'),SKILL_ROUTER_HOME:home,
    SKILL_ROUTER_DATA_ROOT:data,SKILL_ROUTER_LOG_ROOT:logs};
  const probe=spawnSync(process.execPath,['--input-type=module','-e','import os from "node:os";process.stdout.write(os.homedir())'],{env,encoding:'utf8'});
  assert.equal(probe.status,0);assert.equal(probe.stdout,home,'refuse any accidental access to the real user home');
  const client=new Client({name:'codex-transfer-check',version:'1.0.0'});
  const checks=[];
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(core,'src/mcp-server.mjs')],env,stderr:'pipe'}));
    const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return r.structuredContent;};
    const names=(await client.listTools()).tools.map(x=>x.name);
    for(const name of ['route_task','search_skills','get_skill','resolve_alias','list_skills','health_check','plan_agents','report_outcome','scan_capabilities','search_capabilities','plan_recovery'])assert(names.includes(name),name);
    checks.push('all-11-MCP-interfaces');
    const common={host:'codex',contractVersion:4,projectRoot:project};
    const health=await call('health_check',common);assert(health.ok);assert.equal(health.routerVersion,ROUTER_VERSION);
    const cli=spawnSync(process.execPath,[path.join(core,'src/cli.mjs'),'health','--host','codex','--contract-version','4','--project-root',project],{env,encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).count,health.count);
    checks.push('CLI-fallback-with-the-same-private-environment');
    const inventory=await call('list_skills',common);
    for(const suffix of ['transfer-review','legacy-local','project-local'])assert(inventory.skills.some(s=>s.path.includes(suffix)),suffix);
    assert(inventory.skills.every(s=>s.path.startsWith(base)),'only copied router and target-user paths');
    assert(!inventory.skills.some(s=>s.id.includes('example-code-review')));
    checks.push('local-and-project-skills-without-author-library');
    const runtimeSkills=[{path:pluginPath,id:'transfer-plugin:plugin-local',provider:'transfer-fixture',enabled:true}];
    const withPlugin=await call('list_skills',{...common,runtimeSkills});assert(withPlugin.skills.some(s=>s.path.includes('plugin-local')));
    checks.push('target-host-runtime-plugin');
    const runtimeTools=[{name:'mcp__transfer_fixture__read_logs',description:'Read project debugging logs.',available:true,annotations:{readOnlyHint:true}}];
    const q='Use transfer-review to review code and read project debugging logs.';
    const route=await call('route_task',{...common,query:q,runtimeSkills,runtimeTools,dryRun:true});
    const card=route.consultCandidates.find(s=>s.id.includes('transfer-review'));assert(card);
    const stage=await call('search_skills',{...common,query:q,routeId:route.routeId,runtimeSkills,runtimeTools});
    assert.equal(stage.routeId,route.routeId);assert(stage.consultCandidates.some(s=>s.id===card.id));
    const read=await call('get_skill',{...common,name:card.id,expectedContentHash:card.contentHash});
    assert(read.found);assert(read.content.includes('LOCAL_FULL_MANUAL_SENTINEL'));
    assert.equal(read.contentHash,createHash('sha256').update(manual).digest('hex'));
    checks.push('route-reuse-and-full-hashed-manual');
    const capabilities=await call('scan_capabilities',{host:'codex',runtimeTools});
    assert(capabilities.capabilities.some(s=>s.name===runtimeTools[0].name&&s.availability?.callable!==false));
    assert(capabilities.capabilities.some(s=>s.server==='transfer_fixture'||s.id.includes('transfer_fixture')));
    assert.equal(capabilities.scanExecutesTools,false);
    const advice=await call('search_capabilities',{host:'codex',query:'Read project debugging logs.',routeId:route.routeId,runtimeTools});
    assert.equal(advice.routeId,route.routeId);assert(advice.candidates.some(s=>s.name===runtimeTools[0].name));
    checks.push('local-MCP-inventory-and-runtime-tool-advice');
    const fast=await call('route_task',{...common,query:'1+1',nativeSufficient:true,dryRun:true});
    assert.equal(fast.performance.mode,'fast');assert.equal(fast.performance.scannedSkills,false);assert.equal(fast.performance.scannedCapabilities,false);
    checks.push('native-fast-path');
    const recovery=await call('plan_recovery',{host:'codex',query:'Review code; a local dependency is unavailable.',routeId:route.routeId,recoveryContext:{blocked:true,networkAllowed:false}});
    assert.equal(recovery.routeId,route.routeId);assert(recovery.triggered);
    assert.equal(JSON.parse(fs.readFileSync(path.join(core,'config/task-methods.json'),'utf8')).methods.length,20);
    checks.push('recovery-and-20-method-cards');
    const recorded=await call('report_outcome',{host:'codex',contractVersion:4,taskType:'transfer-test',routeId:route.routeId,
      decisions:[{skillId:card.id,contentHash:card.contentHash,mode:'consult',shown:true,read:true,adopted:false,outcome:'unknown',
        evidence:[{kind:'validation',reference:'isolated transfer: full manual and hash read back',passed:true}]}]});
    assert(recorded.recorded);assert(fs.readFileSync(path.join(logs,'feedback-v4.jsonl'),'utf8').includes('transfer-test'));
    checks.push('private-feedback-without-invented-model');
  }finally{await client.close();}
  put(path.join(base,'result.json'),JSON.stringify({status:'PASS',version:ROUTER_VERSION,checks,scope:'Isolated stdio MCP process; not a second physical machine or an actual new Codex host session.'},null,2));
  console.log(JSON.stringify({status:'PASS',version:ROUTER_VERSION,checks,evidence:path.join(base,'result.json')}));
  // Keep the isolated evidence under ignored .runtime; no links or user data are deleted.
});
