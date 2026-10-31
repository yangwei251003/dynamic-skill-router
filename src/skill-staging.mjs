import {webImplementation,evidenceResearch,cadArtifact,latexArtifact,mcpImplementation,backendImplementation,designToCode,desktopObservation,structuredDataOperation,skillAuthoring,publicInformationSearch,imageArtifact,businessAnalysis,electricalDesign,databaseMigration,electricalInspection,spatialDataOperation,videoPostproduction,supportsVideoPostproduction,wordDocumentArtifact,supportsWordAuthoring,numericalComputation,supportsNumericalComputation,optionComparison,supportsOptionComparison,gameImplementation,supportsWebImplementation,latexSourceRepair,supportsLatexSourceRepair} from './task-intents.mjs';
import {semanticTaskText} from './task-structure.mjs';
import {primaryPurpose as manualPurpose} from './purpose-evidence.mjs';
import {latexBuild,latexFailure,supportsLatexBuild,sourceCodeReview,supportsSourceCodeReview} from './task-intents.mjs';

export const PIPELINE_STAGES = [
  'discovery',
  'planning',
  'design',
  'implementation',
  'analysis',
  'verification',
  'optimization',
  'delivery',
  'operations',
];

const STAGE_INDEX = new Map(PIPELINE_STAGES.map((stage, index) => [stage, index]));

function normalizedFields(skill = {}) {
  const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase();
  return {
    id: normalize(skill.id),
    identity: [skill.id, skill.nameZh, skill.category, skill.family, ...(skill.aliases || []), ...(skill.triggers || [])]
      .filter(Boolean).map(normalize).join(' '),
    summary: normalize(skill.summaryZh || skill.description),
  };
}

function visualDirectionOnly(summary) {
  return /visually strong|art[- ]direction|restrained composition|image[- ]led hierarchy|visual hierarchy|美术方向|视觉风格|构图/.test(summary)
    && /websites?|landing pages?|frontend|game ui|\bapps?\b|\binterfaces?\b|网页|界面|前端/.test(summary)
    // Evaluate the stated purpose without inheriting an implementation claim
    // from a broad frontend name, alias or category.
    && !supportsWebImplementation({summaryZh:summary});
}

