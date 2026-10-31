// Restrictions are interpreted from already source-filtered clauses. They can
// narrow execution, never authorize a tool call or replace host scope checks.
const READ = /只读|(?:仅|只)(?:允许|能)?(?:查看|检查|审查|审阅|审核|核验|读取|读回|观察|诊断|评估|搜索|搜|检索|查询)(?:一下)?|(?:仅|只)从.{0,35}读取|只(?:做|出)(?:规划|计划|方案)|\bread[- ]only\b|\b(?:inspect|review|audit|check|read|plan|analy[sz]e|search|look up)\s+only\b|\bonly\s+(?:inspect|review|audit|check|read|plan|search|look up)\b/i;
const NO_WRITE = /(?:不要|不得|禁止|不可|不允许|不准|不能|无需|不)(?:直接|实际|再|对.{0,18}进行)?(?:修改|改动|写入|更改|变更|编辑|保存|删除|覆盖|重命名|改|写)|\b(?:do not|don't|must not|never|without|no)\s+(?:any\s+|making\s+)?(?:modif\w*|chang\w*|writ\w*|edit\w*|delet\w*|overwrit\w*|sav\w*|renam\w*)\b/i;
const SEPARATE_OUTPUT = /(?:创建|生成|输出|写入|保存|导出|制作|编写|复制).{0,45}(?:新|独立|副本)|新建|另(?:行)?(?:建|写|存|交付|输出|生成|导出)|(?:在|对|于).{0,20}副本.{0,20}(?:修改|调整|修复|编译|编辑|更改)|\b(?:create|generate|write|save|export|produce|copy)\s+.{0,45}\b(?:new|separate|copy|copies)\b|\b(?:edit|fix|modify|repair|update)\s+.{0,25}\b(?:a |the )?(?:separate )?cop(?:y|ies)\b/i;
const NEGATIVE = /不要|不得|禁止|不允许|不准|不能|不可|不(?:制作|生成|创建|新建|修改|改|编辑|写|保存|删除|输出|导出)|do not|don't|never|must not|cannot|can't/i;
const COMPONENT_BUILD = /(?:编写|实现|制作|创建|开发).{0,40}(?:工具|接口|服务|skill|mcp)|\b(?:build|implement|create|develop).{0,40}\b(?:tool|endpoint|service|api|mcp)\b/i;
const COMPONENT_RULE = /只读(?:工具|接口|服务)|(?:工具|服务|接口)运行时|\bread[- ]only\s+(?:tool|endpoint|service|api)|\b(?:tool|service|endpoint)\s+(?:must|should|runtime)/i;
const SEMANTIC_INVARIANT = /(?:不(?:要)?|不得|禁止)(?:改变|修改|更改|改动)(?:其|原有的?|原来的?)?(?:含义|语义|意思|行为|逻辑|风格|接口|签名)|\b(?:do not|don't|without)\s+chang\w*\s+(?:(?:the|its|their|existing)\s+)*(?:meaning|semantics|behaviou?r|logic|style|interface|signature|api)\b/gi;
const optOut = value => String(value).replace(/(?:不要求|无需|不必)(?:保持)?只读|不禁止(?:改|修改|编辑)[^，。；\n]*|\b(?:not|no longer)\s+(?:be\s+)?read[- ]only\b/gi,'');
const PROSE_REQUEST=/^\s*(?:(?:请|先|再|帮我|直接|\bplease\b)\s*)*(?:指出|列出|给出|提出|说明|解释|描述|建议|\b(?:identify|list|give|describe|explain|suggest|recommend)\b|提供(?=.{0,30}(?:建议|清单|说明|分析))|\bprovide\b(?=.{0,40}\b(?:advice|suggestions?|recommendations?|analysis|list)\b))/i;

// A locative adjunct names where inspection occurs, not the object protected
// from writes. Keep object predicates such as “参考文件在目录中是只读的” intact.
function operationWithoutLocation(clause) {
 return clause.replace(/^(?:(?:请|先|帮我)\s*)*(?:在|于)[^，。；;\n]{1,70}?(?:中|内|里|上)(?=\s*只读(?:地)?(?:核对|核查|检查|审查|审阅|审核|核验|查看|读取|观察|诊断|评估|访问|分析|进行|开展|完成|做))/,'')
   .replace(/^(?:please\s+)?in\s+[^,.;\n]{1,70}?[, ]+?(?=(?:perform\s+)?(?:a\s+)?read[- ]only\s+(?:inspection|review|audit|check|analysis))/i,'');
}

function forbidsNetwork(clause) {
 const sentences=clause.split(/[.!?](?=\s|$)/).map(x=>x.trim()).filter(Boolean);
 if(sentences.length>1||sentences[0]!==clause)return sentences.some(forbidsNetwork);
 const start='(?:^|[、]|\\bor\\s+|\\band\\s+)\\s*(?:(?:请|本次|全程)\\s*)?';
 return new RegExp(start+'(?:不要|不得|禁止|不允许|无需|不必|不)(?:再|实际)?(?:联网|上网|访问外网|访问网络)(?=$|[\\s:：、或和及并])','i').test(clause)
   || /^(?:请)?(?:全程)?离线(?:完成|处理|执行|工作)?$|^(?:no network(?: access)?|offline only|(?:do not|don't|never) (?:access the (?:internet|network)|go online))$/i.test(clause.trim());
}

// Creation and edits are already requested user work. A protected source does
// not require the user to repeat “new/separate” for every output format or path.
// Mere host interpretation and a request for a chat answer cannot establish it.
export function currentWorkClauses(clauses) {
 return clauses.flatMap(raw=>{
  const text=String(raw);
  // "Explain how to create and save" keeps both verbs subordinate to explain.
  if(/(?:解释|说明|介绍|讲解|描述)(?:一下)?(?:如何|怎么|怎样|为什么|能否|是否)|\b(?:explain|describe|discuss)\s+(?:how|why|whether)\b/i.test(text))return [text];
  return PROSE_REQUEST.test(text)?text.split(/并且|然后|同时|而且|且|并|\band\b|\bthen\b/i):[text];
 }).map(raw=>{
  let clause=String(raw).replace(/(?:已经?|曾经|之前|过去|原来|先前|去年)(?:创建|生成|制作|编写|开发|实现|修改|编辑|修复|保存|导出)(?:了|的|过)?/g,'');
  // An explanatory subordinate clause describes an action; it does not request
  // that action. A later separate imperative remains in its own source clause.
  const explanation=clause.search(/(?:解释|说明|介绍|讲解|描述)(?:一下)?(?:如何|怎么|怎样|为什么|能否|是否)|\b(?:explain|describe|discuss)\s+(?:how|why|whether)\b/i);
  if(explanation>=0)clause=clause.slice(0,explanation);
  const inChat=/(?:发|贴|写|给|回复|回答|输出|呈现|显示)(?:在|到|进)?(?:本次|当前)?(?:聊天|对话)|(?:在|于)(?:本次|当前)?(?:聊天|对话).{0,8}(?:给|回复|回答|展示|呈现|输出|贴|发)|\b(?:in|into|to)\s+(?:the\s+)?chat\b/i.test(clause);
  const persists=/(?:保存|写入|写到|导出|另存).{0,45}(?:文件|文档|目录|路径|本地|\.[a-z0-9]{2,6}\b)|\b(?:save|export)\s+.{0,45}\b(?:file|document|directory|path|locally)\b/i.test(clause);
  // Chat is also a delivery surface for real files and generated media.
  // Distinguish those explicit artifacts from prose describing an artifact.
  const concreteOutput=/(?:生成|制作|绘制|创建|画|\b(?:generate|create|render|draw)\b).{0,40}(?:文件(?!名)|海报|图片|插画|图像|视频|音频|\b(?:png|svg|docx|pptx|mp4|pdf|image|illustration|poster|video|audio|file)\b)/i.test(clause)
    && !/(?:对|关于).{0,30}(?:解释|说明|建议|摘要)|\b(?:explanation|description|summary|advice)\s+(?:of|about|for)\b/i.test(clause);
  // Reporting proposed changes is a speech act, not a request to apply them.
  // Coordinated imperatives were split above, so a later actual edit survives.
  const proseRequest=PROSE_REQUEST.test(clause);
  if(proseRequest&&!persists&&!concreteOutput)return '说明';
  if(inChat&&!persists&&!concreteOutput){
   const proseStart=clause.search(/生成|制作|编写|修正|修复|改写|合成|写一个|\b(?:generate|produce|create|write|compose|fix|edit)\s+/i);
   // Retain a preceding request to inspect its inputs, if one exists.
   return proseStart>=0?clause.slice(0,proseStart):clause;
  }
  return clause;
 }).filter(Boolean);
}

function independentWorkClauses(clauses) {
 // An inspection predicate governs its object: “inspect the export/output file”
 // does not request an export. Explicit coordinated imperatives remain work.
 return clauses.flatMap(clause=>readOnlyOperation(clause)
   ?clause.split(/并且|然后|同时|而且|且|并|\band\b|\bthen\b/i).slice(1)
   :[clause]);
}

function constructiveWork(clauses) {
 return independentWorkClauses(clauses).some(clause=>/(?:创建|生成|制作|编写|开发|实现|做成|新增|增加|修改|编辑|修复|修正|改写|合成|复制|新建|写一个|写本地).{1,80}|(?<![a-z0-9_./\\-])(?:create|generate|produce|implement|develop|build|edit|modify|repair|fix|compose|copy)\s+.{1,80}/i.test(clause)
   || /(?:输出|交付|写入|写到|保存|导出).{0,70}(?:文件|文档|工程|脚本|代码|目录|副本|本地|可编辑|\.[a-z0-9]{2,6}\b|\b(?:pdf|docx|pptx|png|mp4|step|csv|json)\b)|(?:新(?:文件|图|稿|工程)|产物|结果).{0,10}(?:放|存|写)(?:入|到)?\s*\S+|\b(?:write|save|export|deliver)\b.{0,60}\b(?:files?|documents?|scripts?|code|project|folder|directory|locally|local|pdf|docx|csv|json)\b/i.test(clause));
}

// Infer the grammatical target, not a whitelist of file or product names. A
// restriction still applies to that target even when another output is allowed.
function restrictionTarget(clause) {
  clause=operationWithoutLocation(clause).trim();
  // An exclusive action limit attached to the current task applies to that
  // task, even when other descriptive/request clauses use unfamiliar verbs.
  // A task-owned object ("本次任务的资料") does not satisfy this relationship.
  const currentTaskActionLimit=/^(?:请\s*)?(?:(?:此次|这次|本次|本轮|这一轮|当前|现在)(?:任务|操作|阶段)?(?:中|内)?\s*(?:只|仅)(?:允许|能)?|(?:for\s+)?(?:this|the current)\s+(?:task|session|phase)\s+only\s+)/i;
  if(currentTaskActionLimit.test(clause)&&READ.test(clause))return null;
  const global=/(?:全程|整个任务|本次任务|本轮任务|本次|本轮|全局|当前)(?:都|必须|保持|为|是)?\s*(?:只读|(?:不要|不得|禁止|不允许)(?:任何|所有|一切)?(?:写入|修改|改动))|所有(?:操作|写入|修改)|一切(?:写入|修改)|\bglobal(?:ly)?\s+read[- ]only\b|\b(?:whole|entire|this|the|current)\s+(?:task|session|phase)\s*(?:(?:is|are|must|be|remain|stay|strictly)\s+)*(?:read[- ]only|(?:do not|don't|must not|never)\s+(?:write|modify|edit|delete))\b|\ball\s+(?:writes|mutations|operations)\b/i;
  if(global.test(clause))return null;
  const ro=/只读(?!取|回)|\bread[- ]only\b/i.exec(clause);
  if(ro){
    const before=clause.slice(0,ro.index).replace(/(?:保持|维持|为|是|仅|只|必须|严格|\b(?:is|are|be|remain|stay|strictly|must)\b)/gi,'').trim();
    const after=clause.slice(ro.index+ro[0].length).replace(/^(?:地|的|模式|操作|使用|访问|读取|查看|检查|审查|审阅|核验|诊断|\s)+/i,'').trim();
    if(before&&!/^(?:请|这份|这个|这些|\bplease\b|\bthe\b|\bthis\b)$/i.test(before))return before;
    if(after&&!/^(?:模式|操作|\bmode\b|\boperations?\b)$/i.test(after))return after;
    return null;
  }
  // A Chinese object can precede the exclusive read predicate. The explicit
  // current-task relation above has already been handled separately.
  const exclusiveRead=/(?:只|仅)(?:允许|能)?/.exec(clause);
  if(exclusiveRead&&exclusiveRead.index>0&&READ.test(clause))return clause.slice(0,exclusiveRead.index).trim();
  const target=clause.match(/(?:修改|改动|改变|改写|写入|更改|变更|编辑|保存|删除|覆盖|重命名|改(?:任何)?文件|改|写|读取|查看|检查|审查|观察|检索|搜索|查询|搜|\b(?:modif\w*|chang\w*|writ\w*|edit\w*|delet\w*|overwrit\w*|sav\w*|renam\w*|read|inspect|review|check|search)\b)\s*(.*)$/i)?.[1]?.trim();
  if(!target){
    // Chinese also puts the protected object before its negative predicate.
    const prefix=clause.match(/^(.*?)\s*(?:绝不|不要|不得|禁止|不允许|不能|不可|不)(?:再|直接|实际)?(?:修改|改动|改变|改写|写入|更改|变更|编辑|保存|删除|覆盖|重命名|改|写)(?:$|[。；;])/i)?.[1]?.trim();
    return prefix&&!/^(?:请|本次|本轮|所有操作|整个任务)$/.test(prefix)?prefix:null;
  }
  if(/^(?:任何|所有)(?!原|输入|参考)|^(?:any|all)\s+(?!original|input|source|reference)/i.test(target))return null;
  return target;
}

// "Read-only" modifying an inspection predicate describes the requested work;
// "source is read-only" describes an object. Unknown descriptive clauses must
// not erase the former. A separately requested artifact still keeps its scope.
function readOnlyOperation(clause) {
 clause=operationWithoutLocation(clause).trim();
 return /^\s*(?:(?:请|先|帮我|严格|\bplease\b)\s*)*只读(?:地)?(?:核对|核查|检查|审查|审阅|审核|核验|查看|读取|观察|诊断|评估|访问|分析)/i.test(clause)
  // Light verbs still govern an observational action: “进行安全复核” is
  // a review, while “做一个审查工具” names a new artifact and does not match.
  || /^\s*(?:(?:请|先|帮我|严格)\s*)*只读(?:地)?(?:做|进行|开展|完成)(?:一次|一项)?[^，。；;\n]{0,30}(?:预审|审查|审阅|审核|核验|检查|审计|复核|核对|核查|评审|评估|分析|比较|对比)(?=$|[：:\s]|并|且|对)/i.test(clause)
  || /^\s*(?:please\s+)?(?:(?:perform|conduct|carry out)\s+)?(?:an?\s+)?read[- ]only\s+(?:inspection|review|audit|check|analysis|comparison|verification|assessment|inspect|compare|verify|review|audit|check|analy[sz]e)\b/i.test(clause)
  || /^\s*(?:please\s+)?(?:inspect|review|audit|check|compare|verify|analy[sz]e)\b.{0,120}\bin\s+read[- ]only\s+mode\b/i.test(clause);
}

// A restriction on an object and a request to do only observational work are
// different facts. Unknown work is not permission to write, but neither is it
// evidence that the user's object-specific restriction covers every output.
function observationalWorkOnly(clauses) {
  const observation=/^(?:(?:请|先|再|仅|只|只读|帮我|保持|维持|\bplease\b|\bonly\b)\s*)*(?:从.{0,35})?(?:查看|检查|审查|审阅|审核|核验|读取|读回|观察|诊断|评估|搜索|检索|查询|解释|说明|介绍|讲解|描述|总结|概括|\b(?:read|inspect|review|audit|check|observe|diagnose|evaluate|search|explain|describe|summari[sz]e|discuss|analy[sz]e)\b)/i;
  return clauses.every(clause=>{
    // Source predicates contain no independent action. Coordinated actions are
    // inspected separately rather than swallowed as part of a read-only object.
    const parts=clause.split(/并且|然后|同时|而且|且|并|\band\b|\bthen\b/i).map(x=>x.trim()).filter(Boolean);
    const explanationOutput=/^(?:(?:请|再)\s*)?(?:(?:给出|提供|列出)(?:诊断|解释|说明|建议|原因|结论)|(?:在|于)(?:本次|当前)?(?:聊天|对话)(?:中|里)?(?:给出|回复|回答|解释)|\b(?:give|provide)\s+(?:(?:an?|the)\s+)?(?:diagnosis|explanation|analysis|advice|conclusion)\b)/i;
    return parts.every(part=>observation.test(part)||explanationOutput.test(part)||/(?:只读|\bread[- ]only\b)\s*$/i.test(part));
  });
}

export function assessRestrictions(userClauses, hostConstraints = [], invocation = {}, activeClauses = null) {
  const inputs=[{source:'user-request',text:userClauses},...hostConstraints.map(text=>({source:'host-restriction',text}))];
  const evidence=[];
  const networkEvidence=[];
  // A shared negative governs its coordinated actions (“不改原文或新建文件”).
  // Only an explicit contrast starts a fresh affirmative request.
  const workClauses=(activeClauses||String(userClauses).split(/[\n。；;，,]+/))
    .flatMap(x=>optOut(x).split(/但是|但|而是|\bbut\b/i));
  const positiveClauses=currentWorkClauses(workClauses.map(x=>x.split(NEGATIVE)[0].split(NO_WRITE)[0]));
  const positive=independentWorkClauses(positiveClauses).join('\n');
  // Only actual user clauses establish a separate requested output. Host
  // interpretation may narrow scope, never manufacture an allowed output.
  const outputDestination=/(?:生成|输出|保存|写入|导出|制作|编写).{0,60}(?:输出目录|目标目录|交付目录|新目录)|(?:修改|调整|修复|编译|编辑|更改).{0,25}副本|\b(?:create|generate|write|save|export|produce).{0,60}\b(?:output|destination)\s+(?:directory|folder)\b/i.test(positive);
  const allowsSeparateOutput=SEPARATE_OUTPUT.test(positive)||outputDestination||constructiveWork(positiveClauses),componentBuild=COMPONENT_BUILD.test(positive);
  for(const input of inputs){
    const text=optOut(input.text);
    let adjacentProtectedTarget=null;
    for(const part of text.split(/([\n。；;，,]+)/)){
      // Ellipsis can inherit the immediately preceding protected object across
      // a comma, never across a new sentence, semicolon, host input or task.
      if(/^[\n。；;，,]+$/.test(part)){
        if(!/^[，,]+$/.test(part))adjacentProtectedTarget=null;
        continue;
      }
      const clause=part.trim();if(!clause)continue;
      if(forbidsNetwork(clause))networkEvidence.push({source:input.source,scope:'network-access',clause});
      const priorTarget=adjacentProtectedTarget;adjacentProtectedTarget=null;
      const check=clause.replace(SEMANTIC_INVARIANT,'');
      const chatOnly=/(?:只|仅)(?:在聊天(?:中)?|用文字)(?:回复|回答|报告|解释|给出)|\b(?:reply|answer|respond)\b.{0,20}\b(?:in chat|with text) only\b/i.test(check);
      const reverseProhibition=/\b(?:all|any)\s+(?:writes?|mutations?|modifications?|changes?)\s+(?:is|are)\s+(?:forbidden|prohibited|disallowed)\b|(?:禁止|不得)(?:一切|任何|所有)(?:写入|修改|改动)/i.test(check);
      const postfixRead=check.match(/\b(?:inspect|review|audit|check|read|search)\s+([^.;,\n]{1,80})\s+only\b/i);
      const boundedRead=postfixRead&&!/\b(?:write|create|generate|save|edit|modify|delete|upload|publish)\b/i.test(postfixRead[1]);
      if(!READ.test(check)&&!NO_WRITE.test(check)&&!reverseProhibition&&!boundedRead&&!chatOnly)continue;
      // Scope is established by the protected object itself. It must not depend
      // on successfully recognizing the verb used for a different deliverable.
      const componentRule=componentBuild&&COMPONENT_RULE.test(check);
      const hostWorkLimit=input.source==='host-restriction'&&/(?:仅|只)(?:允许|能)?(?:查看|检查|审查|审阅|审核|核验|读取|读回|观察|诊断|评估|搜索|检索|查询)|\b(?:only\s+(?:inspect|review|audit|check|read|plan|search)|(?:inspect|review|audit|check|read|plan|search)\s+only)\b/i.test(check);
      const operationLimit=readOnlyOperation(check)&&(input.source==='host-restriction'||!allowsSeparateOutput);
      const elliptical=priorTarget&&/^(?:(?:并且|并|且|也|\band\b)\s*)?(?:不要|不得|禁止|不允许|不能|不可|不|\b(?:do not|don't|must not|never)\s+)(?:再|直接|实际|\bagain\s+)?(?:覆盖|修改|改动|编辑|删除|重命名|\b(?:overwrite|modify|edit|delete|rename)\b)[!！\s]*$/i.test(check);
      const target=chatOnly||hostWorkLimit||operationLimit?null:restrictionTarget(check)||(elliptical?priorTarget:null),scoped=!!target;
      if(scoped&&!componentRule)adjacentProtectedTarget=target;
      evidence.push({source:input.source,scope:componentRule?'component-behavior':scoped?'protected-target':'all-writes',clause,...(scoped?{target,basis:elliptical?'adjacent-protected-object-ellipsis; other-actions-require-user-request':'explicit-protected-object; other-actions-require-user-request'}:operationLimit?{basis:'explicit-read-only-operation'}:{})});
    }
  }
  if(invocation.mode==='plan')evidence.push({source:'host-plan-mode',scope:'all-writes'});
  if(invocation.readOnly===true)evidence.push({source:'host-read-only',scope:'all-writes'});
  const sources=[...new Set(evidence.filter(x=>x.scope==='all-writes').map(x=>x.source))];
  const observationalOnly=!allowsSeparateOutput&&evidence.some(x=>x.source==='user-request'&&x.scope==='protected-target')&&observationalWorkOnly(positiveClauses);
  if(observationalOnly&&!sources.includes('user-request'))sources.push('user-request');
  return {readOnly:sources.length>0,sources,protectedScopes:evidence.filter(x=>x.scope!=='all-writes'),evidence:[...evidence,...networkEvidence],networkForbidden:networkEvidence.length>0,
    workMode:observationalOnly?'observational-only':allowsSeparateOutput?'separate-output-requested':'unresolved'};
}
