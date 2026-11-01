import {exactToolProhibited,webSearchToolProhibited,webSearchToolPurpose} from './request-evidence.mjs';

const channelOrder=['web','repositories','marketplace','remote','all'];
const searchIntents=new Set(['web-search','academic-search','image-search']);
const isSearchIntent=x=>searchIntents.has(x)||typeof x==='string'&&(x==='search'||x.endsWith('-search'));
const list=x=>Array.isArray(x)?x:[];

/** Host-supplied restrictions describe the current invocation, never grants. */
export function normalizeSearchRestrictions(input) {
  if(input===undefined)return null;
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Invalid invocationContext.searchRestrictions');
  if(Object.keys(input).some(k=>!['prohibitedChannels','prohibitedToolSearch'].includes(k)))throw new TypeError('Unknown invocationContext.searchRestrictions field');
  if(input.prohibitedChannels!==undefined&&(!Array.isArray(input.prohibitedChannels)||input.prohibitedChannels.length>5||input.prohibitedChannels.some(x=>!channelOrder.includes(x))))throw new TypeError('Invalid invocationContext.searchRestrictions.prohibitedChannels');
  if(input.prohibitedToolSearch!==undefined&&(!Array.isArray(input.prohibitedToolSearch)||input.prohibitedToolSearch.length>30||input.prohibitedToolSearch.some(x=>typeof x!=='string'||!x.trim()||x.length>200||x.trim()!==x)))throw new TypeError('Invalid invocationContext.searchRestrictions.prohibitedToolSearch');
  const prohibitedChannels=channelOrder.filter(x=>list(input.prohibitedChannels).includes(x));
  const prohibitedToolSearch=[...new Set(list(input.prohibitedToolSearch))].sort();
  return prohibitedChannels.length||prohibitedToolSearch.length?{prohibitedChannels,prohibitedToolSearch}:null;
}

function toolKind(tool,card) {
  const name=String(tool?.name||card?.name||''),description=String(tool?.description||card?.description||'');
  const intents=list(card?.intentMatches);
  const web=webSearchToolPurpose(description,name)||intents.includes('web-search');
  const repositories=/(?:search_repositories|search_repos)(?:$|_)/i.test(name);
  const marketplace=/(?:search_plugins|plugin_management_search_plugins)(?:$|_)/i.test(name);
  const namedSearch=/(?:^|[_-])search(?:$|[_-])/i.test(name);
  // This is only a declared purpose, not proof that a tool never uses the
  // network. The host still checks the exact tool and its actual effects.
  const declaredLocal=/(?:\b(?:local|offline|on[ -]device|filesystem)\b|本地|离线|磁盘)/i.test(description)
    &&!/(?:\b(?:internet|web|online|cloud|remote|https?)\b|互联网|网页|云端|在线|远程)/i.test(description)
    &&!web&&!repositories&&!marketplace;
  return {name,web,repositories,marketplace,namedSearch,declaredLocal};
}

/**
 * A multi-operation tool remains discoverable for a separately matched
 * permitted action, with an explicit gate. Uncertain tool behavior is deferred.
 * This is advisory metadata, not enforcement at the transport boundary.
 */
export function constrainSearchCapability(card,restrictions,tool={}) {
  if(!restrictions)return card;
  const channels=new Set(list(restrictions.prohibitedChannels));
  const info=toolKind(tool,card),specific=list(restrictions.prohibitedToolSearch).includes(info.name);
  const all=channels.has('all'),web=channels.has('web')&&info.web&&!info.repositories&&!info.marketplace;
  const repo=channels.has('repositories')&&info.repositories,market=channels.has('marketplace')&&info.marketplace;
  const intents=list(card.intentMatches);
  const hasSearch=intents.some(isSearchIntent)||info.namedSearch||info.web||info.repositories||info.marketplace;
  const remote=channels.has('remote')&&hasSearch&&!info.declaredLocal;
  if(!(specific||web||repo||market||remote||(all&&hasSearch))){
    if(channels.has('remote')&&hasSearch&&info.declaredLocal){
      const gates=[...new Set([...list(card.gates),'verify-search-effects-are-local'])];
      const invocation=card.invocation?{...card.invocation,argumentPolicy:'Do not perform remote search. Verify from the exact tool and actual effects that this search is local before using it.'}:card.invocation;
      return {...card,decision:card.decision==='use-now'?'check-scope':card.decision,gates,...(invocation?{invocation}:{}),
        reason:'The stated tool purpose is local search; verify that its actual effects stay local before use.'};
    }
    return card;
  }
  const forbiddenIntent=x=>isSearchIntent(x)&&(specific||all||repo||market||remote||(web&&searchIntents.has(x)));
  const remaining=intents.filter(x=>!forbiddenIntent(x));
  const removed=intents.some(forbiddenIntent);
  const allowedAction=remaining.some(x=>!isSearchIntent(x));
  let decision=card.decision;
  if(!allowedAction&&(removed||info.namedSearch))decision='skip';
  else if(!allowedAction&&!['skip','defer'].includes(decision))decision='defer';
  else if(decision==='use-now')decision='check-scope';
  const gates=[...new Set([...list(card.gates),'host-prohibits-search-use-only-permitted-action'])];
  const invocation=card.invocation?{...card.invocation,argumentPolicy:'Do not invoke the search action prohibited for this current invocation. Use only a separately permitted matched action, after checking the exact schema and user request.'}:card.invocation;
  const reason=decision==='skip'?'The matched search action is prohibited for this invocation.':removed?'Search is prohibited for this invocation; inspect the separately matched non-search action and exact authorization.':card.reason;
  return {...card,...(Array.isArray(card.intentMatches)?{intentMatches:remaining}:{}),...(removed?{suppressedIntentMatches:intents.filter(forbiddenIntent)}:{}),decision,gates,...(invocation?{invocation}:{}),reason,
    ...(decision==='skip'?{when:'当前阶段禁止已匹配的搜索动作'}:decision==='check-scope'?{when:'仅在确认具体非搜索动作已获授权时使用'}:{})};
}