export function inferCapability(skill = {}) {
  const {id, identity, summary} = normalizedFields(skill);
  const subject=[id,skill.name,skill.nameZh].filter(Boolean).join(' ').toLowerCase();
  if (id === 'skill-stocktake' || /技能(?:库)?(?:盘点|治理|路由审计)/.test(identity)) return 'skill-governance';
  if (/design[-_ ]to[-_ ]code/.test(subject)) return 'design-to-code';
  if (/computer[-_ ](?:operator|use)|desktop[-_ ](?:operator|automation)|电脑操作|桌面操作/.test(identity)) return 'desktop-operation';
  if (/git[-_ ]ship|(?:git|版本控制).{0,15}(?:交付|发布|收尾)/.test(identity)
      || /(?:git 工作流|git workflow).{0,25}(?:发布|ship)/.test(summary)) return 'release-workflow';
  if (/fastapi|django|flask|express|nestjs|spring[-_ ]boot|backend[-_ ](?:pattern|develop|implementation)|api[-_ ]design/.test(subject)
      || /^(?:rest api design|backend development|server.side development)/.test(summary)) return 'backend-implementation';
  if (/skill-creator|create-skill|plugin-creator/.test(identity)) return 'skill-authoring';
  if (/easyeda|kicad|pcb[-_ ](?:design|layout)|electronic[-_ ]design/.test(subject)) return 'electrical-design';
  if (/database[-_ ]migration|schema[-_ ]migration/.test(subject)
      || /^(?:database\s+)?schema\s+migration|^database\s+migration/.test(summary)) return 'database-migration';
  if (/tool-design|工具接口|api-design/.test(identity)) return 'engineering';
  if (/(?:^|[:/ ])mcp[-_ ](?:server|builder)/.test(subject)
      || /^(?:build|implement|debug|design|create).{0,40}\bmcp servers?\b/.test(summary)) return 'mcp-authoring';
  if (/environment[-_ ]setup|runtime[-_ ]installer|dependency[-_ ]installer|(?:^|[-_:])env(?:$|\s)|依赖安装|环境安装|环境诊断/.test(identity)) return 'environment-setup';
  if (/latex|tectonic|texlive/.test(identity)) return 'latex';
  if (/math[-_ ]model|or[-_ ]model|数学建模|运筹建模/.test(identity)) return 'mathematical-modeling';
  if (supportsNumericalComputation(skill)) return 'numerical-computation';
  if (/orchestrat|多智能体|多agent|agent团队|并行编排/.test(identity)) return 'orchestration';
  if (/product-director|需求访谈|需求澄清|产品规划|brainstorm|to-spec|规格说明|方案蓝图/.test(identity)
      || /turn a fuzzy .* into an implementation-ready|^convene .{0,30}council for .{0,30}(?:decisions|tradeoffs)/.test(summary)) return 'requirements';
  if (/video-to-superprompt|asset-reverse-engineer|reverse.engineer|资产反推|反推提示词/.test(identity)) return 'asset-analysis';
  if (/personal-homepage|personal site|portfolio website|个人主页|个人网站|作品集网站/.test(identity)) return 'personal-site';
  if (/experiment(?:al)?[- ]design|design[- ]of[- ]experiments|实验设计|试验设计/.test(identity)
      || /^design experiments and studies|^design (?:a |the )?(?:controlled|reproducible|randomized) experiment/.test(summary)) return 'experiment-design';
  if (visualDirectionOnly(summary)) return 'visual-design';
  if (id === 'impeccable' || /design-taste-frontend|ui-ux-pro|ui-new|frontend-design/.test(identity)) return 'visual-design';
  if (/markitdown/.test(identity)) return 'document';
  if (/geopandas|geospatial[-_ ](?:analysis|data)|地理空间分析/.test(subject)
      || /geospatial vector data|spatial joins|coordinate transformations/.test(summary)) return 'geospatial-analysis';
  if (/(?:^|[:/ ])(?:exploratory-)?data-analysis(?:$|\s)|statistical[-_ ]analysis|数据分析|统计分析|\b(?:polars|pandas)\b/.test(identity)
      || /^high.performance dataframe library|^(?:高性能|高效).{0,15}(?:dataframe|数据框架|数据帧)库/.test(summary)) return 'data-analysis';
  if (/spreadsheet|workbook|(^|[^a-z])excel([^a-z]|$)|(^|[^a-z])xlsx([^a-z]|$)|电子表格|工作簿/.test(identity)) return 'spreadsheet';
  if (/pptx|pptgen|pptskill|aippt|presentation|slides?|演示文稿|幻灯片|oil-ppt/.test(identity)) return 'presentation';
  if (/pdf|docx|word document|word文档|文档处理|markdown/.test(identity)) return 'document';
  if (/ffmpeg|video[-_ ](?:edit|cut|trim|postproduction)|视频剪辑/.test(subject)
      || /^(?:ai-assisted )?video editing|^generate ffmpeg commands|^extract frames or short clips/.test(summary)) return 'video-editing';
  if (/video|视频|remotion|shotcraft|seedance/.test(identity)) return 'video-production';
  if (/^(?:generate|create) (?:spoken )?audio from text|text.to.speech|语音合成/.test(summary)) return 'audio-production';
  if (/image|图片|图像|海报|插画|seedream|imagegen/.test(identity)) return 'image-production';
  if (/prompt|提示词/.test(identity)) return 'prompt-engineering';
  if (/scrap|crawler|crawl|爬虫|网页采集|批量抓取|内容提取/.test(identity)) return 'web-extraction';
  if (/playwright|browser|浏览器自动化|网页操作|表单填写|网页截图/.test(identity)) return 'browser-automation';
  if (/citation|reference verification|引用核验|参考文献/.test(identity)) return 'citation';
  // Classify by the leading purpose, not a provider name or an incidental
  // search step buried in a research/authoring workflow.
  const primaryPurpose=summary.split(/[。!?\n]|\.(?:\s|$)/)[0];
  if(/网络信息搜索|(?:新闻|时效性信息|实时信息|公开资料|公开信息).{0,18}(?:搜索|检索)|(?:搜索|检索).{0,30}(?:最新资讯|实时信息|公开来源)|\b(?:web|internet|online|news)\s+(?:information\s+)?search|(?:search|retrieve).{0,35}(?:current|public|up.to.date).{0,18}(?:information|sources|news)/i.test(primaryPurpose)) return 'public-information-search';
  if (/originality|plagiarism|原创性|抄袭/.test(identity) && /audit|review|审查|审计/.test(identity)
      || /^(?:audit|review|verify|inspect)\b.{0,140}(?:originality|plagiarism)/.test(summary)) return 'verification';
  if (/academic|论文|文献综述|deep.research|研究管线|research|hypothesis|consulting[-_ ]analysis/.test(identity)) return 'research';
  if (/accessibility|无障碍|可访问性|wcag|a11y/.test(identity)
      || /^audit and improve web accessibility/.test(summary)) return 'accessibility';
  if (/(^|[^a-z])seo([^a-z]|$)|搜索引擎|搜索排名|sitemap|结构化数据/.test(identity)
      || /^optimize for search engine/.test(summary)) return 'seo';
  if (/(^|[^a-z])performance([^a-z]|$)|性能优化|网页性能|page speed|core web vitals/.test(identity)
      || /^optimize web performance/.test(summary)) return 'performance';
  if (/deploy|deployment|发布上线|部署|托管/.test(identity) || /^deploy .*(?:project|site|frontend)/.test(summary)) return 'deployment';
  if (skill.role === 'verifier' || /verification-loop|质量验证|交付验证|code-review|代码审查/.test(identity)) return 'verification';
  if (/animation|motion|动效|动画|gsap|scrolltrigger|transition/.test(identity)
      || /^design and implement web animations/.test(summary)) return 'motion';
  if (/公众号|发布文章|排版|copywriting|文案|内容写作|blog-writer/.test(identity)) return 'content-publishing';
  if (id === 'frontend-dev' || /frontend[-_ ](?:implementation|patterns?|skill)|前端开发|完整前端|网页应用/.test(identity)
      || /^full-stack frontend development/.test(summary)) return 'frontend-implementation';
  if (/impeccable|\bui\b|\bux\b|(?:visual|graphic|web|brand|product|interaction)[- ]design|视觉设计|界面精修|网页设计|品牌设计|landing page|落地页/.test(identity)
      || /(?:frontend interfaces|frontend interface|anti-slop frontend|website's visual system|site's visual style)/.test(summary)) return 'visual-design';
  if (/architecture|架构|system design|代码实现|coding|编程|debug|诊断/.test(identity)) return 'engineering';
  return 'general';
}

export function inferSkillStage(skill = {}, capability = inferCapability(skill)) {
  if(capability==='electrical-design')return 'design';
  if(capability==='database-migration')return 'implementation';
  const declared = String(skill.phase || '').toLowerCase();
  if (declared && declared !== 'any') {
    if (/discover/.test(declared)) return 'discovery';
    if (/plan|orchestrat/.test(declared)) return 'planning';
    if (/design/.test(declared)) return 'design';
    if (/implement|execution/.test(declared)) return 'implementation';
    if (/analy/.test(declared)) return 'analysis';
    if (/verif|review|test/.test(declared)) return 'verification';
    if (/optim/.test(declared)) return 'optimization';
    if (/deliver|publish|deploy/.test(declared)) return 'delivery';
    if (/operat/.test(declared)) return 'operations';
  }
  if (['skill-governance', 'research','public-information-search'].includes(capability)) return 'discovery';
  if (['orchestration', 'requirements', 'skill-authoring', 'prompt-engineering', 'experiment-design'].includes(capability)) return 'planning';
  if (['visual-design', 'motion', 'content-publishing', 'video-production', 'video-editing', 'image-production','audio-production'].includes(capability)) return 'design';
  if (['personal-site', 'frontend-implementation', 'backend-implementation', 'design-to-code', 'desktop-operation', 'engineering', 'mcp-authoring', 'environment-setup', 'web-extraction', 'browser-automation'].includes(capability)) return 'implementation';
  if (['data-analysis', 'geospatial-analysis', 'numerical-computation', 'spreadsheet', 'document', 'latex', 'citation', 'asset-analysis'].includes(capability)) return 'analysis';
  if (capability === 'verification') return 'verification';
  if (['seo', 'performance', 'accessibility'].includes(capability)) return 'optimization';
  if (['presentation', 'deployment','release-workflow'].includes(capability)) return 'delivery';
  return 'implementation';
}

