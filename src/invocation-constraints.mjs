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
  return {mode:c.mode??null,readOnly:assessment.readOnly===true||c.readOnly===true||c.mode==='plan'||c.mode==='read',networkForbidden:c.networkForbidden===true||options.recoveryContext?.networkAllowed===false||/不要联网|禁止联网|不得联网|离线完成|不允许联网|no network|offline only/i.test(assessment.rawText||assessment.activeText||''),allowedActions:allowed,authority:'restriction-only'};
}
export function constrainCapability(card,constraints,tool={}) {
  const gates=[...list(card.gates)],effect=card.effect??'unknown';let decision=card.decision;
  const restrict=next=>{decision=decision==='skip'||next==='skip'?'skip':decision==='defer'||next==='defer'?'defer':next;};
  const action=card.phase==='validation'?'verify':effect==='read'?'read':effect==='high-impact'?'commit':effect==='external-write'?'communicate':effect==='write-or-unknown'?'change':'unknown';
  if(constraints.readOnly&&effect!=='read'){restrict(effect==='unknown'?'defer':'skip');gates.push(effect==='unknown'?'read-effects-unverified':'read-only-scope');}
  if(constraints.allowedActions&&!constraints.allowedActions.includes(action)){restrict(action==='unknown'?'defer':'skip');gates.push('action-not-allowed-by-host');}
  if(constraints.networkForbidden&&tool.annotations?.openWorldHint!==false){restrict('defer');gates.push('network-forbidden-or-effects-unverified');}
  if(card.decision==='skip')decision='skip';
  return {...card,decision,gates:[...new Set(gates)],taskConstraints:constraints};
}
export function constrainRecovery(plan,assessment,options={}) {
  const c=invocationConstraints(assessment,options),restricted=c.readOnly||(c.allowedActions&&!c.allowedActions.includes('install'));
  if(!c.networkForbidden&&!restricted)return {...plan,taskConstraints:c};
  return {...plan,taskConstraints:c,...(c.networkForbidden?{networkForbidden:true,externalResearchRequired:false,searchQueries:[],searchTools:{web:null,marketplace:null,repositories:null},networkBlocker:'Current restrictions prohibit remote retrieval; use supplied/local evidence or report the missing input.'}:{}),
    steps:list(plan.steps).map(s=>s.id==='install'&&restricted?{...s,required:false,allowed:false,action:'Installation is outside the current restricted scope; report the gap without installing.'}:s.id==='research'&&c.networkForbidden?{...s,required:false,action:'Use supplied/local evidence only; do not fetch remote sources.'}:s.id==='discover-tools'&&c.networkForbidden?{...s,required:false,action:'Inspect already available local tools only; do not query remote registries.'}:s),
    installPolicy:{...plan.installPolicy,...(restricted?{allowed:false,authorization:'Current host restrictions do not permit installation.'}:{})}};
}