/** Apply host search restrictions after source/network recovery constraints. */
export function constrainSearchRecovery(plan,constraints,assessment={},options={}) {
  const restrictions=constraints.searchRestrictions;
  if(!restrictions)return plan;
  const channels=new Set(restrictions.prohibitedChannels),tools=new Set(restrictions.prohibitedToolSearch);
  const all=channels.has('all'),blocked=channel=>all||channels.has(channel)||channels.has('remote');
  const searchTools={...plan.searchTools};
  if(plan.searchTools){
    for(const channel of ['web','repositories','marketplace'])if(blocked(channel)||tools.has(searchTools[channel]))searchTools[channel]=null;
    // If only one named web tool's search is prohibited, another currently
    // visible search tool can be named as a consultation, not as permission.
    if(!blocked('web')&&!constraints.networkForbidden&&!constraints.sourceScope&&plan.searchTools.web&&tools.has(plan.searchTools.web)) {
      const query=assessment.rawText??assessment.activeText??'';
      if(!webSearchToolProhibited(query)){
        const alternative=list(options.runtimeTools).find(t=>t?.available===true&&!tools.has(t.name)&&!exactToolProhibited(query,t.name)&&webSearchToolPurpose(t.description,t.name));
        if(alternative)searchTools.web=alternative.name;
      }
    }
  }
  const searchQueries=list(plan.searchQueries).filter(q=>!blocked(q.channel));
  const restrictionNotice='The host reports search restrictions for this invocation. This is restrictive metadata, not authorization; reassess the complete user request and retransmit restrictions on each stage.';
  const prohibition=all?'Do not search during this invocation. Inspect existing permitted evidence, or open an explicitly authorized source directly if network and source restrictions permit.'
    :channels.has('remote')?'Do not perform remote searches during this invocation. A local search requires verification that its actual effects are offline; an explicitly authorized URL may be opened if network and source restrictions permit.'
    :channels.has('web')?'Do not perform web search during this invocation. Consult already known authorized sources directly; other search channels require their own authorization and must satisfy the source scope.'
    :channels.size?'Do not search the prohibited channels. Other actions or channels require their own authorization and must satisfy the source scope.'
    :'Do not use the named prohibited tools for search. Their other operations and any alternative search tools require independent authorization and exact-schema checks.';
  const sourceNotice=blocked('web')?String(plan.sourceRestriction||'').replace(/before searching/gi,'before consulting'):plan.sourceRestriction;
  const bounded=sourceNotice?` ${sourceNotice}`:'';
  const steps=list(plan.steps).map(step=>{
    if(step.id==='research'&&!constraints.networkForbidden)return {...step,action:prohibition+bounded};
    if(step.id==='discover-tools'){
      if(constraints.networkForbidden&&!all)return step;
      return {...step,required:false,action:(all?'Inspect already available local tools without searching.':`${prohibition} Inspect already available tools first.`)+bounded};
    }
    return step;
  });
  return {...plan,...(plan.searchTools?{searchTools}:{}),...(plan.searchQueries?{searchQueries}:{}),
    ...(all?{externalResearchRequired:false,missingQueryInput:null}:{}),...(plan.steps?{steps}:{}),
    searchRestriction:{...restrictions,scope:'current-invocation',authority:'restriction-only',notice:restrictionNotice}};
}
