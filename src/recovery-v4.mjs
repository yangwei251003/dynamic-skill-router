const list=x=>Array.isArray(x)?x:[];
const clean=x=>String(x||'').trim();

function searchPhrase(value) {
  // Public search receives a minimal technical need, never raw logs or local paths.
  return clean(value).replace(/(?:[A-Za-z]:[\\/]|\\\\)\S+/g,' ')
    .replace(/https?:\/\/\S+/gi,' ')
    .replace(/(?:bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/gi,' ')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,' ')
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,180);
}

/** Lightweight recovery policy: host executes discovery/install, never this module. */
export function planRecovery(assessment, options = {}) {
  const state=options.recoveryContext || {};
  const explicitRejection=/^(?:(?:这次|这个|这个结果|效果|结果|还是|仍然|你做的|做得)\s*)+(?:不行|不好|不满意|不对|太差)|^(?:this (?:result|output) is (?:bad|wrong)|still (?:wrong|broken))/i.test(assessment.activeText||'');
  const rejected=state.userRejected===true||explicitRejection;
  const low=state.confidence==='low';
  const repeated=Number(state.failedAttempts||0)>=2;
  const blocked=state.blocked===true;
  const triggered=rejected||low||blocked||repeated;
  if(!triggered)return {triggered:false,externalResearchRequired:false,reason:'native-sufficient-or-no-blocker',executor:'host-agent',automaticallyExecuted:false};
  const mandatoryResearch=rejected||low||repeated||(blocked&&state.confidence!=='high');
  const networkForbidden=state.networkAllowed===false||/不要联网|禁止联网|不得联网|离线完成|不允许联网|no network|offline only/i.test(assessment.rawText||assessment.activeText||'');
  const need=searchPhrase(state.capabilityNeed || options.taskContext?.domain || '');
  const names=[...list(options.runtimeTools).filter(x=>x?.available!==false).map(x=>x.name),...list(options.runtimeCapabilities?.tools)];
  const find=pattern=>names.find(x=>typeof x==='string'&&pattern.test(x))||null;
  const searchTools={web:find(/^(?:web__run)$|websearch|web_search|search_web|firecrawl_search/),marketplace:find(/plugin_management_search_plugins|search_plugins$/),repositories:find(/search_repositories|search_repos$/)};
  const steps=triggered?[
    {id:'diagnose',action:'State the failed acceptance condition and specific capability gap; inspect current evidence and reusable local tools.',required:true},
    {id:'research',action:networkForbidden?'Respect the no-network constraint; inspect local docs/tools and report the specific remaining gap.':'Search official documentation, exact technical symptoms, and relevant resources. User rejection or low confidence requires new external evidence, not another unsupported rewrite.',required:mandatoryResearch&&!networkForbidden},
    {id:'discover-tools',action:'If a tool can close the gap, search the host plugin directory and maintained open-source projects; compare a small shortlist against the actual task.',required:false,condition:'Missing capability remains or a candidate materially improves the result.'},
    {id:'install',action:'Use an existing tool first; otherwise install the smallest relevant, verified and compatible tool through the supported host/package mechanism, then confirm it is actually callable.',required:false,condition:'Candidate adds necessary capability and its setup cost is justified; host permissions and authentication requirements are satisfied.'},
    {id:'return-and-verify',action:'Return to the original task immediately, apply the capability, and verify against the previously failed acceptance condition. Remove or roll back ineffective task-local additions where appropriate.',required:true},
  ]:[];
  return {triggered,reason:rejected?'user-rejected':low?'low-confidence':repeated?'repeated-failure':blocked?'blocked':'native-sufficient-or-no-blocker',
    externalResearchRequired:mandatoryResearch&&!networkForbidden,networkForbidden,
    networkBlocker:mandatoryResearch&&networkForbidden?'External research is needed but current user/host restrictions prohibit it. Do not bypass them.':null,
    capabilityNeed:need||null,searchTools,
    searchQueries:triggered&&!networkForbidden&&need?[
      {channel:'web',query:`${need} official documentation troubleshooting`},
      {channel:'repositories',query:`${need} archived:false`,ranking:['task-fit','maintenance-and-releases','license-and-platform','verified-example','stars-as-secondary-signal']},
      {channel:'marketplace',query:need},
    ]:[],
    missingQueryInput:triggered&&!need?'Extract a concise non-sensitive technical capability need before searching; do not send the full task or logs.':null,
    steps,budget:{candidateShortlist:3,initialSearchBatches:1,initialSetupCandidates:1,repeatIdenticalFailure:false,
      continueWhen:'New evidence or a materially different candidate is likely to solve the remaining acceptance gap.',
      stopWhen:'Original acceptance criteria pass, or a concrete external dependency needs user action.'},
    installPolicy:{executor:'host-agent',automaticBusinessActions:false,
      require:['specific-task-benefit','verified-origin','compatible-host-and-runtime','license-suitable','minimal-scope','version-recorded','smoke-test-and-task-validation'],
      prefer:['already-installed','official-marketplace-or-maintainer','project-local-or-isolated-install','reversible-changes'],
      neverInfer:['star-count-means-quality','install-success-means-connected','OAuth-complete','payment-authorized','permission-escalation-authorized'],
      authorization:'Follow the user’s standing authorization for relevant routine installs. Do not ask again for already-authorized reversible work; comply with host controls, credentials, payment and connection requirements.'},
    executor:'host-agent',automaticallyExecuted:false};
}

export function useFastPath(assessment, options, recovery) {
  if(recovery.triggered||options.routingMode==='full')return false;
  const active=assessment.activeText||'';
  if(/\$[\w:-]+|app:\/\/|技能|插件|\bmcp\b|\bplugin\b|联网|网上|搜索|最新|\bsearch\b|\bbrowse\b/i.test(active))return false;
  if(assessment.complexDevelopment||options.taskContext?.complexity==='high')return false;
  if(options.nativeSufficient===true||options.routingMode==='fast')return true;
  return assessment.selfContainedFunction===true||/^(?:你好|您好|谢谢|早上好|hello|hi|thanks)[!！。.\s]*$/i.test(active)
    ||/^(?:计算|算一下|算算|what is)?\s*[\d\s+\-*/×÷().=]+[?？]?$/i.test(active);
}
