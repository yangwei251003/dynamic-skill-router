import {closedSuppliedProse} from './supplied-prose.mjs';
import {positiveRequestPrefix,sharedEnglishNegation} from './task-restrictions.mjs';
// A small, no-I/O grammar for supplied-data transformations. A successful
// parse is a closure witness, not permission to execute or discover anything.
const TOKEN = '\\uE000\\d+\\uE001';
const AGGREGATE = '中位数|平均值|均值|总和|最大值|最小值|median|mean|average|sum|maximum|minimum';
const UNKNOWN = /^(?:未知|未(?:知|给出|提供)|待定|缺失|若干|一些|unknown|unspecified|missing|null|undefined|[?？]+)$/i;
const incomplete = value => UNKNOWN.test(value.trim()) || /\.\.\.|…/.test(value);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function suppliedLiterals(raw) {
  if (!raw || raw.length > 1200 || /[\uE000\uE001]/.test(raw)) return null;
  const values = [];
  // Only paired literals are replaced. Unmatched quotation marks stay in the
  // instruction and cannot satisfy any complete operation below.
  const instruction = raw.normalize('NFKC').replace(/“[^”\n]{1,800}”|「[^」\n]{1,800}」|『[^』\n]{1,800}』|‘[^’\n]{1,800}’|"[^"\n]{1,800}"|'[^'\n]{1,800}'/g, value => {
    const token = `\uE000${values.length}\uE001`;
    values.push(value.slice(1,-1));
    return token;
  });
  return {instruction, values};
}

function literal(value, values) {
  const token = /^\uE000(\d+)\uE001$/.exec(value.trim());
  return token ? values[Number(token[1])] : null;
}

function declaredCount(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '一二三四五六七八九';
  if (digits.includes(value) && value.length === 1) return digits.indexOf(value) + 1;
  if (value === '两') return 2;
  if (value === '十') return 10;
  if (/^十[一二三四五六七八九]$/.test(value)) return 11 + digits.indexOf(value[1]);
  if (value === '二十') return 20;
  return NaN;
}

function numberList(source, values) {
  source = (literal(source, values) ?? source).trim();
  let count;
  const declared = /^(?:([\d一二三四五六七八九十两]+)个)?(?:数字|数值|数)\s*[:：]?\s*/.exec(source)
    || /^(?:(\d+)\s+)?(?:numbers|values)\s*:?\s*/i.exec(source);
  if (declared) {
    if (declared[1]) count = declaredCount(declared[1]);
    source = source.slice(declared[0].length);
  }
  if (/^\[[\s\S]*\]$/.test(source)) source = source.slice(1,-1).trim();
  const parts = source.split(/\s*[,，、;；]\s*/);
  return parts.length >= 1 && parts.length <= 20 && (count === undefined || count === parts.length)
    && parts.every(value => /^[+-]?\d+(?:\.\d+)?$/.test(value)
      && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e9);
}

function textList(source, values) {
  const quoted = literal(source, values);
  const parts = (quoted ?? source).split(/\s*[,，、;；]\s*/);
  if (parts.length < 2 || parts.length > 20) return false;
  return parts.every(part => {
    const item = (quoted === null ? literal(part, values) ?? part : part).trim();
    // Unquoted operands must be scalar words, never descriptions of an absent
    // collection. Quoted items may contain arbitrary words, including tool names.
    return item.length > 0 && item.length <= 80 && !incomplete(item)
      && (quoted !== null || literal(part, values) !== null || /^[\p{L}\p{N}_-]+$/u.test(item));
  });
}

