import {creationAction,modificationAction,hasProducedFormat,requestedRasterWork,semanticTaskText,taskStructure} from './task-structure.mjs';
import {primaryPurpose,applicableLanguages,inspectionOfCode} from './purpose-evidence.mjs';
// Small, auditable action/object predicates shared by retrieval and domain checks.
// These describe possible task needs; they do not authorize execution.
export const gameImplementation = text => /游戏|小游戏|\bgames?\b/i.test(text) && (creationAction.test(text)||modificationAction.test(text));
export const webImplementation = text => hasProducedFormat(text,/^html?$/i)
 || taskStructure(text).clauses.some(clause=>(creationAction.test(clause)||modificationAction.test(clause))
   && /浏览器|\bbrowser\b/i.test(clause))
   && /(?:交付|输出|提供|编写|生成).{0,25}(?:可运行)?(?:源码|代码)|\b(?:deliver|write|provide|produce)\b.{0,35}\b(?:source|code)\b/i.test(text)
 || taskStructure(text).clauses.some(clause=>(creationAction.test(clause)||modificationAction.test(clause))
 && /网页|网站|前端|官网|教学页|\b(?:html|web|website|frontend)\b|landing page|responsive|interactive.{0,24}visuali[sz]/i.test(clause))
 || (creationAction.test(text)||modificationAction.test(text))&&(
 gameImplementation(text)&&/canvas|浏览器|browser/i.test(text)
 || /(?:浏览器|browser).{0,25}(?:应用|程序|交互|application|app\b|interactive)/i.test(text)
 || /看板|交互面板|界面|dashboard|interface|interactive panel/i.test(text)&&/拖动|拖拽|键盘|点击|按钮|撤销|交互|drag|keyboard|click|button|undo|interaction/i.test(text));
export const evidenceResearch = text => {
 const providedMaterial=/附件|本地|已提供|已给|给定|贴出|\b(?:attached|local|provided|supplied|pasted)\b/i.test(text);
 const methodsReview=/方法学|(?:试验|实验|研究)方法|方法部分|methods?(?: section)?|methodolog|study design|trial design/i.test(text)
  && /预审|审阅|审查|评审|评估|偏倚|偏差|终点|混杂|多重比较|\b(?:review|audit|evaluate|assess|bias|confound|endpoint)\w*\b/i.test(text);
 const offline=/不(?:要|需要)?(?:联网|上网)|禁止(?:联网|网络)|(?:no|without) (?:internet|network)|offline only/i.test(text);
 const externalLookup=!offline&&(publicInformationSearch(text)
  || /(?:检索|搜索|查找|搜集).{0,25}(?:文献|论文|外部来源|外部证据)|(?:search|find|retrieve|look up).{0,35}(?:literature|papers|external (?:sources|evidence))/i.test(text));
 // Evaluating a supplied methods section is professional review, but it does
 // not create a source-acquisition need for every research/search manual.
 if(providedMaterial&&methodsReview&&!externalLookup)return false;
 if(optionComparison(text)&&/本地|输入|已提供|给定|虚构|\b(?:local|input|provided|supplied|fictional)\b/i.test(text)&&!externalLookup)return false;
 return /(?:比较(?!器)|对比|调研|核实|核查|评估|选型|compare|evaluat|research|investigat|verify|assess)/i.test(text)
  && /(?:资料|来源|证据|原文|官方|许可|最新|近期|current|official|documentation|sources?|evidence|licen[cs]e|latest)/i.test(text);
};
// Acquiring current public evidence is a separate need from a research report.
// Local source checking does not by itself establish an external search need.
export const publicInformationSearch = text => {
 if(/不(?:要)?(?:联网|上网)|禁止(?:联网|网络)|(?:no|without) (?:internet|network)|offline only/i.test(text))return false;
 if(/(?:只|仅)(?:依据|根据|使用|用|查阅|读取).{0,20}(?:本地|已给|给定|已提供|离线)|(?:only|solely).{0,25}(?:local|provided|supplied|offline)/i.test(text))return false;
 return /联网(?:搜|查)|网络(?:搜索|检索)|网上(?:搜|查)|搜(?:索)?公开资料|检索网页|web search|search(?:ing)? (?:the web|online)|browse the web/i.test(text)
  || /核查|核实|查证|查找|搜索|检索|搜集|调研|verify|check|find|look up|research/i.test(text)
   && /最新|近期|实时|官方|公告|公开资料|公开来源|current|latest|recent|official|announcements?|public sources/i.test(text);
};
export const cadArtifact = text => /\bcad\b|freecad|autocad|(?:三维|实体|零件|支架|外壳).{0,12}建模|建模.{0,12}(?:零件|支架|外壳)|工程图|机械|几何|壁厚|孔位|gcode|\bstl\b|\bstp\b|\.step\b|\bstep\s+(?:file|model|mechanical|part)|\b(?:mechanical|parametric)\s+(?:part|model|solid)|\b(?:3d|三维).{0,20}(?:模型|零件|model|part|geometry)/i.test(text)
 || /\bstep\b/i.test(text) && /交付|输出|导出|保存|可编辑|\b(?:deliver|export|output|save|editable)\b/i.test(text)
  && /实体|零件|板|支架|孔|槽|圆柱|长方体|直径|厚度|\b(?:solid|part|plate|bracket|hole|slot|cylinder|cuboid|diameter|thickness)\b/i.test(text)
  && /\d\s*(?:mm|cm|毫米|厘米)|[Øφ⌀]|\d\s*[×x]\s*\d/i.test(text);
