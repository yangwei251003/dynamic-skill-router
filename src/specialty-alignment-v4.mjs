import {requestSegments,instructionText,instructionClauses} from './request-evidence.mjs';

// Consult these broad objects only when a skill's own identity or leading
// purpose makes the specialty clear. Unknown or multi-purpose skills fall
// back to the existing ranking; this list never grants execution authority.
const facets=[
  {name:'personal-site',identity:/(?:^|[^a-z])personal[-_ ]?(?:homepage|site|website)|个人主页|个人网站|作品集网站/iu,
    lead:/^.{0,50}(?:personal\s+(?:homepages?|websites?)|个人主页|个人网站|作品集网站)/iu,
    // A generic webpage may still turn out to be a personal site. Keep this
    // flexible skill unless the current task clearly has another object.
    task:/(?:网页|网站|主页|首页|\b(?:website|webpage|homepage|site)\b|(?:\bhtml\b|网页).{0,25}(?:幻灯|演示文稿|\bpptx?\b|slides?))/iu},
  {name:'presentation',identity:/(?:^|[^a-z])(?:pptx?|powerpoint|slides?|presentation)(?:$|[^a-z])|幻灯片|演示文稿/iu,
    lead:/(?:生成|制作|创建|编辑|转换|create|generate|edit).{0,24}(?:pptx?|powerpoint|幻灯片|演示文稿)|(?:pptx?|powerpoint|幻灯片|演示文稿).{0,24}(?:模板|生成|制作|编辑|create|generate|edit)/iu,
    task:/(?:^|[^a-z])(?:pptx?|powerpoint|slides?|presentation)(?:$|[^a-z])|幻灯片|演示文稿|演示稿|投影片|课件/iu},
  {name:'cloud-files',identity:/网盘|云盘|(?:cloud[-_ ]?(?:file[-_ ]?)?(?:drive|storage))|(?:drive|storage)[-_ ]?cloud/iu,
    lead:/^.{0,28}(?:网盘|云盘|cloud\s+(?:file\s+)?(?:drive|storage))\s*(?:mcp|接口|平台|技能|文件|工具|service|api|tool)/iu,
    task:/网盘|云盘|云存储|云储存|云端(?:文件|目录|文件夹|备份|存储)|共享(?:盘|网盘)|cloud\s+(?:file\s+)?(?:drive|storage)|cloud files?|shared drive|dropbox|onedrive|google drive/iu},
  {name:'agent-persona',identity:/(?:^|[^a-z])persona(?:$|[^a-z])|人设|智能体人格/iu,
    lead:/(?:生成|创建|设计|打造|构建|锻造|create|build|generate).{0,24}(?:人设|人格|\bpersonas?\b)|(?:人设|人格).{0,24}(?:文件包|agent|智能体)/iu,
    task:/人设|人格|性格设定|角色(?:设定|档案|性格|人格)|(?:创建|设计|定制|打造|构建|模拟).{0,20}(?:智能体|agent|数字分身)|(?:agent|智能体).{0,20}(?:人设|人格|性格|身份)|\bpersona\b|character\s+(?:profile|personality)/iu},
  {name:'resume',identity:/(?:^|[^a-z])(?:resume|résumé|resumecraft|curriculum[-_ ]vitae)(?:$|[^a-z])|简历|履历/iu,
    lead:/^.{0,18}(?:简历|履历|resume|résumé|curriculum vitae)(?:制作|优化|撰写|生成|服务|工具|写作|builder|writing|review)/iu,
    task:/简历|履历|求职材料|(?:^|[^a-z])(?:resume|résumé|curriculum vitae|cv)(?:$|[^a-z])/iu},
  {name:'email',identity:/(?:^|[^a-z])(?:mail|e-?mail|mailbox|smtp|imap)(?:$|[^a-z])|邮箱|邮件/iu,
    lead:/^.{0,20}(?:邮箱|邮件|e-?mail|mailbox|smtp|imap)(?:路由|管理|工具|服务|客户端|收发|发送|读取|client|service|tool)/iu,
    task:/邮箱|邮件|电子信箱|smtp|imap|e-?mail|mailbox|gmail|outlook|\b(?:mail|inbox)\b/iu},
  {name:'survey',identity:/(?:^|[^a-z])(?:survey|questionnaire)(?:$|[^a-z])|问卷/iu,
    lead:/^.{0,25}(?:问卷|questionnaire|survey)(?:调查|平台|工具|系统|service|platform|tool)/iu,
    task:/问卷|调查表|在线表单|投票|测评|survey|questionnaire|polls?/iu},
  {name:'official-document',identity:/(?:^|[^a-z])gongwen(?:$|[^a-z])|公文/iu,
    lead:/^.{0,20}(?:机关公文|党政公文|公文标准|公文排版|政府公文)/iu,
    task:/公文|红头文件|党政机关|政府文件|请示|函件|会议纪要|汇报材料|文档排版|国标(?:格式|排版)|\b(?:word|docx?)\b|gb\s*\/\s*t\s*9704/iu},
  {name:'geographic-map',identity:/(?:^|[^a-z])(?:geographic[-_ ]?)?maps?(?:[-_ ]?(?:sdk|api))?(?:$|[^a-z])|地图(?:api|接口|sdk)/iu,
    lead:/^.{0,30}(?:地理地图|电子地图|腾讯地图|百度地图|地图\s*(?:api|sdk|jsapi)|geographic maps?)/iu,
    task:/地图|地理|经纬度|地理坐标|行政区划|路线规划|导航|(?:城市|地标|地点|景点|场所|门店|商圈).{0,40}(?:路线|路径|附近|距离)|(?:路线|路径|附近|距离).{0,40}(?:城市|地标|地点|景点|场所|门店|商圈)|geojson|geocod|latitude|longitude|geographic|\bgps\b|\bmaps?\b/iu},
  {name:'skill-management',identity:/(?:^|[^a-z])(?:find[-_ ]?skills|skill[-_ ]?(?:manager|assistant|installer|creator|vetter|stocktake))(?:$|[^a-z])/iu,
    lead:/(?:skill|技能).{0,20}(?:生命周期|管理助手|安装器|创建器|盘点|治理|management|manager)/iu,
    task:/(?:安装|创建|编写|更新|诊断|盘点|查找|搜索|推荐|选择|管理|优化|评估|审查|启用|停用|install|create|update|diagnose|manage|audit|find|search|recommend|select).{0,24}(?:技能|skills?)|(?:技能|skills?).{0,24}(?:安装|创建|编写|更新|诊断|盘点|查找|搜索|推荐|选择|管理|优化|评估|审查|启用|停用|install|create|update|diagnose|manage|audit|find|search|recommend|select)/iu},
  {name:'media-processing',identity:/(?:^|[^a-z])(?:media[-_ ]?(?:processing|transcod)|video[-_ ]?editor)(?:$|[^a-z])/iu,
    lead:/^.{0,30}(?:音视频|视频|图像|图片|audio|video|image).{0,10}(?:处理|转码|编辑|分析报告|processing|transcoding|editing|analysis report)/iu,
    task:/视频|音频|录屏|屏幕录制|照片|图片|图像|截图|字幕|配音|语音|转码|剪辑|\b(?:video|audio|image|photo|picture|screenshot|subtitle|transcod\w*|voice)\b|\.(?:mp4|mov|wav|mp3|png|jpe?g|webp)\b/iu},
  {name:'industrial-controls',identity:/(?:^|[^a-z])(?:tia[-_ ]?portal|plc)(?:$|[^a-z])|博途|梯形图/iu,
    lead:/^.{0,70}(?:tia\s+portal|博途|\bplc\b|梯形图).{0,20}(?:工程|编程|编译|仿真|项目|engineering|project|program)/iu,
    task:/\b(?:tia|plc|lad|modbus|profinet)\b|博途|梯形图|可编程控制器|工业控制|工业自动化|控制柜|工控|西门子控制器/iu},
  {name:'software-setup',identity:/(?:^|[^a-z])(?:env|environment)[-_ ]?(?:setup|diagnostic|doctor)?(?:$|[^a-z])/iu,
    lead:/^.{0,35}(?:环境|运行时|environment|runtime).{0,15}(?:诊断|安装|配置|diagnos|install|setup)/iu,
    task:/(?:安装|配置|修复|诊断|检查|更新|卸载|install|configure|diagnos|setup).{0,25}(?:环境|依赖|运行时|命令行|cli|工具|包管理|environment|dependenc|runtime|package)|(?:环境|依赖|运行时|命令行|environment|runtime|package).{0,25}(?:安装|配置|修复|诊断|报错|缺失|install|configur|diagnos|missing|error)|command not found|未找到命令/iu},
  {name:'scholarly-sources',identity:/bibliograph|biblio[-_ ]?base|citation|文献库|参考文献/iu,
    lead:/^.{0,35}(?:学术文献|文献知识库|参考文献|scholarly literature|bibliograph)/iu,
    task:/论文|学术|文献|引文|参考文献|专利|期刊|学位|bibliograph|citation|scholarly|\b(?:papers?|doi|research articles?)\b/iu},
  {name:'team-messaging',identity:/(?:^|[^a-z])(?:lark|feishu|slack|discord)(?:$|[^a-z])|飞书/iu,
    lead:/^.{0,20}(?:飞书|lark|feishu|slack|discord).{0,20}(?:消息|群聊|聊天|连接|安装|配置|message|chat|connect|setup)/iu,
    task:/飞书|lark|feishu|slack|discord|团队(?:聊天|消息|通讯)|群聊|(?:发送|读取|搜索|同步|send|read|search).{0,15}(?:团队消息|聊天记录|群消息|team messages?|chat history)/iu},
  {name:'shader-effects',identity:/(?:^|[^a-z])(?:shaders?|webgpu|glsl)(?:$|[^a-z])|着色器/iu,
    lead:/^.{0,30}(?:shaders?|webgpu|glsl|着色器).{0,18}(?:效果|特效|组件|effects?|components?)/iu,
    task:/着色器|光影特效|粒子|极光|动态背景|渐变|玻璃|发光|鼠标跟随|转场|webgpu|webgl|glsl|\bshaders?\b|gpu effects?|animated backgrounds?|gradients?|glass|glow|pointer tracking|transitions?/iu},
  {name:'knowledge-notes',identity:/(?:^|[^a-z])(?:knowledge[-_ ]?base|note[-_ ]?(?:manager|taking))(?:$|[^a-z])|知识库|笔记管理/iu,
    lead:/^.{0,40}(?:知识库|笔记管理|knowledge base|note management)/iu,
    task:/知识库|笔记|资料库|知识管理|读书记录|研究|调研|文献|检索资料|knowledge base|note[- ]?taking|notes?\b|notion|obsidian|research|study|literature/iu},
];

