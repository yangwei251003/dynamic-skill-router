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

// "别用" is a prohibition; the same characters inside "分别用" are not.
export const negativeDirective=/(?:不要|不得|禁止|(?<![分识辨区判鉴])别用|无需|不需要|避免|do not|don't|never|without)/iu;

export function inferUserConstraints(query='',activeText='',activeClauses=[]) {
  // A URL is an input, never an instruction, even when its query contains
  // words such as “禁止联网” or “只读”. Keep a marker for source-scope intent.
  const text=instructionText(query,{preserveNames:false}).replace(/https?:\/\/[^\s<>"“”。，。！？；]+/giu,' USER_SUPPLIED_URL ');
  const clauses=instructionClauses(text).filter(c=>!/^(?:以后|将来|未来|下次|日后|eventually\b|later\b|in future\b)/i.test(c))
    .map(c=>c.split(/(?:例如|比如|举例|for example|e\.g\.)/i)[0]);
  // Evaluate each directive independently: a negation in one sentence must
  // never bind a network or source phrase in the next sentence.
  const active=Array.isArray(activeClauses)&&activeClauses.length?activeClauses:instructionClauses(activeText);
  const actionable=active.map(c=>c.replace(/(?:说明|解释|介绍|描述|讲解|讨论)(?:一下)?(?:如何|怎样|怎么)(?:去|来)?(?:修改|更改|修复|编辑|删除|创建|写入|导出|编译|部署|更新)(?:配置|文件|项目|代码|数据库|工程|内容){0,3}/g,'')
    .replace(/\b(?:explain|describe|outline|show|tell)(?:\s+\w+){0,3}?\s+how\s+to\s+(?:edit|modify|change|fix|repair|delete|create|write|deploy|update)\b(?:\s+(?:the|a|an|configuration|config|files?|documents?|project|code)){0,5}/gi,''));
  const outputPattern=/(?:另存|另行保存|保存(?:到|为)|写入|导出).{0,25}(?:文件|报告|文档|工程|代码|项目|\.\w{2,5}\b)|(?:输出|写出|记录|生成|制作|撰写).{0,25}(?:到|至|为|入|存为).{0,20}(?:文件|报告|文档|工程|代码|项目|\.\w{2,5}\b)|(?:新建|创建|生成|制作|修改|修复|重构|删除).{0,20}(?:文件|文档文件|工程|代码|项目|原文件|原文|\.\w{2,5}\b)|\b(?:save|write|create|edit|modify|update|export|delete)\b.{0,35}(?:\b(?:file|document file|project|code)\b|[a-z0-9_-]+\.(?:csv|json|md|txt|pdf|docx|xlsx|pptx|png|jpg|html|js|py)\b)/i;
  const outputFile=actionable.some(c=>outputPattern.test(c));
  const explicitGlobal=clauses.some(c=>/(?:全程|整个任务|所有操作|严格).{0,8}只读|(?:不要|不得|禁止|不能|严禁|请勿).{0,8}(?:修改|写入|更改|删除).{0,8}(?:任何|所有|一切).{0,8}(?:文件|内容|项目|数据)?|\b(?:no changes at all|do not modify any files|do not write any files)\b/i.test(c));
  const readOnlyLanguage=clauses.some(c=>/只读|只(?:查|看|读|审查|审阅|做.{0,5}分析)|仅(?:限)?(?:阅读|查看|检查|审查|审阅|分析)|\bread.only\b|\breview only\b/i.test(c.replace(/(?:不要|不必|无需|不需要|不要求|禁止)\s*(?:使用|采用|保持)?\s*只读(?:模式)?/g,'').replace(/\b(?:not|no longer)\s+read.only\b/gi,'')));
  const preserveInput=clauses.some(c=>/(?:保持|保留).{0,12}(?:文件|原文|文档|数据|工程).{0,8}(?:原样|不变|不动)|(?:原|原始|输入|已有|现有|提供的)(?:文件|文档|数据|工程|项目|内容|资料)(?:保持)?(?:原样|不变|不动|不被修改)|(?:不要|不得|禁止|请勿|不).{0,5}(?:修改|改动|更改|写入)(?:.{0,10}(?:文件|文档|数据|工程|内容))?|\b(?:do not|don't|never|without)\s+(?:modify|edit|overwrite|change|changing|alter)\b.{0,35}\b(?:input|original|source|existing|repository|repo|website|page|document|file|image|project|part)\b/i.test(c));
  // Inspection and advice are ordinarily non-mutating, but do not suppress a
  // separately requested implementation or output file. Keep advice about a
  // fix distinct from an instruction to actually apply it.
  const inspection=active.some(c=>/检查|审查|审阅|核对|核查|审计|查看|检视|校对|排查|复核|盘点|只做.{0,5}分析|\b(?:inspect|examine|review|audit)\b/i.test(c));
  const mutation=actionable.some(c=>{
    const direct=c.replace(/(?:提出|整理|给(?:出|我)?|说明|评估|讨论|制定|提供|设计|输出|展示|列出|反馈|撰写|写出|总结|罗列|汇报|指出).{0,8}(?:修复|修改|更新|部署|删除|改进|优化)(?:的)?(?:方案|建议|计划|方法|思路|措施|意见|清单|方向)/g,'')
      .replace(/(?:导出|更新|修改|修复|编译|生成|部署|上传|发送|删除|保存)(?:的)?(?:状态|记录|日志|历史|结果|进度|详情)/g,'')
      .replace(/\b(?:propose|suggest|outline|explain|recommend|describe)\s+(?:an?\s+)?(?:reversible\s+)?(?:fix|repair|change|update|solution)\b/gi,'')
      .replace(/\bbefore\s+(?:compilation|building|deployment)\b/gi,'');
    return /修改|更改|改写|重构|修复(?!方案|建议|计划|思路|措施|方法)|编辑|删除|创建|新建|开发|实现|部署|上传|发送|写入|保存|替换|更新|导出|编译|另存|(?:生成|绘制|画|制作|创作).{0,20}(?:文件|图片|图像|照片|插画|海报|视频|代码|程序)|\b(?:edit|modify|overwrite|update|fix|repair|remove|delete|create|write|generate|implement|develop|build|compile|deploy|publish|send|upload|save)\b|\b(?:make|draw|render|produce)\b.{0,40}\b(?:images?|illustrations?|pictures?|icons?|posters?|videos?)\b/i.test(direct);
  });
  const restrictedInput=readOnlyLanguage||preserveInput;
  const readOnly=explicitGlobal||((restrictedInput||inspection)&&!outputFile&&!mutation);
  const preserveInputs=(outputFile||mutation)&&restrictedInput;
  const allowsProvidedNetworkUse=clauses.some(c=>{
    const permitted=c.replace(/(?:不要|不得|禁止|不能|请勿|别|不)\s*(?:主动|自行|直接|再|去)?\s*(?:打开|访问|读取|阅读|浏览|查看|使用|用)/g,'')
      .replace(/\b(?:do not|don't|never)\s+(?:open|visit|read|fetch|use|consult)\b/gi,'');
    return /(?:USER_SUPPLIED_URL|(?:提供|给定|给的|我给|附上|附带|发给).{0,12}(?:链接|网址|网页|网站)|\b(?:provided|supplied|given|attached)\s+(?:urls?|links?|websites?|pages?)\b)/i.test(permitted)
      &&/(?:打开|访问|读取|阅读|查看|浏览|使用|用|\b(?:open|visit|read|fetch|use|consult)\b)/i.test(permitted);
  });
  const networkForbidden=clauses.some(c=>{
    // Strip negated prohibitions first; "不禁止联网" does not forbid access.
    let direct=c.replace(/(?:不要|不用|无需|无须|不必|不需要|不要求|不强制|并非|并不|不是|没有|未曾|未明确|未|不)\s*(?:完全)?\s*(?:禁止|禁用|限制|关闭|断开|停用)\s*(?:联网|上网|网络|互联网|外网|网络访问|访问网络|连接网络)/g,'')
      .replace(/(?:不要|不用|无需|无须|不必|不需要|不要求|不强制|并非|不是)\s*(?:只|仅|完全)?\s*离线(?:模式|操作|完成|使用)?/g,'')
      .replace(/\b(?:do not|don't|never|not)\s+(?:ban|prohibit|forbid|restrict|disable)\s+(?:the\s+)?(?:internet|network|web|online access)\b/gi,'');
    // If the user explicitly permits opening a supplied source, a search-only
    // prohibition must not cancel that permission. A separate unconditional
    // no-network instruction still applies.
    if(allowsProvidedNetworkUse)direct=direct
      .replace(/(?:不要|不得|禁止|不能|请勿|不必|无需|无须|别|不)\s*(?:再|主动|自行|擅自|去)?\s*(?:联网|上网|网上|在线)(?:去|进行)?(?:搜索|检索|查找|查询|查阅|浏览)/g,'')
      .replace(/\b(?:do not|don't|never)\s+(?:search|query|research)\s+(?:the\s+)?(?:internet|web|network|online)\b/gi,'');
    const forbidden=/(?:不要|不得|禁止|不允许|不能|请勿|严禁|不|避免|无需|不必)(?:(?:主动|自行|擅自|直接|尝试|再|实际|进行|执行|任何|通过|使用|访问|连接|接入|向外|远程|网上|在线|外部|外网|网络|互联网|发起|发送|对外|第三方|的|\s)){0,12}(?:联网|上网|(?:网上|在线)(?:搜索|查找|浏览|检索|查询|访问|请求)|(?:使用|用|连接|接入|访问)(?:到|任何|外部)?(?:网络|互联网|外网)|网络(?:请求|访问|连接|通信|调用)|互联网(?:请求|访问|连接)|(?:搜索|查询|检索|浏览|查阅|访问)(?:互联网|网络|外网|网页|网站))/i;
    const offline=/离线(?:完成|处理|运行|使用|总结|分析|阅读|审查|检查|工作|执行|计算|编辑|生成|制作|查找|检索|搜索|安装|验证|调查|设计|解答|研究|模式|环境|状态|条件|方式)/i;
    return forbidden.test(direct)||offline.test(direct)||/\b(?:no (?:internet|network)|offline only|work offline)\b|\b(?:do not|don't|never)\b.{0,28}\b(?:use|access|connect|browse|search|go online)\b.{0,25}\b(?:internet|web|network|online)\b/i.test(direct);
  });
  const sourcePattern=/(?:只|仅|只能|仅能).{0,7}(?:使用|用|阅读|读取|查看|浏览|研读|分析|读|根据|依据|参考|基于|利用|依托).{0,18}(?:(?:提供|给定|所给|已有|给的|给你(?:的)?|发给你(?:的)?|附上|附带|上传(?:的)?).{0,10}(?:资料|来源|内容|文件|数据|文档|笔记|图片|视频|素材|文本|链接|附件)|附件|正文|原文|材料|文本|链接)|(?:不要|不得|禁止|不能|请勿|不允许).{0,8}(?:检索|搜索|查找|查阅|引用|获取|使用|采用|读取|参考|利用|浏览).{0,10}(?:其他|其它|额外|外部|更多|第三方).{0,8}(?:资料|来源|文献|信息|网页|网站|材料|内容|文档|数据)|\b(?:(?:only|solely)\s+(?:use|read|consult|rely on|based on)|(?:use|read|consult|rely on)\s+(?:only|solely))\b.{0,35}\b(?:(?:provided|supplied|given|attached)\s+(?:sources?|text|documents?|links?|notes|materials?|files?|data)|sources?|text|notes)\b|\b(?:do not|don't|never)\s+(?:search|consult|use)\b.{0,25}\b(?:other|additional|external)\s+(?:sources|materials|references)\b/i;
  const sourceNegated=c=>/(?:不必|无需|无须|不用|不需要|不要|不要求|没有要求|不限制|不局限|不限定).{0,12}(?:限制|(?:只|仅)(?:能)?(?:使用|用|阅读|读取|查看|浏览|研读|分析|读|引用|参考|根据|依据))|(?:不只|不仅|不止|不单|不光|并非只|并非仅|不是只|不是仅)(?:仅|是|单)?(?:使用|用|阅读|读取|查看|浏览|研读|分析|读|引用|参考|根据|依据)|\b(?:do not|don't|never)\s+(?:restrict|limit|require|insist|force)\b.{0,60}\b(?:only|solely)\b/i.test(c);
  // “Only three sentences using supplied notes” limits the answer's length,
  // not its sources. A separate source restriction in the same clause remains.
  const withoutFormatLimit=c=>c
    .replace(/(?:只|仅)(?:能)?(?:使用|用)\s*(?:[一二三四五六七八九十两百千\d]+)\s*(?:句话?|段(?:话)?|行|字|条|页|张|秒|分钟|小时|个(?:字|句|段|词))/g,'')
    .replace(/\b(?:only|solely)\s+(?:use|write|produce)\s+(?:one|two|three|four|five|\d+)\s+(?:sentences?|paragraphs?|words?)\b/gi,'');
  const providedOnly=clauses.some(c=>!sourceNegated(c)&&sourcePattern.test(withoutFormatLimit(c)));
  const specifiedSite=clauses.some(c=>!sourceNegated(c)&&/(?:只|仅|只能|仅能).{0,8}(?:用|使用|参考|查阅|依据|访问|查|查询|搜索|检索).{0,30}(?:官网|官方网站|网站|站点)|(?:只|仅|只能|仅能).{0,8}在.{0,30}(?:官网|官方网站|网站|站点).{0,10}(?:查|搜索|检索|阅读|访问)|\b(?:use|consult|cite|search)\s+(?:only|solely)\b.{0,45}\b(?:site|website|domain|official pages?)\b|\b(?:only|solely)\s+(?:use|consult|cite|search)\b.{0,45}\b(?:site|website|domain|official pages?)\b/i.test(c));
  const exactProvided=clauses.some(c=>!sourceNegated(c)&&/(?:只|仅|只能|仅能).{0,10}(?:用|使用|根据|依据).{0,15}(?:提供|给定|给的|所给|附上).{0,12}(?:链接|网址|正文|文本|附件|文档|资料)|\b(?:provided|supplied|given|attached)\s+(?:links?|urls?|text|documents?|notes|materials?|files?|data)\b/i.test(c));
  const onlyUrl=clauses.some(c=>!sourceNegated(c)&&/(?:只|仅|只能|仅能).{0,10}(?:用|使用|访问|查看|阅读).{0,20}USER_SUPPLIED_URL|\b(?:only|solely)\s+(?:use|visit|open|read)\b.{0,25}USER_SUPPLIED_URL/i.test(c));
  const sourceScope=onlyUrl||providedOnly&&(!specifiedSite||exactProvided)?'provided-only':specifiedSite?'specified-site-only':providedOnly?'provided-only':null;
  return {readOnly,networkForbidden,sourceScope,...(preserveInputs?{preserveInputs:true}:{})};
}
