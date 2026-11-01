import {inferUserConstraints,instructionText,instructionClauses} from './request-evidence.mjs';
const list=x=>Array.isArray(x)?x:[];
const modes=new Set(['plan','read','execute']);

// A ban on sharing a document is separate from permission to edit it. Only
// filter dedicated share operations: a mixed-purpose tool can still support a
// permitted operation, subject to the host's ordinary scope checks.
function prohibitedDocumentShare(query,tool) {
  const leaf=String(tool.name||'').split('__').at(-1).replace(/[_-]+/g,' ');
  if(!/\bshare\b/i.test(leaf)||/\b(?:create|update|edit|batch)\b/i.test(leaf))return false;
  if(!/(?:\b(?:file|files|document|documents|drive)\b|文档|文件)/i.test(`${leaf} ${tool.description||''}`))return false;
  const text=instructionText(query,{preserveNames:false}).replace(/https?:\/\/[^\s<>"“”。，！？；]+/giu,' ');
  const documentContext=/(?:文档|文件|资料|\b(?:docs?|documents?|files?)\b)/i.test(text);
  const clearDocumentContext=/(?:文档|文件|\b(?:docs?|documents?|files?)\b)/i.test(text);
  // An omitted object can refer to the current document when no other media
  // or object competes for that reference. Do not infer it from a generic
  // "don't share" in an unrelated or visibly ambiguous task.
  const otherObjectContext=/(?:图片|图像|照片|视频|音频|录音|头像|邮件|日历|日程|网页|网站|代码|\b(?:images?|photos?|videos?|audio|avatars?|emails?|calendars?|events?|websites?|code)\b)/iu.test(text);
  const otherShare=instructionClauses(text).some(clause=>{
    if(/^(?:以后|将来|未来|下次|日后|eventually\b|later\b|in future\b)/i.test(clause))return false;
    return clause.split(/(?:并请|然后请|同时请|\band please\b|\bthen please\b)/iu).some(part=>
      !/(?:不要|不得|禁止|请勿|\b(?:do not|don't|never)\b)/iu.test(part)
      &&/(?:分享|共享|\bshare\b)/iu.test(part)
      &&/(?:另(?:一|个|份)|其他|其它|\b(?:other|another)\b).{0,16}(?:文档|文件|资料|\b(?:documents?|files?)\b)/iu.test(part));
  });
  return instructionClauses(text).some(clause=>{
    if(/^(?:以后|将来|未来|下次|日后|eventually\b|later\b|in future\b)/i.test(clause))return false;
    const direct=clause.replace(/(?:不是|并非|不要|无需|不必|不需要|不)\s*(?:禁止|限制|阻止)/g,'')
      .replace(/\b(?:do not|don't|never)\s+(?:prohibit|forbid|restrict)\b/gi,'');
    const match=/(?<!不)(?<!不要)(?<!无需)(?<!不必)(?:不要|不得|禁止|不能|请勿|不准|严禁|无需|无须|不必|不需要|(?<![分识辨区判鉴])别|\b(?:do not|don't|never|without)\b)\s*([^。；;!?！？]{0,100})/iu.exec(direct);
    if(!match)return false;
    const before=direct.slice(0,match.index),body=match[1].split(/(?:并请|然后请|同时请|\band please\b|\bthen please\b)/iu)[0];
    if(/(?:以后|将来|未来|后续|下一步|届时|下次|日后)\s*(?:再|才|就|将|会|请)?\s*$/u.test(before)
      ||/(?:以后|将来|未来|后续|下一步|届时|下次|日后|\blater\b|\bin future\b)/iu.test(body))return false;
    if(!/(?:分享|共享|\bshar(?:e|ing)\b)/iu.test(body))return false;
    // A prohibition limited to someone else's or another file does not ban
    // a dedicated tool from sharing the separately authorized current file.
    if(/(?:其他人|他人|别人|其他用户|别的|其他|其它|另一个|另份|他的|她的).{0,12}(?:文档|文件|资料)|\b(?:other|another|someone else's)\b.{0,20}\b(?:documents?|files?)\b/iu.test(body))return false;
    if(otherShare&&!/(?:任何|所有|全部|一切|\b(?:any|all)\b)/iu.test(body))return false;
    return /(?:文档|文件|资料|\b(?:docs?|documents?|files?)\b)/iu.test(body)
      ||(documentContext&&/(?:它|这(?:个|份)|该|\b(?:it|this|that)\b)/iu.test(body))
      ||(clearDocumentContext&&!otherObjectContext&&/^\s*(?:(?:再|主动|自行|直接|实际|擅自|对外|公开|向任何人)\s*)*(?:分享|共享|\bshare\b)\s*(?:(?:出去|给(?:任何人|他人|别人|其他人)|对外|\b(?:externally|publicly|with anyone)\b)\s*)?$/iu.test(body.replace(/[.!?。！？]+$/u,'')));
  });
}

// A user may prohibit a particular action on an external object while still
// authorizing a different action. Calendar filtering is limited to dedicated
// event tools; mixed-purpose tools still require their normal scope checks.
export function prohibitedObjectOperation(query='',tool={}) {
  if(prohibitedDocumentShare(query,tool))return true;
  const name=String(tool.name||'');
  if(!/calendar|日历/i.test([name,tool.plugin,tool.server].join(' ')))return false;
  const leaf=name.split('__').at(-1).replace(/[_-]+/g,' ');
  if(!/\b(?:events?|appointments?)\b/i.test(leaf))return false;
  const actions=[
    [/\b(?:create|add|insert|schedule)\b/i,/(?:创建|新建|新增|添加|安排|生成|增删改)|\b(?:create|add|insert|schedule)\b/i],
    [/\b(?:delete|remove|cancel)\b/i,/(?:删除|删掉|移除|去掉|取消|增删改)|\b(?:delete|remove|cancel)\b/i],
    [/\b(?:update|edit|modify|change)\b/i,/(?:修改|更改|编辑|更新|改动|改写|调整|变更|改期|增删改)|\b(?:update|edit|modify|change)\b/i],
  ];
  const wanted=actions.filter(([toolAction])=>toolAction.test(leaf));
  if(!wanted.length)return false;
  const actionWord='(?:增删改|创建|新建|新增|添加|安排|生成|删除|删掉|移除|去掉|取消|修改|更改|编辑|更新|改动|改写|调整|变更|改期|\\b(?:create|add|insert|schedule|delete|remove|cancel|update|edit|modify|change)\\b)';
  const listJoin='(?:、|和|或|以及|及|与|\\band\\b|\\bor\\b)';
  // A comma inside a bare list of verbs continues the same negative scope.
  // Do not join clauses that include an object or an independent request.
  const commaList=new RegExp(`((?:不要|不得|禁止|不能|请勿|不准|不许|严禁|\\b(?:do not|don't|never|without)\\b)\\s*(?:(?:再|直接|自行|擅自)\\s*)?${actionWord}(?:\\s*${listJoin}\\s*${actionWord})*)\\s*[,，]\\s*((?:${listJoin}\\s*)?${actionWord})`,'giu');
  let text=instructionText(query,{preserveNames:false}).replace(/https?:\/\/[^\s<>"“”。，！？；]+/giu,' ');
  for(let previous;previous!==text;){previous=text;text=text.replace(commaList,'$1、$2');}
  return instructionClauses(text).some(clause=>{
    if(/^(?:以后|将来|未来|下次|日后|eventually\b|later\b|in future\b)/i.test(clause))return false;
    const direct=clause.replace(/(?:不要|别|请勿)\s*(?:忘(?:记)?|漏掉|遗漏)(?:了|要)?/g,'')
      .replace(/(?:不是|并非|不要|无需|不必|不需要|不)\s*(?:禁止|限制|阻止)/g,'')
      .replace(/\b(?:do not|don't|never)\s+(?:prohibit|forbid|restrict)\b/gi,'');
    const match=/(?<!不)(?<!不要)(?<!无需)(?<!不必)(?:不要|不得|禁止|不能|请勿|不准|不许|严禁|无需|无须|不必|不需要|(?<![分识辨区判鉴])别|\b(?:do not|don't|never|without)\b)\s*([^。；;!?！？]{0,100})/iu.exec(direct);
    if(!match)return false;
    if(/(?:以后|将来|未来|后续|下一步|届时|下次|日后)\s*(?:再|才|就|将|会|请)?\s*$/u.test(direct.slice(0,match.index)))return false;
    const body=match[1].split(/(?:并请|然后请|同时请|\band please\b|\bthen please\b)/iu)[0];
    // A restriction on somebody else's calendar is not a ban on a dedicated
    // event tool for the user's own calendar; the host must check the target.
    if(/(?:其他人|他人|别人|其他用户|他人的|别人的).{0,8}(?:日历|日程|事件|活动)|\b(?:other|another) (?:people'?s|users?'?|persons?'?)\b.{0,12}\b(?:calendar|events?)\b/i.test(body))return false;
    const object=/(?:日历|日程|行程).{0,16}?(?:事件|活动|日程|会议|安排)|(?:事件|活动|会议).{0,12}?(?:日历|日程)|\b(?:calendar|calendars?)\b.{0,25}?\b(?:events?|appointments?|meetings?)\b|\b(?:events?|appointments?)\b.{0,25}?\bcalendar\b/iu.exec(body);
    if(!object)return false;
    // Ignore an operation whose own distinct object precedes a different
    // calendar operation ("不要新增文件或删掉日历事件"). If a single
    // operation is shared by both objects, keep it for the calendar too.
    let prefix=body.slice(0,object.index);
    const foreignAction=new RegExp(`${actionWord}\\s*(?:(?:任何|所有|全部|本地|已有|现有|原有|旧的?|我的|the|existing|local)\\s*)*(?:文件|文档|报告|源码|代码|图片|邮件|\\b(?:files?|documents?|reports?|emails?)\\b)\\s*${listJoin}\\s*`,'giu');
    let foreign;
    while((foreign=foreignAction.exec(prefix))) {
      const tail=prefix.slice(foreign.index+foreign[0].length);
      if(new RegExp(actionWord,'iu').test(tail)){prefix=tail;foreignAction.lastIndex=0;}
    }
    // Stop at the first calendar object, except for attached post-object
    // verbs. A later independent "并请创建" is not part of "不要删除".
    const end=object.index+object[0].length,after=body.slice(end);
    const attached=new RegExp(`^\\s*(?:的|进行|予以)?\\s*${actionWord}(?:\\s*${listJoin}\\s*${actionWord})*`,'iu').exec(after)?.[0]||'';
    const scoped=prefix+object[0]+attached;
    return wanted.some(([,userAction])=>userAction.test(scoped));
  });
}
export function invocationConstraints(assessment={},options={}) {
  const c=options.invocationContext??{};
  if(!c||typeof c!=='object'||Array.isArray(c))throw new TypeError('invocationContext must be an object');
  if(c.mode!==undefined&&!modes.has(c.mode))throw new TypeError('Invalid invocationContext.mode');
  if(c.phase!==undefined&&!['auto','discovery','planning','design','implementation','validation','delivery'].includes(c.phase))throw new TypeError('Invalid invocationContext.phase');
  for(const key of ['readOnly','networkForbidden','preserveInputs'])if(c[key]!==undefined&&typeof c[key]!=='boolean')throw new TypeError('Invalid invocationContext.'+key);
  if(c.sourceScope!==undefined&&!['provided-only','specified-site-only'].includes(c.sourceScope))throw new TypeError('Invalid invocationContext.sourceScope');
  if(c.allowedActions!==undefined&&(!Array.isArray(c.allowedActions)||c.allowedActions.some(x=>typeof x!=='string')))throw new TypeError('allowedActions must be strings');
  const allowed=c.allowedActions===undefined?null:[...new Set(c.allowedActions)];
  const user=assessment.inferredConstraints||inferUserConstraints(assessment.rawText||assessment.activeText||'',assessment.activeText||'',assessment.activeClauses||[]);
  // Keep both independent restrictions. The legacy single field retains the
  // more restrictive supplied-source scope, while the array is the actual
  // intersection that the host must apply, independent of provenance order.
  const sourceScopes=['provided-only','specified-site-only'].filter(scope=>user.sourceScope===scope||c.sourceScope===scope);
  const sourceScopeIntersection=sourceScopes.length>1
    ?'Use only user-provided sources that also belong to the specified site. Check the original request and exact sources; if the intersection is empty or unclear, do not broaden it.'
    :null;
  return {mode:c.mode??null,readOnly:assessment.readOnly===true||user.readOnly===true||c.readOnly===true||c.mode==='plan'||c.mode==='read',networkForbidden:c.networkForbidden===true||options.recoveryContext?.networkAllowed===false||user.networkForbidden===true||(allowed!==null&&!allowed.includes('network')),allowedActions:allowed,...(sourceScopes.length?{sourceScope:sourceScopes[0],sourceScopes}:{}),...(sourceScopeIntersection?{sourceScopeIntersection}:{}),...((user.preserveInputs===true||c.preserveInputs===true)?{preserveInputs:true}:{}),authority:'restriction-only'};
}
export function constrainCapability(card,constraints,tool={}) {
  const gates=[...list(card.gates)],effect=card.effect??'unknown';let decision=card.decision;
  const restrict=next=>{decision=decision==='skip'||next==='skip'?'skip':decision==='defer'||next==='defer'?'defer':next;};
  const action=card.phase==='validation'?'verify':effect==='read'?'read':effect==='high-impact'?'commit':effect==='external-write'?'communicate':effect==='write-or-unknown'?'change':'unknown';
  if(constraints.readOnly&&effect!=='read'){restrict(effect==='unknown'?'defer':'skip');gates.push(effect==='unknown'?'read-effects-unverified':'read-only-scope');}
  if(constraints.allowedActions&&!constraints.allowedActions.includes(action)){restrict(action==='unknown'?'defer':'skip');gates.push('action-not-allowed-by-host');}
  if(constraints.networkForbidden&&tool.annotations?.openWorldHint!==false){restrict('defer');gates.push('network-forbidden-or-effects-unverified');}
  const scopes=new Set([...list(constraints.sourceScopes),constraints.sourceScope].filter(Boolean));
  if(scopes.has('provided-only')) {if(decision==='use-now')decision='check-scope';gates.push('use-only-user-provided-sources');}
  if(scopes.has('specified-site-only')) {if(decision==='use-now')decision='check-scope';gates.push('use-only-user-specified-site');}
  const intents=list(card.intentMatches),providedUrls=list(card.inputEvidence?.providedUrls);
  const providedOpenOnly=scopes.has('provided-only')&&intents.includes('web-open')&&!intents.includes('web-search');
  if(providedOpenOnly&&tool.annotations?.openWorldHint!==false) {
    if(providedUrls.length)gates.push('verify-open-url-is-user-provided-source');
    else {restrict('defer');gates.push('verify-required-user-provided-source-url');}
  }
  if(scopes.size&&!providedOpenOnly&&tool.annotations?.openWorldHint!==false
      &&(list(card.intentMatches).includes('web-search')||/\bsearch(?:_query)?\b|(?:^|_)search(?:_|$)/i.test(`${tool.name||card.name||''} ${tool.description||''}`))) {
    // A site-only search is actionable after the host bounds the query to the
    // verified site. A supplied-only restriction does not establish that any
    // search result is an allowed supplied source, so keep it deferred.
    if(scopes.has('provided-only'))restrict('defer');
    gates.push('verify-bounded-source-query-before-search');
  }
  if(scopes.has('provided-only')&&scopes.has('specified-site-only')) {
    if(tool.annotations?.openWorldHint!==false)restrict('defer');
    gates.push('verify-provided-source-and-specified-site-intersection');
  }
  if(constraints.preserveInputs) {if(decision==='use-now')decision='check-scope';gates.push('preserve-input-files');}
  if(card.decision==='skip')decision='skip';
  return {...card,decision,gates:[...new Set(gates)],taskConstraints:constraints};
}
export function constrainRecovery(plan,assessment,options={}) {
  const c=invocationConstraints(assessment,options),restricted=c.readOnly||(c.allowedActions&&!c.allowedActions.includes('install'));
  const scopes=new Set([...list(c.sourceScopes),c.sourceScope].filter(Boolean));
  const noExtraSources=scopes.has('provided-only');
  const siteOnly=scopes.has('specified-site-only');
  const intersection=noExtraSources&&siteOnly;
  if(!c.networkForbidden&&!restricted&&!noExtraSources&&!siteOnly)return {...plan,taskConstraints:c};
  const researchBlocked=c.networkForbidden||noExtraSources;
  const sourceRestricted=noExtraSources||siteOnly;
  const sourceRestriction=intersection
    ?'Use only user-provided sources that also belong to the specified site. Check the original request and exact sources; if the intersection is empty or unclear, do not broaden it.'
    :noExtraSources
    ?'Use only user-provided sources. If network use is otherwise permitted, an explicitly provided URL may still be opened; do not search for additional sources.'
    :'Use only the user-specified site as evidence. Confirm the site before searching; do not infer its domain from a brand name.';
  // A generic web query is not confined to the specified site. Leave query
  // construction to the host after it has established the permitted site.
  const boundedSearch=researchBlocked
    ?{networkForbidden:c.networkForbidden,externalResearchRequired:false,searchQueries:[],searchTools:{web:null,marketplace:null,repositories:null},networkBlocker:c.networkForbidden?'Current restrictions prohibit remote retrieval; use supplied/local evidence or report the missing input.':null,...(!c.networkForbidden&&noExtraSources?{sourceBlocker:sourceRestriction}:{}),missingQueryInput:intersection?'Check the original request and confirm which provided sources also belong to the specified site; do not search outside the intersection.':null}
    :siteOnly?{searchQueries:[],searchTools:{...plan.searchTools,marketplace:null,repositories:null},missingQueryInput:'Before searching, confirm the user-specified site and constrain the query to it; do not infer its domain.'}:{};
  return {...plan,taskConstraints:c,...boundedSearch,...(sourceRestricted?{sourceRestriction}:{}),
    steps:list(plan.steps).map(s=>{
      if(s.id==='install'&&restricted)return {...s,required:false,allowed:false,action:'Installation is outside the current restricted scope; report the gap without installing.'};
      if(s.id==='install'&&c.networkForbidden)return {...s,required:false,action:'If installation is authorized and necessary, use only already available local packages; do not access a network or remote registry.',networkAllowed:false};
      if(s.id==='install'&&sourceRestricted)return {...s,required:false,action:'Use existing tools first. Do not infer permission to install; any separately authorized installation must respect the source and network restrictions.',condition:'Installation is separately authorized, needed and consistent with the specified source and network scope.'};
      if(s.id==='research'&&intersection)return {...s,required:false,action:`${sourceRestriction}${c.networkForbidden?' Do not access the network.':''}`};
      if(s.id==='research'&&researchBlocked)return {...s,required:false,action:c.networkForbidden?'Use only permitted local evidence; do not access the network.':'Use only supplied evidence; an explicitly provided URL may be opened if network use is otherwise permitted.'};
      if(s.id==='research'&&siteOnly)return {...s,action:'Consult only the user-specified site; confirm its domain before searching and do not infer it from a brand name.'};
      if(s.id==='discover-tools'&&(researchBlocked||siteOnly))return {...s,required:false,action:'Inspect already available local tools; do not query unrestricted remote registries or sources.'};
      if(s.id==='return-and-verify'&&c.readOnly)return {...s,action:'Return to the original task using permitted read-only actions and verify the result without making changes.'};
      return s;
    }),
    installPolicy:{...plan.installPolicy,...(c.networkForbidden?{networkAllowed:false,networkRestriction:'Only already available local packages may be considered; no remote registry or download.'}:{}),...(sourceRestricted?{sourceRestriction:'Any separately authorized acquisition must comply with the user’s source and network scope; installed tools are preferred.'}:{}),...(restricted?{allowed:false,authorization:'Current user or host restrictions do not permit installation.'}:{})}};
}