const taskObject=/(?:网页|网站|界面|小程序|游戏|动画|视频|音频|录屏|图片|图像|照片|截图|海报|报告|文档|论文|表格|工作簿|数据集|地图|图表|电路|原理图|器件|简历|邮件|邮箱|问卷|网盘|云盘|代码|程序|接口|数据库|模型|提示词|\b(?:website|webpage|web app|html|canvas|game|video|audio|image|photo|document|report|paper|spreadsheet|csv|xlsx|pdf|pptx?|slides?|map|email|survey|resume|database|code|api|prompt)\b)/iu;

// Exclude only clear, standalone negative task clauses when determining
// whether a task positively names a specialist's object. Keep the full raw
// request for restrictions and leave ambiguous/conditional language alone.
export function positiveObjectEvidence(clauses=[],fallback='') {
  if(!Array.isArray(clauses)||!clauses.length)return String(fallback||'');
  const standaloneNegative=/^(?:(?:也|并|且|同时|另外|另|请)\s*)*(?:(?:不需要|无需|不要求|无须)(?!不)|(?:不要|不|不用|不再|不必|不得|禁止|请勿|严禁)\s*(?:(?:再|另行|额外|单独|自动|主动|直接)\s*)*(?:制作|生成|创建|建立|设计|绘制|导出|输出|提供|使用|调用|连接|访问|上传|下载|启用|运行|部署|处理|编辑|修改|删除|构建|编写|撰写|发布|分享|制作|准备|获取|包含|采用))/u;
  // A conjunction may introduce another positive objective or an input;
  // when its scope is unclear, keep the entire clause instead of discarding
  // potentially useful evidence.
  const possibleContinuation=/(?:但是|然而|而是|但|却|而|同时|此外|并且|以及|然后|接着|仍要|仍需|仍然|还要|\b(?:but|and|then|however)\b)/iu;
  const pastBackground=/^\s*(?:(?:我|我们|团队)\s*)?(?:之前|以前|过去|曾经|此前)(?:做过|开发过|创建过|制作过|使用过|用过|参与过|维护过)/u;
  const kept=clauses.filter(clause=>{
    const text=String(clause||'').trim();
    if(pastBackground.test(text)&&!/(?:现在|本次|这次|请|目前|\b(?:now|today)\b)/iu.test(text))return false;
    return !standaloneNegative.test(text)||possibleContinuation.test(text);
  });
  return kept.length?kept.join(' '):String(fallback||'');
}