export const mathematicalModeling = text => /数学建模|整数规划|线性规划|运筹|mathematical model|integer programming|linear programming|operations research/i.test(text)
 || /约束|constraints?|变量|variables?/i.test(text)&&/最小化|最大化|最优|最优化|目标函数|objective function|minimi[sz]|maximi[sz]|optimi[sz]/i.test(text);
export const latexArtifact = text => /\b(?:pdf|xe|lua)?latex\b|\blatexmk\b|\btex\b|\.tex\b|\btectonic\b|\bfontspec\b|\btexlive\b/i.test(text);
export const latexSourceRepair = text => latexArtifact(text) && /修复|修正|排错|诊断|\b(?:fix|repair|resolve|debug|diagnose)\b/i.test(text)
 && /源码|源文件|正文|文档|项目|引用|标签|控制序列|括号|数学模式|编译(?!器)|错误|\b(?:source|document|project|references?|labels?|brackets?|compilation|errors?)\b|control sequence|math mode/i.test(text);
export const sourceCodeReview = text => taskStructure(text).clauses.some(inspectionOfCode);
export const supportsSourceCodeReview = (skill,text) => {
 const purpose=primaryPurpose(skill);
 if(!/(?:review|inspect|audit|审查|审阅).{0,45}(?:code|changes|patch|diff|代码|补丁)|(?:code|代码).{0,25}(?:review|审查|审阅)/i.test(purpose))return false;
 const exclusive=purpose.match(/(?:exclusively|only)\s+(?:on|for)\s+(.+)|(?:只|仅)(?:审查|检查|用于|针对)(.+)/i);
 if(exclusive){
   const subject=(exclusive[1]||exclusive[2]).trim().toLowerCase();
   const matching=String(text).toLowerCase().includes(subject)
     || /over.engineering|complexity/.test(subject)&&/过度设计|过度工程|复杂度|简化|over.engineer|complexity|simplif/i.test(text);
   if(!matching)return false;
 }
 return applicableLanguages(purpose,text);
};
export const latexBuild = text => latexArtifact(text) && (/编译|构建|compile|compil|build/i.test(text)
 || hasProducedFormat(text,/^pdf$/i) && /交付|生成|输出|创建|deliver|generate|output|create/i.test(text));
export const latexFailure = text => {
 const observed=String(text).replace(/(?:无|没有|不含|不存在|避免|确保无|确认无)[^，。；;\n]{0,45}(?:错误|未定义|未解析|失败|包冲突)|\b(?:no|without|free of|avoid)\s+(?:\w+\s+){0,4}(?:errors?|undefined references?|failures?|conflicts?)/gi,'');
 return latexSourceRepair(observed)||/报错|编译失败|出现错误|包冲突|undefined control sequence|compilation (?:failed|failure)|package conflict/i.test(observed);
};
export const supportsLatexBuild = skill => /^(?:compile|build|render|编译|构建)|(?:latex|tex).{0,25}(?:编译|compiler|compilation workflow)/i.test(primaryPurpose(skill))
 && !/^(?:诊断|检测|detect|diagnos|repair|rescue|fix|修复)|smoke test/i.test(primaryPurpose(skill));
