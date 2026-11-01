import {inferUserConstraints,instructionText,instructionClauses} from './request-evidence.mjs';
const list=x=>Array.isArray(x)?x:[];
const modes=new Set(['plan','read','execute']);

// A user may prohibit a particular action on an external object while still
// authorizing a local deliverable. Apply this only to dedicated calendar
// event tools; mixed-purpose tools still require their normal scope checks.
export function prohibitedObjectOperation(query='',tool={}) {
  const name=String(tool.name||'');
  if(!/calendar|日历/i.test([name,tool.plugin,tool.server].join(' ')))return false;
  const leaf=name.split('__').at(-1).replace(/[_-]+/g,' ');
  if(!/\b(?:events?|appointments?)\b/i.test(leaf))return false;
  const actions=[
    [/\b(?:create|add|insert|schedule)\b/i,/(?:创建|新建|新增|添加|安排|生成)|\b(?:create|add|insert|schedule)\b/i],
    [/\b(?:delete|remove|cancel)\b/i,/(?:删除|移除|取消)|\b(?:delete|remove|cancel)\b/i],
    [/\b(?:update|edit|modify|change)\b/i,/(?:修改|更改|编辑|更新|改动)|\b(?:update|edit|modify|change)\b/i],
  ];
  const wanted=actions.filter(([toolAction])=>toolAction.test(leaf));
  if(!wanted.length)return false;
  const text=instructionText(query,{preserveNames:false}).replace(/https?:\/\/[^\s<>"“”。，！？；]+/giu,' ');
  return instructionClauses(text).some(clause=>{
    if(/^(?:以后|将来|未来|下次|日后|eventually\b|later\b|in future\b)/i.test(clause))return false;
    const direct=clause.replace(/(?:不要|别|请勿)\s*(?:忘(?:记)?|漏掉|遗漏)(?:了|要)?/g,'')
      .replace(/(?:不是|并非|不要|无需|不必|不需要|不)\s*(?:禁止|限制|阻止)/g,'')
      .replace(/\b(?:do not|don't|never)\s+(?:prohibit|forbid|restrict)\b/gi,'');
    const match=/(?<!不)(?<!不要)(?<!无需)(?<!不必)(?:不要|不得|禁止|不能|请勿|不准|严禁|无需|无须|不必|不需要|(?<![分识辨区判鉴])别|\b(?:do not|don't|never|without)\b)\s*([^。；;!?！？]{0,100})/iu.exec(direct);
    if(!match)return false;
    if(/(?:以后|将来|未来|后续|下一步|届时|下次|日后)\s*(?:再|才|就|将|会|请)?\s*$/u.test(direct.slice(0,match.index)))return false;
    const body=match[1];
    // A restriction on somebody else's calendar is not a ban on a dedicated
    // event tool for the user's own calendar; the host must check the target.
    if(/(?:其他人|他人|别人|其他用户|他人的|别人的).{0,8}(?:日历|日程|事件|活动)|\b(?:other|another) (?:people'?s|users?'?|persons?'?)\b.{0,12}\b(?:calendar|events?)\b/i.test(body))return false;
    const object=/(?:日历|日程|行程).{0,16}?(?:事件|活动|日程|会议|安排)|(?:事件|活动|会议).{0,12}?(?:日历|日程)|\b(?:calendar|calendars?)\b.{0,25}?\b(?:events?|appointments?|meetings?)\b|\b(?:events?|appointments?)\b.{0,25}?\bcalendar\b/iu.exec(body);
    if(!object)return false;
    // Stop at the first object, except for a directly attached post-object
    // verb. A later independent "并请创建" is not part of "不要删除".
    const end=object.index+object[0].length,after=body.slice(end);
    const attached=/^\s*(?:的|进行|予以)?\s*(?:创建|新建|新增|添加|安排|生成|删除|移除|取消|修改|更改|编辑|更新|改动)/u.exec(after)?.[0]||'';
    const scoped=body.slice(0,end)+attached;
    return wanted.some(([,userAction])=>userAction.test(scoped));
  });
}
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
