// No I/O. Each witness consumes the whole request and binds chat actions to
// supplied operands. Unrecognized wording falls through to normal discovery.
const num='[+-]?\\d+(?:\\.\\d+)?';
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const sentences=s=>s.split(/[。！？!?;；\n]+|\.(?=\s|$)/).map(x=>x.trim()).filter(Boolean);
const ask=s=>s.replace(/^(?:(?:请|帮我|并|顺便|直接)\s*)+/,'').replace(/^(?:and\s+)?(?:please\s+)?/i,'');
const finite=s=>Number.isFinite(Number(s))&&Math.abs(Number(s))<=1e9;
const effect=/查找|查询|核实|联网|读取|打开|保存|导出|发送|运行|调用|启用|创建|安装|执行|照做|附件|https?:|[A-Za-z]:[\\/]|\b(?:use|invoke|read|open|save|export|send|email|run|execute|verify|search|fetch|create|install|attachment)\b/i;
// A quoted medical/financial/legal operation still needs the existing evidence
// path. Source attribution establishes an input, not domain sufficiency.
const highStakes=/药物|药品|用药|剂量|诊断|治疗|投资|股票|法律|税务|\b(?:medical|medicine|medication|dosage|dose|diagnosis|treatment|investment|legal|tax)\b/i;
const resultExplanation=s=>/^(?:用[一二两三\d]+(?:句话|句))?(?:解释|说明)(?:计算结果|结果|计算步骤|这里为什么除以\s*\d+)$/.test(ask(s))
 || /^explain (?:the (?:result|calculation)|why the denominator is \d+)$/i.test(ask(s));
const witness=(kind,inputCount)=>({kind,instructionText:'在聊天计算已给定数量或解释已给定引文',inputCount,chatOnly:true,authority:'advisory-only'});

