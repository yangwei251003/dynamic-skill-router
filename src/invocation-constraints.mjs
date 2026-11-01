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
  const sourceRestricted=noExtraSources||siteOnly;
  const sourceRestriction=noExtraSources
    ?'Use only user-provided sources. If network use is otherwise permitted, an explicitly provided URL may still be opened; do not search for additional sources.'
    :'Use only the user-specified site as evidence. Confirm the site before searching; do not infer its domain from a brand name.';
  // A generic web query is not confined to the specified site. Leave query
  // construction to the host after it has established the permitted site.
  const boundedSearch=researchBlocked
    ?{networkForbidden:c.networkForbidden,externalResearchRequired:false,searchQueries:[],searchTools:{web:null,marketplace:null,repositories:null},networkBlocker:c.networkForbidden?'Current restrictions prohibit remote retrieval; use supplied/local evidence or report the missing input.':null,...(!c.networkForbidden&&noExtraSources?{sourceBlocker:sourceRestriction}:{}),missingQueryInput:null}
    :siteOnly?{searchQueries:[],searchTools:{...plan.searchTools,marketplace:null,repositories:null},missingQueryInput:'Before searching, confirm the user-specified site and constrain the query to it; do not infer its domain.'}:{};
  return {...plan,taskConstraints:c,...boundedSearch,...(sourceRestricted?{sourceRestriction}:{}),
    steps:list(plan.steps).map(s=>{
      if(s.id==='install'&&restricted)return {...s,required:false,allowed:false,action:'Installation is outside the current restricted scope; report the gap without installing.'};
      if(s.id==='install'&&c.networkForbidden)return {...s,required:false,action:'If installation is authorized and necessary, use only already available local packages; do not access a network or remote registry.',networkAllowed:false};
      if(s.id==='install'&&sourceRestricted)return {...s,required:false,action:'Use existing tools first. Do not infer permission to install; any separately authorized installation must respect the source and network restrictions.',condition:'Installation is separately authorized, needed and consistent with the specified source and network scope.'};
      if(s.id==='research'&&researchBlocked)return {...s,required:false,action:c.networkForbidden?'Use only permitted local evidence; do not access the network.':'Use only supplied evidence; an explicitly provided URL may be opened if network use is otherwise permitted.'};
      if(s.id==='research'&&siteOnly)return {...s,action:'Consult only the user-specified site; confirm its domain before searching and do not infer it from a brand name.'};
      if(s.id==='discover-tools'&&(researchBlocked||siteOnly))return {...s,required:false,action:'Inspect already available local tools; do not query unrestricted remote registries or sources.'};
      if(s.id==='return-and-verify'&&c.readOnly)return {...s,action:'Return to the original task using permitted read-only actions and verify the result without making changes.'};
      return s;
    }),
    installPolicy:{...plan.installPolicy,...(c.networkForbidden?{networkAllowed:false,networkRestriction:'Only already available local packages may be considered; no remote registry or download.'}:{}),...(sourceRestricted?{sourceRestriction:'Any separately authorized acquisition must comply with the user’s source and network scope; installed tools are preferred.'}:{}),...(restricted?{allowed:false,authorization:'Current user or host restrictions do not permit installation.'}:{})}};
}
