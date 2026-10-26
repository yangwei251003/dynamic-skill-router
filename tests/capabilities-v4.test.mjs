import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {discoverCapabilities,adviseCapabilities} from '../src/capabilities-v4.mjs';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'capability-router-'));
const configPath=path.join(root,'config.toml'), pluginCacheRoot=path.join(root,'cache');
const config=`[mcp_servers.repo]\ncommand="must-not-run"\nargs=["TOKEN_SHOULD_NOT_LEAK"]\nenabled_tools=["get_issue", "send_message", "execute_query", "deploy_project", "get_status"]\n[mcp_servers.repo.env]\nSECRET="TOP_SECRET"\n[mcp_servers.disabled]\nenabled=false\nurl="https://TOKEN_SHOULD_NOT_LEAK.invalid"\n[plugins."design@local"]\nenabled=true\n[plugins."disabled@local"]\nenabled=false\n[plugins."ambiguous@local"]\nenabled=true\n`;
fs.writeFileSync(configPath,config);
function manifest(name,version,value={}){const dir=path.join(pluginCacheRoot,'local',name,version);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({name,version,description:'Figma design file tools',...value}));return dir;}
const design=manifest('design','1.0.0');
fs.writeFileSync(path.join(design,'mcp.json'),JSON.stringify({mcpServers:{design:{command:'must-not-run',env:{SECRET:'SECRET_PLUGIN'}}}}));
manifest('disabled','1.0.0');manifest('ambiguous','1.0.0');manifest('ambiguous','2.0.0');
const tools=[
 {name:'mcp__repo__get_issue',description:'Read GitHub repository issue details',annotations:{readOnlyHint:true}},
 {name:'mcp__repo__send_message',description:'Send GitHub repository issue message',annotations:{readOnlyHint:true}},
 {name:'mcp__repo__execute_query',description:'Execute database SQL query',annotations:{readOnlyHint:true}},
 {name:'mcp__repo__deploy_project',description:'Deploy GitHub repository website project',annotations:{destructiveHint:true}},
 {name:'mcp__repo__get_status',description:'Read GitHub repository deployment status',annotations:{readOnlyHint:true}},
 {name:'mcp__repo__delete_issue',description:'Delete GitHub repository issue',annotations:{destructiveHint:true}},
 {name:'mcp__disabled__get_data',description:'Read database schema',annotations:{readOnlyHint:true}},
 {name:'mcp__design__get_design',description:'Read Figma design file for implementation',plugin:'design',annotations:{readOnlyHint:true}},
];
const options={host:'codex',configPath,pluginCacheRoot,runtimeTools:tools};
const advice=(query,extra={})=>adviseCapabilities(taskAssessment(query),{...options,...extra,capabilityLimit:10});

test('configuration discovery is read-only, does not expose secrets, and never claims connected',()=>{
 const scan=discoverCapabilities({...options,runtimeTools:[]});
 assert.equal(fs.readFileSync(configPath,'utf8'),config);
 assert(scan.capabilities.some(x=>x.kind==='mcp'&&x.name==='repo'));
 assert(scan.capabilities.some(x=>x.kind==='plugin'&&x.name==='design'));
 assert(scan.capabilities.some(x=>x.id==='plugin-mcp:design@local:design'));
 assert(scan.capabilities.every(x=>!x.callable));
 assert(!/TOP_SECRET|TOKEN_SHOULD_NOT_LEAK|SECRET_PLUGIN|must-not-run/.test(JSON.stringify(scan)));
 assert.equal(scan.capabilities.find(x=>x.id==='plugin:ambiguous@local').manifestStatus,'ambiguous-version');
});
test('runtime tools honor disabled servers and allowlists',()=>{
 const scan=discoverCapabilities(options);
 assert(scan.capabilities.find(x=>x.name==='mcp__repo__get_issue').callable);
 assert(!scan.capabilities.find(x=>x.name==='mcp__disabled__get_data').callable);
 assert(!scan.capabilities.find(x=>x.name==='mcp__repo__delete_issue').callable);
 assert(scan.capabilities.find(x=>x.id==='plugin:design@local').callable);
 const missing=discoverCapabilities({...options,runtimeTools:[]});
 assert(!missing.capabilities.some(x=>x.kind==='tool'),'runtime is never persisted across requests');
});
test('specific read tools are suggested now; native arithmetic does not recruit tools',()=>{
 const result=advice('读取 GitHub 仓库 issue 详情');
 assert.equal(result.candidates.find(x=>x.name==='mcp__repo__get_issue')?.decision,'use-now');
 assert.equal(result.candidates.find(x=>x.name==='mcp__repo__send_message')?.decision,'defer');
 assert.equal(advice('计算 2+2').candidates.length,0);
 assert(result.candidates.every(x=>x.invocation.automaticallyExecuted===false));
});
test('delivery nouns and future actions do not authorize delivery',()=>{
 for(const query of ['检查 GitHub 仓库 deployment status','开发 GitHub 仓库网站，以后部署','读取 GitHub 仓库 issue。不要发送消息']) {
  const result=advice(query);
  for(const card of result.candidates.filter(x=>x.effect==='high-impact'||x.effect==='external-write')) assert(['defer','skip'].includes(card.decision),query+JSON.stringify(card));
 }
 assert.equal(advice('部署 GitHub 仓库网站').candidates.find(x=>x.name==='mcp__repo__deploy_project')?.decision,'check-scope');
});
test('read-only task wins over misleading readOnlyHint on execution tools',()=>{
 const card=advice('只读检查 database SQL query').candidates.find(x=>x.name==='mcp__repo__execute_query');
 assert(card);assert.equal(card.decision,'skip');
});
test('explicit plugin selection requires tool selection rather than invoking all provider tools',()=>{
 const result=advice('使用 design 插件');
 assert(result.candidates.some(x=>x.kind==='plugin'&&x.decision==='discover-first'));
 assert(!result.candidates.some(x=>x.kind==='tool'));
});
test('route_task includes compact actionable capabilities without changing skill routing',()=>{
 const route=routeTaskV4('读取 GitHub 仓库 issue 详情',{...options,index:[],routeId:'stable',responseDetail:'compact'});
 assert.equal(route.routeId,'stable');assert.deepEqual(route.consultCandidates,[]);
 assert(route.capabilityCandidates.some(x=>x.invocation.tool==='mcp__repo__get_issue'));
 assert(!JSON.stringify(route).includes('TOP_SECRET'));
});
test('malformed config fails closed without leaking parser source',()=>{
 const invalid=path.join(root,'invalid.toml');fs.writeFileSync(invalid,'SECRET="TOP_SECRET\n');
 const result=discoverCapabilities({...options,configPath:invalid});
 assert(result.errors.includes('codex-config-unreadable-or-invalid'));
 assert(!JSON.stringify(result).includes('TOP_SECRET'));
});
