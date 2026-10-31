// A bounded grammar for speech acts over text present in the request. This is
// evidence of input closure, not a general language parser or an authorization.
// Every non-data clause must be consumed. Unknown/composite work falls through.
const MARK = '\\uE100\\d+\\uE101';
const effect = /联网|上网|搜索|查找|查询|检索|核实|查证|打开|运行|执行|保存|导出|发送|提交|发布|部署|安装|下载|上传|修改文件|删除|移除|移动|复制|创建|访问|调用|启用|使用|借助|\$[\w:-]+|\b(?:use|search|browse|fetch|verify|open|run|execute|save|export|send|submit|publish|deploy|install|download|upload|invoke|enable|delete|remove|move|copy|create)\b/i;
const split = value => value.split(/[。！？!?\n]+|\.(?=\s|$)/).map(x=>x.trim()).filter(Boolean);
const ask = value => value.replace(/^(?:(?:请你?|帮我|直接|麻烦)\s*)+/,'').replace(/^please\s+/i,'');
const neg = /^(?:不要|不得|禁止|无需|不必|不)(?:(?:联网|上网|检查机器|读写文件|读文件|写文件|(?:调用|使用)(?:其中提到的|任何|外部)?(?:能力|工具|插件)|(?:查询|访问)(?:任何)?(?:外部)?(?:系统|数据库|网站|网页))(?:或|和|与|、)?)+$|^(?:without (?:network access|external tools|external lookups)|do not (?:use tools|read or write files|go online))$/i;
const noExtra = /^(?:(?:不添加|不要增加|不增添)(?:任何)?(?:信息|内容)|(?:do not add|without adding) (?:any )?(?:information|content))$/i;
const output = /^(?:(?:只|仅)?(?:给出|给|输出|返回)(?:改写后|改后|整理后|修改后|概括后)?(?:的)?(?:句子|一句话|文字|文本|结果|答案|列表|编号列表)|(?:直接)?(?:在|于)(?:本次|当前)?(?:聊天|对话)(?:中|里)?(?:回答|答复|回复|输出)|(?:return|output|give) (?:only )?(?:the )?(?:rewritten )?(?:sentence|text|result|answer|list))$/i;
const sourceNotice = /^(?:(?:引文|引用|材料|记录|附加字段|字段|文本|描述|description\s*=)[\s\S]{0,180}(?:待分析材料|记录里的字符串|不是(?:对你的)?(?:任务|技能)?指令)|(?:the )?(?:quote|record|field|text)[\s\S]{0,150}(?:data|not instructions))$/i;
const notice = value => sourceNotice.test(value)&&!effect.test(value);
const interpretation = value => {
 const body=ask(value).replace(/^用(?:[一二两三四五六七八九十\d]+)?(?:句话|句|条|个要点)\s*/, '');
 // An interpretation must ask about evidence in the supplied record, not any
 // real-world claim that happens to follow “explain”. Entire suffixes are bound.
 return /^(?:说明|指出|判断)(?:哪些|哪项)(?:事实|结论|说法)(?:已|已经)?(?:有证据|有依据|获支持|成立)$/.test(body)
   || /^(?:说明|指出|判断)(?:记录|引文|材料)(?:中|里)(?:存在)?(?:什么|哪些)?(?:矛盾|分歧|未决事项|已知事实)$/.test(body)
   || /^(?:说明|指出)(?:他们|双方)(?:当前|目前)?(?:尚未|还未|未)(?:达成|确定)(?:哪项|什么)(?:决定|共识)$/.test(body)
   || /^(?:说明|解释)(?:结果|上述结果|两者区别|限制)$/.test(body)
   || /^(?:说明|指出)[A-Za-z][\w-]{0,25}的值$/.test(body)
   || /^说明(?:哪个|哪一个|哪些)(?:数字|数值)(?:较大|较小|相同|相等)$/.test(body)
   || new RegExp('^区分(?:'+MARK+'){2,6}(?:各自)?(?:是否|哪些)(?:已|已经)?(?:获证据|有证据|有依据)$').test(body);
};

function harmlessSuffix(text) {
  return text.split(/[，,；;]+|、(?=不|禁止|无需)/).map(x=>ask(x.trim())).filter(Boolean).every(part =>
    neg.test(part) || noExtra.test(part) || output.test(part) || notice(part)
      || /^不是(?:对你的)?(?:任务|技能)?指令$/.test(part));
}

