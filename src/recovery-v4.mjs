import {requestedName} from './request-entities.mjs';
import {closedSuppliedTransformation} from './native-closure.mjs';
import {positiveRequestPrefix,currentWorkClauses} from './task-restrictions.mjs';
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
  const networkForbidden=state.networkAllowed===false||assessment.restrictions?.networkForbidden===true||/不要联网|禁止联网|不得联网|离线完成|不允许联网|no network|offline only/i.test(assessment.rawText||assessment.activeText||'');
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

const NATIVE_LANGUAGES = new Set(['python','node','nodejs','javascript','typescript','powershell','shell','bash','html','css']);
const REWRITE_ACTION=/改写|润色|精简|缩写|换一种说法|(?:改|写|说)(?:得|成|为)\s*(?:更|较|再|稍(?:微)?)?\s*(?:简洁|简短|简练|精炼|通顺|自然|流畅|清晰)|\b(?:rewrite|rephrase|shorten|paraphrase)\b/i;
const SUBSTITUTION_ACTION=/改成|改为|替换(?:成|为)?|换成|换为|\b(?:replace|change)\b/i;
const REWRITE_RESULT=/(?:改|写|说)(?:得|成|为)\s*(?:更|较|再|稍(?:微)?)?\s*(?:简洁|简短|简练|精炼|通顺|自然|流畅|清晰)/i;

function requestsNamedCapability(assessment, options) {
  const active=assessment.activeText||'';
  const clauses=list(assessment.activeClauses).length?assessment.activeClauses:[active];
  // Never invoke a lazy catalogue getter merely to decide whether to skip it.
  const suppliedIndex=Object.getOwnPropertyDescriptor(options,'index')?.value;
  const index=Array.isArray(suppliedIndex)?suppliedIndex:list(suppliedIndex?.skills);
  const registered=new Set([...index,...list(options.runtimeSkills),...list(options.runtimeTools)]
    .flatMap(x=>[x.id,x.name,x.nameZh,...list(x.aliases)]).filter(x=>typeof x==='string')
    .flatMap(x=>[x.toLowerCase(),x.toLowerCase().split(/__|:/).at(-1)]));
  // Examine the governed phrase, not a finite list of permitted modifiers.
  // “use the locally supplied ... NAME” and “使用内置的 ... NAME” preserve NAME.
  for(const name of registered)if(name&&!NATIVE_LANGUAGES.has(name)&&requestedName(clauses,name))return true;
  const phrases=[...active.matchAll(/(?:使用|调用|启用|采用|借助|用|\b(?:apply|use|invoke|enable)\b)\s*([^，。；;\n]{1,100})/gi)].map(x=>x[1]);
  for(const phrase of phrases){
    const identifiers=phrase.match(/[a-z][a-z0-9_.:-]{2,}/gi)||[];
    if(identifiers.some(name=>!NATIVE_LANGUAGES.has(name.toLowerCase())&&(/[-_.:]/.test(name)||name.toLowerCase()==='imagegen')))return true;
  }
  return false;
}

// This is a conservative closure check, not a general semantic classifier.
// Text must be supplied in the request; quantities must be finite and small.
function hasTranslationTarget(active, raw = active) {
  const languages=/英文|英语|中文|汉语|日语|法语|德语|西班牙语|韩语|阿拉伯语|\b(?:English|Chinese|Mandarin|Japanese|French|German|Spanish|Korean|Arabic)\b/gi;
  for(const language of active.matchAll(languages)){
    const before=active.slice(0,language.index);
    const relation=[...before.matchAll(/译成|译为|翻译成|翻译为|\b(?:into|to)\b/gi)].at(-1);
    if(!relation)continue;
    const between=before.slice(relation.index+relation[0].length);
    // Clause extraction projects commas to newlines. A descriptive list can
    // still govern one target language when the untouched request confirms
    // commas at those exact boundaries. Never bridge a real sentence break.
    const targetSpan=active.slice(relation.index,language.index+language[0].length);
    const commaContinuation=targetSpan.includes('\n')&&new RegExp(targetSpan.split('\n')
      .map(part=>part.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[ \t]+/g,'[ \\t]+'))
      .join('[ \\t]*[,，][ \\t]*'),'i').test(raw);
    if(between.length<=60&&!/[。；:：;!?]|\.(?=\s|$)/.test(between)&&(!/[，\n]/.test(between)||commaContinuation)
      && !/解释|说明|概括|摘要|总结|改写|使用|用|另外|同时|接着|然后|\b(?:summary|explanation|analysis|rewrite|paraphrase|explain|discuss|use|also|then|summari[sz]e|analy[sz]e)\b/i.test(between))return true;
  }
  return false;
}

