import assert from 'node:assert/strict';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {ROUTER_ROOT} from '../src/paths.mjs';
const client=new Client({name:'recovery-mcp-test',version:'1.0.0'});
try{
 const start=performance.now();await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROUTER_ROOT,'src/mcp-server.mjs')],stderr:'pipe'}));
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return r.structuredContent;};
 const result=await call('route_task',{query:'计算 2+2',host:'codex',contractVersion:4});
 assert.equal(result.performance.mode,'fast');const coldMs=performance.now()-start;
 const plan=await call('plan_recovery',{query:'修复 PDF 中文字体',routeId:result.routeId,recoveryContext:{confidence:'low',userRejected:true,capabilityNeed:'PDF Chinese font rendering'},runtimeTools:[{name:'web__run'},{name:'mcp__catalog__search_plugins'}]});
 assert.equal(plan.routeId,result.routeId);assert(plan.externalResearchRequired);assert.equal(plan.searchTools.web,'web__run');
 assert.equal(plan.searchTools.marketplace,'mcp__catalog__search_plugins');assert(!plan.automaticallyExecuted);
 const bad=await client.callTool({name:'plan_recovery',arguments:{query:'fix'}});assert(bad.isError);
 console.log(JSON.stringify({ok:true,fastRoute:true,roundTripAndStartupMs:coldMs,recoveryPlan:true,reusesRouteId:true,actualToolsOnly:true,missingRouteIdRejected:true}));
}finally{await client.close();}