// A single literal filename may be valid task data even when quoted. It may
// prevent an exclusion, but never acts as a directive, boost or authorization.
function literalFileObjects(query='',active=''){
  const raw=String(query),parsed=requestSegments(raw,{preserveNames:false}),paths=[];
  for(const span of parsed.spans){
    if(span.role==='attached-context' && /附件|附带文件|上传文件|attach(?:ed|ment)/iu.test(active)){
      const text=raw.slice(span.start,span.end);
      for(const hit of text.matchAll(/[\p{L}\p{N}_.-]+\.(?:pptx?|pdf|docx?|xlsx?|csv|png|jpe?g|webp|mp4|mov|mp3|wav)\b/giu))paths.push(hit[0]);
      continue;
    }
    if(span.role!=='quoted-material'||span.boundary)continue;
    const text=raw.slice(span.start,span.end);
    const match=/^[`"'“‘「『]((?:[a-z]:[\\/])?[\p{L}\p{N}_.\\/-]{1,200}\.(?:pptx?|pdf|docx?|xlsx?|csv|png|jpe?g|webp|mp4|mov|mp3|wav))[`"'”’」』]$/iu.exec(text);
    if(match)paths.push(match[1]);
  }
  return paths.join(' ');
}

// Treat an actual upgrade of an agent skill collection/router as a management
// task without turning an explanation of such an upgrade into an instruction.
// Match only a direct imperative in an active clause and a concrete agent
// skill-management object; ambiguous game/individual skills fall back.
function directSkillManagementUpgrade(activeText='',rawQuery=''){
  const text=instructionText(rawQuery||activeText);
  const clauses=instructionClauses(text);
  const prefix='(?:(?:请(?:你)?|帮我|麻烦|我想|我希望|我需要|需要|希望|现在|本次|这次|先|再|接着|然后|继续|着手|开始|尽快|直接)\\s*)*';
  const object='(?:(?:动态|智能|自定义|全局)?技能(?:路由器?|管理|库|插件|目录|清单|索引|框架|包)|(?:agent[ -]+)?skill[ -]+(?:router|manager|registry|library|inventory)|installed[ -]+skills?)';
  const verbFirst=new RegExp(`^${prefix}(?:升级|upgrade)\\s*(?:我的|现有的?|当前的?|全局的?)?\\s*${object}`, 'iu');
  const objectFirst=new RegExp(`^${prefix}(?:把|将|对)\\s*(?:我的|现有的?|当前的?|全局的?)?\\s*${object}(?:(?!(?:不|别|勿|未|没|禁止|无需|无须|避免|暂缓|\\b(?:not|never|avoid)\\b)).){0,24}(?:升级|upgrade)`, 'iu');
  return clauses.some(clause=>verbFirst.test(clause)||objectFirst.test(clause));
}

export function specialtyMismatch(skill,activeText,rawQuery=''){
  const identity=[skill.id,skill.nameZh,skill.name,...(Array.isArray(skill.aliases)?skill.aliases:[])].filter(Boolean).join(' ');
  const summary=String(skill.summaryZh||skill.description||'').split(/[。！？!?\n]/u)[0].slice(0,240);
  const matches=facets.filter(f=>f.identity.test(identity)||f.lead.test(summary));
  if(!matches.length)return null;
  // The object lexicon is not a reliable language detector. Only attempt a
  // negative inference on predominantly Chinese requests; other languages
  // retain legacy ranking. Mixed-language uncertainty also falls back.
  const text=String(activeText||'');
  if(!/\p{Script=Han}/u.test(text)
      ||/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Greek}\p{Script=Hebrew}]/u.test(text)
      ||/[\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]/u.test(text)
      ||/\b(?:una|unas|para|con|los|las|crear|hacer|presentacion|diapositivas?|une|des|pour|avec|faire|creer|diapositives?|und|eine|einen|erstellen|folien)\b/iu.test(text))return null;
  const evidence=String(activeText||'')+' '+literalFileObjects(rawQuery,activeText);
  if(!taskObject.test(evidence))return null;
  if(matches.some(f=>f.task.test(evidence)))return null;
  if(matches.some(f=>f.name==='skill-management')&&directSkillManagementUpgrade(activeText,rawQuery))return null;
  // A provider's literal Chinese name in its concise storage title can be an
  // independently requested service even when the user omits “网盘”.
  const provider=/^\s*([\p{Script=Han}]{2,8})(?:网盘|云盘)/u.exec(summary)?.[1];
  if(provider&&evidence.includes(provider))return null;
  return {facets:matches.map(f=>f.name),reason:'No matching task object for a clearly specialized skill.'};
}