export const supportsLatexSourceRepair = skill => {
 const purpose=[skill.summaryZh,skill.description].filter(Boolean).join(' ').split(/[。;；\n]|[.!?](?=\s|$)/)[0];
 return /(?:fix|repair|resolv|修复|修正).{0,60}(?:latex|tex|compil|error|源码|编译|报错)|(?:latex|tex|编译|源码).{0,50}(?:fix|repair|修复|修正)/i.test(purpose);
};
export const mcpImplementation = text => /(?:^|[^a-z0-9_-])mcp(?=$|[^a-z0-9_-])/i.test(text)
 && (/(?:实现|开发|编写|创建|制作|生成|建立|做(?:一个|一套)?|调试|修复|构建|设计|build|implement|create|develop|debug|fix|design).{0,50}(?:\bmcp\b|stdio|streamable|服务|server)|(?:\bmcp\b|stdio).{0,40}(?:实现|开发|编写|构建|调试|修复|设计|implement|develop|debug|build|design)/i.test(text)
 || /inputSchema|invalid parameters|参数.{0,12}(?:错误|不符|类型)|(?:诊断|排查|检查|对照).{0,60}(?:协议|工具调用|参数|握手|初始化|schema|transport)|(?:debug|diagnose|inspect|check).{0,80}(?:schema|protocol|parameter|transport|handshake|initialization|capabilities)/i.test(text));
export const structuredDataOperation = text => /\bcsv\b|\bxlsx\b|\bexcel\b|spreadsheet|google\s*sheets|表格|数据集|dataset|借阅记录|库存记录/i.test(text)
 && /清洗|汇总|去重|缺失|关联|分析报告|趋势分析|analysis report|trend analys|clean|aggregat|deduplicat|normaliz|\bjoin\b|missing|(?:数据|记录|列值|异常行|表格|单元格|单位).{0,12}(?:转换|换算|校验|异常|一致)|(?:统一|转换|换算|校验|异常).{0,12}(?:数据|记录|列值|异常行|表格|单元格|单位)/i.test(text);
// Formats establish the object; operations establish the requested work. A
// destination CSV does not turn coordinate or geometry work into tabular EDA.
export const spatialDataOperation = text => /\b(?:geojson|geopackage|shapefiles?|postgis|geospatial|geographic|crs|epsg)\b|\.shp\b|\.gpkg\b|坐标参考系|地理空间|空间数据|经纬度|点.{0,15}(?:多边形|所属面)|point.{0,20}polygon/i.test(text)
 && /检查|核对|统一|转换|重投影|投影|匹配|相交|包含|叠加|缓冲|距离|面积|空间连接|空间关联|坐标|\b(?:inspect|check|convert|transform|reproject|project|join|intersect|contain|overlay|buffer|distance|area|coordinate|match)\w*\b/i.test(text);
export const videoPostproduction = text => /视频|录像|镜头|\b(?:video|footage|movie|clip|mp4|mov|mkv|webm|avi)\b/i.test(text)
 && /剪辑|剪出|截取|裁剪|剪切|转码|压缩|淡入|淡出|原声|音轨|帧率|抽帧|画幅|分辨率|(?:转为|转换|缩放).{0,35}(?:h\.?26[45]|mp4|\d+\s*[×x]\s*\d+)|\b(?:edit|cut|trim|transcod|encod|compress|crop|resize|rescale|fade|extract|split|concatenat|remux)\w*\b|frame rate|aspect ratio/i.test(text);
export const supportsVideoPostproduction = skill => {
 const identity=[skill.id,skill.name,skill.nameZh].filter(Boolean).join(' ');
 const summary=[skill.summaryZh,skill.description].filter(Boolean).join(' ')
  .split(/[。；;\n]|[.!?](?=\s|$)/).filter(clause=>!/(?:\bnot (?:for|used for|suitable for)|\bcannot\b|\bdoes not support\b|不支持|不用于|不能)/i.test(clause)).join(' ');
 return /ffmpeg|video[-_ ](?:edit|cut|trim|postproduction)|视频剪辑/i.test(identity)
  || /(?:edit(?:ing)?|cut(?:ting)?|trim(?:ming)?|transcod(?:e|ing)|compress(?:ion)?).{0,45}(?:videos?|footage|clips?)|(?:videos?|footage|clips?).{0,45}(?:edit(?:ing)?|cut(?:ting)?|trim(?:ming)?|transcod(?:e|ing))|extract frames or short clips|(?:剪辑|剪切|截取|转码|压缩).{0,20}视频|视频.{0,20}(?:剪辑|剪切|截取|转码|压缩)/i.test(summary);
};
export const backendImplementation = text => (/\b(?:fastapi|django|flask|express|nestjs|spring|asp\.net)\b|后端|服务端|服务器|\bhttp\b.{0,10}(?:服务|service|server)|\b(?:rest|graphql|grpc|endpoint)\b|(?:导入|查询|上传|认证|库存|http|api).{0,15}接口|接口.{0,15}(?:导入|查询|上传|认证|http|api)/i.test(text)
 || /\bnode\.?js\b/i.test(text)&&/服务|\b(?:service|api|http|idempotency|endpoint)\b/i.test(text))
 && (creationAction.test(text)||modificationAction.test(text)||/仓库|代码|repository|code/i.test(text));
