import {inferUserConstraints} from './request-evidence.mjs';
const list=x=>Array.isArray(x)?x:[];
const modes=new Set(['plan','read','execute']);
export function invocationConstraints(assessment={},options={}) {
  const c=options.invocationContext??{};
  if(!c||typeof c!=='object'||Array.isArray(c))throw new TypeError('invocationContext must be an object');
  if(c.mode!==undefined&&!modes.has(c.mode))throw new TypeError('Invalid invocationContext.mode');
  if(c.phase!==undefined&&!['auto','discovery','planning','design','implementation','validation','delivery'].includes(c.phase))throw new TypeError('Invalid invocationContext.phase');
  for(const key of ['readOnly','networkForbidden'])if(c[key]!==undefined&&typeof c[key]!=='boolean')throw new TypeError('Invalid invocationContext.'+key);
  if(c.allowedActions!==undefined&&(!Array.isArray(c.allowedActions)||c.allowedActions.some(x=>typeof x!=='string')))throw new TypeError('allowedActions must be strings');
  const allowed=c.allowedActions===undefined?null:[...new Set(c.allowedActions)];
  const user=assessment.inferredConstraints||inferUserConstraints(assessment.rawText||assessment.activeText||'',assessment.activeText||'',assessment.activeClauses||[]);
  return {mode:c.mode??null,readOnly:assessment.readOnly===true||user.readOnly===true||c.readOnly===true||c.mode==='plan'||c.mode==='read',networkForbidden:c.networkForbidden===true||options.recoveryContext?.networkAllowed===false||user.networkForbidden===true,allowedActions:allowed,...(user.sourceScope?{sourceScope:user.sourceScope}:{}),...(user.preserveInputs?{preserveInputs:true}:{}),authority:'restriction-only'};
}
export function constrainCapability(card,constraints,tool={}) {
  const gates=[...list(card.gates)],effect=card.effect??'unknown';let decision=card.decision;
  const restrict=next=>{decision=decision==='skip'||next==='skip'?'skip':decision==='defer'||next==='defer'?'defer':next;};
  const action=card.phase==='validation'?'verify':effect==='read'?'read':effect==='high-impact'?'commit':effect==='external-write'?'communicate':effect==='write-or-unknown'?'change':'unknown';
  if(constraints.readOnly&&effect!=='read'){restrict(effect==='unknown'?'defer':'skip');gates.push(effect==='unknown'?'read-effects-unverified':'read-only-scope');}
  if(constraints.allowedActions&&!constraints.allowedActions.includes(action)){restrict(action==='unknown'?'defer':'skip');gates.push('action-not-allowed-by-host');}
  if(constraints.networkForbidden&&tool.annotations?.openWorldHint!==false){restrict('defer');gates.push('network-forbidden-or-effects-unverified');}
  if(constraints.sourceScope==='provided-only') {if(decision==='use-now')decision='check-scope';gates.push('use-only-user-provided-sources');}
  if(constraints.sourceScope==='specified-site-only') {if(decision==='use-now')decision='check-scope';gates.push('use-only-user-specified-site');}
  if(constraints.preserveInputs) {if(decision==='use-now')decision='check-scope';gates.push('preserve-input-files');}
  if(card.decision==='skip')decision='skip';
  return {...card,decision,gates:[...new Set(gates)],taskConstraints:constraints};
}
export function constrainRecovery(plan,assessment,options={}) {
  const c=invocationConstraints(assessment,options),restricted=c.readOnly||(c.allowedActions&&!c.allowedActions.includes('install'));
  const noExtraSources=c.sourceScope==='provided-only';
  const siteOnly=c.sourceScope==='specified-site-only';
  if(!c.networkForbidden&&!restricted&&!noExtraSources&&!siteOnly)return {...plan,taskConstraints:c};
  const researchBlocked=c.networkForbidden||noExtraSources;
  return {...plan,taskConstraints:c,...(researchBlocked?{networkForbidden:c.networkForbidden,externalResearchRequired:false,searchQueries:[],searchTools:{web:null,marketplace:null,repositories:null},networkBlocker:c.networkForbidden?'Current restrictions prohibit remote retrieval; use supplied/local evidence or report the missing input.':'Use only the user-provided sources; a provided URL may still be opened if network use is otherwise permitted.'}:siteOnly?{searchQueries:list(plan.searchQueries).filter(q=>q.channel==='web'),searchTools:{...plan.searchTools,marketplace:null,repositories:null},sourceRestriction:'Use only the user-specified site as evidence; do not infer its domain from a brand name.'}:{}),
    steps:list(plan.steps).map(s=>s.id==='install'&&restricted?{...s,required:false,allowed:false,action:'Installation is outside the current restricted scope; report the gap without installing.'}:s.id==='install'&&c.networkForbidden?{...s,required:false,action:'If installation is authorized and necessary, use only already available local packages; do not access a network or remote registry.',networkAllowed:false}:s.id==='research'&&researchBlocked?{...s,required:false,action:'Use only permitted supplied/local evidence; do not fetch additional sources.'}:s.id==='discover-tools'&&researchBlocked?{...s,required:false,action:'Inspect already available local tools only; do not query remote registries.'}:s),
    installPolicy:{...plan.installPolicy,...(c.networkForbidden?{networkAllowed:false,networkRestriction:'Only already available local packages may be considered; no remote registry or download.'}:{}),...(restricted?{allowed:false,authorization:'Current host restrictions do not permit installation.'}:{})}};
}