export function stageRank(stage) {
  return STAGE_INDEX.get(stage) ?? PIPELINE_STAGES.length;
}

const CAPABILITY_SIGNALS = {
  'mcp-authoring': /\bmcp\b|stdio|streamable/i,
  latex: /\blatex\b|\btex\b|\.tex\b|tectonic|texlive/i,
  'environment-setup': /安装|依赖|环境(?:配置|诊断|检查)|配置.{0,12}(?:环境|运行时|path|镜像)|command not found|not recognized|install|setup|dependencies|environment/i,
  'audio-production': /(?:生成|合成|制作|配|generate|synthesi[sz]|create).{0,30}(?:语音|音频|配音|旁白|audio|speech|voiceover)|text.to.speech|tts|语音合成/i,
  'experiment-design': /实验|试验|对照|随机分组|随机化|混杂|重复测量|experiment|randomi[sz]|confound|factorial|control(?:led)? (?:study|trial)|replicat/i,
  'skill-governance': /技能(?:库)?|skill|路由器|技能路由|no_skill/i,
  'skill-authoring': /(?:创建|制作|编写|更新|维护|修复).{0,8}(?:(?:agent\s*)?skill|技能)|skill\.md|技能文件|技能包/i,
  orchestration: /并行|多\s*agents?|多智能体|分工|agent团队|编排|multi[ -]?agents?/i,
  requirements: /需求|范围|规格|产品规划|方案|蓝图|先梳理|从零|还不清楚|访谈/i,
  accessibility: /无障碍|可访问性|wcag|a11y|读屏|键盘导航/i,
  seo: /seo|搜索引擎|搜索排名|站点地图|sitemap|meta tags?/i,
  performance: /性能|加载慢|提速|page speed|core web vitals|lcp|inp|cls/i,
  deployment: /部署|上线|发布|托管|预览环境|生产环境|deploy|hosting/i,
  verification: /测试|验证|核验|验收|检查|审查|审计|复核|回归|质量门|test|review|audit|inspect|verify/i,
  motion: /动效|动画|转场|滚动叙事|motion|animation|gsap|scrolltrigger/i,
  'web-extraction': /抓取|采集|爬虫|爬取|scrape|crawl|提取网页/i,
  'browser-automation': /浏览器|点击|登录|填表|截图|e2e|端到端|playwright/i,
  spreadsheet: /excel|xlsx|csv|电子表格|工作簿|表格文件/i,
  presentation: /pptx?|幻灯片|演示文稿|汇报材料|slide|presentation/i,
  document: /word|docx|pdf|markdown|文档/i,
  'data-analysis': /数据分析|统计|分析报告|图表|可视化|数据洞察|dataset/i,
  citation: /引用|参考文献|doi|citation/i,
  research: /研究|调研|文献|论文|research|literature/i,
  'content-publishing': /公众号|文章|推文|文案|博客|排版|发布内容/i,
  'personal-site': /个人(?:网站|主页|网页|品牌)|作品集|简历网站|portfolio|personal site/i,
  'frontend-implementation': /react|vue|next\.js|前端代码|完整代码|网页应用|web app|组件实现/i,
  'visual-design': /视觉|界面|\bui\b|\bux\b|高级感|设计系统|改版|美化|品牌官网|落地页/i,
  engineering: /代码|编程|架构|重构|调试|bug|报错|接口|后端|数据库/i,
  'asset-analysis': /反推|逆向|分析.{0,12}(?:视频|图片|网站|动效).{0,12}(?:提示词|复刻)|重建提示词|recreation prompt/i,
  'video-production': /视频|宣传片|短片|video|remotion/i,
  'image-production': /图片|图像|海报|插画|image|poster/i,
  'prompt-engineering': /提示词|prompt/i,
};

export function capabilityDirectlyRequested(capability, query, primaryCapability = '') {
  const text = semanticTaskText(query).toLowerCase();
  if (capability === 'numerical-computation') return numericalComputation(text);
  if (capability === 'requirements' && optionComparison(text)) return true;
  if (capability === 'geospatial-analysis') return spatialDataOperation(text);
  if (capability === 'video-editing') return videoPostproduction(text);
  const signal = CAPABILITY_SIGNALS[capability];
  if (!signal?.test(text)) return false;
  if (capability === 'visual-design') {
    return /视觉|\bui\b|\bux\b|高级感|设计系统|改版|美化|精修|视觉设计|界面设计/i.test(text);
  }
  if (primaryCapability === 'personal-site' && capability === 'frontend-implementation') {
    return /react|vue|next\.js|前端代码|完整代码|网页应用|组件实现/i.test(text);
  }
  if (primaryCapability === 'personal-site' && capability === 'visual-design') {
    return /视觉|界面|ui|ux|高级感|设计系统|改版|美化/i.test(text);
  }
  return true;
}