export const designToCode = text => /\bfigma\b|设计稿|设计节点|design (?:file|node|mockup)/i.test(text)
 && /做成|转为|转成|实现|还原|开发|代码|组件|react|vue|html|implement|build|port|code|component/i.test(text);
export const wordDocumentArtifact = text => hasProducedFormat(text,/^docx?$/i)
 || taskStructure(text).clauses.some(clause=>/\bdocx\b|\bword\b|Word文档/i.test(clause)
 && /生成|制作|编辑|填写|填入|填充|交付|导出|输出|合成|整理|可编辑|create|generate|edit|fill|deliver|export|produce|convert|write/i.test(clause));
export const wordDocumentInspection = text => /\bdocx\b|\bword\b|Word文档/i.test(text)
 && /读取|只读|核对|审查|检查|比较|对照|差异|\b(?:read|inspect|review|compare|check|diff)\b/i.test(text);
export const desktopObservation = text => /桌面|屏幕(?:上|中|里)|已(?:经)?打开|当前(?:页|窗口|界面)|desktop|\bscreen\b(?!\s*reader)|open (?:app|window)|current (?:window|screen|page)/i.test(text)
 && /看一下|查看|观察|读取|确认|检查|读到|inspect|observe|read|look|check/i.test(text);
export const accessibilityNeed = text => /无障碍|可访问性|wcag|\ba11y\b|读屏|screen reader|accessib/i.test(text)
 || /键盘用户|键盘可(?:达|操作)|减少(?:动态效果|动画)|prefers-reduced-motion|reduced motion/i.test(text)
 || /键盘.{0,35}(?:控制|操作|移到|移动|焦点|按钮|导航)|keyboard.{0,25}(?:control|operat|navigat|focus)/i.test(text);

export const businessAnalysis = text => /商业分析|市场分析|市场规模|竞品|收费方案|商业可行性|盈利|盈亏|\b(?:market|business|competitive|consumer|brand|financial|industry)\b.{0,25}\b(?:analysis|report|research|insights?|sizing|feasibility)\b/i.test(text)
 || /供应商|采购|\b(?:vendor|supplier|procurement)\b/i.test(text)&&/预算|成本|报价|选型|比较|\b(?:budget|cost|price|select|compar)\w*/i.test(text);
export const experimentWork = text => /实验(?!仪器|设备|器材|耗材|室)|试验|研究日志|随机分组|随机化|随机运行|重复测量|\bexperiments?\b|randomi[sz]|confound|factorial|treatment|lab notebook/i.test(text);
export const experimentDesign = text => experimentWork(text) && /设计|规划|对照|随机|区组|混杂|样本量|复现|重复|design|plan|control|random|block|confound|replicat|sample size/i.test(text);
export const electricalDesign = text => /嘉立创|立创EDA|\beasyeda\b|\bkicad\b|\bpcb\b|电路|原理图|circuit|schematic/i.test(text)
 && /设计|做|建立|创建|绘制|编辑|连通|布线|封装|焊盘|网表|引脚|build|create|design|edit|connect|routing|footprint|netlist|pins?\b/i.test(text);
export const electricalInspection = text => /嘉立创|立创EDA|\beasyeda\b|\bkicad\b|\bpcb\b|电路|原理图|circuit|schematic/i.test(text)
 && /只读|查看|读取|检查|核对|审查|确认|对照|\b(?:inspect|read|check|review|verify|audit)\b/i.test(text);
export const databaseMigration = text => /数据库|表结构|\b(?:database|postgresql|postgres|mysql|sqlite|schema)\b/i.test(text)
 && /迁移|回滚|新旧|版本兼容|migration|migrat|rollback|mixed.{0,25}(?:version|deployment)|rename.{0,25}(?:column|field)/i.test(text)
 || /(?:rename|alter|drop|add).{0,25}(?:column|field)|(?:更名|重命名|增删|修改).{0,12}(?:列|字段)/i.test(text)
 && /production|deploy|rollback|schema|生产环境|回滚|部署|新旧版本/i.test(text);

