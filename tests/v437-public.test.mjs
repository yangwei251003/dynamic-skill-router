import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {readFeedbackV4} from '../src/feedback-v4.mjs';
import {routeTaskV4} from '../src/advisor-v4.mjs';
import {ROUTER_VERSION} from '../src/version.mjs';

// A copy of the source runs under a unique temporary root. No real feedback
// path or user account is read or written by this test.
const candidate=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const model='fixture-model-id';
const skill='fixture-skill', contentHash='fixture-content-hash';
const decision={skillId:skill,contentHash,mode:'consult',shown:true,read:true,adopted:true,
  outcome:'helpful',evidence:[{kind:'validation',reference:'isolated-synthetic-check',passed:true}]};
const observation={contractVersion:4,host:'codex',taskType:'general',routeId:'fixture-task',
  modelId:model,routerVersion:'caller-claimed-version',observedAt:new Date().toISOString(),decisions:[decision]};
const context={host:'codex',taskType:'general',modelId:model,contentHashes:{[skill]:contentHash},mode:'consult'};

function sandbox() {
  const tempBase=fs.realpathSync(os.tmpdir());
  const dir=fs.mkdtempSync(path.join(tempBase,'router-outcome-v437-'));
  assert.equal(path.dirname(fs.realpathSync(dir)),tempBase);
  assert(path.basename(dir).startsWith('router-outcome-v437-'));
  const project=path.join(dir,'project'),src=path.join(project,'src');fs.mkdirSync(src,{recursive:true});
  const config=path.join(project,'config');fs.mkdirSync(config);fs.writeFileSync(path.join(config,'host-manifest.json'),JSON.stringify({hosts:{generic:{},codex:{}}}));
  const names=fs.readdirSync(path.join(candidate,'src')).filter(n=>n.endsWith('.mjs'));
  for(const name of names)fs.copyFileSync(path.join(candidate,'src',name),path.join(src,name));
  const dependencies=fs.realpathSync(path.join(candidate,'node_modules'));
  const link=path.join(project,'node_modules');fs.symlinkSync(dependencies,link,process.platform==='win32'?'junction':'dir');
  assert.equal(fs.realpathSync(link),dependencies);
  return {dir,project,src,names,link,log:path.join(dir,'private-logs','feedback-v4.jsonl')};
}
function cleanup(f) {
  const tempBase=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(fs.realpathSync(f.dir)),tempBase);
  assert(path.basename(f.dir).startsWith('router-outcome-v437-'));
  const logs=path.join(f.dir,'private-logs');
  if(fs.existsSync(logs)) {
    for(const name of fs.readdirSync(logs)) {
      assert(['feedback-v4.jsonl','feedback.jsonl','history-v4.jsonl'].includes(name));
      fs.unlinkSync(path.join(logs,name));
    }
    fs.rmdirSync(logs);
  }
  assert(fs.lstatSync(f.link).isSymbolicLink());fs.unlinkSync(f.link);
  for(const name of f.names)fs.unlinkSync(path.join(f.src,name));
  fs.rmdirSync(f.src);fs.unlinkSync(path.join(f.project,'config','host-manifest.json'));fs.rmdirSync(path.join(f.project,'config'));fs.rmdirSync(f.project);fs.rmdirSync(f.dir);
}
function invoke(f,record,...flags) {
  const child=spawnSync(process.execPath,[path.join(f.src,'cli.mjs'),'report-outcome',...flags],
    {input:JSON.stringify(record),encoding:'utf8',timeout:30000,env:{...process.env,CODEX_MODEL:'must-not-be-guessed',SKILL_ROUTER_LOG_ROOT:path.join(f.dir,'private-logs'),SKILL_ROUTER_DATA_ROOT:path.join(f.dir,'sample-data')}});
  assert.notEqual(child.status,null,child.stderr);assert(child.stdout.trim(),child.stderr);return {status:child.status,result:JSON.parse(child.stdout)};
}
function entries(f){return fs.readFileSync(f.log,'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));}
function samples(f,ctx=context){return readFeedbackV4(ctx,{},f.log).get(skill)?.samples||0;}

test('explicit V4 CLI and MCP record consistent outcomes without implicit model or unsafe promotion',async()=>{
  const f=sandbox();let client;
  try {
    // Dry-run and invalid records do not even create a log directory.
    const dry=invoke(f,observation,'--input-json','--dry-run');
    assert.equal(dry.status,0);assert.equal(dry.result.recorded,false);assert.equal(dry.result.wouldRecord,true);assert.equal(dry.result.routerVersion,ROUTER_VERSION);
    assert(!fs.existsSync(path.dirname(f.log)));
    const malformed=spawnSync(process.execPath,[path.join(f.src,'cli.mjs'),'report-outcome'],
      {input:'{"private":"fictional-sensitive-sentinel",',encoding:'utf8',timeout:30000});
    assert.equal(malformed.status,1);assert(!(`${malformed.stdout} ${malformed.stderr}`).includes('fictional-sensitive-sentinel'));
    assert(!fs.existsSync(path.dirname(f.log)));
    for(const bad of [{...observation,modelId:'   '},{...observation,host:'invalid-host'},
      {...observation,decisions:[{...decision,evidence:[{kind:'validation',reference:'',passed:true}]}]}]) {
      const r=invoke(f,bad);assert.equal(r.status,1);assert.equal(r.result.recorded,false);
      assert(!fs.existsSync(path.dirname(f.log)));
    }
    const noModel={...observation,routeId:'no-model'};delete noModel.modelId;
    const audit=invoke(f,noModel);assert.equal(audit.status,0);assert.equal(audit.result.modelIdentityPresent,false);
    assert(!('modelId' in entries(f)[0]));assert.equal(entries(f)[0].routerVersion,ROUTER_VERSION);assert.equal(samples(f),0);

    // Exactly one CLI observation is eligible; duplicates are not independent.
    const recorded=invoke(f,observation);assert.equal(recorded.status,0);assert.equal(recorded.result.recorded,true);
    assert.match(recorded.result.policy,/仅记录必要依据/);assert(!('query' in entries(f).at(-1)));
    assert.equal(recorded.result.routerVersion,ROUTER_VERSION);assert.equal(entries(f).at(-1).routerVersion,ROUTER_VERSION);
    assert.equal(samples(f),1);invoke(f,observation);assert.equal(samples(f),1);
    assert.equal(samples(f,{...context,modelId:'another-model'}),0);
    const expired={...observation,routeId:'expired',observedAt:new Date(Date.now()-100*86400000).toISOString()};
    const future={...observation,routeId:'future',observedAt:new Date(Date.now()+86400000).toISOString()};
    const selfOnly={...observation,routeId:'self-only',decisions:[{...decision,evidence:[{kind:'self',reference:'unverified-self-review'}]}]};
    for(const value of [expired,future,selfOnly])assert.equal(invoke(f,value).status,0);
    assert.equal(samples(f),1);assert.equal(readFeedbackV4(context,{},f.log).get(skill).adjustment,0);

    // A separate stdio MCP process uses the same copy and isolated log root.
    client=new Client({name:'isolated-outcome-check',version:'1.0.0'});
    const transport=new StdioClientTransport({command:process.execPath,args:[path.join(f.src,'mcp-server.mjs')],cwd:f.project,stderr:'pipe',env:{...process.env,SKILL_ROUTER_LOG_ROOT:path.join(f.dir,'private-logs'),SKILL_ROUTER_DATA_ROOT:path.join(f.dir,'sample-data')}});
    await client.connect(transport);
    const call=arguments_=>client.callTool({name:'report_outcome',arguments:arguments_});
    const mcp=await call(observation);assert(!mcp.isError,JSON.stringify(mcp));assert.equal(mcp.structuredContent.recorded,true);
    assert.equal(mcp.structuredContent.taskIdentityPresent,recorded.result.taskIdentityPresent);
    assert.equal(mcp.structuredContent.modelIdentityPresent,recorded.result.modelIdentityPresent);
    assert.equal(mcp.structuredContent.routerVersion,ROUTER_VERSION);assert.equal(entries(f).at(-1).routerVersion,ROUTER_VERSION);
    const rows=entries(f);const cliRow=rows.find(x=>x.routeId==='fixture-task');const mcpRow=rows.at(-1);
    const withoutTimestamp=({timestamp,...rest})=>rest;assert.deepEqual(withoutTimestamp(mcpRow),withoutTimestamp(cliRow));
    assert.equal(samples(f),1,'same task via MCP must not count twice');
    const beforeInvalid=fs.readFileSync(f.log,'utf8');
    for(const bad of [{...observation,modelId:'   '},{...observation,host:'invalid-host'}]) {
      let rejected=false;
      try {const r=await call(bad);rejected=Boolean(r.isError)||r.structuredContent?.recorded===false;}
      catch {rejected=true;}
      assert(rejected);assert.equal(fs.readFileSync(f.log,'utf8'),beforeInvalid);
    }
    const revoked=await call({...observation,revoked:true});assert.equal(revoked.structuredContent.recorded,true);assert.equal(samples(f),0);

    // Historical V4 records without a routerVersion remain readable.
    const historyPath=path.join(f.dir,'private-logs','history-v4.jsonl');
    const oldEntry={...observation,routeId:'historic-v4'};delete oldEntry.routerVersion;
    fs.writeFileSync(historyPath,JSON.stringify(oldEntry)+'\n');
    assert.equal(readFeedbackV4(context,{},historyPath).get(skill)?.samples,1);
    assert(!('routerVersion' in JSON.parse(fs.readFileSync(historyPath,'utf8'))));

    // Legacy MCP continues to use the existing V3 file; CLI entry is V4 only.
    const legacy=await call({query:'Synthetic legacy task',selectedIds:['fixture'],outcome:'helpful'});
    assert.equal(legacy.structuredContent.recorded,true);
    const legacyPath=path.join(f.dir,'private-logs','feedback.jsonl');assert.equal(JSON.parse(fs.readFileSync(legacyPath,'utf8')).contractVersion,3);
    const beforeV4=fs.readFileSync(f.log,'utf8');const badVersion=invoke(f,{contractVersion:3,query:'Synthetic legacy task',selectedIds:['fixture'],outcome:'helpful'});
    assert.equal(badVersion.status,1);assert.equal(fs.readFileSync(f.log,'utf8'),beforeV4);
  } finally {
    if(client)await client.close();
    cleanup(f);
  }
});


// Synthetic tool descriptions and tasks; no tool is executed.
test('a category-level image generation ban excludes mixed tools in both advice paths',()=>{
  const tools=[
    {name:'fixture__mixed',description:'Generate an image from text and edit existing images.',available:true},
    {name:'fixture__edit',description:'Edit existing images.',available:true},
  ];
  const capabilities=tools.map(x=>({id:'tool:'+x.name,kind:'tool',...x,enabled:true,callable:true,evidence:'runtime-tool'}));
  const query='不要调用图片生成工具，并请编辑上传的照片。';
  const result=routeTaskV4(query,{host:'codex',routingMode:'full',index:[],useFeedback:false,runtimeTools:tools,
    capabilityIndex:{revision:'synthetic',capabilities,coverage:{},errors:[]},
    taskContext:{capabilityRequests:[{toolNames:['fixture__mixed','fixture__edit'],evidenceRefs:['编辑上传的照片']}]}});
  assert(!result.capabilityCandidates.some(x=>x.name==='fixture__mixed'&&!['skip','defer'].includes(x.decision)));
  assert(!result.capabilityConsultations.some(x=>x.name==='fixture__mixed'&&x.decision==='consult'));
  assert(result.capabilityCandidates.some(x=>x.name==='fixture__edit'&&x.intentMatches?.includes('image-edit')));
  assert(result.capabilityCandidates.every(x=>x.invocation.automaticallyExecuted===false));
});

test('offline explanation retains its explicit network restriction',()=>{
  const r=routeTaskV4('请离线解释两种记账方法的区别。',{host:'codex',routingMode:'full',index:[],useFeedback:false,
    runtimeTools:[],capabilityIndex:{revision:'synthetic',capabilities:[],coverage:{},errors:[]}});
  assert.equal(r.taskConstraints.networkForbidden,true);
});

test('current monetary decision suggests search while supplied-only offline does not',()=>{
  const tool={name:'web__run',description:'Search the internet and open requested web pages.',available:true,annotations:{readOnlyHint:true}};
  const options={host:'codex',routingMode:'full',index:[],useFeedback:false,runtimeTools:[tool],
    capabilityIndex:{revision:'synthetic',capabilities:[{id:'tool:'+tool.name,kind:'tool',...tool,enabled:true,callable:true,evidence:'runtime-tool'}],coverage:{},errors:[]}};
  const hasSearch=r=>r.capabilityCandidates.some(x=>x.name===tool.name&&x.intentMatches?.includes('web-search')&&!['skip','defer'].includes(x.decision));
  assert(hasSearch(routeTaskV4('请核对示例地区央行本周利率决议。',options)));
  assert(!hasSearch(routeTaskV4('只根据提供的资料核对央行本周利率决议，禁止联网。',options)));
});