// Match a complete expression, not an arithmetic-looking substring of a task.
// Verbal operators are normalized before a small grammar checks finite operands.
function closedArithmetic(active) {
  let text=active.normalize('NFKC').trim();
  text=text.replace(/^(?:(?:请|帮我|直接|只需|只要|只|麻烦|计算|算一下|算算|算出来|求值|回答|告诉我)\s*[:：]?\s*)+/,'')
    .replace(/^(?:please\s+)?(?:calculate|compute|evaluate|what is|how much is|answer)\s*[:：]?\s*/i,'')
    .replace(/[?？!！。.,，;；\s]+$/g,'')
    .replace(/(?:[,，;；]\s*)?(?:(?:请|直接)?(?:只)?(?:给我|给出|给|输出|回答)(?:计算)?(?:结果|答案)|(?:give|return|output)\s+(?:only\s+)?(?:the\s+)?(?:result|answer)|(?:result|answer)\s+only)\s*$/i,'')
    .replace(/(?:等于多少|是多少|等于几|结果是多少|=)\s*$/,'')
    .replace(/[?？!！。.,，;；\s]+$/g,'')
    .replace(/加上|加|\bplus\b/gi,'+').replace(/减去|减|\bminus\b/gi,'-')
    .replace(/乘以|乘|\bmultiplied by\b|\btimes\b|×/gi,'*')
    .replace(/除以|除|\bdivided by\b|÷/gi,'/').replace(/[−–]/g,'-');
  if(!text||/[^\d\s.()+*/-]/.test(text))return false;
  const tokens=text.match(/\d+(?:\.\d+)?|[()+*/-]/g)||[];
  if(tokens.join('')!==text.replace(/\s/g,''))return false;
  const numbers=tokens.filter(x=>/^\d/.test(x));
  if(numbers.length<2||numbers.length>8||numbers.some(x=>!Number.isFinite(Number(x))||Number(x)>1e9))return false;
  let operand=true,depth=0;
  for(const token of tokens){
    if(/^\d/.test(token)){if(!operand)return false;operand=false;}
    else if(token==='('){if(!operand)return false;depth++;}
    else if(token===')'){if(operand||--depth<0)return false;}
    else if(operand){if(token!=='+'&&token!=='-')return false;}
    else operand=true;
  }
  return !operand&&depth===0;
}