export function capabilityActionCompatible(capability, query) {
  const text = semanticTaskText(query).toLowerCase();
  if (capability === 'numerical-computation') return numericalComputation(text);
  if (capability === 'requirements' && optionComparison(text)) return true;
  if (capability === 'geospatial-analysis') return spatialDataOperation(text);
  if (capability === 'video-editing') return videoPostproduction(text);
  if (capability === 'public-information-search') return publicInformationSearch(text);
  if (capability === 'backend-implementation') return backendImplementation(text);
  if (capability === 'design-to-code') return designToCode(text);
  if (capability === 'desktop-operation') return desktopObservation(text) || /操控电脑|操作桌面|computer use|desktop automation/i.test(text);
  if (capability === 'release-workflow') return /\b(?:git[ -])?ship\b|(?:发布|推送|合并).{0,25}(?:改动|变更|代码|分支)|(?:改动|变更|代码|分支).{0,25}(?:发布|推送|合并)|(?:创建|提交|提成).{0,15}\bpr\b.{0,20}(?:并|and).{0,10}(?:合并|merge)/i.test(text);
  if (capability === 'frontend-implementation') return webImplementation(text) || gameImplementation(text) || /前端|react|vue|next\.js|网页|网站|页面|\bweb\b|\bhtml\b|组件/i.test(text)
    && /开发|实现|搭建|创建|制作|修改|修复|重构|前端|react|vue|next\.js|网页应用|代码|build|create|implement/i.test(text)
    && !(/抓取|采集|爬虫/.test(text) && !/开发|实现|前端|代码/.test(text));
  if (capability === 'visual-design') return webImplementation(text) || gameImplementation(text)&&/浏览器|browser|canvas|\bhtml\b/i.test(text) || /视觉|界面|网页|网站|\bui\b|\bux\b|设计系统|品牌|落地页|配色|字体|组件规范|移动端|信息架构|可用性/i.test(text)
    && /设计|改版|优化|美化|精修|开发|创建|制作|实现|做|配色|字体|改得|build|create|design|polish|improve/i.test(text);
  if (capability === 'personal-site') return CAPABILITY_SIGNALS['personal-site'].test(text)
    || /个人博客|(?:自己|简历|经历|作品|resume|projects).{0,30}(?:网站|网页|website)|(?:网站|网页|website).{0,30}(?:自己|简历|经历|作品|resume|projects)/i.test(text);
  if (capability === 'general') return false;
  return CAPABILITY_SIGNALS[capability]?.test(text) ?? true;
}

