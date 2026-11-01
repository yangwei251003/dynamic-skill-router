// Extract task directives separately from quoted or supplied material. These are
// advisory signals, not a replacement for the host's authorization decisions.
export function requestSegments(query='',{preserveNames=true}={}) {
  const raw=String(query);
  const spans=[];
  const blank=value=>value.replace(/[^\r\n]/g,' ');
  const add=(start,end,role,details={})=>spans.push({start,end,role,...details});
  const named=(inner,start)=>preserveNames&&!/(?:不要|不得|禁止|只读|联网|\boffline\b|\bread.only\b)/iu.test(inner)
    &&/^[$\p{L}\p{N}_.:-]+$/u.test(inner)
    &&(inner.startsWith('$')||/(?:使用|调用|启用|采用|用|\bapply|\buse|\binvoke)\s*$/iu.test(raw.slice(Math.max(0,start-18),start)));
  const closeQuote=(start,endChar)=>{for(let j=start+1;j<raw.length;j++)if(raw[j]===endChar&&raw[j-1]!=='\\'&&(endChar!=="'"||!/[\p{L}\p{N}]/u.test(raw[j+1]||'')))return j;return -1;};
  const pairs={'“':'”','‘':'’','「':'」','『':'』','"':'"',"'":"'"};
  const tag=/<\/?(quote|reference|source|attachment|document|example|blockquote)\b[^>]*>/gi;
  // Lex left-to-right. Once inside a quote, fence, inline code or material
  // tag, syntax inside it cannot start a competing outer construct.
  for(let i=0;i<raw.length;){
    const lineStart=i===0||raw[i-1]==='\n';
    if(lineStart){
      const fence=/^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/.exec(raw.slice(i));
      if(fence){const symbol=fence[1][0],length=fence[1].length,close=new RegExp(`^[ \\t]{0,3}${symbol}{${length},}[ \\t]*(?:\\r?\\n|$)`,'gm');close.lastIndex=i+fence[0].length;const found=close.exec(raw),end=found?close.lastIndex:raw.length;add(i,end,'code-or-example',found?{}:{boundary:'unclosed'});i=end;continue;}
      const quote=/^[ \t]*>[^\r\n]*/.exec(raw.slice(i));
      if(quote){add(i,i+quote[0].length,'quoted-material');i+=quote[0].length;continue;}
    }
    // Apostrophes in a URL query are URL data, not delimiters for a quotation.
    const url=/^https?:\/\/[^\s<>"“”。，！？；]+/i.exec(raw.slice(i));
    if(url){i+=url[0].length;continue;}
    if(raw[i]==='<'){
      tag.lastIndex=i;const open=tag.exec(raw);
      if(open&&open.index===i&&!/^<\//.test(open[0])){
        const stack=[open[1].toLowerCase()];let end=tag.lastIndex,closed=/\/\s*>$/.test(open[0]);
        while(!closed){const next=tag.exec(raw);if(!next)break;end=tag.lastIndex;const name=next[1].toLowerCase();if(/^<\//.test(next[0])){if(stack.at(-1)===name)stack.pop();if(!stack.length)closed=true;}else if(!/\/\s*>$/.test(next[0]))stack.push(name);}
        if(!closed)end=raw.length;add(i,end,'provided-material',closed?{}:{boundary:'unclosed'});i=end;continue;
      }
    }
    if(raw[i]==='`'){
      let end=i;while(raw[end]==='`')end++;const mark=raw.slice(i,end),at=raw.indexOf(mark,end),lineEnd=raw.indexOf('\n',end);
      const closed=at>=0&&(lineEnd<0||at<lineEnd),finish=closed?at+mark.length:(lineEnd<0?raw.length:lineEnd);
      if(!closed||!named(raw.slice(end,at),i))add(i,finish,'quoted-material',closed?{}:{boundary:'unclosed'});i=finish;continue;
    }
    const endChar=pairs[raw[i]];
    if(endChar&&!(raw[i]==='"'&&/\d/.test(raw[i-1]||''))&&(raw[i]!=="'"||!/[\p{L}\p{N}]/u.test(raw[i-1]||''))){
      const end=closeQuote(i,endChar),finish=end<0?raw.length:end+1;
      if(end<0||!named(raw.slice(i+1,end),i))add(i,finish,'quoted-material',end<0?{boundary:'unclosed'}:{});i=finish;continue;
    }
    i++;
  }
  let text=raw;
  for(const span of spans)text=text.slice(0,span.start)+blank(text.slice(span.start,span.end))+text.slice(span.end);
  const labels=/(?:引用材料|参考资料|参考文本|原文|正文|示例|例子|材料(?:如下|为|是)?|(?:以下|下面|如下)(?:的|是|为)?(?:正文|内容|文本|资料)|(?:正文|资料|参考资料)(?:如下|为|是)|reference text|quoted text|supplied text|example)\s*[:：]/gim;
  let labelMatch;
  while((labelMatch=labels.exec(text))){
    const start=labelMatch.index,end=labels.lastIndex;
    const next=spans.filter(s=>s.start>=end&&/^\s*$/.test(raw.slice(end,s.start))).sort((a,b)=>a.start-b.start)[0];
    add(start,end,'material-label');text=text.slice(0,start)+blank(text.slice(start,end))+text.slice(end);
    const openBlockquote=next?.role==='quoted-material'&&/^[ \t]*>/.test(raw.slice(next.start,next.end));
    if(!next||openBlockquote){
      for(let j=spans.length-1;j>=0;j--)if(spans[j].start>=end)spans.splice(j,1);
      add(end,raw.length,'provided-material',{boundary:'unclosed'});text=text.slice(0,end)+blank(text.slice(end));break;
    }
  }
  // Recognize the outer file-attachment wrapper only after masking material.
  // An arbitrary heading inside supplied text or code is never a new user turn.
  const marker=/^## My request:[ \t]*$/mi.exec(text);
  if(marker&&/^# Files mentioned by the user:[ \t]*$/mi.test(text.slice(0,marker.index))){
    const end=marker.index+marker[0].length;
    for(let i=spans.length-1;i>=0;i--)if(spans[i].end<=end)spans.splice(i,1);
    spans.push({start:0,end,role:'attached-context'});text=blank(text.slice(0,end))+text.slice(end);
  }
  spans.sort((a,b)=>a.start-b.start||a.end-b.end);
  return {text,spans,offsetUnit:'utf16'};
}
export function instructionText(query='',options={}) {
  return requestSegments(query,options).text
    .replace(/\[\$([\w.:-]+)\]\(app:\/\/[^\s)]+\)/g,' $$$1 ')
    .replace(/((?:使用|调用|启用|采用|用|\bapply|\buse|\binvoke)\s*)[“"「『`]([$\p{L}\p{N}_.:-]+)[”"」』`]/giu,'$1$2')
    .replace(/`(\$[\p{L}\p{N}_.:-]+)`/gu,'$1');
}

export function instructionClauses(text='') {
  // Query-string '?' and '=' belong to a supplied URL, not a sentence break.
  const urls=[];
  const protectedText=String(text).replace(/https?:\/\/[^\s<>"“”。，。！？；]+/giu,value=>{const i=urls.push(value)-1;return `\uE000${i}\uE001`;});
  return protectedText.split(/[。！？!?;；，,\n]+|(?<!\d)\.(?=\s+\S)/u)
    .flatMap(c=>c.split(/(?:但是|然而|而是|(?<![\p{L}\p{N}])but(?=\s)|(?<![\p{L}\p{N}])instead(?=\s))/iu))
    .map(c=>c.replace(/\uE000(\d+)\uE001/g,(_,i)=>urls[Number(i)]).trim()).filter(Boolean);
}

function maskDirectiveUrls(value='') {
  const text=String(value), urls=/https?:\/\/[^\s<>"“”。，！？；]+/giu;
  const pairs={'(':')','（':'）','[':']','【':'】'};
  let masked='',cursor=0,url;
  while((url=urls.exec(text))) {
    let prev=url.index-1;while(prev>=0&&/[ \t]/u.test(text[prev]))prev--;
    const open=text[prev],close=pairs[open];let length=url[0].length,depth=0;
    if(close)for(let i=0;i<url[0].length;i++){
      if(url[0][i]===open)depth++;
      else if(url[0][i]===close){if(depth>0)depth--;else{length=i;break;}}
    }
    masked+=text.slice(cursor,url.index)+url[0].slice(0,length).replace(/[^\r\n]/g,' ');
    cursor=url.index+length;urls.lastIndex=cursor;
  }
  return masked+text.slice(cursor);
}

// Current, exact tool prohibitions apply only to the named handle. Do not
// infer a provider-wide ban from a shared leaf name or from quoted material.
export function exactToolProhibited(query='',toolName='') {
  if (typeof toolName!=='string'||!toolName.trim()) return false;
  if (!String(query).toLowerCase().includes(toolName.toLowerCase())) return false;
  const masked=maskDirectiveUrls(instructionText(query));
  const escaped=toolName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const prior='(?:[$\\p{L}\\p{N}_.:-]+\\s*(?:和|与|及|、|\\band\\b|\\bor\\b)\\s*)*';
  const exactName=`(?:'${escaped}'|${escaped})`;
  const rule=new RegExp(`(?:不要|不得|禁止|严禁|请勿|禁用|不使用|不用|不调用|不执行|(?<![分识辨区判鉴])别用|do not|don't|never)\\s*(?:(?:再|主动|自行|直接|实际|擅自)\\s*)*(?:使用|调用|执行|启用|参考|咨询|用|use|invoke|call|run)?\\s*(?:(?:工具|tool)\\s*)?${prior}\\$?${exactName}(?![\\p{L}\\p{N}_.:-])`,'giu');
  for(const clause of instructionClauses(masked)) {
    rule.lastIndex=0;let match;
    while((match=rule.exec(clause))) {
      const before=clause.slice(0,match.index).trimEnd();
      if(/(?:以后|将来|未来|下次|日后|later|in future)(?:再|请)?\s*$/iu.test(before))continue;
      if(/(?:不必|无需|不需要|不要求|并非|不是|不)\s*$/u.test(before))continue;
      return true;
    }
  }
  return false;
}

// Category bans are current explicit instructions about tool use, not a
// blanket ban inferred from a quoted example or an unrelated negative.
export function imageToolProhibitions(query='') {
  const result={create:false,edit:false};
  const clauses=instructionClauses(maskDirectiveUrls(instructionText(query)));
  const head=/(?:不要|不得|禁止|严禁|请勿)\s*(?:(?:再|主动|自行|直接|实际|擅自)\s*)*(?:调用|使用|启用|用)|(?:禁用|不使用|不用|不调用)|\b(?:do not|don't|never)\s+(?:use|invoke|call|run)\b/giu;
  for(const clause of clauses) {
    head.lastIndex=0;let hit;
    while((hit=head.exec(clause))) {
      const before=clause.slice(0,hit.index).trimEnd();
      if(/(?:以后|将来|未来|下次|日后|later|in future)(?:再|请)?\s*$/iu.test(before)||/(?:不必|无需|不需要|不要求|并非|不是|不|不要)\s*$/u.test(before))continue;
      const tail=clause.slice(hit.index,hit.index+90), end=/(?:工具|应用|\btools?\b|\bapi\b)/iu.exec(tail);
      if(!end)continue;
      const scope=tail.slice(0,end.index+end[0].length);
      if(!/(?:图片|图像|照片|插画|\b(?:images?|photos?|pictures?|illustrations?)\b)/iu.test(scope))continue;
      if(/(?:生成|创建|绘制|创作|\b(?:generat(?:e|ion|ing)|creat(?:e|ion|ing)|draw(?:ing)?)\b)/iu.test(scope))result.create=true;
      if(/(?:编辑|修改|修图|\b(?:edit(?:ing)?|modif(?:y|ication|ying)|retouch(?:ing)?)\b)/iu.test(scope))result.edit=true;
    }
  }
  return result;
}

function affirmativePurpose(purpose='') {
  return String(purpose).split(/[.!?;；。！？,，\n]+|\b(?:but|however|whereas)\b|(?:但是|然而|却|但)/iu)
    .map(part=>part.replace(/(?:\b(?:do not|don't|does not|doesn't|cannot|can't|never|not (?:intended|suitable|able) (?:for|to))\b|不支持|不能|无法|不可|不用于)[\s\S]*$/iu,' ')).join(' ');
}

// Read only a tool's stated purpose, not its name or later examples. These
// signals restrict suggestions; they do not establish availability or consent.
export function imageToolPurposes(description='') {
  const paragraphs=String(description).replace(/\r\n/g,'\n').split(/\n\s*\n/);let purpose='';
  for(let p of paragraphs){p=p.trim().replace(/^#{1,6}\s*/,'');if(!p||/^(?:tools?\s+in\s+(?:the\s+)?[\w.-]+\s+namespace|[\w.-]+\s+namespace|[-_=]+)\.?$/i.test(p))continue;if(/^(?:guidelines|examples|usage hints|exec tool declaration|```)/i.test(p))break;purpose=p.slice(0,700);break;}
  // Preserve an affirmative clause after a contrast such as "does not
  // generate images, but edits existing images" while never turning the
  // explicitly negated operation into a supported purpose.
  purpose=affirmativePurpose(purpose);
  const noun='(?:images?|photos?|photographs?|pictures?|illustrations?|posters?|portraits?|comics?)';
  const qualifier='(?:(?:a|an|the|of|this|that|existing|attached|uploaded|provided|supplied|local|source|reference|input|original|new|standalone|raster|bitmap|digital|product|selected|user-provided)\\s+){0,6}';
  const action=(verb,nounAction)=>new RegExp(`\\b${verb}\\b\\s+${qualifier}${noun}\\b|\\b${noun}\\s+${nounAction}\\b`,'i').test(purpose);
  return {
    create:action('(?:generat(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|draw(?:s|n|ing)?|render(?:s|ed|ing)?)','(?:generation|creation|rendering)')||/(?:生成|创建|绘制|渲染)(?:一张|一个|新的|新|指定的|目标)?(?:图片|图像|照片|插画)/u.test(purpose),
    edit:action('(?:edit(?:s|ed|ing)?|modif(?:y|ies|ied|ying)|retouch(?:es|ed|ing)?|alter(?:s|ed|ing)?|restyl(?:e|es|ed|ing))','(?:editing|modification|retouching)')||/\b(?:remove|erase|replace)\s+(?:the\s+)?backgrounds?\s+(?:from|of)\s+(?:(?:the|a|an|existing|supplied|provided)\s+)*(?:images?|photos?|photographs?|pictures?)\b/i.test(purpose)||/(?:编辑|修改|修饰|调整)(?:已有的?|现有的?|上传的?|指定的)?(?:图片|图像|照片|插画)|(?:图片|图像|照片|插画)(?:进行|的)?(?:编辑|修改|修饰|调整)/u.test(purpose),
  };
}

// A ban on a web-search tool is narrower than a ban on network access. Keep
// the explicit tool class separate so other authorized online work is usable.
const webSearchToolNoun=/(?:网络|网页|互联网|网上|在线|联网|连网|web|internet|online)\s*(?:的)?\s*(?:搜索|检索|查找|search(?:ing)?)\s*(?:的|类|类的|相关的?)?\s*(?:工具|插件|应用|服务|接口|tools?|plugins?|apps?|services?|apis?)|(?:搜索|检索|查找)\s*(?:网络|网页|互联网|网上|在线|联网|连网)\s*(?:的|类|类的|相关的?)?\s*(?:工具|插件|应用|服务|接口)|\b(?:web|internet|online)[ -]+search(?:ing)?[ -]+(?:tools?|apps?|services?|apis?)\b|\bsearch[ -]+(?:tools?|apps?|services?|apis?)[ -]+(?:for[ -]+)?(?:the[ -]+)?(?:web|internet)\b/giu;

export function webSearchToolProhibited(query='') {
  const clauses=instructionClauses(maskDirectiveUrls(instructionText(query)));
  const head=/(?:不要|不得|禁止|严禁|请勿|不能|不允许)\s*(?:(?:再|主动|自行|直接|实际|擅自)\s*)*(?:调用|使用|启用|借助|通过|用)?|(?:禁用|不使用|不用|不调用|别用)|\b(?:do not|don't|never)\s+(?:use|invoke|call|run)\b/giu;
  for(const clause of clauses){
    head.lastIndex=0;let hit;
    while((hit=head.exec(clause))){
      const before=clause.slice(0,hit.index).trimEnd();
      const scope=clause.slice(hit.index,hit.index+100).split(/(?:但是|然而|而是|然后|之后|并且?(?:使用|调用|启用)|\band\s+(?:use|invoke|call)\b)/iu)[0];
      const doubleNegative=/(?:并非|不是|并不|并不是)\s*不\s*$/u.test(before);
      if(/(?:以后|将来|未来|下次|日后|later|in future)(?:再|请)?\s*$/iu.test(before)||!doubleNegative&&/(?:不必|无需|不需要|不要求|并非|不是|不|不要)\s*$/u.test(before))continue;
      if(/^(?:不要|无需|不必|不需要|不用|不要求)\s*(?:再)?\s*(?:禁止|禁用|限制|阻止)/u.test(scope))continue;
      webSearchToolNoun.lastIndex=0;
      if(webSearchToolNoun.test(scope))return true;
    }
  }
  return false;
}

// Restrict only tools whose name or stated purpose actually identifies web
// search; a generic online image or document tool is not a search tool.
export function webSearchToolPurpose(description='',name='') {
  if(/^(?:web__run)$|web[_-]?search|search[_-]?web|websearch|firecrawl[_-]?search/i.test(String(name)))return true;
  const paragraphs=String(description).replace(/\r\n/g,'\n').split(/\n\s*\n/);let purpose='';
  for(let p of paragraphs){p=p.trim().replace(/^#{1,6}\s*/,'');if(!p||/^(?:tools?\s+in\s+(?:the\s+)?[\w.-]+\s+namespace|[\w.-]+\s+namespace|[-_=]+)\.?$/i.test(p))continue;if(/^(?:guidelines|examples|usage hints|exec tool declaration|```)/i.test(p))break;purpose=p.slice(0,700);break;}
  purpose=affirmativePurpose(purpose);
  return /(?:搜索|检索|查询|查找).{0,30}(?:互联网|网络|网页|网站|网上)|(?:互联网|网络|网页|网站|网上).{0,20}(?:搜索|检索|查询)|\b(?:search(?:es|ing)?|find(?:s|ing)?|discover(?:s|ing)?|quer(?:y|ies|ying)|look(?:s|ing)?\s+up)\b.{0,60}\b(?:web|internet|online|websites?|search engines?)\b|\b(?:web|internet|online)\b.{0,30}\b(?:search(?:es|ing)?|quer(?:y|ies|ying))\b/iu.test(purpose);
}

export function imageObjectRemovalInquiry(text='') {
  return /(?:是否(?:需要|要)?|需不需要|要不要|应不应该|能否|能不能|可否).{0,12}(?:移除|去除|去掉|删除|删掉|擦除|抹去|抹掉)|(?:移除|去除|去掉|删除|删掉|擦除|抹去|抹掉).{0,18}(?:的)?(?:原因|方案|建议|必要性|可行性|方法|思路)|\b(?:whether|if)\b.{0,30}\b(?:remove|erase|delete)\b|\b(?:remove|erase|delete)\b.{0,30}\b(?:reason|plan|necessity)\b/iu.test(String(text));
}

// Evaluating the need for an edit is not an instruction to apply it.
export function imageEditInquiry(text='') {
  return /(?:是否(?:需要|要|应当|应该)?|需不需要|要不要|应不应该|是否有必要|有必要|该不该).{0,16}(?:编辑|修改|修图|调整)|(?:编辑|修改|修图|调整).{0,24}(?:有必要吗|是否必要|需要吗|合适吗|合适么|适合吗|必要性|可行性|的方案|的建议)|需要.{0,5}(?:编辑|修改|修图|调整).{0,24}(?:吗|么|必要吗)|\b(?:whether|if)\b.{0,35}\b(?:edit|modify|retouch)\b|\b(?:edit|modify|retouch)\b.{0,35}\b(?:necessary|needed|necessity)\b/iu.test(String(text));
}

export function imageEditInquiryOnly(query='') {
  const clauses=instructionClauses(instructionText(query)).flatMap(c=>c.split(/(?:并且|然后|同时|以及|并|\band then\b|\band\b)/iu));
  const picture=/(?:图片|图像|照片|插画|截图|(?:这|那)(?:张|幅)图|\b(?:images?|photos?|pictures?)\b)/iu;
  let inquiry=false,independentEdit=false;
  for(const clause of clauses){
    if(!picture.test(clause))continue;
    if(imageEditInquiry(clause)){inquiry=true;continue;}
    const direct=clause.replace(/(?:不要|不得|禁止|不能|请勿|无需|不需要|不)\s*(?:再|实际|直接)?\s*(?:编辑|修改|修图|调整)/gu,'')
      .replace(/\b(?:do not|don't|never)\s+(?:edit|modify|retouch)\b/giu,'');
    if(/(?:编辑|修改|修图|调整|\b(?:edit|modify|retouch)\b)/iu.test(direct))independentEdit=true;
  }
  return inquiry&&!independentEdit;
}

// "别用" is a prohibition; the same characters inside "分别用" are not.
export const negativeDirective=/(?:不要|不得|禁止|不使用|不用|(?<![分识辨区判鉴])别用|无需|不需要|避免|do not|don't|never|without)/iu;

// A scheduled reminder is an action on a scheduler even when its message
// says to "check" or "review" something. Reuse this narrow signal in both
// task constraints and capability recommendations.
export function scheduledReminderRequest(value='') {
  const clause=String(value);
  if(/^(?:(?:请|帮我|请你|麻烦|please)\s*)*(?:解释|介绍|讲解|说明|讨论|判断|评估|比较|如何|怎么|是否|要不要|需不需要|explain\b|describe\b|what is\b|how (?:to|does|do)\b|should (?:i|we)\b)/i.test(clause))return false;
  const action=/(?:提醒我|提醒一下我|给我.{0,8}提醒|(?:设置|创建|建立|安排|设定).{0,12}(?:提醒|定时任务|自动化)|\b(?:remind me|set (?:a |an )?reminder|create (?:a |an )?(?:reminder|scheduled task))\b)/i.exec(clause);
  if(!action)return false;
  const before=clause.slice(0,action.index);
  if(/(?:不要|不得|禁止|不能|请勿|不准|严禁|无需|无须|不必|不需要|\b(?:do not|don't|never)\b)\s*(?:再|实际|直接|自行|擅自|去)?\s*$/i.test(before))return false;
  return /(?:每(?:天|日|周|星期|月|年|隔)|每天|每周|每月|明天|后天|下周|下个月|定时|定期|周期|(?:\d+|[一二三四五六七八九十两]+)(?:分钟|小时|天)后|\d{1,2}[:：点时]\d{0,2}|\b(?:every|daily|weekly|monthly|tomorrow|next week|next month|in \d+ (?:minutes?|hours?|days?))\b)/i.test(clause);
}

function withoutReadMetadata(clause) {
  // Keep the metadata noun if the surrounding directive actually changes it.
  // For example, “查看最后修改时间” is a read, while “把文件修改时间改成
  // 明天” is a change even though both contain the same noun.
  const metadata=/(?:文件|文档|项目|工程|记录|资源|条目)(?:的)?(?:修改|更改|更新|编辑|创建|生成|上传|导出|编译|部署|发布|删除)(?:时间|日期|者|人)(?:(?:及|和|与|、)(?:最后|最近|上次)?(?:修改|更改|更新|编辑|创建|生成|上传|导出|编译|部署|发布|删除)(?:时间|日期|者|人))*|(?:最后(?:一次)?|最近(?:一次)?|上(?:一次|次)|首次|第一次)(?:修改|更改|更新|编辑|创建|生成|上传|导出|编译|部署|发布|删除)(?:时间|日期|者|人|记录|历史|状态|日志|进度|详情|结果)/g;
  return clause.replace(metadata,(match,offset,whole)=>{
    const before=whole.slice(Math.max(0,offset-24),offset),after=whole.slice(offset+match.length,offset+match.length+24);
    if (/(?:设置|设定|更改|修改|调整|改写|更新|重置)\s*(?:(?:原|该|这个|当前|已有|现有)(?:的)?)?$/u.test(before)
        ||/^\s*(?:改为|改成|设为|设成|设置为|设置成|调整为|调整成|更改为|更改成|修改为|修改成|变为|变成)/u.test(after))return match;
    return '';
  });
}

// Restore only literal, inline-code output paths, not instructions contained
// in quoted material. A path is data; its surrounding active verb supplies
// the evidence that a file is to be written.
function textWithInlinePaths(query) {
  const raw=String(query), parsed=requestSegments(raw,{preserveNames:false});
  let text=parsed.text;
  for(const span of parsed.spans) {
    if(raw[span.start]!=='`'||raw[span.end-1]!=='`'||span.boundary)continue;
    const value=raw.slice(span.start+1,span.end-1);
    if(!/^(?:[a-z]:[\\/])?[\p{L}\p{N}_.\\/-]+(?:[\\/]|\.(?:csv|tsv|json|md|txt|pdf|docx|xlsx|pptx|html|js|mjs|py|png|jpg|svg))$/iu.test(value))continue;
    text=text.slice(0,span.start)+' '+value+' '+text.slice(span.end);
  }
  return text;
}

// Identify the user's exclusive source site from the directive, never from
// URL contents. Domain tokens retain location without imposing a short length
// limit; common local-file extensions are not treated as website names.
function specifiedSiteDirective(clause) {
  if(/(?:不必|无需|无须|不用|不需要|不要|不要求|并非|不是|不)\s*(?:再|限制|限定|局限)?\s*(?:只|仅)/u.test(clause)
    ||/(?:不必|无需|无须|不用|不需要|不要|不要求|并非|不是|不)\s*(?:限制|限定|局限)(?:来源|范围|查询|检索|搜索)?(?:在|为|于|到)/u.test(clause)
    ||/\b(?:do not|don't|never|no need to)\s+(?:restrict|limit)\b/i.test(clause)
    ||/\b(?:do not|don't|never|no need to)\s+(?:restrict|limit|require|insist|force|search|query|use|consult)\b(?:(?!\b(?:and|but)\b).){0,55}\b(?:only|solely|just)\b/i.test(clause)
    ||/\bnot\s+(?:only|just)\b/i.test(clause))return false;
  if(/(?:以后|将来|未来|下次|日后|后续|下一步|届时)\s*(?:再|才|就|请|要|会|须|需)?\s*(?:只|仅)/u.test(clause)
    ||/\b(?:later|in (?:the )?future|next time)\s*,?\s*(?:please\s+)?(?:only|solely)\b/i.test(clause))return false;
  const localExtensions=new Set(['csv','tsv','xlsx','xls','json','jsonl','txt','md','pdf','doc','docx','ppt','pptx','html','htm','js','mjs','py','png','jpg','jpeg','svg','zip','log']);
  const direct=clause.replace(/USER_SUPPLIED_URL/gi,' URLTOKEN ')
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?(?:[/?#][^\s，。；！？]*)?/giu,value=>{
      const host=value.split(/[/:?#]/)[0],ext=host.slice(host.lastIndexOf('.')+1).toLowerCase();
      return localExtensions.has(ext)?value:' DOMAINTOKEN ';
    });
  const zhSite='(?:官网|官方网站|网站(?!名称|字段|列)|站点(?!名称|字段|列)|URLTOKEN|DOMAINTOKEN)';
  const zhAction='(?:查询|查找|查阅|搜索|检索|阅读|访问|查)';
  if(new RegExp(`(?:只|仅)(?:能|可|限(?:于)?|允许)?\\s*(?:在|从|于|到).{0,70}?${zhSite}.{0,60}?${zhAction}`,'iu').test(direct)
    ||new RegExp(`(?:只|仅)(?:能|可|限(?:于)?|允许)?\\s*(?:使用|参考|查阅|查询|搜索|检索|访问|用|查).{0,50}?${zhSite}`,'iu').test(direct)
    ||new RegExp(`(?:查询|检索|搜索|来源|信息){0,2}(?:范围)?(?:限定|限制|局限)(?:查询|检索|搜索|来源|范围){0,2}(?:在|为|于|到).{0,50}?${zhSite}`,'iu').test(direct))return true;
  const named='(?:URLTOKEN|DOMAINTOKEN|(?:the\\s+)?(?:specified|official|user-specified|designated)\\s+(?:site|website|domain|official pages?)|(?:the|this|that)\\s+(?:site|website|domain))';
  return new RegExp(`\\b(?:only|solely)\\s+(?:search|query|consult|cite|use|browse|visit)\\b.{0,70}?${named}`,'iu').test(direct)
    ||new RegExp(`\\b(?:search|query|consult|cite|use|browse|visit)\\s+(?:only|solely)\\b.{0,70}?${named}`,'iu').test(direct)
    ||new RegExp(`\\b(?:only|solely)\\s+(?:on|at|in|from)\\s+${named}`,'iu').test(direct)&&/\b(?:search|query|consult|cite|use|browse|visit)\b/i.test(direct)
    ||new RegExp(`\\b(?:limit|restrict)\\s+(?:the\\s+)?(?:search(?:es)?|sources?|research|queries)\\s+to\\s+${named}`,'iu').test(direct)
    ||/\b(?:use|consult|cite)\s+(?:only|solely)\b.{0,45}\b(?:site|website|domain|official pages?)\b/i.test(direct)
    ||/\b(?:search|query|consult|cite|use|browse|visit)\b.{0,70}\b(?:site|website|domain)\b.{0,25}\b(?:only|solely)\s*[.!]?\s*$/i.test(direct);
}

export function inferUserConstraints(query='',activeText='',activeClauses=[]) {
  // A URL is an input, never an instruction, even when its query contains
  // words such as “禁止联网” or “只读”. Keep a marker for source-scope intent.
  const text=instructionText(query,{preserveNames:false}).replace(/https?:\/\/[^\s<>"“”。，。！？；]+/giu,' USER_SUPPLIED_URL ');
  const clauses=instructionClauses(text).filter(c=>!/^(?:以后|将来|未来|下次|日后|eventually\b|later\b|in future\b)/i.test(c))
    .map(c=>c.split(/(?:例如|比如|举例|for example|e\.g\.)/i)[0]);
  // Evaluate each directive independently: a negation in one sentence must
  // never bind a network or source phrase in the next sentence.
  const active=Array.isArray(activeClauses)&&activeClauses.length?activeClauses:instructionClauses(activeText);
  const actionable=active.map(c=>withoutReadMetadata(maskDirectiveUrls(c).replace(/(?<!不能)(?<!不可能)(?<!不可以)(?<!不得)(?<!不要)(?<!不会)(?<!无法)(?:不要|不得|禁止|不能|请勿|不必|无需|不需要|不|避免)\s*(?:实际|直接|擅自|自行|再|去|执行|进行){0,3}\s*(?:修改|改动|更改|改写|重构|修复|编辑|删除|创建|新建|部署|上传|发送|写入|保存|替换|更新|导出|编译|另存)/g,'')
    .replace(/\b(?:do not|don't|never|without)\s+(?:actually\s+|directly\s+)?(?:edit|editing|modify|modifying|change|changing|alter|altering|fix|fixing|repair|delete|deleting|create|creating|write|writing|deploy|update|updating|save|saving)\b/gi,'')
    .replace(/(?:说明|解释|介绍|描述|讲解|讨论)(?:一下)?(?:如何|怎样|怎么)(?:去|来)?(?:修改|更改|修复|编辑|删除|创建|写入|导出|编译|部署|更新)(?:配置|文件|项目|代码|数据库|工程|内容){0,3}/g,'')
    .replace(/\b(?:explain|describe|outline|show|tell)(?:\s+\w+){0,3}?\s+how\s+to\s+(?:edit|modify|change|fix|repair|delete|create|write|deploy|update)\b(?:\s+(?:the|a|an|configuration|config|files?|documents?|project|code)){0,5}/gi,'')));
  const outputPattern=/(?:另存|另行保存|保存(?:到|为)|写入|导出).{0,25}(?:文件|报告|文档|工程|代码|项目|\.\w{2,5}\b)|(?:输出|写出|记录|生成|制作|撰写).{0,25}(?:到|至|为|入|存为).{0,20}(?:文件|报告|文档|工程|代码|项目|\.\w{2,5}\b)|(?:新建|创建|生成|制作|修改|修复|重构|删除).{0,20}(?:文件|文档文件|工程|代码|项目|原文件|原文|\.\w{2,5}\b)|\b(?:save|write|create|edit|modify|update|export|delete)\b.{0,35}(?:\b(?:file|document file|project|code)\b|[a-z0-9_-]+\.(?:csv|json|md|txt|pdf|docx|xlsx|pptx|png|jpg|html|js|py)\b)/i;
  // A no-change instruction may be followed in the same clause by a
  // separately requested new output. The negative applies to the original,
  // not to a new file named after "and/then".
  const separateOutput=clauses.some(c=>/(?:不要|不得|禁止|请勿|不)\s*(?:修改|改动|更改|写入|覆盖)\s*(?:原(?:始)?(?:文件|文档|工程|项目|数据)|原件|输入(?:文件|数据))\s*(?:并|再|然后|同时|但)\s*(?:新建|创建|另存|生成|保存|写入).{0,30}(?:新文件|文件|报告|文档|副本|[a-z0-9_.-]+\.(?:csv|json|md|txt|pdf|docx|xlsx|pptx|html|js|py)\b)/i.test(c)
    ||/\b(?:without|do not|don't|never)\s+(?:modifying|changing|editing|modify|change|edit|overwriting|overwrite)\b.{0,25}\b(?:original|input|source|existing)\b.{0,20}\b(?:and|then|but)\s+(?:create|write|save|generate)\b.{0,35}(?:\b(?:new file|report|copy)\b|[a-z0-9_.-]+\.(?:csv|json|md|txt|pdf|docx|xlsx|pptx|html|js|py)\b)/i.test(c));
  const artifactClauses=instructionClauses(maskDirectiveUrls(textWithInlinePaths(query)))
    .flatMap(c=>c.split(/但(?=\s*(?:请|要|另外|还要)?\s*(?:交付|输出|保存|写入|放置|导出|存储|编写|撰写|写|生成|制作|创建|新建))/u))
    .filter(c=>!/^(?:以后|将来|未来|下次|日后|后续|下一步|eventually\b|later\b|in future\b)/i.test(c))
    .map(c=>c.split(/(?:例如|比如|举例|以后|将来|未来|下次|日后|后续|下一步|for example|e\.g\.|\blater\b|\bin future\b|不要|不得|禁止|请勿|(?:不必|无需|不需要|不)\s*(?:写入|保存|输出|交付|生成|制作|创建|新建|编写|撰写|导出|另存)|\bdo not\b|\bdon't\b|\bnever\b)/i)[0]
      .replace(/(?:说明|解释|介绍|描述|讲解|讨论)(?:一下)?(?:如何|怎样|怎么)(?:去|来)?(?:写入|保存|输出|交付|生成|制作|创建|新建|编写|撰写|导出|另存).*/u,''));
  const localArtifact=/(?:编写|撰写|写出|写|输出|生成|制作|创建|新建|导出|保存).{0,15}(?:本地|磁盘|硬盘|本机).{0,20}(?:报告|文档|文件|表格|工作簿|脚本|代码)/u;
  const filePath='[\\p{L}\\p{N}_.\\\\/-]+\\.(?:csv|tsv|json|md|txt|pdf|docx|xlsx|pptx|html|js|mjs|py|png|jpg|svg)\\b';
  const artifactFile=new RegExp(`(?:另存|保存|写入|输出|导出)\\s*(?:到|至|为)?\\s*${filePath}|(?:编写|撰写|创建|生成|制作|交付|写)\\s*(?:一份|一个|文件|文档|脚本|报告)?\\s*${filePath}|(?:编写|撰写|写|生成|制作|创建|导出).{0,25}(?:到|至|为)\\s*${filePath}`,'iu');
  const explicitLocalOutput=artifactClauses.some(c=>localArtifact.test(c)||artifactFile.test(c)||/(?:交付|输出|保存|写入|放置|导出|存储)\s*(?:到|至|于)\s*(?:[\p{L}\p{N}_.\\/-]+[\\/]|(?:本地|指定|当前|工作)(?:目录|文件夹))/iu.test(c));
  const outputFile=actionable.some(c=>outputPattern.test(c))||separateOutput||explicitLocalOutput;
  const explicitGlobal=clauses.some(c=>{
    const direct=c.replace(/(?:不要|不必|无需|不需要|不要求|并非|不是)\s*(?:全程|整个任务|所有操作|严格)\s*只读/gu,'')
      .replace(/(?:不必|无需|无须|不用|不需要|不要|不要求)\s*(?:禁止|禁用|限制)\s*(?:修改|写入|更改|删除)\s*(?:任何|所有|一切)\s*(?:文件|内容|项目|数据)/gu,'');
    return /(?:全程|整个任务|所有操作|严格).{0,8}只读|(?:不要|不得|禁止|不能|严禁|请勿).{0,8}(?:修改|写入|更改|删除)\s*(?:任何|所有|一切)\s*(?:一个|的)?\s*(?:文件(?!夹|名|格式|路径|属性|权限|类型)|内容|项目|数据)|(?:不要|不得|禁止|不能|严禁|请勿)\s*(?:进行|执行|做)?\s*(?:任何|所有|一切)\s*(?:修改|更改|写入|删除|变更|操作)|\b(?:no changes at all|do not modify any files|do not write any files)\b/iu.test(direct);
  });
  const readOnlyLanguage=clauses.some(c=>/只读|只(?:查|看|读|审查|审阅|判断|评估|分析|做.{0,5}分析)|仅(?:限)?(?:阅读|查看|检查|审查|审阅|分析|判断|评估)|\bread.only\b|\b(?:review|check|inspect|examine|audit|read|view)\s+only\b/i.test(c.replace(/(?:不要|不必|无需|不需要|不要求|禁止)\s*(?:使用|采用|保持)?\s*只读(?:模式)?/g,'').replace(/\b(?:not|no longer)\s+read.only\b/gi,'')));
  const preserveInput=clauses.some(c=>{
    // A negated prohibition or a negated preservation request is not itself
    // an instruction to protect the object from edits.
    const direct=c.replace(/(?:不必|无需|无须|不用|不需要|不要求|不要)\s*(?:再)?\s*(?:禁止|限制|阻止|不要|不)\s*(?:修改|改动|更改|写入|覆盖).{0,15}(?:文件|文档|数据|工程|内容|项目|配置|代码|源码|原图|原件)/gu,'')
      .replace(/(?:不必|无需|无须|不用|不需要|不要求|不要)\s*(?:保持|保留).{0,12}(?:文件|原文|文档|数据|工程|代码|源码|原图|原件).{0,8}(?:原样|不变|不动)/gu,'')
      .replace(/(?:说明|解释|介绍|讨论|描述|讲解|分析|研究)\s*(?:一下)?\s*(?:如何|怎样|怎么|为什么)?\s*(?:保持|保留).{0,12}(?:文件|原文|文档|数据|工程|代码|源码).{0,8}(?:原样|不变|不动)(?:的(?:方法|建议|原理|含义|概念))?/gu,'')
      .replace(/\b(?:do not|don't|never|no need to)\s+(?:keep|preserve|leave)\s+(?:the\s+)?(?:source code|codebase|code|source files?|original files?)\s+(?:unchanged|intact|as is)\b/gi,'');
    return /(?:保持|保留).{0,12}(?:文件|原文|文档|数据|工程|代码|源码).{0,8}(?:原样|不变|不动)|(?:原|原始|输入|已有|现有|提供的)(?:文件|文档|数据|工程|项目|内容|资料|代码|源码)(?:保持)?(?:原样|不变|不动|不被修改)|(?:不要|不得|禁止|请勿|不).{0,5}(?:修改|改动|更改|写入).{0,10}(?:文件|文档|数据|工程|内容|项目|配置|代码|源码|原图|原件)|(?:不要|不得|禁止|请勿)\s*(?:(?:联网|连网|上网|安装依赖|安装软件)\s*[、或和及与]\s*){1,5}(?:修改|改动|更改|写入|覆盖).{0,8}(?:输入|原始|原有|已有|现有)(?:文件|文档|数据|工程|内容|项目|代码|源码)|\b(?:do not|don't|never|without)\s+(?:modify|modifying|edit|editing|overwrite|overwriting|change|changing|alter|altering)\b.{0,35}\b(?:input|original|source|existing|repository|repo|website|page|documents?|files?|images?|projects?|parts?|code|codebase)\b|\b(?:keep|preserve|leave)\s+(?:the\s+)?(?:source code|codebase|code|source files?|original files?)\s+(?:unchanged|intact|as is)\b/i.test(direct)
      ||/(?:保留|保持)\s*(?:原图|原件|原(?:始)?(?:图片|照片|文件))(?=$|[并和与及、，。；\s]|(?:不变|原样|不动))/u.test(direct);
  });
  // Inspection and advice are ordinarily non-mutating, but do not suppress a
  // separately requested implementation or output file. Keep advice about a
  // fix distinct from an instruction to actually apply it.
  const inspection=active.some(c=>/检查|审查|审阅|核对|核查|审计|查看|检视|校对|排查|复核|盘点|只做.{0,5}分析|\b(?:check|inspect|examine|review|audit)\b/i.test(maskDirectiveUrls(c)));
  const mutation=actionable.some(c=>{
    const direct=c.replace(/(?:提出|整理|给(?:出|我)?|说明|评估|讨论|制定|提供|设计|输出|展示|列出|反馈|撰写|写出|总结|罗列|汇报|指出).{0,8}(?:修复|修改|更新|部署|删除|改进|优化)(?:的)?(?:方案|建议|计划|方法|思路|措施|意见|清单|方向)/g,'')
      .replace(/(?:导出|更新|修改|修复|编译|生成|部署|上传|发送|删除|保存)(?:的)?(?:状态|记录|日志|历史|结果|进度|详情)/g,'')
      .replace(/\b(?:propose|suggest|outline|explain|recommend|describe)\s+(?:an?\s+)?(?:reversible\s+)?(?:fix|repair|change|update|solution)\b/gi,'')
      .replace(/\bbefore\s+(?:compilation|building|deployment)\b/gi,'');
    let mutationText=/(?:图片|图像|照片|插画|截图|\b(?:images?|photos?|pictures?)\b)/iu.test(direct)&&imageObjectRemovalInquiry(direct)
      ?direct.replace(/(?:是否(?:需要|要)?|需不需要|要不要|应不应该|能否|能不能|可否).{0,12}?(?:移除|去除|去掉|删除|删掉|擦除|抹去|抹掉)/gu,'')
        .replace(/(?:移除|去除|去掉|删除|删掉|擦除|抹去|抹掉).{0,18}?(?:的)?(?:原因|方案|建议|必要性|可行性|方法|思路)/gu,'')
        .replace(/\b(?:whether|if)\b.{0,30}?\b(?:remove|erase|delete)\b/giu,'')
        .replace(/\b(?:remove|erase|delete)\b.{0,30}?\b(?:reason|plan|necessity)\b/giu,'')
      :direct;
    if(/(?:图片|图像|照片|插画|截图|\b(?:images?|photos?|pictures?)\b)/iu.test(mutationText)&&imageEditInquiry(mutationText))mutationText=mutationText
      .replace(/(?:是否(?:需要|要|应当|应该)?|需不需要|要不要|应不应该|是否有必要|有必要|该不该).{0,16}?(?:编辑|修改|修图|调整)/gu,'')
      .replace(/需要.{0,5}?(?:编辑|修改|修图|调整).{0,24}?(?:吗|么|必要吗)/gu,'')
      .replace(/(?:编辑|修改|修图|调整).{0,24}?(?:有必要吗|是否必要|需要吗|合适吗|合适么|适合吗|必要性|可行性|的方案|的建议)/gu,'')
      .replace(/\b(?:whether|if)\b.{0,35}?\b(?:edit|modify|retouch)\b/giu,'')
      .replace(/\b(?:edit|modify|retouch)\b.{0,35}?\b(?:necessary|needed|necessity)\b/giu,'');
    return /修改|更改|改写|重构|修复(?!方案|建议|计划|思路|措施|方法)|编辑|删除|创建|新建|开发|实现|部署|上传|发送|写入|保存|替换|更新|导出|编译|另存|(?:生成|绘制|画|制作|创作).{0,20}(?:文件|图片|图像|照片|插画|海报|视频|代码|程序)|\b(?:edit|modify|change|alter|overwrite|update|fix|repair|remove|delete|create|write|generate|implement|develop|build|compile|deploy|publish|send|upload|save)\b|\b(?:make|draw|render|produce)\b.{0,40}\b(?:images?|illustrations?|pictures?|icons?|posters?|videos?)\b/i.test(mutationText);
  });
  // A request to add executable tests is a writing task; test advice or an
  // explanation of how to write tests does not authorize an edit.
  const testMutation=actionable.some(c=>{
    const direct=c.replace(/(?:不要|不得|禁止|请勿|不必|无需|不需要|不)\s*(?:再|去|实际)?\s*(?:补充|编写|新增|添加|创建|生成|写).{0,12}(?:回归|单元|集成|端到端|自动化)?测试(?:代码|用例|文件)?/g,'')
      .replace(/(?:说明|解释|介绍|描述|讲解|讨论)(?:一下)?(?:如何|怎样|怎么).{0,12}(?:补充|编写|新增|添加|创建|生成|写).{0,12}(?:回归|单元|集成|端到端|自动化)?测试(?:代码|用例|文件)?/g,'');
    return /(?:补充|编写|新增|添加|创建|生成|写).{0,12}(?:回归|单元|集成|端到端|自动化)?(?:测试(?:代码|用例|文件)(?!的?(?:方案|建议|计划|策略|思路|清单|报告|说明))|测试(?!代码|用例|文件|的?(?:方案|建议|计划|策略|思路|清单|报告|说明)))/u.test(direct);
  });
  const imageObjectMutation=actionable.some(c=>{
    const direct=c.replace(/(?:提出|给出|说明|解释|分析|评估|讨论|制定).{0,30}(?:移除|去除|去掉|删除|擦除|抹去).{0,16}(?:建议|方案|思路|方法|计划|效果|说明)/g,'');
    if(imageObjectRemovalInquiry(direct))return false;
    return /(?:图片|图像|照片|插画|截图)(?:中|里|内|上)(?:的)?.{0,18}(?:移除|去除|去掉|删除|删掉|擦除|抹去|抹掉)/u.test(direct);
  });
  // File/input preservation implies an otherwise read-only task, but an
  // independently requested output remains allowed. Object-level bans such
  // as calendar events are not promoted to global input preservation.
  const scheduledReminder=active.some(scheduledReminderRequest);
  const readOnly=explicitGlobal||((readOnlyLanguage||((preserveInput||inspection)&&!scheduledReminder))&&!outputFile&&!mutation&&!testMutation&&!imageObjectMutation);
  const preserveInputs=preserveInput||((outputFile||mutation||testMutation||imageObjectMutation)&&readOnlyLanguage);
  const allowsProvidedNetworkUse=clauses.some(c=>{
    const permitted=c.replace(/(?:不要|不得|禁止|不能|请勿|别|不)\s*(?:主动|自行|直接|再|去)?\s*(?:打开|访问|读取|阅读|浏览|查看|使用|用)/g,'')
      .replace(/\b(?:do not|don't|never)\s+(?:open|visit|read|fetch|use|consult)\b/gi,'');
    return /(?:USER_SUPPLIED_URL|(?:提供|给定|给的|我给|附上|附带|发给).{0,12}(?:链接|网址|网页|网站)|\b(?:provided|supplied|given|attached)\s+(?:urls?|links?|websites?|pages?)\b)/i.test(permitted)
      &&/(?:打开|访问|读取|阅读|查看|浏览|使用|用|\b(?:open|visit|read|fetch|use|consult)\b)/i.test(permitted);
  });
  const networkForbidden=clauses.some(c=>{
    // Strip negated prohibitions first; "不禁止联网" does not forbid access.
    let direct=c.replace(/(?:不要|不用|无需|无须|不必|不需要|不要求|不强制|并非|并不|不是|没有|未曾|未明确|未|不)\s*(?:完全)?\s*(?:禁止|禁用|限制|关闭|断开|停用)\s*(?:联网|连网|连互联网|上网|网络|互联网|外网|网络访问|访问网络|连接网络)/g,'')
      .replace(/(?:不要|不用|无需|无须|不必|不需要|不要求|不强制|并非|不是)\s*(?:只|仅|完全)?\s*离线(?:模式|操作|完成|使用)?/g,'')
      .replace(/(?:说明|解释|介绍|讨论|描述|讲解|研究|分析|比较|探索|科普|理解|什么是|何为)\s*(?:一下)?\s*离线\s*(?:汇总|统计|归纳|整理|分析|处理|计算|工作|模式)?[^，。；]{0,14}?(?:概念|含义|原理|机制|定义|意义|区别)/gu,'')
      .replace(/\b(?:do not|don't|never|not)\s+(?:ban|prohibit|forbid|restrict|disable)\s+(?:the\s+)?(?:internet|network|web|online access)\b/gi,'');
    // Remove only the named tool-class noun before looking for a global ban;
    // an independent or coordinated "禁止联网" in the same clause remains.
    direct=direct.replace(webSearchToolNoun,' ')
      .replace(/(?:以及|或者|和|与|及|并|或)\s*(?=(?:(?:联网|连网|上网)(?!工具|插件|服务|应用)|(?:访问|连接|接入)(?:互联网|网络|外网)|(?:网络|互联网|外网)(?:请求|访问|连接|通信|调用)))/gu,' ');
    // If the user explicitly permits opening a supplied source, a search-only
    // prohibition must not cancel that permission. A separate unconditional
    // no-network instruction still applies.
    if(allowsProvidedNetworkUse)direct=direct
      .replace(/(?:不要|不得|禁止|不能|请勿|不必|无需|无须|别|不)\s*(?:再|主动|自行|擅自|去)?\s*(?:联网|连网|连互联网|上网|网上|在线)(?:去|进行)?(?:搜索|检索|查找|查询|查阅|浏览)/g,'')
      .replace(/\b(?:do not|don't|never)\s+(?:search|query|research)\s+(?:the\s+)?(?:internet|web|network|online)\b/gi,'');
    const forbidden=/(?:不要|不得|禁止|不允许|不准|不能|请勿|严禁|(?<![分识辨区判鉴])别|不|避免|无需|不必)(?:(?:主动|自行|擅自|直接|尝试|再|实际|进行|执行|任何|通过|借助|使用|访问|连接|接入|向外|远程|网上|在线|外部|外网|网络|互联网|发起|发送|对外|第三方|的|\s)){0,12}(?:联网|连网|连互联网|上网|(?:网上|在线)(?:搜索|查找|浏览|检索|查询|访问|请求)|(?:使用|用|连接|接入|访问)(?:到|任何|外部)?(?:网络|互联网|外网)|网络(?:请求|访问|连接|通信|调用)|互联网(?:请求|访问|连接)|(?:搜索|查询|检索|浏览|查阅|访问)(?:互联网|网络|外网|网页|网站))/i;
    const noRemoteAcquisition=/(?:不要|不得|禁止|不能|不准|请勿|严禁|(?<![分识辨区判鉴])别)\s*(?:再|主动|自行|直接)?\s*(?:通过|从|使用|利用)\s*(?:互联网|网络|外网|网上)\s*(?:获取|下载|访问|连接)/i;
    const offline=/离线\s*(?:完成|处理|运行|使用|总结|汇总|统计|归纳|整理|提取|转换|分析|阅读|审查|检查|工作|执行|计算|编辑|生成|制作|查找|检索|搜索|安装|验证|调查|设计|解答|研究|模式|环境|状态|条件|方式|解释|介绍|讲解)/i;
    return forbidden.test(direct)||noRemoteAcquisition.test(direct)||offline.test(direct)||/\b(?:no (?:internet|network)|offline only|work offline)\b|\b(?:do not|don't|never)\b.{0,28}\b(?:use|access|connect|browse|search|go online)\b.{0,25}\b(?:internet|web|network|online)\b/i.test(direct);
  });
  const sourcePattern=/(?:只|仅|只能|仅能).{0,7}(?:使用|用|阅读|读取|查看|浏览|研读|分析|读|根据|依据|参考|基于|利用|依托).{0,18}(?:(?:提供|给定|所给|已有|给的|给你(?:的)?|发给你(?:的)?|附上|附带|上传(?:的)?).{0,10}(?:资料|来源|内容|文件|数据|文档|笔记|图片|视频|素材|文本|链接|附件)|附件|正文|原文|材料|文本|链接)|(?:不要|不得|禁止|不能|请勿|不允许).{0,8}(?:检索|搜索|查找|查阅|引用|获取|使用|采用|读取|参考|利用|浏览).{0,10}(?:其他|其它|额外|外部|更多|第三方).{0,8}(?:资料|来源|文献|信息|网页|网站|材料|内容|文档|数据)|\b(?:(?:only|solely)\s+(?:use|read|consult|rely on|based on)|(?:use|read|consult|rely on)\s+(?:only|solely))\b.{0,35}\b(?:(?:provided|supplied|given|attached)\s+(?:sources?|text|documents?|links?|notes|materials?|files?|data)|sources?|text|notes)\b|\b(?:do not|don't|never)\s+(?:search|consult|use)\b.{0,25}\b(?:other|additional|external)\s+(?:sources|materials|references)\b/i;
  const sourceNegated=c=>/(?:不必|无需|无须|不用|不需要|不要|不要求|没有要求|不限制|不局限|不限定).{0,12}(?:限制|(?:只|仅)(?:能)?(?:使用|用|阅读|读取|查看|浏览|研读|分析|读|引用|参考|根据|依据))|(?:不只|不仅|不止|不单|不光|并非只|并非仅|不是只|不是仅)(?:仅|是|单)?(?:使用|用|阅读|读取|查看|浏览|研读|分析|读|引用|参考|根据|依据)|\b(?:do not|don't|never)\s+(?:restrict|limit|require|insist|force)\b.{0,60}\b(?:only|solely)\b|\b(?:do not|don't|never)\s+(?:use|read|consult|analy[sz]e)\s+(?:only|solely)\b/i.test(c);
  // “Only three sentences using supplied notes” limits the answer's length,
  // not its sources. A separate source restriction in the same clause remains.
  const withoutFormatLimit=c=>c
    .replace(/(?:只|仅)(?:能)?(?:使用|用)\s*(?:[一二三四五六七八九十两百千\d]+)\s*(?:句话?|段(?:话)?|行|字|条|页|张|秒|分钟|小时|个(?:字|句|段|词))/g,'')
    .replace(/\b(?:only|solely)\s+(?:use|write|produce)\s+(?:one|two|three|four|five|\d+)\s+(?:sentences?|paragraphs?|words?)\b/gi,'');
  // A specifically named local input file is a supplied source even when the
  // user says “same directory” instead of “provided”. An output filename is
  // not evidence that the inputs are restricted.
  const localFileSource=/(?:只|仅|只能|仅能).{0,8}(?:使用|用|根据|依据|参考|读取|阅读|查阅|分析)\s*(?:(?:同(?:一)?目录|当前目录|本地|此目录|这个目录|本目录|该目录)(?:的|下|中|里|内)?\s*)?(?:[a-z0-9_.-]+\.(?:csv|tsv|xlsx?|json|jsonl|txt|md|pdf|docx?|pptx?)\b|(?:本地|同目录|当前目录|该|此|这个|已有|当前|原始|原|输入)(?:文件|数据|资料|表格|文档))\s*(?:(?:中|里|内)(?:的)?(?:数据|内容|信息|记录|文字|表格)?|(?:的)?(?:数据|内容|信息|记录|文字)|(?:作为)?(?:唯一)?(?:来源|依据|材料|数据源)|(?=\s*(?:$|并|进行|来|做|生成|总结|分析)))/i;
  const localDirectorySource=/(?:只|仅|只能|仅能).{0,8}(?:使用|用|根据|依据|参考|读取|阅读|查阅|分析)\s*(?:同(?:一)?目录|当前目录|本地|此目录|这个目录|本目录|该目录)(?:\s|中|下|里|内|的){0,20}(?:数据|资料|内容|文件|文档|表格|记录)/i;
  const localCsvSource=/(?:只|仅|只能|仅能)\s*(?:使用|用|根据|依据|参考|读取|阅读|查阅|分析|查)\s*(?:本地|本机|本目录|当前目录|该目录)(?:的|中|下|内)?\s*(?:CSV|TSV|XLSX?|JSONL?)\b|\b(?:(?:only|solely)\s+(?:use|read|consult|analy[sz]e)|(?:use|read|consult|analy[sz]e)\s+(?:only|solely))\s+(?:the\s+)?(?:local|on-device)\s+(?:CSV|TSV|XLSX?|JSONL?)\b/i;
  const localOutputFormat=/(?:本地|本机|本目录|当前目录|该目录)\s*(?:的)?\s*(?:CSV|TSV|XLSX?|JSONL?)\s*(?:文件)?(?:格式|形式)\s*(?:(?:来进行|用于|作为|进行|来)\s*)?(?:导出|保存|写入|输出|生成|制作|记录|报告|结果|文件)|\b(?:local|on-device)\s+(?:CSV|TSV|XLSX?|JSONL?)\s+format\s+(?:to|for)\s+(?:export|save|write|output)\b/i;
  const localOnly=clauses.some(c=>!sourceNegated(c)&&(localFileSource.test(withoutFormatLimit(c))||localDirectorySource.test(withoutFormatLimit(c))||c.split(/(?:并且|并|然后|同时|\band\b)/iu).some(part=>localCsvSource.test(withoutFormatLimit(part))&&!localOutputFormat.test(part))));
  const providedOnly=localOnly||clauses.some(c=>!sourceNegated(c)&&sourcePattern.test(withoutFormatLimit(c)));
  const specifiedSite=clauses.some(c=>!sourceNegated(c)&&specifiedSiteDirective(c));
  const exactProvided=clauses.some(c=>!sourceNegated(c)&&/(?:只|仅|只能|仅能).{0,10}(?:用|使用|根据|依据).{0,15}(?:提供|给定|给的|所给|附上).{0,12}(?:链接|网址|正文|文本|附件|文档|资料)|\b(?:provided|supplied|given|attached)\s+(?:links?|urls?|text|documents?|notes|materials?|files?|data)\b/i.test(c));
  const exactOnlyUrl=clauses.some(c=>{
    if(sourceNegated(c))return false;
    const match=/(?:只|仅|只能|仅能).{0,10}(?:用|使用|访问|查看|阅读).{0,20}USER_SUPPLIED_URL|\b(?:only|solely)\s+(?:use|visit|open|read)\b.{0,25}USER_SUPPLIED_URL/i.exec(c);
    return match&&!/(?:官网|官方网站|网站|站点)|\b(?:site|website|domain|official pages?)\b/i.test(match[0]);
  });
  const sourceScope=exactOnlyUrl||providedOnly&&(!specifiedSite||exactProvided||localOnly)?'provided-only':specifiedSite?'specified-site-only':providedOnly?'provided-only':null;
  return {readOnly,networkForbidden,sourceScope,...(preserveInputs?{preserveInputs:true}:{})};
}