function prepared(raw) {
  if (!raw || raw.length > 1200 || /[\uE100\uE101]|```/.test(raw)) return null;
  const literals=[];
  const text=raw.normalize('NFKC').replace(/“[^”\n]{1,800}”|‘[^’\n]{1,800}’|「[^」\n]{1,800}」|『[^』\n]{1,800}』|"[^"\n]{1,800}"|'[^'\n]{1,800}'/g,value=>{
    literals.push(value.slice(1,-1));return `\uE100${literals.length-1}\uE101`;
  });
  return {text,literals};
}

const countOf = value => /^\d+$/.test(value)?Number(value):({'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}[value]);
const witness = (kind, inputCount) => ({kind,instructionText:'对已给定文字作一次限定的文字处理',inputCount,chatOnly:true,authority:'advisory-only'});
function suppliedRecord(body) {
 const entries=body.split(/[；;，,]/).map(x=>x.trim());
 return entries.length<=20&&entries.every(entry=>{
   if(!entry||/附件|未提供|待提供|见(?:文件|记录)|详见|\.\.\.|…|https?:|[A-Za-z]:[\\/]|[,，]|然后|并且|同时|另外|接着|随后|\b(?:then|and|also)\b/i.test(entry))return false;
   const facts=entry.replace(/(?:调用|执行|认证)(?:结果|记录)|安装状态|配置启用|会话可调用/g,'事实字段');
   return !effect.test(facts)&&/(?:[:：=]|为|是|没有|未有|尚无|说|表示)/.test(entry);
 });
}

export function closedSuppliedProse(raw) {
  const p=prepared(String(raw||'').trim());if(!p)return null;
  const sentences=split(p.text),first=ask(sentences.shift()||'');

  // A rewrite binds a paired literal to a result complement. A supplied deadline
  // is a content constraint; it is not a request to find the current time or send.
  const rewritten=new RegExp('^(?:把|将)\\s*('+MARK+')\\s*(?:改写|润色|改)(?:成|为|得)\\s*([^。]{1,160})$').exec(first)
    ||new RegExp('^(?:rewrite|rephrase)\\s*('+MARK+')\\s+(?:as|into)\\s+([^。]{1,160})$','i').exec(first);
  if(rewritten){
    const parts=rewritten[2].split(/[，,；;]+/).map(x=>x.trim()).filter(Boolean);
    const style=parts.shift()||'';
    const stylePart=x=>/^(?:(?:更|较|非常|稍微|礼貌|明确|自然|清晰|简洁|简短|精炼|正式|友好|通顺|流畅|委婉|专业|客观|温和|且|而|的|一句话|一句|句子|文字|文本|通知|一段|、|\s)+|(?:(?:a|an|more|polite|clear|natural|concise|formal|friendly|sentence|text|notice|and)\s*)+)$/i.test(x);
    // Style may be coordinated. Keep/pass-through clauses can contain literal
    // content, but cannot introduce a second imperative after a conjunction.
    const content=x=>/^(?:保留|保持)(?:原意|原有含义|原来的意思|原顺序)$/.test(x)
      ||new RegExp('^(?:保留|保持|包含|写明|注明)\\s*'+MARK+'$').test(x)
      ||/^(?:保留|保持|包含|写明|注明)(?:今天|明天|后天|周[一二三四五六日天])(?:[0-2]?\d|[一二两三四五六七八九十]{1,3})(?:点|:[0-5]\d)(?:[0-5]?\d分)?(?:前|后)?(?:(?:提交|完成|开会)的)?(?:截止时间|截止日期|时间)?$/.test(x);
    if(stylePart(style)&&parts.every(x=>stylePart(x)||content(x)||harmlessSuffix(x))
      &&sentences.every(x=>harmlessSuffix(x)))return witness('rewrite',1);
  }

  // The colon owns a bounded literal list up to the sentence boundary. A name
  // such as “browser” in that list is an operand, not an external capability.
  const list=new RegExp('^(?:把|将)(?:下面|以下|这)?([一二两三四五六七八九十\\d]+)?项(?:按(?:原|输入)顺序)?(?:整理|排版|列出|转换)(?:成|为)?(?:编号列表|项目列表|项目符号列表|列表)((?:[,，].*)?)[:：]\\s*(.+)$').exec(first);
  if(list&&(!list[2]||harmlessSuffix(list[2]))){
    const items=list[3].split(/[、;；]/).map(x=>x.trim());
    if(items.length>=1&&items.length<=20&&(!list[1]||countOf(list[1])===items.length)
      &&items.every(x=>x.length>0&&x.length<=80&&!/\.\.\.|…|未知|待提供/.test(x)
        &&(new RegExp('^'+MARK+'$').test(x)||/^[\p{L}\p{N}_ -]+$/u.test(x)))
      &&sentences.every(harmlessSuffix))return witness('format-list',items.length);
  }

  const summary=new RegExp('^(?:只|仅)?(?:概括|总结)(?:下面|以下)?(?:这段|这份)?(?:会议|短|给定|提供的)?(?:引文|文字|文本|材料|记录)(?:的(?:观点|内容|要点))?([^：:]{0,80})[:：]\\s*('+MARK+')(.*)$').exec(first);
  if(summary&&(!summary[1]||harmlessSuffix(summary[1]))
    &&(!summary[3]||interpretation(summary[3]))
    &&sentences.every(x=>harmlessSuffix(x)||notice(x)||interpretation(x)))return witness('summary',1);

  // Explicitly supplied records are scoped data, including fields that mention
  // software or contain commands. The following request must stay a text-only
  // interpretation; an actual inspection or verification does not close here.
  const record=/^(?:只|仅)?(?:根据|依据)(?:这份|以下|下面|这段)?(?:给定|已给出|提供的)(?:记录|材料|文本)(?:作|做|进行)(?:逻辑判断|逻辑分析|判断|概括|总结|解释)([^：:]{0,100})[:：]([\s\S]{1,700})$/.exec(first);
  if(record&&(!record[1]||harmlessSuffix(record[1]))&&suppliedRecord(record[2])&&sentences.length){
    let interpreted=false;
    const complete=sentences.every(value=>{
      const clause=ask(value);
      if(notice(clause)||harmlessSuffix(clause))return true;
      if(interpretation(clause)){
        interpreted=true;return true;
      }
      return false;
    });
    if(complete&&interpreted)return witness('record-interpretation',1);
  }
  return null;
}