export function skillDomainCompatible(skill, query) {
  const {id, identity, summary} = normalizedFields(skill);
  const text = semanticTaskText(query).toLowerCase();
  if (id === 'council-multi-model' && !/评议会|council|外部.{0,8}(?:评审|批评)|external critique/i.test(text)) return false;
  if (/(?:^|[\s-])(?:cad|gcode|dfam)(?:[\s-]|$)|freecad|autocad|三维审查/.test(identity)
      && !cadArtifact(text)) return false;
  const capability = inferCapability(skill);
  // The leading purpose of a specialist manual constrains incidental matches
  // from its long description (format, tests, output, and environment words).
  const purpose=identity+' '+summary.slice(0,180);
  // A specialist's input/output contract takes precedence over incidental
  // format or protocol words. Explicit manual requests bypass this gate upstream.
  const primaryPurpose=summary.split(/[。!\n]|\.(?=\s|$)/)[0];
  const geographicService=/地图|地理编码|maps? (?:api|service|integration|generation|visualization)|location service|geocod/i.test(manualPurpose(skill));
  const geographicRequest=/地图|地理|经纬度|地点|门店|导航|路线|出行|街道|\b(?:geographic|geospatial|geocod|latitude|longitude|navigation|directions|places|locations|mapbox|google maps|maps api|jsapi)\b/i.test(text)
    || /\bmap\b.{0,25}\b(?:cities|city|route|street|country|region|markers|tiles)\b/i.test(text);
  if(geographicService&&!geographicRequest)return false;
  // A language-specific or provider-specific review manual cannot satisfy an
  // unrelated source-review need merely because it contains 'review'.
  if(sourceCodeReview(text)&&/code.review|代码审查/i.test(identity)&&!supportsSourceCodeReview(skill,text))return false;
  const extractionOnly=/^(?:convert|extract|read|parse).{0,100}(?:documents?|files?|media).{0,100}(?:markdown|text|analysis)|^(?:读取|提取|解析|转换).{0,50}(?:文档|文件).{0,50}(?:markdown|文本|分析)/.test(primaryPurpose)
    && !supportsWordAuthoring(skill);
  const extractingDocument=/(?:转换|转为|转成|提取|convert|extract).{0,60}(?:markdown|纯文本|plain text)|(?:markdown|纯文本|plain text).{0,25}(?:提取|转换)/.test(text)
    && !/(?:创建|生成|制作|编辑|填写|create|generate|edit|fill).{0,35}(?:word|docx)|(?:word|docx).{0,35}(?:编辑|填写|edit|fill)/.test(text);
  if(wordDocumentArtifact(text)&&extractionOnly&&!extractingDocument)return false;
  const socialPurpose=/^(?:x\/twitter|twitter|x platform).{0,35}api|(?:x\/twitter|twitter).{0,35}(?:api integration|posting tweets)|^(?:realistic )?(?:x|twitter) (?:post|tweet) card/.test(primaryPurpose);
  if(socialPurpose&&!/\btwitter\b|\btweets?\b|推特|推文|x\s*(?:\/|平台|api)|\bx\b.{0,12}(?:platform|api|timeline)|(?:post|publish).{0,25}\bx\b|(?:发布|发推|发帖).{0,20}x\b/.test(text))return false;
  if(/cloudbase|腾讯云开发/.test(purpose)&&!/cloudbase|腾讯云开发|微信云开发|云开发平台/.test(text))return false;
  const canvasPurpose=/json canvas|\.canvas.{0,30}(?:nodes|edges)|obsidian.{0,30}canvas/.test(primaryPurpose);
  if(canvasPurpose&&!/json\s*canvas|\.canvas\b|obsidian.{0,25}(?:canvas|画布)|(?:思维导图|节点连线|节点和边|visual canvas|mind map|nodes and edges)/.test(text))return false;
  const userResearchRoom=/user research.{0,100}(?:interviews|support tickets|surveys)/.test(primaryPurpose)&&/decision room/.test(summary);
  if(userResearchRoom&&!/用户研究|用户访谈|访谈记录|访谈笔记|问卷|客服工单|user research|interview (?:notes|transcripts)|support tickets|surveys/.test(text))return false;
  if(/prediction markets?|预测市场/.test(primaryPurpose)&&!/prediction markets?|预测市场|市场隐含概率|market.implied probabilit/.test(text))return false;
  if(/^cache .{0,80}(?:file processing|results).{0,80}hash|(?:内容哈希|内容散列).{0,30}缓存/.test(primaryPurpose)
      && !/缓存|\bcach(?:e|ing|ed)\b|auto.invalidat|重复.{0,20}(?:处理|计算).{0,20}(?:慢|昂贵)|repeated.{0,25}processing.{0,20}slow/.test(text))return false;
  if(/(?:markdown|markdown 文档).{0,30}(?:渲染成|to|into).{0,15}pdf/.test(primaryPurpose)
      && !/markdown|\.md\b/.test(text))return false;
  if(capability==='numerical-computation'&&!numericalComputation(text))return false;
  if(capability==='spreadsheet'&&numericalComputation(text)&&!/\b(?:excel|xlsx|workbook|spreadsheet)\b|电子表格|工作簿|单元格/.test(text))return false;
  if(capability==='geospatial-analysis'&&!spatialDataOperation(text))return false;
  if(capability==='video-editing'&&!videoPostproduction(text))return false;
  const generatingVideo=/(?:生成|制作|创建).{0,20}(?:全新|新|ai|人工智能|文生)?视频|(?:generate|create|produce).{0,25}(?:new |ai |text.to.)?video|文生视频|text.to.video/.test(text);
  if(capability==='video-production'&&videoPostproduction(text)&&!generatingVideo&&!supportsVideoPostproduction(skill)
      && /文生视频|text.to.video|视频生成器|video generat|generate.{0,25}videos? from/.test(summary))return false;
  const editingPresentation=/\bpptx?\b|powerpoint|幻灯片|演示文稿|presentation|slides?/.test(text)
    && /本地|现有|已有|附件|第.{0,5}页|existing|attached|uploaded/.test(text)
    && /编辑|修改|添加|保留|调整|替换|另存|edit|modify|add|preserve|retain|replace|update/.test(text);
  if(editingPresentation&&/(?:仅|只)用于生成全新|(?:only|exclusively).{0,30}(?:new presentations?|new slides?|from scratch)|不用于.{0,25}(?:编辑已有|编辑现有)|not (?:for|used for).{0,25}edit(?:ing)? existing/.test(summary))return false;
  const cloudDocumentPurpose=/在线云文档平台|云端文档平台|online (?:cloud )?document platform|cloud document platform/.test(summary.slice(0,180));
  if(cloudDocumentPurpose&&/本地|local|离线|offline/.test(text)
      && !/腾讯文档|云文档|docs\.qq\.com|google docs|云端协作|cloud collaboration|(?:上传|导入|import|upload)[^。；;\n]{0,60}(?:云端|云文档|cloud)/.test(text))return false;
  if(/ethereum|keccak|cryptograph|哈希算法|密码学/.test(purpose)
    && !/ethereum|keccak|cryptograph|\bhash(?:ing)?\b|\bsha[ -]?\d|checksum|哈希|散列|密码学|校验和|区块链|以太坊/i.test(text))return false;
  if(/ai[-_ ]model/.test(identity)
    && !/\b(?:ai|llm|embedding|inference)\b|大模型|模型(?:调用|接口|推理)|人工智能|生成式|对话模型/i.test(text))return false;
  if(capability==='electrical-design'&&!electricalDesign(text)&&!electricalInspection(text))return false;
  if(capability==='electrical-design'){
    const requestedEasyEDA=/嘉立创|立创EDA|\beasyeda\b/i.test(text);
    const requestedKiCad=/\bkicad\b/i.test(text);
    if(requestedEasyEDA&&!requestedKiCad&&/\bkicad\b/i.test(purpose)&&!/\beasyeda\b/i.test(purpose))return false;
    if(requestedKiCad&&!requestedEasyEDA&&/\beasyeda\b/i.test(purpose)&&!/\bkicad\b/i.test(purpose))return false;
  }
  if(capability==='database-migration'&&!databaseMigration(text))return false;
  const statisticsSpecialist=/statistic|统计/.test([skill.id,skill.name,skill.nameZh].filter(Boolean).join(' '))
    || /^(?:statistical analysis|统计分析|假设检验)/.test(primaryPurpose);
  if(statisticsSpecialist&&!/(?:统计|假设检验|显著|置信|样本量|功效|方差|回归分析|\bp\s*值|statistic|hypothesis|significan|confidence|power analysis|anova|p[- ]?values?)/i.test(text))return false;
  if(/aminer|academic[-_ ](?:search|retrieval)|学术检索|论文搜索/.test(purpose)
      && !/论文|文献|期刊|作者|学者|引用|学术.{0,8}(?:检索|搜索)|\b(?:papers?|literature|journal|authors?|scholars?|citations?)\b/i.test(text))return false;
  if(/proposal[-_ ]writer|proposal.first|项目申请书/.test(purpose)
      && !/申请书|研究计划|开题报告|科研项目.{0,10}(?:申报|计划|申请)|\bproposal\b|research plan/i.test(text))return false;
  if(/originality|plagiarism|原创性|抄袭/.test(purpose)
      && !/原创|抄袭|换皮|剽窃|模仿|参考|originality|plagiar|copying|copied|imitat|reference/i.test(text))return false;
  if(/简历生成|resume(?:craft|[-_ ](?:writer|builder|generat))/.test(purpose)
      && !/简历|求职|职位|招聘|resume|curriculum vitae|\bcv\b/i.test(text))return false;
  if(/论文写作|academic paper writing/.test(purpose)
      && !/(?:写|起草|草拟|撰写|润色|修订|改写|翻译|评审).{0,20}(?:论文|正文|摘要)|(?:论文|正文|摘要).{0,20}(?:写作|起草|初稿|润色|修订|改写|翻译)|审稿|peer review|draft|write|writing|revise|polish|proofread|rebuttal/i.test(text))return false;
  if(/论文精读|paper.{0,20}(?:reader|translation)|full-paper/.test(purpose)
      && !/精读|翻译|解读|阅读论文|读论文|translate|translation|read.{0,20}paper/i.test(text))return false;
  if(/引用补充|add.{0,20}citations?/.test(purpose)
      && !/补.{0,10}(?:引用|文献)|(?:查找|寻找|找(?!到)).{0,10}(?:引用|文献)|(?:引用|文献).{0,10}(?:补充|支撑)|add.{0,15}citation|find.{0,15}(?:source|reference)/i.test(text))return false;
  if(/引用核验|reference verification|文献逐条/.test(purpose)
      && !/doi|作者|年份|真实性|真假|多源|查证|查假|verify.{0,20}references?|reference.{0,20}verif/i.test(text))return false;
  if(/实验日志|experiment[-_ ]log/.test(purpose)&&skillAuthoring(text))return false;
  if(/literature search|文献知识库|学术检索/.test(purpose)
      && !/检索|搜索|文献综述|查文献|查论文|找文献|找论文|引用数|他引|search|literature review|find papers|find references/i.test(text))return false;
  if(/polish.{0,50}academic prose|论文润色|语言润色/.test(purpose)
      && !/润色|措辞|语法|改写|翻译|排版|浮动|版面|polish|proofread|prose|grammar|translat|layout|typesett|overfull|float/i.test(text))return false;
  if(/(?:^|[-_:])email|邮件|邮箱/.test(identity)
      && !/邮件|邮箱|收件|发件|email|e-mail|gmail|outlook|imap|smtp/i.test(text))return false;
  if(capability==='mathematical-modeling' && !(numericalComputation(text)&&supportsNumericalComputation(skill)) && !/数学建模|整数规划|线性规划|约束(?:求解|验算)|求解|优化模型|目标函数|最小化|最大化|排班|运筹|mathematical model|optimization|programming model|solver|objective function|minimi[sz]|maximi[sz]/i.test(text))return false;
  const businessManual=/consulting|market|consumer|brand|business|financial|industry|商业|市场/i.test(purpose);
  if(capability==='research'&&!(businessManual&&businessAnalysis(text))&&!(optionComparison(text)&&supportsOptionComparison(skill))&&!evidenceResearch(text)&&!/调研|研究(?:问题|方案|计划|设计|方法)|文献综述|论文(?:审查|评审|审阅|初稿)|(?:审查|评审|审阅|起草|草拟|写).{0,15}论文|审稿|research|literature review|paper review|peer review|draft.{0,20}(?:paper|manuscript)/i.test(text))return false;
  if(/downloader|文献下载|论文下载/.test(identity)&&!/下载|获取.{0,12}(?:论文|全文)|download|fetch.{0,12}paper/i.test(text))return false;
  if(capability==='document' && desktopObservation(text) && !/读取.{0,20}文件|生成|编辑|转换|提取|导出|交付|create|edit|convert|extract|export/i.test(text))return false;
  if(capability==='presentation' && /google\s+slides/i.test(text)
      && /^(?:create|build).{0,30}(?:edit|pptx)/i.test(summary) && !/pptx|生成|制作|创建|(?:请|要|并|再)编辑|create|build|\bedit\b/i.test(text))return false;
  if(capability==='backend-implementation'){
    const technologies=/\b(?:fastapi|django|flask|express|nestjs|spring|node\.js|next\.js)\b/gi;
    const requested=[...text.matchAll(technologies)].map(match=>match[0]);
    const supported=[...summary.matchAll(technologies)].map(match=>match[0]);
    if(requested.length&&supported.length&&!requested.some(item=>supported.includes(item)))return false;
  }
  if (['backend-implementation','design-to-code','desktop-operation','release-workflow','public-information-search'].includes(capability)
      && !capabilityActionCompatible(capability,text)) return false;
  if (capability === 'data-analysis') {
    const performanceLibrary=/^high.performance dataframe library|^(?:高性能|高效).{0,15}(?:dataframe|数据框架|数据帧)库/.test(primaryPurpose);
    if(performanceLibrary&&!/\b(?:python|dataframe|polars|pandas|arrow|etl)\b|大规模|海量|百万|千万|高性能|流式|惰性|内存不足|out.of.core|streaming|lazy quer|large.scale/.test(text))return false;
    const exploratoryPurpose=/exploratory data analysis|探索性数据分析/.test(summary.slice(0,180));
    if(exploratoryPurpose&&!/探索性|数据探索|科学数据|科研|试验|实验|生物|测序|光谱|显微|exploratory|scientific|research data|experiment|bioinformatics|sequencing|spectroscop|microscopy|understand.{0,30}(?:structure|quality|characteristic)/i.test(text))return false;
    if(/\b(?:word|docx)\b/i.test(text)&&/段落|标题|附件编号|paragraph|heading|attachment number/i.test(text)
      && !/数据集|清洗|汇总|去重|缺失值|单位换算|\b(?:csv|xlsx|excel|dataset|clean|aggregat|deduplicat)\b/i.test(text))return false;
    const statistics=/statistical|统计/.test(identity);
    if(statistics && !/统计|假设检验|显著|置信|样本量|功效|方差|回归分析|statistic|hypothesis|significan|confidence|power analysis|anova/i.test(text))return false;
    if(!statistics && !structuredDataOperation(text) && !/数据分析|数据探索|统计|数据洞察|data analys|data explor|dataset/i.test(text))return false;
  }
  if (capability === 'motion' && /视频模板|制作.{0,10}视频|video templates?|(?:create|produce|make).{0,20}videos?/i.test(skill.summaryZh||skill.description||'')
      && !/视频|宣传片|短片|\.motion\b|video|film|clip|template/i.test(text)) return false;
  if (capability === 'mcp-authoring' && !mcpImplementation(text)) return false;
  if (capability === 'latex' && !latexArtifact(text)) return false;
  if(capability==='latex'&&latexBuild(text)&&!latexFailure(text)&&!supportsLatexBuild(skill)
      && /diagnos|repair|rescue|detect|smoke test|修复|诊断|检测/i.test(manualPurpose(skill)))return false;
  // Source repair and prose editing have separate output contracts.
  if (capability === 'latex' && latexSourceRepair(text) && !supportsLatexSourceRepair(skill)
      && /^(?:polish|proofread|润色|校对)/i.test(primaryPurpose)
      && !/润色|校对|措辞|文笔|语法|polish|proofread|prose|grammar/i.test(text)) return false;
  if (capability === 'environment-setup' && !CAPABILITY_SIGNALS['environment-setup'].test(text)) return false;
  if (capability === 'presentation' && !CAPABILITY_SIGNALS.presentation.test(text)) return false;
  if (capability === 'experiment-design' && (!CAPABILITY_SIGNALS['experiment-design'].test(text)
      || skillAuthoring(text)&&!/随机|区组|实验设计|实验方案|randomi[sz]|experiment design/i.test(text))) return false;
  if (capability === 'audio-production' && !CAPABILITY_SIGNALS['audio-production'].test(text)) return false;
  if (capability === 'prompt-engineering' && !/提示词|提示语|\bprompt\b|(?:不知道|不会|说不清|表达不清).{0,30}(?:ai|模型|描述|表达)|(?:想法|需求).{0,12}(?:模糊|混乱)/i.test(text)) return false;
  if (['frontend-implementation', 'visual-design', 'personal-site'].includes(capability)
      && !capabilityActionCompatible(capability, text)) return false;
  if (capability === 'image-production') {
    // Looking at an attachment is not a request to edit or generate it.
    const requested = imageArtifact(text) || /(?:生成|制作|画|绘制|设计|编辑|修改|美化|修复|处理|替换|调整|抠图|去背景|加字|p图).{0,12}(?:图片|图像|照片|海报|插画|背景|头像)|(?:图片|图像|照片|海报|插画|背景|头像).{0,12}(?:生成|制作|编辑|修改|美化|修复|替换|调整|抠图|去背景|加字)|(?:generate|create|draw|edit|retouch|remove background).{0,24}(?:image|photo|picture|poster|illustration)/i.test(text);
    if (!requested) return false;
  }
  if (id === 'nature-image2ppt' && !/图片|图像|截图|扫描|image|screenshot|scanned/i.test(text)) return false;
  if (id !== 'nature-image2ppt' && (/nature.*ppt|paper2ppt|academic.*(?:ppt|slide)|论文.*(?:ppt|幻灯片)/.test(`${id} ${identity}`))
      && !/论文|文献|研究|学术|nature|paper|research|literature/i.test(text)) return false;
  return true;
}

