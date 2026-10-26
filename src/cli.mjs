#!/usr/bin/env node
import fs from 'node:fs';
import { routeTask, formatAgentContext, getSkillByAlias } from './router.mjs';
import { routeTaskV4, formatAgentContextV4, searchSkills, taskAssessment } from './advisor-v4.mjs';
import { discoverCapabilities, adviseCapabilities } from './capabilities-v4.mjs';
import {planRecovery} from './recovery-v4.mjs';
import { discoverSkills, resolveDiscoveredSkill, refreshIndex } from './discovery-v4.mjs';
import { loadRegistry, validateRegistry } from './registry.mjs';
import { ROUTER_VERSION } from './version.mjs';
import { planWorkItems } from './work-planner.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
const output = value => process.stdout.write(typeof value === 'string' ? value+'\n' : JSON.stringify(value,null,2)+'\n');
function parse(values) {
  const words=[],options={}; let contextMode=false,jsonInput=false;
  const strings={'--host':'host','--profile':'qualityProfile','--current-model':'currentModel','--project-root':'projectRoot','--route-id':'routeId','--source':'source','--domain':'domain','--phase':'phase','--output':'outputPath','--routing-mode':'routingMode'};
  const numbers={'--slots':'availableAgentSlots','--contract-version':'contractVersion','--limit':'limit'};
  for(let i=0;i<values.length;i++){
    const v=values[i];
    if(v==='--context') contextMode=true;
    else if(v==='--input-json') jsonInput=true;
    else if(v==='--native-sufficient') options.nativeSufficient=true;
    else if(v==='--dry-run') Object.assign(options,{dryRun:true,autoSync:false,writeLog:false});
    else if(v==='--no-feedback') options.useFeedback=false;
    else if(v==='--no-parallel') options.parallelAgents=false;
    else if(v==='--no-model-override') options.modelOverride=false;
    else if(v==='--models') options.availableModels=(values[++i]||'').split(',').filter(Boolean);
    else if(strings[v]||numbers[v]){
      const value=values[++i]; if(value===undefined) throw new Error('Missing value for '+v);
      options[strings[v]||numbers[v]]=numbers[v]?Number(value):value;
    } else if(v.startsWith('--')) throw new Error('Unknown option '+v);
    else words.push(v);
  }
  if(options.contractVersion!=null&&![3,4].includes(options.contractVersion)) throw new Error('contractVersion must be 3 or 4');
  return {query:words.join(' ').trim(),options,contextMode,jsonInput};
}
try {
  if(command==='plan-agents'){
    const input=JSON.parse(fs.readFileSync(args[0]||0,'utf8')); output(planWorkItems(input.workItems,input.options));
  }else if(['route','plan','search','resolve','list','health','coverage','refresh-index','capabilities','search-capabilities','recover'].includes(command)){
    const parsed=parse(args); let {query,options}=parsed;
    if(parsed.jsonInput){const envelope=JSON.parse(fs.readFileSync(0,'utf8'));query=envelope.query||query;options={...envelope.options,...options};}
    if(command==='recover'){
      query||=fs.readFileSync(0,'utf8').trim();if(!options.routeId)throw new Error('recover requires --route-id');
      output({routeId:options.routeId,...planRecovery({...taskAssessment(query,options.taskContext),rawText:query},options)});
    }else if(command==='capabilities'){
      output(discoverCapabilities(options));
    }else if(command==='search-capabilities'){
      query||=fs.readFileSync(0,'utf8').trim();if(!options.routeId)throw new Error('search-capabilities requires --route-id');
      output({routeId:options.routeId,...adviseCapabilities(taskAssessment(query,options.taskContext),options),recoveryPlan:planRecovery({...taskAssessment(query,options.taskContext),rawText:query},options)});
    }else if(command==='route'||command==='plan'){
      query||=fs.readFileSync(0,'utf8').trim(); const v4=options.contractVersion===4;
      const result=v4?routeTaskV4(query,options):routeTask(query,options);
      output(command==='plan'?result.coordination:parsed.contextMode?(v4?formatAgentContextV4(result):formatAgentContext(result)):result);
    }else if(command==='search'){
      query||=fs.readFileSync(0,'utf8').trim(); if(!options.routeId) throw new Error('search requires --route-id from the initial route');
      output(searchSkills(query,options));
    }else if(command==='coverage'){
      const index=discoverSkills(options); output({routerVersion:ROUTER_VERSION,revision:index.revision,count:index.skills.length,coverage:index.coverage,errors:index.errors});
    }else if(command==='refresh-index'){
      output(options.dryRun?discoverSkills(options):refreshIndex(options));
    }else if(command==='resolve'){
      if(options.contractVersion===4) output(resolveDiscoveredSkill(query,discoverSkills(options)));
      else {const skill=getSkillByAlias(query);output(skill?{id:skill.id,nameZh:skill.nameZh,path:skill.path,summaryZh:skill.summaryZh}:{found:false});}
    }else if(options.contractVersion===4){
      const index=discoverSkills(options);output(command==='list'?index.skills:{routerVersion:ROUTER_VERSION,contractVersion:4,revision:index.revision,count:index.skills.length,coverage:index.coverage,errors:index.errors,ok:index.errors.length===0});
    }else{
      const registry=loadRegistry();output(command==='list'?registry.skills.map(({id,nameZh,category,status,summaryZh,path})=>({id,nameZh,category,status,summaryZh,path})):{routerVersion:ROUTER_VERSION,schemaVersion:registry.schemaVersion,...validateRegistry(registry),router:'ok'});
    }
  }else output('skill-router route <任务或stdin> --contract-version 4 --host codex --context | search <任务或stdin> --route-id ID | capabilities | search-capabilities <任务或stdin> --route-id ID | coverage | refresh-index [--output PATH] | resolve NAME --contract-version 4 | list | health | plan-agents JSON。--input-json 从 stdin 读取 {query,options}。省略 contract-version 保留 V3。');
}catch(error){process.stderr.write('[dynamic-skill-router] '+error.message+'\n');output({ok:false,error:error.message,fallback:'Continue with native capabilities; routing failure does not authorize execution.'});process.exitCode=1;}