// Advisory coverage groups describe distinct requested outcomes. They are not
// permissions, fixed workflows, or a reason to fill the candidate budget.
export function manualNeedKeys(skill, capability, text) {
 const identity=[skill.id,skill.name,skill.nameZh].filter(Boolean).join(' ');
 const summary=[skill.summaryZh,skill.description].filter(Boolean).join(' ');
 const keys=[];
 if(sourceCodeReview(text)&&supportsSourceCodeReview(skill,text))keys.push('source-code-review');
 if(cadArtifact(text)&&/(?:^|[\s:/_-])cad(?:$|[\s:/_-])|freecad|parametric.*(?:model|design)|参数化.{0,15}(?:建模|设计)/i.test(identity+' '+primaryPurpose(skill)))keys.push('cad-model');
 if(mathematicalModeling(text)&&capability==='mathematical-modeling')keys.push('mathematical-modeling');
 if(numericalComputation(text)&&supportsNumericalComputation(skill))keys.push('numerical-computation');
 if(gameImplementation(text)&&supportsWebImplementation(skill)&&['game-implementation','frontend-implementation','visual-design','engineering'].includes(capability))keys.push('game-implementation');
 if(optionComparison(text)&&supportsOptionComparison(skill)&&['research','requirements','option-comparison'].includes(capability))keys.push('option-comparison');
 if(webImplementation(text)&&['visual-design','frontend-implementation'].includes(capability)&&supportsWebImplementation(skill))keys.push('web-implementation');
 if(designToCode(text)&&capability==='design-to-code')keys.push('design-to-code');
 if(backendImplementation(text)&&capability==='backend-implementation')keys.push('backend-implementation');
 if(capability==='document'&&(wordDocumentArtifact(text)?supportsWordAuthoring(skill):wordDocumentInspection(text)&&/\bdocx\b|\bword\b/i.test(identity+' '+summary)))keys.push('word-document');
 if(desktopObservation(text)&&capability==='desktop-operation')keys.push('desktop-observation');
 if(evidenceResearch(text)&&capability==='research')keys.push('evidence-research');
 if(businessAnalysis(text)&&capability==='research'&&/consulting|market|consumer|brand|business|financial|industry|商业|市场/i.test(identity+' '+summary))keys.push('business-analysis');
 if(publicInformationSearch(text)&&capability==='public-information-search')keys.push('public-information-search');
 if(skillAuthoring(text)&&capability==='skill-authoring')keys.push('skill-authoring');
 if(accessibilityNeed(text)&&capability==='accessibility')keys.push('accessibility');
 if(mcpImplementation(text)&&capability==='mcp-authoring')keys.push('mcp-protocol');
 if((electricalDesign(text)||electricalInspection(text))&&capability==='electrical-design')keys.push('electrical-design');
 if(databaseMigration(text)&&capability==='database-migration')keys.push('database-migration');
 if(experimentDesign(text)&&capability==='experiment-design')keys.push('experiment-design');
 if(structuredDataOperation(text)&&capability==='data-analysis')keys.push('structured-data');
 if(spatialDataOperation(text)&&capability==='geospatial-analysis')keys.push('spatial-data');
 if(videoPostproduction(text)&&['video-editing','video-production'].includes(capability)&&supportsVideoPostproduction(skill))keys.push('video-postproduction');
 if(latexArtifact(text)&&capability==='latex'){
   if(latexSourceRepair(text)&&supportsLatexSourceRepair(skill))keys.push('latex-source-repair');
   const compilation=/编译|构建|未(?:解析|定义)|报错|错误|包冲突|compile|compil|build|undefined|error|fontspec/i.test(text);
   const prose=/润色|措辞|语法|文笔|校对|polish|proofread|grammar|prose|wording/i.test(text);
   const layout=/排版|版面|格式|浮动|溢出|layout|typesett|format|float|overfull/i.test(text);
   if((compilation||latexBuild(text))&&(supportsLatexBuild(skill)||latexFailure(text)&&/compil|编译|diagnos|undefined|诊断|rescue/i.test(identity+' '+summary)))keys.push('latex-compile');
   if(prose&&/polish|proofread|grammar|prose|润色|校对/i.test(identity+' '+summary))keys.push('latex-prose');
   if(layout&&/layout|typesett|format|排版|版面|格式/i.test(identity+' '+summary))keys.push('latex-layout');
   if(!compilation&&!prose&&!layout)keys.push('latex');
 }
 if(imageArtifact(text)&&capability==='image-production')keys.push('raster-image');
 return keys;
}
export const skillAuthoring = text => /(?:创建|制作|编写|写|更新|维护|修复|create|write|develop|update|build).{0,45}(?:(?:agent\s*)?skill|技能)|(?:完整|交付|生成|输出).{0,12}skill\.md/i.test(text);
export const imageArtifact = text => {
  if(/^(?:请\s*)?(?:比较|对比|调研|研究|核查|compare\b|research\b|evaluate\b)/i.test(text)
    && !/(?:然后|并且|并|另|再|and then|then).{0,6}(?:生成|绘制|编辑|修改|create|generate|edit)/i.test(text))return false;
  return requestedRasterWork(text);
};