function webProject(query) {
  if (/抓取|采集|爬虫|爬取|scrape|crawl/i.test(query)
      && !/(?:开发|创建|实现|搭建|设计|改版).{0,20}(?:网站|网页|页面|官网|前端|react|vue|web app)/i.test(query)) return false;
  return /(?:开发|创建|制作|实现|搭建|设计|改版|做|build|create|develop|design).{0,28}(?:网站|网页|页面|官网|前端|react|vue|next\.js|web app|landing page|portfolio)/i.test(query)
    || /(?:网站|网页|页面|官网|前端|react|vue|next\.js|web app|landing page|portfolio).{0,28}(?:开发|创建|制作|实现|搭建|设计|改版|做|build|create|develop|design)/i.test(query);
}

function engineeringProject(query) {
  return /代码|项目|应用|系统|前端|后端|接口|数据库|react|vue|python|node|开发|实现|修复|重构/i.test(query);
}

export function futureOpportunity(candidate, query) {
  const skill = candidate.skill || candidate;
  const capability = inferCapability(skill);
  const text = String(query || '').normalize('NFKC').toLowerCase();
  const web = webProject(text);
  const engineering = engineeringProject(text);
  const dataFlow = /excel|xlsx|csv|统计|抓取|采集|报表|分析报告|数据分析|数据集|dataset/i.test(text)
    || (/数据(?!库|连接|事务)/i.test(text) && !/数据库(?:连接|事务|报错|异常|问题)/i.test(text));
  const researchFlow = /研究|调研|文献|论文|academic|research/i.test(text);
  const opportunities = [];
  if (web) {
    if (capability === 'requirements') opportunities.push([6.5, '需求或验收标准未完全确定时可在开发前补齐蓝图']);
    if (capability === 'visual-design') opportunities.push([5.5, '进入视觉与交互定稿阶段时可提升设计质量']);
    if (capability === 'motion') opportunities.push([4.5, '页面结构稳定后可按需要补充动效']);
    if (capability === 'browser-automation') opportunities.push([5.5, '出现可运行页面后可执行真实浏览器验收']);
    if (capability === 'verification') opportunities.push([7.5, '实现完成后可作为独立交付验证门']);
    if (capability === 'seo') opportunities.push([6, '页面结构和内容稳定后可进行搜索优化']);
    if (capability === 'performance') opportunities.push([6, '核心功能完成后可进行性能审计与提速']);
    if (capability === 'accessibility') opportunities.push([6, '交互完成后、发布前可进行无障碍审计']);
    if (capability === 'deployment') opportunities.push([5, '用户确定平台并授权上线后可负责发布']);
  }
  if (engineering) {
    if (capability === 'verification') opportunities.push([5, '代码形成可验证增量后可执行独立验证']);
    if (capability === 'orchestration' && /复杂|多个模块|全流程|并行|大型|系统性/i.test(text)) opportunities.push([5, '任务出现独立工作线时可启用分阶段协作']);
  }
  if (dataFlow) {
    if (capability === 'spreadsheet') opportunities.push([5.5, '结构化数据稳定后可整理为表格交付物']);
    if (capability === 'data-analysis') opportunities.push([6, '采集或清洗完成后可进入统计分析与洞察阶段']);
    if (capability === 'presentation') opportunities.push([4.5, '结论稳定且需要汇报时可生成演示文稿']);
    if (capability === 'browser-automation' && /登录|动态|点击|滚动|分页|渲染/i.test(text)) opportunities.push([6.5, '采集依赖登录或动态交互时可接管真实浏览器步骤']);
    if (capability === 'verification') opportunities.push([4.5, '数据与产物生成后可核验完整性和一致性']);
  }
  if (researchFlow) {
    if (capability === 'citation') opportunities.push([6, '形成研究结论后可核验引用与 DOI']);
    if (capability === 'verification') opportunities.push([5, '研究结论形成后可进行独立复核']);
    if (capability === 'presentation') opportunities.push([4, '需要对外汇报研究结果时可介入']);
  }
  if (/pptx?|幻灯片|演示文稿|slide deck|presentation/i.test(text) && capability === 'presentation') {
    opportunities.push([6, '明确新建、编辑或汇报形式后可选择对应演示文稿技能']);
  }
  if (/技能路由|路由器|no_skill|技能识别|技能匹配/i.test(text) && capability === 'skill-governance') {
    opportunities.push([8, '技能路由或技能库治理任务的专用审计能力']);
  }
  if (!opportunities.length) return {score: 0, reason: ''};
  opportunities.sort((a, b) => b[0] - a[0]);
  return {score: opportunities[0][0], reason: opportunities[0][1]};
}