function fieldPresent(source, field, values) {
  const text = literal(source, values);
  field = (literal(field, values) ?? field).trim();
  if (text === null || !/^[\p{L}\p{N}][\p{L}\p{N}_ -]{0,29}$/u.test(field)) return false;
  // Bind the requested label to a supplied record value. Merely mentioning a
  // label elsewhere does not prove that the requested input was supplied.
  const record = new RegExp('(?:^|[;；,，\\n])\\s*' + escape(field)
    + '\\s*(?:[:：=]\\s*([^;；,，\\n]+)|(?=[A-Za-z0-9])([^;；,，\\n]+))', 'i').exec(text);
  const value = (record?.[1] ?? record?.[2] ?? '').trim();
  return !!value && !incomplete(value);
}

// Modifiers must be complete suffixes. In particular, an output instruction
// cannot consume a following lookup, explanation, file write or second task.
const OUTPUT = /[,，;；]\s*(?:(?:只)?(?:输出|返回|给出|给)\s*(?:结果|答案|这个数|数值|数字|(?:逗号|顿号|空格)分隔的[\p{L}\p{N}_-]{1,12})|(?:return|output|give)\s+(?:only\s+)?(?:the\s+)?(?:result|answer|value|number|(?:comma|space)[- ]separated\s+(?:values|items|words)))\s*$/iu;
const ORDER = /(?:[,，;；]|并且|并|\s+and\s+)?\s*(?:保留|保持)(?:首次(?:出现)?|第一次出现|原有|原|输入)顺序\s*$|(?:[,;]|\s+and\s+)?\s*(?:preserve|preserving|keep|keeping)\s+(?:(?:the\s+)?(?:original|input)\s+order|(?:the\s+)?first[- ]occurrence\s+order)\s*$/i;
const PROHIBITION = /[,，;；]\s*(?:(?:不|不要|禁止|无需|不必)(?:联网|(?:查询|访问|检索)(?:任何|外部|其他)?(?:系统|数据库|网站|网页|资料)|(?:使用|调用)(?:任何|外部)?(?:工具|插件))|without\s+(?:network\s+access|external\s+lookups?|tools))\s*$/i;

const LIST_EXTERNAL = /仓库|数据库|附件|文件|目录|天气|实时|最新|未提供|待提供|待补充|待填写|未给出|未知|待定|缺失|其余|其他|查找|查询|检索|核实|获取|读取|打开|搜索|联网|上网|调用|使用|发送|发给|发邮件|联系|上传|发布|分享|保存|导出|创建|删除|安装|运行|执行|操作|启动|访问|点击|登录|写入|绘制|生成|拍摄|支付|购买|打印|打电话|网址|链接|浏览器|工具|插件|技能|补充|推荐|猜测|决定|然后|同时|并|另外|接着|[\uE000\uE001]|https?:|[A-Za-z]:[\\/]|\b(?:repository|database|attachment|files?|folder|weather|latest|current|missing|unknown|unspecified|fetch|read|open|search|lookup|verify|use|invoke|send|email|message|contact|call|upload|publish|share|save|export|create|delete|install|run|execute|operate|start|access|click|login|write|draw|generate|pay|buy|purchase|print|browser|tools?|plugins?|add|recommend|guess|decide|then|also)\b/i;
const LIST_ORDER = /^(?:保持|保留)(?:原|原有|输入)顺序$|^(?:keep|preserve)\s+(?:the\s+)?(?:original|input)\s+order$/i;

