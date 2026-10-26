import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {ROUTER_ROOT} from '../src/paths.mjs';
const client=new Client({name:'capabilities-mcp-test',version:'1.0.0'});
const runtimeTools=[{name:'mcp__fixture__get_project_logs',description:'Read fixture project debugging logs',annotations:{readOnlyHint:true}}];
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROUTER_ROOT,'src/mcp-server.mjs')],stderr:'pipe'}));
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return r.structuredContent;};
 const tools=await client.listTools();
 assert(tools.tools.find(x=>x.name==='scan_capabilities').annotations.readOnlyHint);
 const scan=await call('scan_capabilities',{host:'codex',runtimeTools,kind:'tool',limit:1});
 assert.equal(scan.count,1);assert.equal(scan.capabilities[0].name,runtimeTools[0].name);assert.equal(scan.scanExecutesTools,false);
 const route=await call('route_task',{query:'检查 fixture project debugging logs',host:'codex',contractVersion:4,runtimeTools});
 assert(route.capabilityCandidates.some(x=>x.name===runtimeTools[0].name));
 const result=await call('search_capabilities',{query:'检查 fixture project debugging logs',routeId:route.routeId,host:'codex',runtimeTools,phase:'validation'});
 assert.equal(result.routeId,route.routeId);assert.equal(result.candidates[0].invocation.tool,runtimeTools[0].name);
 assert.equal(result.candidates[0].decision,'use-now');
 const refreshed=await call('scan_capabilities',{host:'codex',runtimeTools:[],kind:'tool'});
 assert.equal(refreshed.count,0,'no persistent runtime state');
 const invalid=await client.callTool({name:'search_capabilities',arguments:{query:'read logs',host:'codex'}});assert(invalid.isError);
 console.log(JSON.stringify({ok:true,toolsListed:true,scan:true,routeIntegration:true,phaseSearch:true,routeIdReused:true,runtimeNotPersisted:true,missingRouteIdRejected:true}));
}finally{await client.close();}