function suppliedTextSubstitution(raw) {
  const quotes=[...raw.matchAll(/[“「『"]([^”」』"\n]{1,800})[”」』"]/g)];
  for(let i=0;i+1<quotes.length;i++){
    const from=quotes[i],to=quotes[i+1];
    const before=raw.slice(0,from.index),between=raw.slice(from.index+from[0].length,to.index);
    const after=raw.slice(to.index+to[0].length).replace(/[，,。.;；!！?？]+/g,' ').trim();
    if(after&&!/^(?:(?:请|直接)?(?:只)?(?:输出|给出|给|返回)(?:改后|替换后|更改后)?(?:句子|文本|文字|结果|答案)|(?:return|output|give)\s+(?:only\s+)?(?:the\s+)?(?:result|text|sentence))$/i.test(after))continue;
    if(/^(?:(?:请|帮我|直接)\s*)*(?:把|将)\s*$/.test(before)&&/^\s*(?:改成|改为|替换成|替换为|换成|换为)\s*$/.test(between))return true;
    if(/^(?:please\s+)?(?:replace|change)\s*$/i.test(before)&&/^\s*(?:with|to)\s*$/i.test(between))return true;
  }
  return false;
}

function suppliedChatOperation(raw, active, allowText = true) {
  const textActions=[
    /翻译|译成|译为|\btranslate\b/i,
    /概括|总结|摘要|\b(?:summari[sz]e|summarise|condense)\b/i,
    /提取|摘出|\bextract\b/i,
    new RegExp(REWRITE_ACTION.source+'|'+SUBSTITUTION_ACTION.source,'i'),
  ];
  const requested=textActions.map((pattern,index)=>pattern.test(active)?index:-1).filter(x=>x>=0);
  if(!allowText&&requested.length)return false;
  if(requested.length>1)return false;
  if(requested.length===1){
    const quoted=[...raw.matchAll(/[“「『"]([^”」』"\n]{1,800})[”」』"]/g)];
    const colon=raw.match(/[：:]\s*(\S[\s\S]{1,800})$/);
    if(!quoted.length&&!colon)return false;
    const kind=requested[0];
    if(kind===3&&SUBSTITUTION_ACTION.test(active)&&!REWRITE_RESULT.test(active)&&!suppliedTextSubstitution(raw))return false;
    if(kind===3&&REWRITE_RESULT.test(active)&&!/改写|润色|精简|缩写|换一种说法/i.test(active)){
      // For a result-complement rewrite, bind the supplied text to the action.
      // An unrelated quoted label is not the missing paragraph to rewrite.
      const governedQuote=quoted.some(q=>/(?:把|将)\s*$/.test(raw.slice(0,q.index))
        && REWRITE_RESULT.test(raw.slice(q.index+q[0].length).replace(/^\s*(?:请|帮我)\s*/,''))
        && /^\s*(?:请|帮我)?\s*(?:改|写|说)(?:得|成|为)/.test(raw.slice(q.index+q[0].length)));
      const namedInput=colon&&/(?:这|下|原|一|该).{0,5}(?:句|句话|段|文字|文本)/.test(raw.slice(0,colon.index));
      if(!governedQuote&&!namedInput)return false;
    }
    if(kind===0&&!hasTranslationTarget(active,raw))return false;
    if(kind===2&&!/数字|数值|日期|时间|邮箱|电子邮件|姓名|名字|单词|关键词|\b(?:numbers?|dates?|times?|emails?|names?|words?|keywords?)\b/i.test(active))return false;
    return true;
  }
  const numbers=active.match(/(?<![\d.])[-+]?\d+(?:\.\d+)?(?![\d.])/g)||[];
  if(numbers.length<1||numbers.length>8||numbers.some(x=>!Number.isFinite(Number(x))||Math.abs(Number(x))>1e9))return false;
  if(/若干|一些|几(?:个|张|次)|大约|约莫|不知道|不清楚|未(?:知|给出)|估计|猜测|\b(?:some|several|approximately|about|unknown|unspecified|estimate|guess)\b/i.test(active))return false;
  const units=[
    /公里|千米|厘米|毫米|(?<!千|厘|毫)米|\b(?:kilomet(?:er|re)s?|centimet(?:er|re)s?|millimet(?:er|re)s?|met(?:er|re)s?|km|cm|mm|m)\b/gi,
    /千克|公斤|毫克|(?<!千|毫)克|\b(?:kilograms?|milligrams?|grams?|kg|mg|g)\b/gi,
    /毫升|(?<!毫)升|\b(?:millilit(?:er|re)s?|lit(?:er|re)s?|ml|l)\b/gi,
    /小时|分钟|秒钟|秒|\b(?:hours?|minutes?|seconds?|hr|min|sec)\b/gi,
  ];
  const unitText=active.replace(/(\d)([a-z])/gi,'$1 $2');
  const families=units.map(pattern=>[...unitText.matchAll(pattern)].length);
  const conversion=/(?:换算|转换|等于|多少|\b(?:convert|conversion|how many|in|to)\b)/i.test(active)
    && families.filter(x=>x>0).length===1&&families.some(x=>x>=2);
  const countQuestion=/还(?:剩|有)|剩下|一共|总共|现在有|共计|多少|\b(?:how many|how much|remaining|total|left)\b/i.test(active);
  const countChange=/给(?:出|了)?|送(?:出|了)?|收到|获得|增加|减少|用掉|吃掉|拿走|每(?:个|人|组|盒|袋)|平均分|\b(?:gave|gives?|received?|gets?|added?|lost|used|ate|each|every|times|per|share[ds]?)\b/i.test(active);
  const startingQuantity=/(?:原有|有|起初|最初|\b(?:had|has|have|started with)\b)[^，。；,;.!?\d]{0,30}\d/i.test(active);
  const perQuantity=/每(?:个|人|组|盒|袋)|\b(?:each|every|per)\b/i.test(active);
  return conversion||(numbers.length>=2&&countQuestion&&countChange&&(startingQuantity||perQuantity));
}

// Auto inference is deliberately limited to operations on values already in
// the request. Recognizing “simple” is not permission to read files or fetch data.
function closedLiteralOrdering(raw) {
  // Parse a complete bounded operation, including its output modifier. Values
  // such as “apple” are input data here, not names of installed capabilities.
  const text=raw.normalize('NFKC').trim().replace(/[。.!?？！]+$/,'').trim();
  const output='(?:[,，;；]\\s*(?:只(?:输出|返回|给出)(?:较[大小]的)?(?:分数|数值|数字|结果|答案|逗号分隔的词|排序结果)|(?:return|output|give)\\s+(?:only\\s+)?(?:the\\s+)?(?:result|answer|larger(?: fraction| number)?|smaller(?: fraction| number)?|comma[- ]separated words)))?';
  const scalar='[+-]?\\d+(?:\\.\\d+)?(?:\\s*/\\s*[+-]?\\d+(?:\\.\\d+)?)?';
  const numberOrder=new RegExp('^(?:请\\s*)?(?:比较|对比)\\s*('+scalar+')\\s*(?:和|与|、|,|，)\\s*('+scalar+')'+output+'$','i').exec(text)
    ||new RegExp('^(?:please\\s+)?compare\\s+('+scalar+')\\s+(?:and|with)\\s+('+scalar+')'+output+'$','i').exec(text)
    ||new RegExp('^which\\s+is\\s+(?:larger|smaller|greater|less)\\s*[:：]?\\s*('+scalar+')\\s+or\\s+('+scalar+')'+output+'$','i').exec(text);
  if(numberOrder)return numberOrder.slice(1,3).every(value=>{
    const n=value.split('/').map(Number);
    return n.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e9)&&(n.length===1||n[1]!==0);
  });
  const words='[a-z]+(?:\\s*[,，、]\\s*[a-z]+){1,19}';
  return new RegExp('^(?:请\\s*)?(?:把|将)\\s*('+words+')\\s*按(?:英文)?字母(?:顺序|升序|降序)排列'+output+'$','i').test(text)
    ||new RegExp('^(?:please\\s+)?sort\\s+(?:these words\\s*:\\s*)?('+words+')\\s+(?:alphabetically|in alphabetical order)'+output+'$','i').test(text);
}

function closedTextOperation(assessment) {
  const active=clean(assessment.activeText);
  const raw=clean(assessment.originalRequest||assessment.rawText||active);
  if(raw.length>1200||active.length>800)return false;
  if(closedLiteralOrdering(raw))return true;
  if(/^(?:你好|您好|谢谢|早上好|hello|hi|thanks)[!！。.\s]*$/i.test(active))return true;
  if(/^(?:计算|算一下|算算|what is)?\s*[\d\s+\-*/×÷().=]+[?？]?$/i.test(active))return true;
  if(closedArithmetic(active))return true;
  const arithmetic=/(?:计算|算一下|算算|算出来|求值|等于多少|结果|答案|\b(?:calculate|compute|evaluate|what is|how much)\b)/i.test(active)
    && /(?:\d+(?:\.\d+)?\s*[+\-*/×÷]\s*)+\d+(?:\.\d+)?/.test(active);
  const sorting=/(?:排序|从小到大|从大到小|升序|降序|\b(?:sort|ascending|descending)\b)/i.test(active)
    && /(?:[-+]?\d+(?:\.\d+)?\s*[,，、;；\s]\s*){1,}[-+]?\d+(?:\.\d+)?/.test(raw);
  const rewrite=/(?:改写|润色|精简|缩写|换一种说法|\b(?:rewrite|rephrase|shorten|paraphrase)\b)/i.test(active)
    && /(?:这|下|原|一|该).{0,5}(?:句|句话|段|文字|文本)|\b(?:this|following|given|sentence|paragraph|text)\b/i.test(active)
    && (/[：:]\s*\S/.test(raw)||/[“「『"][^”」』"\n]{2,500}[”」』"]/.test(raw));
  const supplied=suppliedChatOperation(raw,active);
  if(!arithmetic&&!sorting&&!rewrite&&!supplied)return false;
  const textKinds=[/翻译|译成|译为|\btranslate\b/i,/概括|总结|摘要|\bsummari[sz]e\b/i,/提取|\bextract\b/i,new RegExp(REWRITE_ACTION.source+'|'+SUBSTITUTION_ACTION.source,'i')].filter(x=>x.test(active)).length;
  if(textKinds>1||(textKinds&&(arithmetic||sorting)))return false;
  if(/制作|建立|创建|搭建|开发|部署|绘制|渲染|设计|研究|调查|调研|规划|推荐|执行|运行|测试|保存|导出|发送|提交|发布|安装|下载|上传|预测|证明|求解|\b(?:build|create|develop|deploy|render|design|research|investigate|recommend|execute|run|test|save|export|send|submit|publish|install|download|upload|predict|prove|solve)\b/i.test(active))return false;
  if(/(?:另外|同时|接着|然后|再|并且|并)\s*(?:帮我|请)?\s*(?:解释|介绍|回答|分析|讲述)|\b(?:also|then|and)\s+(?:explain|describe|answer|analy[sz]e|tell)\b/i.test(active)
    && !/(?:解释|说明|explain).{0,12}(?:结果|步骤|计算|原因|result|steps?|calculation)/i.test(active))return false;
  // Additional output in chat (a short explanation, bullets, or just the result)
  // is still one closed operation. Unrelated requested actions must not hide in it.
  return !/(?:另(?:外|行)?|同时|接着|然后|再)(?:帮我|请)?\s*(?:制作|建立|创建|设计|开发|执行|运行|打开|发送|提交)|\b(?:and then|also|afterwards)\s+(?:build|create|design|run|open|send|submit)\b/i.test(active);
}

export function useFastPath(assessment, options, recovery) {
  if(recovery.triggered||options.routingMode==='full')return false;
  // A validated, evidence-backed host gap is an explicit request for discovery,
  // never an authorization. A contradictory nativeSufficient hint cannot hide it.
  if(assessment.capabilityRequests?.length)return false;
  // Reuse the source-bound witness produced by taskAssessment so scope and
  // fast-path decisions cannot diverge through separate parsing limits.
  const closed=assessment.suppliedOperation||closedSuppliedTransformation(assessment.originalRequest||assessment.rawText||assessment.activeText);
  // Closed arithmetic/text fragments cannot consume a separately requested
  // file output. Reuse the action-bound artifact roles, including bare format
  // names, rather than guessing from a substring such as “result” or “3/4”.
  if(!closed&&assessment.taskStructure?.artifacts?.some(item=>['output','verification','input'].includes(item.role)))return false;
  // A complete grammar distinguishes supplied literals and a scoped no-lookup
  // constraint from instructions. It never mutates the source assessment.
  const active=closed?.instructionText||(assessment.activeClauses||[assessment.activeText||'']).map(positiveRequestPrefix).filter(Boolean).join('\n');
  if(/(?:查找|核实|注明|标注|给出|补充|提供).{0,25}(?:出处|来源|参考文献)|\b(?:find|verify|give|provide|cite)\b.{0,35}\b(?:source|provenance|reference)\b/i.test(active))return false;
  if(/\$[\w:-]+|app:\/\/|技能|插件|工具|手册|\b(?:mcp|plugins?|tools?|manuals?)\b|联网|网上|搜索|最新|\bsearch\b|\bbrowse\b/i.test(active))return false;
  // The complete list grammar has already consumed its literal operands and
  // every prohibition. Neither a quoted item nor a shared denied tool action
  // is a capability request; real tool instructions cannot obtain this witness.
  const capabilityRequest=['list-presentation','supplied-text-formatting'].includes(closed?.kind)
    ?{...assessment,activeText:closed.instructionText,activeClauses:[closed.instructionText]}:assessment;
  if(requestsNamedCapability(capabilityRequest,options))return false;
  const currentWork=currentWorkClauses(active.split('\n'));
  if(currentWork.some(clause=>/^(?:(?:请|先|再|然后|并且|并|帮我|直接)\s*)*(?:读取|读入|打开|扫描|访问|执行|运行|测试|发送|安装|删除|部署|发布)|^(?:please\s+)?(?:read|open|scan|access|execute|run|test|send|install|delete|deploy|publish)\b/i.test(clause)))return false;
  // 仓库 also names supplied stock in a quantity word problem. Preserve the
  // repository warning unless the existing bounded quantity grammar applies;
  // real reads, tool requests and other external inputs still have their guards.
  const quantityClosed=suppliedChatOperation(assessment.originalRequest||active,active,false);
  if(/仓库/.test(active)&&!quantityClosed)return false;
  // These tasks need evidence or effects beyond the supplied text. This guard
  // also applies to host hints: they cannot erase an explicit external need.
  if(/https?:\/\/|(?:[a-z]:[\\/]|\\\\)\S+|\b[\w-]+\.(?:csv|xlsx?|docx?|pdf|txt|json|png|jpe?g|mp4|tex|step|svg|py|js|mjs|sh|ps1)\b|附件|上传|下载|文件|目录|工程|数据库|浏览器|当前(?:网页|页面|界面)|今天|今日|实时|最新|联网|外部资料|参考资料|一手|文献|论文|新闻|天气|汇率|网址|链接|查找|查询|检索|查证|核实|药物|剂量|诊断|治疗|投资|股票|法律|税务|电路|原理图|\b(?:pcb|plc|attached|attachment|files?|folder|repository|database|browser|today|latest|sources?|literature|news|weather|verify|fetch|medical|dosage|diagnosis|treatment|investment|legal|tax|circuit|schematic)\b|\bcurrent\s+(?:price|version|news|weather|status|rates?)\b/i.test(active))return false;
  if(assessment.complexDevelopment||options.taskContext?.complexity==='high')return false;
  if(options.nativeSufficient===true||options.routingMode==='fast')return true;
  return assessment.selfContainedFunction===true||closed!==null||closedTextOperation(assessment);
}