function listSuffix(value) {
  const text=value.trim().replace(/^(?:请|please\s+)/i,'');
  if(LIST_ORDER.test(text)||/^(?:不补充|不增加|不要增加|不添加)(?:任何)?内容$|^(?:do not add|without adding)\s+(?:any\s+)?(?:content|information)$|^(?:reply|respond|answer)\s+(?:here|in\s+(?:the\s+)?chat)\s+only$|^(?:只|仅)(?:在聊天(?:中)?|在这里)(?:回复|回答|输出)$/i.test(text))return true;
  // Consume every coordinated forbidden action. A prohibition is a scope
  // constraint only; it cannot supply an absent list or swallow a new request.
  const body=text.match(/^(?:不要|不得|禁止|无需|不必|不|do not\s+|don't\s+|never\s+)(.+)$/i)?.[1];
  if(!body)return false;
  const parts=body.split(/、|以及|或者|或|和|与|及|[,，]|\b(?:and|or)\b/i).map(x=>x.trim()).filter(Boolean);
  const denied=/^(?:(?:发布|分享|上传)(?:任何内容|内容|结果|列表)?|发送(?:给(?:任何人|他人|别人))?|(?:创建|保存|导出|读写|读取|读)(?:任何)?文件|联网|上网|(?:调用|使用)(?:任何|外部)?(?:工具|插件)|(?:publish|share|upload)(?:\s+(?:anything|content|results?|the list))?|send(?:\s+(?:it|anything|messages|the list))?(?:\s+to\s+(?:anyone|others))?|(?:create|save|export|read|write)\s+(?:any\s+)?files?|(?:access|use)\s+(?:the\s+)?(?:internet|network)|go\s+online|look\s+(?:anything|anything else|information)\s+up|(?:call|invoke|use)\s+(?:any\s+|external\s+)?tools?)$/i;
  return parts.length>0&&parts.every(x=>denied.test(x));
}

function suppliedListItems(source, values) {
  const whole=literal(source,values);
  const parts=(whole??source).split(/\s*[,，、]\s*|\s+and\s+/i);
  if(parts.length<1||parts.length>20)return null;
  const items=parts.map(part=>(whole!==null?part:literal(part,values)??part).trim());
  if(items.some((item,i)=>!item||item.length>80||incomplete(item)
    ||/^(?:待补充|待提供|待填写|未提供|未填写|空缺|tbd|n\/a|etc\.?|等等?)$/i.test(item)
    ||(whole===null&&literal(parts[i],values)===null
      &&(!/^[\p{L}\p{N}_ -]+$/u.test(item)||LIST_EXTERNAL.test(item)))))return null;
  return items;
}

const COUNT_WORDS='one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
const COUNT_EN='(?:\\d+|'+COUNT_WORDS.join('|')+')';
const COUNT_ZH='[\\d一二三四五六七八九十两]+';
function presentationCounts(text) {
  const zh=[...text.matchAll(new RegExp('('+COUNT_ZH+')(?:个|项|样|条|行)','g'))];
  const en=[...text.matchAll(new RegExp('\\b('+COUNT_EN+')\\b','gi'))].filter(x=>!zh.some(y=>y.index===x.index));
  return [...zh.map(x=>declaredCount(x[1])),...en.map(x=>/^\d+$/.test(x[1])?Number(x[1]):COUNT_WORDS.indexOf(x[1].toLowerCase())+1)];
}

function presentationOperation(raw) {
  let text=raw.trim().replace(/^(?:(?:请|帮我|直接)\s*)+/,'').replace(/^please\s+/i,'');
  const lineFormat=/分行|逐行|[列排分]成.{0,8}行|每项(?:单独)?一行|一项一行|\b(?:lines?|per line|line by line)\b/i.test(text);
  // Consume subordinate format/ordering phrases independently of their order.
  // Their counts are claims about the same supplied collection, not new data.
  text=text.replace(/每项(?:单独)?一行|一项一行|\b(?:line by line|one\s+(?:item\s+)?per\s+line|each\s+(?:item\s+)?on\s+(?:(?:a\s+)?(?:separate|new)|its own)\s+line)\b/gi,' ');
  const counts=presentationCounts(text);
  text=text.replace(/[,，]\s*(?:不补充|不增加|不添加)(?:任何)?内容\s*$/,'')
    .replace(/(?:按|按照|保持|保留)(?:原|原有|输入|给定)顺序/g,' ')
    .replace(/\b(?:in\s+(?:the\s+)?(?:same|original|input)\s+order|(?:keep|preserve)\s+(?:the\s+)?(?:original|input)\s+order)\b/gi,' ')
    .replace(/(?:在|于|到)(?:本次|当前)?(?:聊天|对话)(?:中|里)?/g,' ')
    .replace(/\b(?:in\s+(?:(?:the|this|current)\s+)?chat|here)(?:\s+only)?\b/gi,' ')
    .replace(new RegExp('(?:列成|排成|分成)\\s*'+COUNT_ZH+'行','g'),'列出')
    .replace(new RegExp('\\b(?:as|on|into)\\s+(?:'+COUNT_EN+'\\s+)?(?:(?:separate|individual)\\s+)?lines?\\b','gi'),' ')
    .replace(/分行|逐行/g,' ')
    .replace(/[,，]/g,' ').trim();
  const op=/^(?:列出|列|展示|呈现|输出|返回|写出)|^(?:list|display|show|present|return|output)\b/i.exec(text);
  if(!op&&!(lineFormat&&!text))return null;
  const label=text.slice(op?.[0].length||0).trim();
  if(label.length>90||LIST_EXTERNAL.test(label)||!/^[\p{L}\p{N}\s_'’\-]*$/u.test(label))return null;
  return {kind:'identity-presentation',counts,format:lineFormat?'lines':'list',delivery:'chat',order:'input'};
}

function suppliedDeclaration(text) {
  if(text.length>100||LIST_EXTERNAL.test(text))return null;
  // A declaration has a collection noun and only supplied-data qualifiers.
  // Word order does not matter; a missing-input or lookup predicate cannot be
  // consumed by this vocabulary. The actual colon-bound operands are checked
  // separately, so these words alone never prove data completeness.
  if(!/项目|条目|物品|清单|列表|名称|词语|单词|项|\b(?:items|entries|words|names|list)\b/i.test(text))return null;
  const residue=text.replace(new RegExp(COUNT_ZH,'g'),' ')
    .replace(/以下|下面|这些|给定|给出|提供|已经|全部|完整|项目|条目|物品|清单|列表|名称|词语|单词|如下|已|都|的|项|个|为/g,' ')
    .replace(new RegExp('\\b'+COUNT_EN+'\\b','gi'),' ')
    .replace(/\b(?:a|the|these|following|all|are|have|been|already|fully|given|supplied|provided|items|entries|words|names|list|of)\b/gi,' ').trim();
  return residue?null:{counts:presentationCounts(text)};
}

// Separate data binding from its presentation operation. Both orders use one
// representation and the same completeness checks; no noun/date-specific path.
function closedSuppliedList(instruction, values) {
  const clauses=instruction.split(/[。！？!?；;\n]+|\.(?=\s|$)/).map(x=>x.trim()).filter(Boolean);
  let data=null,operation=null;const counts=[];
  for(const clause of clauses){
    const colon=/^([^:：]+)[:：]\s*(.+)$/.exec(clause);
    if(colon){
      if(data)return null;
      const declaration=suppliedDeclaration(colon[1].trim()),op=declaration?null:presentationOperation(colon[1]);
      if(!declaration&&!op)return null;
      data=suppliedListItems(colon[2],values);if(!data)return null;
      counts.push(...(declaration||op).counts);
      if(op){if(operation)return null;operation=op;}
      continue;
    }
    if(listSuffix(clause))continue;
    const inline=/^(?:请\s*)?(?:把|将)\s*(.+?)\s*((?:按原顺序)?(?:列|列出|呈现|展示)(?:在|到)(?:本次|当前)?(?:聊天|对话)(?:中|里)?)$/.exec(clause);
    if(inline){
      if(data||operation)return null;
      data=suppliedListItems(inline[1],values);operation=presentationOperation(inline[2]);
      if(!data||!operation)return null;counts.push(...operation.counts);continue;
    }
    const op=presentationOperation(clause);
    if(!op||operation)return null;
    operation=op;counts.push(...op.counts);
  }
  if(!data||!operation||counts.some(n=>n!==data.length))return null;
  return {kind:'list-presentation',instructionText:'在聊天呈现已完整给定的短列表',inputCount:data.length,chatOnly:true,
    presentation:{input:'supplied-list',operation:operation.kind,format:operation.format,order:operation.order,delivery:operation.delivery},authority:'advisory-only'};
}

export function closedSuppliedPresentation(raw) {
  const supplied=suppliedLiterals(String(raw||'').trim());
  return supplied?closedSuppliedList(supplied.instruction,supplied.values):null;
}

const FORMAT_EFFECT=/https?:\/\/|[A-Za-z]:[\\/]|\b[\w-]+\.(?:csv|xlsx?|docx?|pdf|txt|json|png|jpe?g|py|js|mjs)\b|联网|查找|查询|检索|查证|核实|读取|读文件|打开|访问|调用|使用|发送|上传|发布|保存|导出|写入|创建|删除|安装|运行|执行|购买|支付|\b(?:look\s+up|lookup|search|verify|fetch|read|open|access|invoke|use|send|email|upload|publish|save|export|write|create|delete|install|run|execute|buy|pay)\b/i;
const SOURCE_MISSING=/\.\.\.|…|未(?:提供|给出|填写)|待(?:提供|补充|填写)|缺失|未知|不知道|见附件|详见|\b(?:missing|unknown|unspecified|tbd|not\s+(?:provided|given)|see\s+(?:the\s+)?attachment)\b/i;
const FORMAT_START=/^(?:(?:请|帮我|直接)\s*)*(?:(?:把|将)(?:这些|这段|这份|以下|下面|给定|已给出)(?:的)?(?:文字|文本|记录|数据|内容|清单)?\s*)?(?:整理|排版|改排|转换|转|编排|呈现|列)(?:成|为)|^(?:please\s+)?(?:turn|format|reformat|organi[sz]e|arrange|convert|present)\s+(?:this|these|the|it)(?:\s+[a-z][a-z-]{0,24}){0,5}?\s+(?:as|into|in)\s+/i;

function formattingModifiers(text) {
  // Apply delivery/locative normalization before recognizing the operation,
  // independent of modifier position. This projection never touches source spans.
  return text.replace(/(?:只|仅|直接)?(?:在|于)(?:当前|本次)?(?:这里|聊天|对话)(?:中|里)?(?:回复|回答|输出|呈现)?/g,' ')
    .replace(/\b(?:in\s+your\s+reply\s+here|in\s+(?:(?:the|this|current)\s+)?chat|reply\s+here\s+only|here\s+only)\b/gi,' ')
    .replace(/\s+/g,' ').trim();
}

function formattingInstruction(text) {
  text=formattingModifiers(text);
  const reference=/^(?:please\s+)?(?:turn|format|reformat|organi[sz]e|arrange|convert|present)\s+((?:this|these|the|it)(?:\s+[a-z][a-z-]{0,24}){0,5}?)\s+(?:as|into|in)\s+/i.exec(text)?.[1];
  if(reference&&(FORMAT_EFFECT.test(reference)||/\b(?:from|at|on|attached|external|online|latest|current)\b/i.test(reference)))return null;
  if(FORMAT_START.test(text))return text;
  // Field selection is still a transformation over the same supplied fragment.
  // The field names are opaque; this does not assert that each requested value
  // exists, or authorize consulting a second source to fill an absent value.
  const zh=/^(?:(?:请|帮我)\s*)*(?:从(?:这些|以下|给定)(?:记录|数据|文本|内容)(?:中)?)?提取([\p{L}\p{N}、和与及\s]{1,70})(?:并|，|,)\s*(?:整理|列|转换)(?:成|为)/u.exec(text);
  const en=/^(?:please\s+)?extract\s+([\p{L}\p{N}_ ,'-]{1,70})\s+from\s+(?:this|these(?:\s+records)?|the\s+(?:given|supplied)\s+(?:text|records|data))\s+(?:into|as)\s+/iu.exec(text);
  const match=zh||en;
  if(!match||FORMAT_EFFECT.test(match[1]))return null;
  return (zh?'整理成':'turn this into ')+text.slice(match[0].length);
}

function formatDirective(value) {
  const original=formattingInstruction(value.trim());
  if(!original)return null;
  let text=original.replace(FORMAT_START,'');
  // Delivery and preservation are instruction roles. Field labels stay opaque:
  // this witness proves the source is present, not the model's interpretation.
  let columns=[];
  text=text.replace(/^\s*[“「『"‘']([^”」』"’'\n]{1,100})[”」』"’']\s*/,(_,names)=>{columns=names.split(/\s*(?:\/|\||、|,|，)\s*/);return '';});
  const format=/^\s*(?:(?:[\d一二三四五六七八九十两]+)(?:条|行|列|个)?\s*){0,2}(?:清单|列表|表格|条目)|^\s*(?:(?:a|an)\s+)?(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:[- ](?:row|column|item|line))?\s+){0,2}(?:(?:numbered|bulleted)\s+)?(?:table|list|bullets|bullet points)\b/i.exec(text);
  if(!format)return null;
  const formatText=format[0],columnCounts=[];
  const rowShape=formatText.replace(new RegExp('('+COUNT_ZH+')列|\\b('+COUNT_EN+')[ -]column\\b','gi'),(_,zh,en)=>{
    columnCounts.push(zh?declaredCount(zh):/^\d+$/.test(en)?Number(en):COUNT_WORDS.indexOf(en.toLowerCase())+1);return ' ';});
  const counts=presentationCounts(rowShape.replace(/-(?:row|item|line)\b/gi,' items')),columnCount=columnCounts[0]??null;
  if([...counts,...columnCounts].some(n=>!Number.isInteger(n)||n<1||n>20)||columnCounts.some(n=>n!==columnCount))return null;
  if(columnCount&&columns.length&&columnCount!==columns.length)return null;
  text=text.slice(formatText.length);
  text=text.replace(/\bwith\s+([\p{L}\p{N}_ ,'-]{1,100})\s+columns\b/giu,(_,names)=>{columns=names.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean);return ' ';});
  const parts=sharedEnglishNegation(text).split(/[，,。；;!?\n]+|\.(?=\s|$)|但是|但|改为|然后|另外|接着|\bbut\b|\binstead\b|\bthen\b|\balso\b/i).map(x=>x.trim()).filter(Boolean);
  for(const part of parts){
    if(!positiveRequestPrefix(part))continue;
    if(FORMAT_EFFECT.test(part))return null;
    if(/^(?:保留|保持|只保留|列名为|表头为|包含列)(?:原顺序|原有顺序|[\p{L}\p{N}、和与及\s]{1,70})$|^(?:不补充|不增加|不添加)(?:任何)?内容$/u.test(part))continue;
    if(/^(?:with\s+[\p{L}\p{N}_ -]{1,70}\s+columns|(?:keep|preserve|retain|retaining)\s+[\p{L}\p{N}_ -]{1,70}|in\s+(?:the\s+)?(?:same|original|input)\s+order|only)$/iu.test(part))continue;
    return null;
  }
  return {format:/表格|table/i.test(formatText)?'table':/bullets|bullet points/i.test(formatText)?'bullets':'list',counts,columnCount,columns};
}

function sourceFragment(raw,start,end) {
  while(start<end&&/\s/.test(raw[start]))start++;
  while(end>start&&/[\s。.]$/.test(raw.slice(end-1,end)))end--;
  const text=raw.slice(start,end);
  if(!text||text.length>1000||SOURCE_MISSING.test(text))return null;
  // Resource references are not supplied contents. Imperative-looking words
  // inside an explicitly labelled record or quoted text remain source data.
  const payload=text.replace(/^[^。.!?\n:：=]{1,35}[:：=]\s*/, '').trim();
  const resourceOnly=/^(?:https?:\/\/\S+|[A-Za-z]:[\\/]\S+|[\w-]+\.(?:csv|xlsx?|docx?|pdf|txt|json))$/i;
  if(resourceOnly.test(text)||resourceOnly.test(payload))return null;
  if(/(?:数据|输入|资料|内容|清单|记录|详情)(?:都)?(?:在|来自|位于|见|保存于).{0,35}(?:附件|文件|账户|账号|数据库|仓库|官网|网页|链接|https?:|[A-Za-z]:[\\/]|\b[\w-]+\.(?:csv|xlsx?|txt|json))|\b(?:data|records|content|input|list|details|information)\s+(?:is|are|can be found)\s+(?:in|on|at)\s+.{0,35}(?:\b(?:account|attachment|file|database|repository|website)\b|https?:|\b[\w-]+\.(?:csv|xlsx?|txt|json))/i.test(text))return null;
  const labelled=/^[^。.!?\n:：]{1,35}[:：](?!\d)/.test(text),quoted=/^[“「『"‘'][\s\S]*[”」』"’']$/.test(text);
  const sentences=text.split(/[。!?！？\n]+|\.(?=\s|$)/).map(x=>x.trim()).filter(Boolean);
  const imperative=/^(?:另外|然后|接着|同时|请|帮我|你(?:需要|应该|必须)|先|再|读取|打开|访问|查找|查询|调用|使用|发送|保存|导出|执行|运行|创建|删除)|^(?:you\s+(?:should|must|need to)|please|then|also|and then|read|open|access|fetch|search|use|invoke|send|save|export|run|execute|create|delete)\b/i;
  if(!quoted&&sentences.some((s,i)=>imperative.test(s)&&!(i===0&&labelled)))return null;
  if(!quoted&&/[，,;；]\s*(?:另外|然后|接着|同时|请|帮我|please\b|then\b|also\b)/i.test(text))return null;
  // Some visible structure is needed to distinguish a supplied record from a
  // bare anaphor such as "the data". No field/value semantic proof is required.
  if(!labelled&&!quoted&&!/[,，;；:=]|\b(?:is|are|was|were|has|have|will)\b|为|是|有|负责|带来|携带/.test(text))return null;
  return {start,end,text};
}

export function closedSuppliedFormatting(raw) {
  raw=String(raw||'');if(!raw.trim()||raw.length>1600||/```|[\uE000\uE001\uE100\uE101]/.test(raw))return null;
  const boundaries=[0,...[...raw.matchAll(/[。！？!?;；\n]|\.(?=\s|$)|[”」』"’']/g)].map(x=>x.index+x[0].length)];
  for(const offset of boundaries){
    const rest=raw.slice(offset),leading=rest.match(/^\s*/)[0].length,start=offset+leading;
    if(!formattingInstruction(raw.slice(start)))continue;
    let source,instruction,descriptor;
    if(start>0){
      source=sourceFragment(raw,0,offset);instruction={start,end:raw.length,text:raw.slice(start)};
      descriptor=formatDirective(instruction.text.replace(/[。.!?！？]+\s*$/,''));
    }else{
      const colon=/[:：]/.exec(raw.slice(start));if(!colon)continue;
      const end=start+colon.index;
      instruction={start,end,text:raw.slice(start,end)};descriptor=formatDirective(instruction.text);
      source=sourceFragment(raw,end+1,raw.length);
    }
    if(!source||!descriptor)continue;
    const sourceHeader=source.text.match(/^([^:：]+)[:：](?!\d)/)?.[1];
    const declared=sourceHeader&&/(?:[\d一二三四五六七八九十两]+)(?:项|条|个)|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:items|records|entries|notes)\b/i.test(sourceHeader)?presentationCounts(sourceHeader):[];
    if(declared.some(n=>descriptor.counts.some(m=>n!==m)))continue;
    if(declared.length){
      const operands=suppliedLiterals(source.text.slice(source.text.search(/[:：]/)+1));
      const items=operands&&suppliedListItems(operands.instruction,operands.values);
      if(items&&declared.some(n=>n!==items.length))continue;
    }
    return {kind:'supplied-text-formatting',instructionText:'在聊天重新呈现当前请求已给定的文字',chatOnly:true,authority:'advisory-only',
      sourceSpans:[source],instructionSpans:[instruction],presentation:{input:'supplied-text',operation:'format',format:descriptor.format,rows:descriptor.counts[0]??null,columns:descriptor.columnCount??(descriptor.columns.length||null),columnLabels:descriptor.columns,delivery:'chat'}};
  }
  return null;
}

export function closedSuppliedTransformation(raw) {
  const prose = closedSuppliedProse(raw);
  if (prose) return prose;
  const supplied = suppliedLiterals(String(raw || '').trim());
  if (!supplied) return null;
  const {values} = supplied;
  const presented=closedSuppliedList(supplied.instruction,values);
  if(presented)return presented;
  const formatted=closedSuppliedFormatting(raw);
  if(formatted)return formatted;
  let text = supplied.instruction.trim().replace(/[。.!?？！]+$/,'').trim()
    .replace(/^(?:(?:请|帮我|直接)\s*)+/,'').replace(/^please\s+/i,'');
  // A precisely scoped prohibition only removes authority; it is never treated
  // as a requested lookup. Keep the untouched original request in assessment.
  text = text.replace(PROHIBITION,'');
  const instructionText = text;
  text = text.replace(OUTPUT,'');
  const withoutOrder = text.replace(ORDER,'');
  const ordered = withoutOrder !== text;
  text = withoutOrder;

  let match = /^(?:把|将|对)\s*(.+?)\s*(?:进行)?(?:去重|去掉重复项|删除重复项)$/.exec(text)
    || /^(?:去重|deduplicate)\s*[:：]?\s*(.+)$/i.exec(text)
    || /^remove\s+duplicates\s+from\s+(.+)$/i.exec(text);
  if (match && textList(match[1], values)) return {kind:'deduplicate', instructionText};
  if (ordered) return null;

  match = new RegExp('^(?:给定|已给出|given)\\s*(.+?)[,，;；]\\s*(?:求|计算|calculate|compute|find)\\s*(?:the\\s+)?(' + AGGREGATE + ')$', 'i').exec(text)
    || new RegExp('^(?:求|计算)?\\s*(.+?)\\s*的\\s*(' + AGGREGATE + ')(?:是多少|为多少)?$', 'i').exec(text);
  if (match && numberList(match[1], values)) return {kind:'aggregate', instructionText};
  match = new RegExp('^(?:calculate|compute|find)\\s+(?:the\\s+)?(' + AGGREGATE + ')\\s+(?:of|for)\\s+(.+)$','i').exec(text);
  if (match && numberList(match[2], values)) return {kind:'aggregate', instructionText};

  match = new RegExp('^(?:给定|已给出)\\s*(' + TOKEN + ')\\s*[,，;；]\\s*(?:只)?(?:输出|返回|给出)\\s*(.+)$').exec(text)
    || new RegExp('^从\\s*(' + TOKEN + ')\\s*(?:中|里)\\s*(?:提取|摘出)\\s*(.+)$').exec(text)
    || new RegExp('^given\\s*(' + TOKEN + ')\\s*[,;]\\s*(?:return|output)\\s+(?:only\\s+)?(?:the\\s+)?(.+)$','i').exec(text);
  if (match && fieldPresent(match[1],match[2],values)) return {kind:'field', instructionText};
  match = new RegExp('^(?:extract|return|output)\\s+(?:the\\s+)?(.+?)\\s+from\\s*(' + TOKEN + ')$','i').exec(text);
  if (match && fieldPresent(match[2],match[1],values)) return {kind:'field', instructionText};
  return null;
}