const RESPONSIBILITIES = {
  'mcp-authoring': '实现与验证所需的 MCP 工具、协议和传输',
  'electrical-design': '核对真实器件并建立与验证电路、原理图及 PCB 文件',
  'database-migration': '设计并验证数据库结构迁移、兼容与回滚',
  latex: '处理 TeX 源码、诊断编译问题并核验数学排版',
  'environment-setup': '解决任务中已出现的运行环境与依赖缺口',
  'audio-production': '生成或编辑用户明确要求的语音和音频产物',
  'experiment-design': '设计可复现的实验、控制因素与比较方案',
  'skill-governance': '审计技能覆盖、冲突、优先级与路由质量',
  'skill-authoring': '创建或维护技能文件、工作流与触发说明',
  orchestration: '拆分工作线、安排依赖并守住集成门',
  requirements: '澄清范围、约束、验收标准与实现蓝图',
  'visual-design': '确定视觉方向、交互规则与设计质量基线',
  motion: '在稳定界面上设计和实现必要动效',
  'personal-site': '统筹个人网站的信息结构、内容呈现与整体实现',
  'frontend-implementation': '将已确认方案实现为可运行前端',
  'web-extraction': '采集网页内容并输出结构化原始数据',
  'browser-automation': '执行真实浏览器操作、流程验证或动态页面采集',
  spreadsheet: '整理、计算并交付结构化表格',
  'data-analysis': '分析结构化数据并形成可解释结论',
  'numerical-computation': '实现数值方法并核验误差、收敛和计算结果',
  'geospatial-analysis': '处理坐标参考系、空间关系与几何运算',
  document: '读取、转换、生成或编辑文档产物',
  presentation: '把稳定结论组织为可汇报演示文稿',
  research: '收集与综合研究证据',
  citation: '核验引用、来源和 DOI',
  seo: '优化搜索可见性、元数据与站点结构',
  performance: '审计并改善加载速度和运行性能',
  accessibility: '按无障碍标准审计并修正交互',
  verification: '独立核验实现、测试证据和交付完整性',
  deployment: '在获得授权后完成预览或生产发布',
  'content-publishing': '组织内容、排版并准备发布',
  engineering: '处理代码、架构、调试与工程实现',
  'video-production': '制作或编辑视频产物',
  'video-editing': '剪辑、转码与检查已有视频素材',
  'image-production': '生成或编辑图像产物',
  'prompt-engineering': '设计、评审或优化提示词',
  'asset-analysis': '分析参考资产并形成可复刻或可改进的规格与提示词',
  general: '在其专长范围内提供阶段性支持',
};

