// Restrictions are interpreted from already source-filtered clauses. They can
// narrow execution, never authorize a tool call or replace host scope checks.
const READ = /只读|(?:仅|只)(?:允许|能)?(?:查看|检查|审查|审阅|审核|核验|读取|读回|观察|诊断|评估|搜索|搜|检索|查询)(?:一下)?|(?:仅|只)从.{0,35}读取|只(?:做|出)(?:规划|计划|方案)|\bread[- ]only\b|\b(?:inspect|review|audit|check|read|plan|analy[sz]e|search|look up)\s+only\b|\bonly\s+(?:inspect|review|audit|check|read|plan|search|look up)\b/i;
const NO_WRITE = /(?:不要|不得|禁止|不可|不允许|不准|不能|无需|不)(?:直接|实际|再|对.{0,18}进行)?(?:修改|改动|写入|更改|变更|编辑|保存|删除|覆盖|重命名|改|写)|\b(?:do not|don't|must not|never|without|no)\s+(?:any\s+|making\s+)?(?:modif\w*|mutat\w*|chang\w*|writ\w*|edit\w*|delet\w*|overwrit\w*|sav\w*|renam\w*)\b/i;
const SEPARATE_OUTPUT = /(?:创建|生成|输出|写入|保存|导出|制作|编写|复制).{0,45}(?:新|独立|副本)|新建|另(?:行)?(?:建|写|存|交付|输出|生成|导出)|(?:在|对|于).{0,20}副本.{0,20}(?:修改|调整|修复|编译|编辑|更改)|\b(?:create|generate|write|save|export|produce|copy)\s+.{0,45}\b(?:new|separate|copy|copies)\b|\b(?:edit|fix|modify|repair|update)\s+.{0,25}\b(?:a |the )?(?:separate )?cop(?:y|ies)\b/i;
// Polarity and positive-work detection share their action vocabulary. A denied
// repair/install is never a requested mutation merely because another module
// recognizes a different verb list. A shared negative owns its coordinated
// actions until an explicit contrast starts a separate clause.
const MUTATION_ZH='创建|生成|制作|编写|开发|实现|做成|新增|增加|修改|编辑|修复|修正|改写|合成|复制|新建|写一个|写本地|写库|更新|发送|上传|分享|发布|部署|安装|卸载|启用|停用|注册|购买|下单|删除|重命名|保存|写入|覆盖|更改|变更|改动|改变|导出|输出|另存';
const MUTATION_EN='create|generate|produce|implement|develop|build|edit|modify|repair|fix|compose|copy|update|send|upload|share|publish|deploy|install|uninstall|enable|disable|register|purchase|delete|rename|save|write|overwrite|change|export';
const REQUEST_ACTION_ZH=MUTATION_ZH+'|读取|读写|读|查看|检查|核对|核验|查询|检索|搜索|联网|上网|访问|调用|使用|采用|借助|连接|运行|执行|操作|启动|联系|报名|点击|登录|做|进行|重绘|提交|跑|写|改';
// Nominal prohibitions ("no changes/edits/writes") must have the same polarity
// as the write restrictions below, rather than remaining unresolved active work.
export const negativeRequestPattern=new RegExp("(?:"+NO_WRITE.source+")|不要|不得|禁止|不允许|不准|不能|不可|别用|不用|没有(?=[^。；;\\n]{0,100}(?:授权|许可|权限))|不(?:(?:替我|帮我|公开|线上|在线|直接|实际|再))?(?:"+REQUEST_ACTION_ZH+")|没有(?:线上|在线)?(?:发布|部署|上传)需求|无需|不需要|不必|避免|do not|don't|must not|may not|cannot|can't|should not|shouldn't|never|without",'i');
export function positiveRequestPrefix(value) {
 const text=String(value),start=negativeRequestPattern.exec(text)?.index;
 return (start===undefined?text:text.slice(0,start)).replace(/(?:并且|然后|同时|而且|并|且|也|\band\b|\bthen\b)\s*$/i,'').trim();
}
const REQUEST_ACTION_EN=MUTATION_EN+'|read|inspect|review|check|search|look|browse|fetch|access|call|invoke|use|connect|run|execute|operate|start|contact|click|log in|go online';
// Expand only grammatical action enumerations. Commas alone do not carry a
// prohibition into the next request: an explicit contrast, renewed imperative,
// or independently requested output starts its own role. Original text remains
// available in originalRequest; this projection is shared by intent and scope.
export function sharedEnglishNegation(value) {
 const action=new RegExp('^(?:(?:and|or)\\s+)?(?:'+REQUEST_ACTION_EN+')\\b','i');
 const coordinated=new RegExp('\\b(?:and|or)\\s+(?:'+REQUEST_ACTION_EN+')\\b','i');
 const bare=new RegExp('^(?:(?:and|or)\\s+)?(?:'+REQUEST_ACTION_EN+')$','i');
 return String(value).split(/([。；;!?\n]|\.(?=\s|$)|\bbut\b|\binstead\b)/i).map(sentence=>{
  const parts=sentence.split(/([,，])/);
  for(let i=0;i<parts.length;i+=2){
   const prefix=parts[i].trim().match(/^(?:please\s+)?(do not|don't|must not|never|without)\s+/i)?.[1];
   if(!prefix)continue;
   let end=i+2;
   while(end<parts.length){
    const part=parts[end].trim();
    if(!action.test(part))break;
    end+=2;
   }
   // First identify the complete enumeration, including an Oxford comma. A
   // terminal "or" governs all preceding actions even if one creates output.
   // Only then may a clearly independent output break an unmarked/"and" run.
   const terminalOr=new RegExp('\\bor\\s+(?:'+REQUEST_ACTION_EN+')\\b','i').test(parts[end-2]);
   if(!terminalOr)for(let k=i+2;k<end;k+=2){
    const part=parts[k].trim();
    if(!/^or\b/i.test(part)&&SEPARATE_OUTPUT.test(part)&&!coordinated.test(part.replace(/^and\s+/i,''))){end=k;break;}
   }
   const continued=[];for(let k=i+2;k<end;k+=2)continued.push(k);
   if(!continued.length||(!coordinated.test(parts[end-2])&&!continued.every(k=>bare.test(parts[k].trim()))))continue;
   for(const k of continued)parts[k]=' '+prefix+' '+parts[k].trim().replace(/^(?:and|or)\s+/i,'');
   i=end-2;
  }
  return parts.join('');
 }).join('');
}
const COMPONENT_BUILD = /(?:编写|实现|制作|创建|开发).{0,40}(?:工具|接口|服务|skill|mcp)|\b(?:build|implement|create|develop).{0,40}\b(?:tool|endpoint|service|api|mcp)\b/i;
const COMPONENT_RULE = /只读(?:工具|接口|服务)|(?:工具|服务|接口)运行时|\bread[- ]only\s+(?:tool|endpoint|service|api)|\b(?:tool|service|endpoint)\s+(?:must|should|runtime)/i;
const SEMANTIC_INVARIANT = /(?:不(?:要)?|不得|禁止)(?:改变|修改|更改|改动)(?:其|原有的?|原来的?)?(?:含义|语义|意思|行为|逻辑|风格|接口|签名)|\b(?:do not|don't|without)\s+chang\w*\s+(?:(?:the|its|their|existing)\s+)*(?:meaning|semantics|behaviou?r|logic|style|interface|signature|api)\b/gi;
const optOut = value => String(value).replace(/(?:不要求|无需|不必)(?:保持)?只读|不禁止(?:改|修改|编辑)[^，。；\n]*|\b(?:not|no longer)\s+(?:be\s+)?read[- ]only\b/gi,'');
const PROSE_REQUEST=/^\s*(?:(?:请|先|再|帮我|直接|\bplease\b)\s*)*(?:指出|列出|给出|提出|说明|解释|描述|建议|\b(?:identify|list|give|describe|explain|suggest|recommend)\b|提供(?=.{0,30}(?:建议|清单|说明|分析))|\bprovide\b(?=.{0,40}\b(?:advice|suggestions?|recommendations?|analysis|list)\b))/i;
const CHAT_SPEECH=/(?:在|于)(?:本次|当前)?(?:这里|聊天|对话)(?:中|里)?(?:把.{0,45})?(?:返回|回复|回答|答复|归纳|概括|总结|解释|说明|区分|给出|给|列出|列|拆|判断|交付|输出|呈现|写)|(?:列|写|显示|输出|呈现)(?:出)?(?:在|到)(?:本次|当前)?(?:这里|聊天|对话)(?:中|里)?|\b(?:list|display|show|present|return|output|reply|respond|answer|explain|summari[sz]e|report)\b.{0,80}\bin\s+(?:(?:(?:the|this|current)\s+)?chat|your\s+reply\s+here)\b|^(?:(?:please|only)\s+)*(?:reply|respond|answer)\s+here(?:\s+only)?$/i;

function negativeActionItems(clause) {
 const bounded=String(clause).trim().split(/但是|但|而是|\bbut\b|\binstead\b/i)[0];
 const body=bounded.match(/^(?:(?:请|本次|本轮|此次|这一轮|全程)\s*)?(?:不要|不得|禁止|不允许|不准|不能|不可|不|do not\s+|don't\s+|must not\s+|never\s+|without\s+|no\s+)([^。；;\n]+)$/i)?.[1];
 return body?body.split(/[、]|或者|或|以及|及|\b(?:and|or)\b/i).map(x=>x.trim().replace(/[.!?]+$/,'').replace(/^(?:不要|不得|禁止|不允许|不准|不能|不可|不)(?=.{1,100})/,'')).filter(Boolean):[];
}

function forbidsAllWrites(clause) {
 return negativeActionItems(clause).some(item=>
  /^(?:任何|所有|一切)(?:(?:持久(?:化)?(?:状态)?|外部状态))?(?:写入|修改|改动)$/.test(item)
  || /^(?:修改|改动|改变|更新|写入)(?:任何|所有|一切)(?:外部状态|持久(?:化)?状态|状态|文件|数据)$/.test(item)
  || /^(?:(?:any|all)\s+)?(?:(?:persistent|external)\s+)?(?:state\s+)?(?:writes?|mutations?|modifications?|changes?|edits?)$/i.test(item));
}

// A locative adjunct names where inspection occurs, not the object protected
// from writes. Keep object predicates such as “参考文件在目录中是只读的” intact.
function operationWithoutLocation(clause) {
 return clause.replace(/^(?:(?:请|先|帮我)\s*)*(?:在|于)[^，。；;\n]{1,70}?(?:中|内|里|上)(?=\s*只读(?:地)?(?:核对|核查|检查|审查|审阅|审核|核验|查看|读取|观察|诊断|评估|访问|分析|进行|开展|完成|做))/,'')
   .replace(/^(?:please\s+)?in\s+[^,.;\n]{1,70}?[, ]+?(?=(?:perform\s+)?(?:a\s+)?read[- ]only\s+(?:inspection|review|audit|check|analysis))/i,'');
}

function forbidsNetwork(clause) {
 const sentences=clause.split(/[.!?](?=\s|$)/).map(x=>x.trim()).filter(Boolean);
 if(sentences.length>1||sentences[0]!==clause)return sentences.some(forbidsNetwork);
 if(negativeActionItems(clause).some(x=>/^(?:再|实际)?(?:联网|上网|访问(?:外部|外界|公共|公众)?(?:网络|网站)|访问外网)$/.test(x)
   ||/^(?:go online|(?:access|use)\s+(?:the\s+)?(?:internet|network))$/i.test(x)))return true;
 const start='(?:^|[、]|\\bor\\s+|\\band\\s+)\\s*(?:(?:请|本次|全程)\\s*)?';
 return new RegExp(start+'(?:不要|不得|禁止|不允许|无需|不必|不)(?:再|实际)?(?:联网|上网|访问(?:外部|外界|公共|公众)?(?:网络|网站)|访问外网)(?=$|[\\s:：、或和及并])','i').test(clause)
   || /^(?:请)?(?:全程)?离线(?:完成|处理|执行|工作)?$|^(?:no network(?: access)?|offline only|(?:do not|don't|never) (?:access the (?:internet|network)|go online))$/i.test(clause.trim());
}

// Creation and edits are already requested user work. A protected source does
// not require the user to repeat “new/separate” for every output format or path.
// Mere host interpretation and a request for a chat answer cannot establish it.
const IMPLICIT_ARTIFACT=/(?:做|写|画|搭建|制作|生成|创建|编写)(?:一个|一段|一份|一套|个|段|份|套)?[^，。；;\n]{0,40}(?:游戏|网页|应用|程序|脚本|代码文件|文件|工程|图片|图像|海报|视频|音频)|\b(?:make|write|draw|create|generate|produce|build)\s+.{0,40}\b(?:game|webpage|application|script|code file|file|project|image|poster|video|audio)\b/i;
export function currentWorkClauses(clauses) {
 return clauses.flatMap(raw=>{
  const text=String(raw);
  // "Explain how to create and save" keeps both verbs subordinate to explain.
  if(/(?:解释|说明|介绍|讲解|描述)(?:一下)?(?:如何|怎么|怎样|为什么|能否|是否)|\b(?:explain|describe|discuss)\s+(?:how|why|whether)\b/i.test(text))return [text];
  return PROSE_REQUEST.test(text)||CHAT_SPEECH.test(text)?text.split(/并且|然后|同时|而且|且|并|\band\b|\bthen\b/i):[text];
 }).map(raw=>{
  let clause=String(raw).replace(/(?:已经?|曾经|之前|过去|原来|先前|去年)(?:创建|生成|制作|编写|开发|实现|修改|编辑|修复|保存|导出|更新|发送|上传|分享|发布|部署|安装|卸载|启用|停用|注册|购买|下单|删除|重命名)(?:了|的|过)?/g,'');
  // An explanatory subordinate clause describes an action; it does not request
  // that action. A later separate imperative remains in its own source clause.
  const explanation=clause.search(/(?:解释|说明|介绍|讲解|描述)(?:一下)?(?:如何|怎么|怎样|为什么|能否|是否)|\b(?:explain|describe|discuss)\s+(?:how|why|whether)\b/i);
  if(explanation>=0)clause=clause.slice(0,explanation);
  const inChat=/(?:发|贴|写|给|回复|回答|输出|呈现|显示)(?:在|到|进)?(?:本次|当前)?(?:聊天|对话)|(?:在|于)(?:本次|当前)?(?:聊天|对话).{0,8}(?:给|回复|回答|展示|呈现|输出|贴|发)|\b(?:in|into|to)\s+(?:the\s+)?chat\b/i.test(clause);
  const persists=/(?:保存|写入|写到|导出|另存).{0,45}(?:文件|文档|目录|路径|本地|\.[a-z0-9]{2,6}\b)|\b(?:save|export)\s+.{0,45}\b(?:file|document|directory|path|locally)\b/i.test(clause);
  // Chat is also a delivery surface for real files and generated media.
  // Distinguish those explicit artifacts from prose describing an artifact.
  const concreteOutput=(IMPLICIT_ARTIFACT.test(clause)||/(?:生成|制作|绘制|创建|画|交付|输出|给出|提供|\b(?:generate|create|render|draw|deliver|output)\b).{0,40}(?:文件(?!名)|海报|图片|插画|图像|视频|音频|\.[a-z0-9]{2,6}\b|\b(?:png|svg|docx|pptx|xlsx|mp4|pdf|image|illustration|poster|video|audio|file)\b)/i.test(clause))
    && !/(?:对|关于).{0,30}(?:解释|说明|建议|摘要)|\b(?:explanation|description|summary|advice)\s+(?:of|about|for)\b/i.test(clause);
  const chatSpeech=CHAT_SPEECH.test(clause);
  if(chatSpeech&&!persists&&!concreteOutput)return '说明';
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
 const mutation=new RegExp('(?:'+MUTATION_ZH+').{1,80}|(?<![a-z0-9_./\\\\-])(?:'+MUTATION_EN+')\\s+.{1,80}','i');
 return independentWorkClauses(clauses).some(clause=>mutation.test(clause)||IMPLICIT_ARTIFACT.test(clause)
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
  const target=clause.match(/(?:修改|改动|改变|改写|写入|更改|变更|编辑|保存|删除|覆盖|重命名|改(?:任何)?文件|改|写|读取|查看|检查|审查|观察|检索|搜索|查询|搜|\b(?:modif\w*|mutat\w*|chang\w*|writ\w*|edit\w*|delet\w*|overwrit\w*|sav\w*|renam\w*|read|inspect|review|check|search)\b)\s*(.*)$/i)?.[1]?.trim();
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
 // Bare Chinese 只读 can be the read predicate itself when it directly governs
 // a concrete resource token. This is distinct from a source adjective such as
 // “原文件只读”. Resource placeholders (.csv) survive the input projection.
 const resourceRead=/^(?:(?:请|先|再|然后|并且|并|帮我|严格)\s*)*只读\s*((?:[A-Za-z]:[\\/]|https?:\/\/|(?:[^\s,，;；]*\.)[a-z][a-z0-9]{1,7}\b)[^,，;；]*)/i.exec(clause);
 if(resourceRead)return true;
 return /^\s*(?:(?:请|先|再|然后|并且|并|帮我|严格|\bplease\b)\s*)*只读(?:地)?(?:核对|核查|检查|审查|审阅|审核|核验|查看|读取|观察|诊断|评估|访问|分析|查询|检索|统计|提取)/i.test(clause)
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
  const workClauses=(activeClauses||sharedEnglishNegation(userClauses).split(/[\n。；;，,]+|\.(?=\s|$)/))
    .flatMap(x=>optOut(x).split(/但是|但|而是|\bbut\b/i));
  const positiveClauses=currentWorkClauses(workClauses.map(positiveRequestPrefix));
  const positive=independentWorkClauses(positiveClauses).join('\n');
  // Only actual user clauses establish a separate requested output. Host
  // interpretation may narrow scope, never manufacture an allowed output.
  const outputDestination=/(?:生成|输出|保存|写入|导出|制作|编写).{0,60}(?:输出目录|目标目录|交付目录|新目录)|(?:修改|调整|修复|编译|编辑|更改).{0,25}副本|\b(?:create|generate|write|save|export|produce).{0,60}\b(?:output|destination)\s+(?:directory|folder)\b/i.test(positive);
  const allowsSeparateOutput=SEPARATE_OUTPUT.test(positive)||outputDestination||constructiveWork(positiveClauses),componentBuild=COMPONENT_BUILD.test(positive);
  // A prose answer delivered in chat has no persistent side effect. This does
  // not prove that its inputs are available or permit reading any resource.
  // Separately requested files/media still take their own positive-work path.
  const chatProseOnly=!allowsSeparateOutput&&workClauses.some(clause=>
    CHAT_SPEECH.test(clause)||/(?:结论|结果|说明|回复|答案)(?:只|仅)?(?:发|贴|给|写)(?:在|到)?(?:当前|本次)?(?:聊天|对话)|\b(?:reply|answer|respond|explain|summari[sz]e|report)\b.{0,45}\bin\s+(?:the\s+)?chat\b/i.test(clause));
  if(chatProseOnly)evidence.push({source:'user-request',scope:'all-writes',basis:'chat-prose-delivery-without-persistent-work'});
  // Observation and conversation request information, not persistent effects.
  // This inference describes the current requested work; it is not a new host
  // prohibition and never grants permission for an unknown action. Explicit or
  // implicit artifacts and operations with unknown effects keep their own path.
  const observation=/^(?:(?:请|先|再|帮我|并|同时|直接|please|and|then)\s*)*(?:查(?:询|找)?|搜索|检索|查看|检查|审查|审阅|核验|读取|观察|诊断|评估|比较|解释|说明|告诉我|回答|报告|\b(?:read|inspect|review|audit|check|observe|diagnose|evaluate|search|look up|compare|explain|describe|tell me|answer|report)\b)/i;
  const chatLocation=/^(?:(?:请|先|再|帮我|并|同时|直接)\s*)*(?:在|于)(?:本次|当前)?(?:这里|聊天|对话)(?:中|里)?|^\s*in\s+(?:(?:the|this|current)\s+)?chat\b/i;
  const uncertainEffect=/(?:^|并|然后|\band\s+|\bthen\s+)(?:(?:请|先|再|帮我|同时|please)\s*)*(?:运行|执行|启动|点击|操作|登录|\b(?:run|execute|start|click|operate|login)\b)/i;
  const sourceAttribute=x=>/^read[- ]only\b/i.test(x)&&!readOnlyOperation(x);
  const observed=x=>(observation.test(x)&&!sourceAttribute(x))||chatLocation.test(x);
  const neutral=x=>/^(?:说明|解释)$/.test(x)||sourceAttribute(x)||/(?:只读|\bread[- ]only\b)\s*$/i.test(x);
  const observationRequested=!allowsSeparateOutput&&!positiveClauses.some(x=>uncertainEffect.test(x))
    &&positiveClauses.some(observed)&&positiveClauses.every(x=>observed(x)||neutral(x));
  if(observationRequested&&!chatProseOnly)evidence.push({source:'user-request',scope:'all-writes',basis:'requested-observation-without-persistent-work',inferred:true});
  for(const input of inputs){
    const text=optOut(sharedEnglishNegation(input.text));
    let adjacentProtectedTarget=null;
    for(const part of text.split(/([\n。；;，,]+|\.(?=\s|$))/)){
      // Ellipsis can inherit the immediately preceding protected object across
      // a comma, never across a new sentence, semicolon, host input or task.
      if(/^[\n。；;，,.]+$/.test(part)){
        if(!/^[，,]+$/.test(part))adjacentProtectedTarget=null;
        continue;
      }
      const clause=part.trim();if(!clause)continue;
      if(forbidsNetwork(clause))networkEvidence.push({source:input.source,scope:'network-access',clause});
      const priorTarget=adjacentProtectedTarget;adjacentProtectedTarget=null;
      const check=clause.replace(SEMANTIC_INVARIANT,'');
      const chatOnly=/(?:只|仅)(?:在聊天(?:中)?|用文字)(?:回复|回答|报告|解释|给出)|\b(?:reply|answer|respond)\b.{0,20}\b(?:in chat|with text) only\b/i.test(check);
      const globalWriteLimit=forbidsAllWrites(check);
      const reverseProhibition=globalWriteLimit||/\b(?:all|any)\s+(?:writes?|mutations?|modifications?|changes?)\s+(?:is|are)\s+(?:forbidden|prohibited|disallowed)\b|(?:禁止|不得)(?:一切|任何|所有)(?:写入|修改|改动)/i.test(check);
      const postfixRead=check.match(/\b(?:inspect|review|audit|check|read|search)\s+([^.;,\n]{1,80})\s+only\b/i);
      const boundedRead=postfixRead&&!/\b(?:write|create|generate|save|edit|modify|delete|upload|publish)\b/i.test(postfixRead[1]);
      if(!READ.test(check)&&!NO_WRITE.test(check)&&!reverseProhibition&&!boundedRead&&!chatOnly)continue;
      // Scope is established by the protected object itself. It must not depend
      // on successfully recognizing the verb used for a different deliverable.
      const componentRule=componentBuild&&COMPONENT_RULE.test(check);
      const hostWorkLimit=input.source==='host-restriction'&&/(?:仅|只)(?:允许|能)?(?:查看|检查|审查|审阅|审核|核验|读取|读回|观察|诊断|评估|搜索|检索|查询)|\b(?:only\s+(?:inspect|review|audit|check|read|plan|search)|(?:inspect|review|audit|check|read|plan|search)\s+only)\b/i.test(check);
      const operationLimit=readOnlyOperation(check)&&(input.source==='host-restriction'||!allowsSeparateOutput);
      const elliptical=priorTarget&&/^(?:(?:并且|并|且|也|\band\b)\s*)?(?:不要|不得|禁止|不允许|不能|不可|不|\b(?:do not|don't|must not|never)\s+)(?:再|直接|实际|\bagain\s+)?(?:覆盖|修改|改动|编辑|删除|重命名|\b(?:overwrite|modify|edit|delete|rename)\b)[!！\s]*$/i.test(check);
      const target=globalWriteLimit||chatOnly||hostWorkLimit||operationLimit?null:restrictionTarget(check)||(elliptical?priorTarget:null),scoped=!!target;
      if(scoped&&!componentRule)adjacentProtectedTarget=target;
      evidence.push({source:input.source,scope:componentRule?'component-behavior':scoped?'protected-target':'all-writes',clause,...(scoped?{target,basis:elliptical?'adjacent-protected-object-ellipsis; other-actions-require-user-request':'explicit-protected-object; other-actions-require-user-request'}:operationLimit?{basis:'explicit-read-only-operation'}:{})});
    }
  }
  if(invocation.mode==='plan')evidence.push({source:'host-plan-mode',scope:'all-writes'});
  if(invocation.readOnly===true)evidence.push({source:'host-read-only',scope:'all-writes'});
  if(invocation.networkForbidden===true)networkEvidence.push({source:'host-network-restriction',scope:'network-access'});
  const sources=[...new Set(evidence.filter(x=>x.scope==='all-writes').map(x=>x.source))];
  const observationalOnly=!allowsSeparateOutput&&evidence.some(x=>x.source==='user-request'&&x.scope==='protected-target')&&observationalWorkOnly(positiveClauses);
  if(observationalOnly&&!sources.includes('user-request'))sources.push('user-request');
  return {readOnly:sources.length>0,sources,protectedScopes:evidence.filter(x=>x.scope!=='all-writes'),evidence:[...evidence,...networkEvidence],networkForbidden:networkEvidence.length>0,
    workMode:observationalOnly?'observational-only':allowsSeparateOutput?'separate-output-requested':'unresolved'};
}
