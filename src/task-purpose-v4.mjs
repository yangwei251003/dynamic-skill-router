import {positiveObjectEvidence} from './specialty-alignment-v4.mjs';

const list=value=>Array.isArray(value)?value:[];
const norm=value=>String(value||'').normalize('NFKC').toLowerCase();
const nonDirective=/^\s*(?:(?:请|帮我|请你|麻烦|please)\s*)*(?:解释|介绍|科普|讨论|什么是|为什么|是否|explain\b|what\s+is\b|whether\b)/iu;
const negated=/^\s*(?:(?:也|并|且|请|同时)\s*)*(?:不要|不得|禁止|请勿|严禁|不使用|不用|不调用|不采用|无需|不需要|不做|不画|不绘制|不生成|不制作|不对|不在|do not\b|don't\b|never\b|without\b)/iu;
const build=/(?:制作|开发|设计|创建|构建|生成|实现|搭建|编写|做(?:一|个|成)|整理(?:为|成)|需要.{0,8}(?:一份|一个)|\b(?:build|create|make|implement|develop|design)\b)/iu;
const webObject=/(?:网页|网站|网页应用|网站首页|前端|网页界面|网页小工具|\b(?:website|webpage|web app|html|frontend)\b)/iu;
const uiPage=/(?:页面|界面)/u;
const game=/(?:游戏|\bgames?\b)/iu;
const gameplay=/(?:键盘|按键|按钮|控制|玩家|关卡|操作|触控|移动|\b(?:keyboard|buttons?|controls?|players?)\b)/iu;
const nonWebPlatform=/(?:\b(?:unity|unreal|godot|pygame|flutter|swiftui|android|ios|steam)\b|微信小程序|原生桌面|原生客户端)/iu;
const frontendManual=/(?:frontend interfaces?|front.end interfaces?|frontend (?:pages?|components?|applications?)|web (?:components?|pages?|applications?)|前端(?:网页|界面|页面|应用)|网页(?:界面|前端)设计)/iu;
const codeManual=/(?:\b(?:code|html|css|react|javascript|typescript)\b|代码|编码)/iu;
const personalSiteManual=/^\s*(?:(?:create|build|edit|design|make|develop).{0,50}(?:personal (?:homepages?|websites?)|portfolio websites?|resume websites?)|(?:个人(?:主页|网站)|作品集网站).{0,20}(?:生成|制作|设计|开发|创建))/iu;
const personalSiteObject=/(?:个人|求职|简历|履历|作品集|个人项目|\b(?:personal|portfolio|resume)\b)/iu;
const resumeTask=/(?:需要|制作|撰写|生成|起草|编写|写|修改|优化|润色|整理(?:为|成)).{0,25}(?:简历|履历|求职介绍|\b(?:resume|résumé|curriculum vitae|cv)\b)|(?:简历|履历|\b(?:resume|résumé|curriculum vitae|cv)\b).{0,12}(?:优化|润色|修改|撰写|生成|排版)/iu;
const resumeManual=/(?:简历|履历|\b(?:resume|résumé|curriculum vitae)\b).{0,65}(?:生成|制作|编写|写作|排版|\b(?:builder|build|creat|writ|generat)\w*)|(?:生成|制作|撰写|build|creat\w*|writ\w*|generat\w*).{0,55}(?:简历|履历|\b(?:resume|résumé|curriculum vitae)\b)/iu;
const resumeWebsiteOnly=/(?:\b(?:resume|résumé|cv)\s+(?:website|webpage|site|homepage)s?\b|简历网站|简历主页)/iu;
const resumeDocumentPurpose=/(?:简历(?:生成|制作|撰写|排版|优化)|(?:生成|制作|撰写|排版|优化).{0,8}简历|\b(?:resume|résumé)\s+(?:builder|generation|writing|creator)\b)/iu;
const wordObject=/(?:\bword\b|\.docx?\b|\bdocx\b)/iu;
const documentWrite=/(?:制作|撰写|编写|生成|创建|编辑|修改|撰写|写一份|另存|导出|排版|\b(?:create|write|draft|edit|modify|produce|export|format)\b)/iu;
const wordManual=/(?:\bword\b|\bdocx\b|\.docx\b)/iu;
const wordManualAction=/(?:\b(?:create|creation|creat\w*|edit\w*|format\w*|manipulat\w*|produc\w*|modify)\b|生成|制作|撰写|创建|编辑|排版)/iu;
const pdfObject=/(?:\.pdf\b|\bpdf\b)/iu;
const pdfManual=/(?:\bpdf\b|\.pdf\b)/iu;
const pdfManualAction=/(?:\b(?:create|creating|edit|fill|merge|combine|split|produc\w*|export)\b|生成|制作|创建|编辑|填写|合并|拆分|导出)/iu;
const paperObject=/(?:论文|学术文章|文献|\b(?:papers?|research articles?)\b)/iu;
const paperAction=/(?:逐篇|提取|对比|比较|归纳|整理|阅读|分析|核对|综述|\b(?:read|compare|extract|review|analy[sz]e|synthesi[sz]e)\b)/iu;
const paperManual=/^\s*(?:(?:use this skill to|used to|用于)\s*)?(?:read|review|analy[sz]e|extract|阅读|研读|解读|分析).{0,100}(?:academic papers?|research papers?|论文|学术文献)|(?:^|[^a-z])paper[-_ ]?(?:read|reader|review)(?:$|[^a-z])|论文(?:阅读|研读|解读|对比)/iu;
const videoObject=/(?:视频|影片|录像|录屏|屏幕录制|\bvideo\b|\.(?:mp4|mov|mkv|webm)\b)/iu;
const audioSource=/(?:旁白|语音|音频|人声|说话|\b(?:speech|voice|audio|narration)\b)/iu;
const textOutput=/(?:文字|文本|转写|转录|字幕|逐字|逐句|\bsrt\b|\b(?:transcript|captions?|subtitles?)\b)/iu;
const transcriptAction=/(?:提取|整理|转写|转录|听写|导出|生成|转换|转成|\b(?:extract|transcrib\w*|convert|generat\w*)\b)/iu;
const transcriptManual=/(?:local\s+video|video\s+url|本地视频|视频链接)/iu;
const transcriptManualAction=/(?:transcri(?:ption|be)|captions?|subtitles?|转写|字幕|语音识别)/iu;
const presentationObject=/(?:课件|幻灯片|演示稿|演示文稿|\bpptx?\b|powerpoint|\bslides?\b|presentation)/iu;
const presentationManual=/(?:\bpptx?\b|powerpoint|\bslides?\b|presentation|幻灯片|演示文稿)/iu;
const slideStructure=/(?:\d+|[一二三四五六七八九十]+)\s*(?:页|张)|(?:可编辑|授课|课堂|演示|讲解|教学|\beditable\b)/iu;
const genericDeclared=new Set(['搜索','网页','视频','图片','生成','使用','创建','工具','技能','用户','所有任务','all tasks','project','engineering','api','code','web','eda']);

function declaredTerms(skill){
  const summary=String(skill.summaryZh||skill.description||'').slice(0,1800);
  const marker=/(?:\btrigger\s+on|\btrigger\s+words?|触发词)\s*[:：]\s*([^\n]{1,700})/iu.exec(summary);
  if(!marker)return {summary,lead:summary,terms:[]};
  return {summary,lead:summary.slice(0,marker.index),terms:[...marker[1].matchAll(/["“「『]([^"”」』\r\n]{3,48})["”」』]/gu)].map(match=>match[1].trim())};
}
function phrasePattern(term){
  const escaped=Array.from(term).map(ch=>ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');
  const startsLatin=/^[a-z0-9]/iu.test(term),endsLatin=/[a-z0-9]$/iu.test(term);
  try{return new RegExp((startsLatin?'(?<![a-z0-9_])':'')+escaped+(endsLatin?'(?![a-z0-9_])':''),'iu');}catch{return null;}
}

// A user may forbid a product by its stated brand while the skill ID uses a
// different spelling. Only recognize a specific product when it is the
// manual's own leading identity or the summary explicitly declares an alias
// relationship to that identity. Generic output words (e.g. schematic) are
// not treated as product names, and prohibited actions such as upload alone
// do not become a whole-product ban.
export function prohibitedDeclaredProduct(skill,clauses){
  const {summary,terms}=declaredTerms(skill);
  const identity=[skill.id,skill.nameZh,skill.name,...list(skill.aliases)].filter(Boolean).join(' ');
  const names=[...identity.matchAll(/[a-z][a-z0-9]{4,}/giu)].map(x=>x[0]).filter(x=>!['codex','skill','tools','agent','plugin','design','system','editor'].includes(norm(x)));
  const cleanSummary=summary.replace(/[*_`]/gu,'');
  const ban=/(?:不要|不得|禁止|请勿|严禁|不使用|不用|不调用|不采用|不执行|禁用|避免使用|do not|don't|never)\s*(?:(?:再|主动|直接|擅自)\s*)*(?:(?:使用|调用|启用|采用|打开|启动|操作|用|use|invoke|call|open)\s*)?(?:(?:软件|平台|工具|产品)\s*)?$/iu;
  for(const term of terms){
    if(genericDeclared.has(norm(term)))continue;
    const latin=/^[a-z][a-z0-9]{4,}$/iu.test(term);
    const mixed=/\p{Script=Han}/u.test(term)&&/[a-z]/iu.test(term)&&term.length>=5;
    if(!latin&&!mixed)continue;
    const pattern=phrasePattern(term);if(!pattern)continue;
    const own=pattern.test(identity);
    const alias=mixed&&names.some(name=>{
      const a=Array.from(term).map(ch=>ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');
      const b=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      return new RegExp(`${a}.{0,50}(?:english\\s+name|英文名|中文名|别名|又称|又名|also\\s+known\\s+as|\\baka\\b).{0,50}${b}`,'iu').test(cleanSummary);
    });
    if(!own&&!alias)continue;
    for(const clause of list(clauses)){
      const found=pattern.exec(String(clause));
      if(found&&ban.test(String(clause).slice(0,found.index).trimEnd()))return {phrase:found[0],term};
    }
  }
  return null;
}

function declaredTrigger(skill,clauses){
  const {terms}=declaredTerms(skill);
  for(const term of terms){
    if(genericDeclared.has(norm(term))||!/[\p{L}\p{N}]/u.test(term))continue;
    if(/^[a-z0-9]+$/iu.test(term)&&term.length<4)continue;
    if(/^[\p{Script=Han}]+$/u.test(term)&&term.length<3)continue;
    const pattern=phrasePattern(term);if(!pattern)continue;
    for(const clause of clauses){
      if(negated.test(clause))continue;
      const found=pattern.exec(clause);
      if(!found)continue;
      const before=clause.slice(Math.max(0,found.index-20),found.index);
      if(/(?:不要|不得|禁止|不用|不使用|不采用|不做|不画|不绘制|不生成|不制作|不对|不在|未使用|without|never|do not)[^，,。；;]{0,16}$/iu.test(before))continue;
      return {phrase:found[0],term};
    }
  }
  return null;
}

// These are optional consultation signals based on both the active work and
// the leading stated purpose of a manual. They neither invoke tools nor
// establish permission, availability, specialist qualification, or success.
export function taskPurposeMatches(skill,assessment){
  const clauses=list(assessment.activeClauses).map(String);
  const active=positiveObjectEvidence(clauses,assessment.activeText||'');
  const currentClauses=clauses.filter(c=>!negated.test(c)&&!/^\s*(?:(?:我|我们|团队)\s*)?(?:以前|之前|过去|曾经|此前).{0,40}(?:网站|网页|游戏|website|game)/iu.test(c));
  const leading=String(skill.summaryZh||skill.description||'').slice(0,700);
  const firstSentence=leading.split(/[。！？!?\n]|\.(?=\s|$)/u)[0];
  const identity=[skill.id,skill.nameZh,skill.name,...list(skill.aliases)].filter(Boolean).join(' ');
  const out=[];
  const add=(group,pattern,phases)=>{const m=pattern.exec(active);if(m)out.push({group,phrase:m[0],phases});};
  if(!nonDirective.test(active)){
    const building=build.test(active);
    const explicitWeb=currentClauses.some(c=>build.test(c)&&(webObject.test(c)||(uiPage.test(c)&&/(?:可运行|源码|浏览器|键盘|移动端|本地启动|交互|响应式|\b(?:source code|browser|responsive)\b)/iu.test(active))));
    const possibleWebGame=currentClauses.some(c=>build.test(c)&&game.test(c))&&gameplay.test(active)&&!nonWebPlatform.test(active);
    const personalSite=currentClauses.some(c=>build.test(c)&&/(?:网页|网站|主页|首页|\b(?:website|webpage|homepage|site)\b)/iu.test(c))&&personalSiteObject.test(active);
    if(personalSite&&personalSiteManual.test(leading))add('personal-site-work',personalSiteObject,['implementation','design']);
    if(building&&(explicitWeb||possibleWebGame)&&frontendManual.test(leading)&&codeManual.test(leading))
      add('frontend-work',explicitWeb?(webObject.test(active)?webObject:uiPage):game,['implementation','design']);
    if(resumeTask.test(active)&&resumeManual.test(leading)&&(!resumeWebsiteOnly.test(leading)||resumeDocumentPurpose.test(leading)))add('resume-work',/(?:简历|履历|\b(?:resume|résumé|curriculum vitae|cv)\b)/iu,['implementation','planning','design']);
    if(documentWrite.test(active)&&wordObject.test(active)&&wordManual.test(firstSentence)&&wordManualAction.test(firstSentence))add('word-document-work',wordObject,['implementation','analysis','delivery']);
    if(documentWrite.test(active)&&pdfObject.test(active)&&pdfManual.test(firstSentence)&&pdfManualAction.test(leading))add('pdf-document-work',pdfObject,['implementation','analysis','delivery']);
    if(paperObject.test(active)&&paperAction.test(active)&&(paperManual.test(identity)||paperManual.test(leading.slice(0,250))))add('paper-analysis',paperObject,['implementation','discovery','analysis']);
    if(videoObject.test(active)&&audioSource.test(active)&&textOutput.test(active)&&transcriptAction.test(active)
        &&transcriptManual.test(leading)&&transcriptManualAction.test(leading))add('video-transcription',videoObject,['implementation','analysis','design']);
    if(building&&presentationObject.test(active)&&slideStructure.test(active)&&presentationManual.test(identity+' '+leading.slice(0,250)))
      add('presentation-work',presentationObject,['implementation','design','delivery']);
  }
  const trigger=nonDirective.test(active)?null:declaredTrigger(skill,clauses);
  if(trigger)out.push({group:'declared:'+norm(trigger.term).replace(/\s+/g,''),phrase:trigger.phrase,phases:[]});
  return out;
}