export const numericalComputation = text => /数值(?:计算|求解|模拟|分析)|微分|(?:定|不定|数值|曲线|二重|三重)积分|积分(?:法|器|到|求解|计算)|递推|收敛|误差阶|\b(?:numerical|euler|heun|runge.kutta|ode|quadrature|convergence)\b/i.test(text)
 && /计算|求解|编写|实现|运行|比较|绘制|误差|\b(?:comput|calculat|solv|implement|run|compar|error|integrat)\w*/i.test(text);
export const optionComparison = text => /比较|对比|选型|选择|推荐|取舍|\b(?:compar|select|recommend|decid)\w*/i.test(text)
 && /方案|供应商|候选|选项|容量|预算|成本|条件|约束|\b(?:options?|vendors?|alternatives?|budget|cost|constraints?)\b/i.test(text);
export const supportsWordAuthoring = skill => {
 const identity=[skill.id,skill.name,skill.nameZh].filter(Boolean).join(' ');
 const summary=[skill.summaryZh,skill.description].filter(Boolean).join(' ').split(/[。；;\n]|[.!?](?=\s|$)/)[0];
 return /docx|word/i.test(identity)&&!/markitdown/i.test(identity)
  || /(?:create|edit|generat|produc|制作|创建|生成|编辑).{0,50}(?:word|docx)|(?:word|docx).{0,50}(?:creat|edit|generat|produc|制作|创建|生成|编辑)/i.test(summary);
};
export const supportsNumericalComputation = skill => {
 const identity=[skill.id,skill.name,skill.nameZh].filter(Boolean).join(' ');
 if(/sympy|symbolic|符号计算|运筹|or[-_ ]model/i.test(identity))return false;
 const purpose=[skill.summaryZh,skill.description].filter(Boolean).join(' ').split(/[。；;\n]|[.!?](?=\s|$)/)[0];
 if(/竞赛|比赛|competition|pipeline|全流程|整套|论文|论文撰写/i.test(identity+' '+purpose))return false;
 return /数值|科学计算|数学建模|\b(?:numerical|scipy|numpy|scientific.comput|math.model)/i.test(identity+' '+purpose);
};
export const supportsOptionComparison = skill => {
 const identity=[skill.id,skill.name,skill.nameZh].filter(Boolean).join(' ');
 const summary=[skill.summaryZh,skill.description].filter(Boolean).join(' ');
 const purpose=summary.split(/[。；;\n]|[.!?](?=\s|$)/)[0];
 if(/prediction.market|预测市场|oracle|用户研究|user research|user interviews/i.test(identity+' '+purpose))return false;
 return /consulting[-_ ]analysis|咨询分析|方案评估|方案比较/i.test(identity)
   || /ambiguous decisions|tradeoffs|decision.oriented summaries|比较.{0,20}方案|方案.{0,20}(?:比较|评估)/i.test(purpose);
};
export const supportsWebImplementation = skill => {
 const identity=[skill.id,skill.name,skill.nameZh].filter(Boolean).join(' ');
 const summary=[skill.summaryZh,skill.description].filter(Boolean).join(' ');
 if(/art direction|visually strong|composition|image.led hierarchy|视觉指导|美术方向|视觉构图/i.test(summary)
   && !/\b(?:code|coding|javascript|functional)\b|代码|功能实现/i.test(summary))return false;
 return /frontend[-_ ](?:dev|patterns?|implementation)|前端开发|游戏开发|game[-_ ]develop/i.test(identity)
  || /(?:implement|develop|build|create|generat|实现|开发|创建|生成)/i.test(summary)
   && /code|functional|interactive|javascript|html.{0,3}css|react|web components|frontend interfaces|代码|功能实现|交互实现/i.test(summary);
};