const ACTIVATION_CONDITIONS = {
  discovery: '任务边界或所需证据需要进一步确认时',
  planning: '范围、依赖或验收标准尚未稳定时',
  design: '进入方案、视觉或内容结构定稿前',
  implementation: '输入与方案确认，开始产出或编码时',
  analysis: '原始材料或数据准备完成后',
  verification: '出现可检查的中间产物或最终产物后',
  optimization: '核心功能和内容稳定、进入专项优化时',
  delivery: '产物通过验证并准备交付、汇报或上线时',
  operations: '交付后进入持续运行或维护时',
};

export function makePortfolioItem(candidate, role, tier, query, opportunity = {score: 0, reason: ''}) {
  const capability = inferCapability(candidate.skill);
  const phase = inferSkillStage(candidate.skill, capability);
  const relevanceScore = Math.round((candidate.relevanceScore ?? candidate.score ?? 0) * 10) / 10;
  const portfolioScore = Math.round((relevanceScore + (opportunity.score || 0)) * 10) / 10;
  const evidence = candidate.reasons?.filter((reason) => !reason.startsWith('存在排除')) || [];
  const reason = [...evidence.slice(0, 2), opportunity.reason].filter(Boolean).join('；') || '与任务的后续阶段存在可验证关联';
  return {
    role,
    tier,
    id: candidate.skill.id,
    nameZh: candidate.skill.nameZh,
    summaryZh: candidate.skill.summaryZh,
    path: candidate.skill.path,
    family: candidate.skill.family,
    status: candidate.skill.status,
    executionRole: candidate.skill.role || candidate.skill.compositionRole || (role === 'primary' ? 'workflow_owner' : 'specialist'),
    phase,
    capability,
    responsibility: RESPONSIBILITIES[capability] || RESPONSIBILITIES.general,
    activationCondition: tier === 'potential'
      ? `确实需要“${RESPONSIBILITIES[capability] || capability}”，且${ACTIVATION_CONDITIONS[phase]}`
      : `在${phase}阶段按职责介入`,
    mutationScope: candidate.skill.mutationScope || 'unspecified',
    estimatedTokens: candidate.skill.estimatedTokens || 0,
    score: Math.round((candidate.score ?? 0) * 10) / 10,
    relevanceScore,
    portfolioScore,
    confidence: portfolioScore >= 16 ? 'high' : portfolioScore >= 10 ? 'medium' : 'watch',
    matchMode: candidate.matchMode || (opportunity.score ? 'anticipated' : 'semantic'),
    reason,
    directlyRequested: capabilityDirectlyRequested(capability, query),
  };
}