function quotedDiscussion(raw){
 const quotes=[...raw.matchAll(/“[^”\n]{1,800}”|「[^」\n]{1,800}」|"[^"\n]{1,800}"/g)];
 if(quotes.length!==1)return null;
 const q=quotes[0],before=raw.slice(0,q.index).trim(),after=raw.slice(q.index+q[0].length).trim();
 if(effect.test(before))return null;
 // A source attribution is background, not an instruction to inspect software.
 if(!/^(?:(?:我(?:正在|在)?(?:审|阅读)(?:一份|这份)[\p{L}\p{N}_ -]{0,40}(?:说明|文档|手册)[，,][ \t]*)?(?:里面|说明中|文档中|手册中)写着|(?:下面|以下)(?:这段)?(?:引文|文字)|(?:the[ \t]+)?[\w -]{0,40}(?:manual|document|message)[ \t]+says)[ \t]*[:：]$/iu.test(before))return null;
 const parts=sentences(after).flatMap(x=>x.split(/[，,]/)).map(x=>ask(x.trim())).filter(Boolean);
 if(!parts.length)return null;
 const interpretation=/^(?:(?:解释|说明)(?:这句话|这段文字|引文)(?:的含义|会产生什么影响|意味着什么)|explain (?:what this sentence would do|the meaning of this (?:sentence|text)))$/i;
 const rewrite=/^(?:改写成(?:更)?(?:谨慎|简洁|清晰|礼貌|正式)的(?:说明|句子|文字)|rewrite it (?:more )?(?:cautiously|clearly|concisely|politely))$/i;
 return parts.every(x=>interpretation.test(x)||rewrite.test(x))?witness('quoted-chat-discussion',1):null;
}

function numericStatistics(raw){
 const parts=sentences(raw),source=parts.shift()||'';
 const m=/^(?:(?:一组|这些|给定的)?(?:测量值|数值|数据)(?:是|为|[:：])|(?:the\s+)?(?:values|numbers|measurements)\s+are)\s*(.+)$/i.exec(source);
 if(!m)return null;
 const values=m[1].split(/[,，、]/).map(x=>x.trim());
 if(!values.length||values.length>20||!values.every(x=>new RegExp('^'+num+'$').test(x)&&finite(x)))return null;
 const actions=parts.flatMap(x=>x.split(/[，,]/)).map(x=>ask(x.trim())).filter(Boolean);
 const aggregate=/^(?:(?:算出|计算|求)(?:平均数|平均值|均值|总体方差|方差|总和|中位数)(?:(?:和|与|、)(?:平均数|平均值|均值|总体方差|方差|总和|中位数))*|(?:calculate|compute|find) (?:the )?(?:mean|average|population variance|variance|sum|median)(?: and (?:the )?(?:mean|average|population variance|variance|sum|median))*)$/i;
 return actions.length&&aggregate.test(actions[0])&&actions.slice(1).every(resultExplanation)?witness('supplied-statistics',values.length):null;
}

const numericCountWords='one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
function numericCount(value){
 if(!value)return null;
 if(/^\d+$/.test(value))return Number(value);
 const en=numericCountWords.indexOf(value.toLowerCase());if(en>=0)return en+1;
 const digits='一二三四五六七八九';
 if(value==='两')return 2;
 if(value.length===1&&digits.includes(value))return digits.indexOf(value)+1;
 if(value==='十')return 10;
 if(/^十[一二三四五六七八九]$/.test(value))return 11+digits.indexOf(value[1]);
 if(value==='二十')return 20;
 return NaN;
}

function numericSort(raw){
 // Every clause is consumed: one operation binds one colon-delimited source;
 // any remaining clauses must be exact chat-output restrictions. No lookup,
 // file, code or second operation can be projected out of this grammar.
 const parts=sentences(raw),first=ask(parts.shift()||'');
 const binding=/^([^:：]+)[:：]\s*(.+)$/.exec(first);if(!binding)return null;
 const instruction=binding[1].trim();
 const zh=/^(?:按|按照)(?:数字|数值)?(从小到大|从大到小|升序|降序)(?:排列|排序)\s*(.+)$/.exec(instruction);
 const en=/^(?:sort|order|arrange)\s+(.+?)\s+in\s+(ascending|descending)(?:\s+(?:numeric|numerical))?\s+order$/i.exec(instruction);
 if(!zh&&!en)return null;
 const reference=(zh?zh[2]:en[1]).trim();
 const collection=zh
  ? /^(?:(?:这|这些|以下|下面|给定)(?:的)?)?(?:([\d一二三四五六七八九十两]+)(?:个)?)?(?:项|数字|数值|数|条目)$/.exec(reference)
  : new RegExp('^(?:(?:the|these|following|supplied|given)\\s+)?(?:(\\d+|'+numericCountWords.join('|')+')\\s+)?(?:numbers|values|items|entries)$','i').exec(reference);
 if(!collection)return null;
 const count=numericCount(collection[1]);
 const source=binding[2].trim(),items=source.split(/\s*[,，、]\s*/);
 if(items.length<2||items.length>20||(count!==null&&count!==items.length))return null;
 // A numeric identity may have a uniform label on either side. Requiring one
 // numeric key and identical wrappers prevents free prose from posing as data.
 const itemPattern=new RegExp('^([\\p{L}]{0,16})\\s*('+num+')\\s*([\\p{L}]{0,16})$','u');
 const operands=items.map(item=>itemPattern.exec(item.trim()));
 if(operands.some(item=>!item||!finite(item[2])||effect.test(item[0])))return null;
 if(operands.some(item=>item[1]!==operands[0][1]||item[3]!==operands[0][3]))return null;
 const output=/^(?:(?:不要|无需|不必)补充说明|(?:只|仅)(?:输出|返回|给出)(?:结果|答案)|(?:return|output|give)\s+only\s+(?:the\s+)?(?:result|answer)|(?:no|without)\s+(?:additional\s+)?explanation|(?:reply|respond)\s+(?:here|in\s+chat)\s+only)$/i;
 if(!parts.every(part=>output.test(ask(part))))return null;
 const order=/从小到大|升序|ascending/i.test(zh?zh[1]:en[2])?'ascending':'descending';
 return {kind:'supplied-numeric-sort',instructionText:'在聊天按明确数字顺序排列已完整给定的有限列表',
  inputCount:items.length,chatOnly:true,authority:'advisory-only',
  numericList:{operation:'sort',order,delivery:'chat',items:operands.map(item=>({text:item[0],key:Number(item[2])}))}};
}

function quantityBalance(raw){
 // Only a first-person ongoing activity can introduce background. A request
 // such as “请设计…” remains an action and cannot be removed by this projection.
 const background=/^我(?:正在|在)设计[\p{L}\p{N}_ -]{1,35}[:：]/u.exec(raw);
 if(background&&effect.test(background[0]))return null;
 let text=background?raw.slice(background[0].length):raw;
 if(effect.test(text))return null;
 const parts=sentences(text);if(parts.length<2||parts.length>3)return null;
 const facts=parts[0].split(/[，,]/).map(x=>x.trim());
 const start=new RegExp('^[\\p{L}]{1,12}有\\s*('+num+')\\s*([\\p{L}]{1,12})$','u').exec(facts.shift()||'');
 if(!start||!finite(start[1])||!facts.length||facts.length>4)return null;
 const rates=facts.map(x=>new RegExp('^([\\p{L}]{1,8}?)(?:一|1)([\\p{L}]{1,10})\\s*(?:耗|消耗|需要)\\s*('+num+')\\s*([\\p{L}]{1,10})$','u').exec(x));
 if(rates.some(x=>!x||!finite(x[3])||Number(x[3])<=0||!start[2].startsWith(x[4])))return null;
 const question=/^(.+?)后还(?:能|可以)(.+?)(?:多少|几)(.+)$/.exec(parts[1]);
 if(!question||!rates.some(x=>x[1]===question[2]&&x[2]===question[3]))return null;
 const events=question[1].split(/、|[，,]/).map(x=>x.trim());
 if(!events.length||events.length>8||!events.every(event=>rates.some(rate=>{
  const m=new RegExp('^'+esc(rate[1])+'\\s*('+num+')\\s*'+esc(rate[2])+'$').exec(event);
  return m&&finite(m[1])&&Number(m[1])>=0;
 })))return null;
 if(parts[2]&&!resultExplanation(parts[2])&&!/^写一句适合[\p{L}]{1,16}的说明$/u.test(ask(parts[2])))return null;
 return witness('supplied-quantity-balance',events.length+rates.length+1);
}

export function closedChatTask(raw){
 raw=String(raw||'').trim();
 if(!raw||raw.length>1200||/```|[\uE000-\uE101]/.test(raw)||highStakes.test(raw))return null;
 return quotedDiscussion(raw)||numericStatistics(raw)||numericSort(raw)||quantityBalance(raw);
}
