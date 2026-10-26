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
    summary: normalize(skill.summaryZh),
  };
}

export function inferCapability(skill = {}) {
  const {id, identity, summary} = normalizedFields(skill);
  if (id === 'skill-stocktake' || /技能(?:库)?(?:盘点|治理|路由审计)/.test(identity)) return 'skill-governance';
  if (/skill-creator|create-skill|plugin-creator/.test(identity)) return 'skill-authoring';
  if (/orchestrat|多智能体|多agent|agent团队|并行编排/.test(identity)) return 'orchestration';
  if (/product-director|需求访谈|需求澄清|产品规划|brainstorm|to-spec|规格说明|方案蓝图/.test(identity)
      || /turn a fuzzy .* into an implementation-ready/.test(summary)) return 'requirements';
  if (/video-to-superprompt|asset-reverse-engineer|reverse.engineer|资产反推|反推提示词/.test(identity)) return 'asset-analysis';
  if (/personal-homepage|personal site|portfolio website|个人主页|个人网站|作品集网站/.test(identity)) return 'personal-site';
  if (/tool-design|工具接口|api-design/.test(identity)) return 'engineering';
  if (id === 'impeccable' || /design-taste-frontend|ui-ux-pro|ui-new|frontend-design/.test(identity)) return 'visual-design';
  if (/markitdown/.test(identity)) return 'document';
  if (id === 'data-analysis' || /exploratory-data-analysis|数据分析|统计分析|polars|pandas/.test(identity)) return 'data-analysis';
  if (/spreadsheet|workbook|(^|[^a-z])excel([^a-z]|$)|(^|[^a-z])xlsx([^a-z]|$)|电子表格|工作簿/.test(identity)) return 'spreadsheet';
  if (/pptx|aippt|presentation|slides?|演示文稿|幻灯片|oil-ppt/.test(identity)) return 'presentation';
  if (/pdf|docx|word document|word文档|文档处理|markdown/.test(identity)) return 'document';
  if (/video|视频|remotion|shotcraft|seedance/.test(identity)) return 'video-production';
  if (/image|图片|图像|海报|插画|seedream|imagegen/.test(identity)) return 'image-production';
  if (/prompt|提示词/.test(identity)) return 'prompt-engineering';
  if (/scrap|crawler|crawl|爬虫|网页采集|批量抓取|内容提取/.test(identity)) return 'web-extraction';
  if (/playwright|browser|浏览器自动化|网页操作|表单填写|网页截图/.test(identity)) return 'browser-automation';
  if (/citation|reference verification|引用核验|参考文献/.test(identity)) return 'citation';
  if (/academic|论文|文献综述|deep.research|研究管线|research|hypothesis/.test(identity)) return 'research';
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
  if (id === 'frontend-dev' || /frontend-implementation|前端开发|完整前端|网页应用/.test(identity)
      || /^full-stack frontend development/.test(summary)) return 'frontend-implementation';
  if (/impeccable|ui|ux|design|视觉设计|界面精修|网页设计|品牌设计|landing page|落地页/.test(identity)
      || /(?:frontend interfaces|frontend interface|anti-slop frontend)/.test(summary)) return 'visual-design';
  if (/architecture|架构|system design|代码实现|coding|编程|debug|诊断/.test(identity)) return 'engineering';
  return 'general';
}

export function inferSkillStage(skill = {}, capability = inferCapability(skill)) {
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
  if (['skill-governance', 'research'].includes(capability)) return 'discovery';
  if (['orchestration', 'requirements', 'skill-authoring', 'prompt-engineering'].includes(capability)) return 'planning';
  if (['visual-design', 'motion', 'content-publishing', 'video-production', 'image-production'].includes(capability)) return 'design';
  if (['personal-site', 'frontend-implementation', 'engineering', 'web-extraction', 'browser-automation'].includes(capability)) return 'implementation';
  if (['data-analysis', 'spreadsheet', 'document', 'citation', 'asset-analysis'].includes(capability)) return 'analysis';
  if (capability === 'verification') return 'verification';
  if (['seo', 'performance', 'accessibility'].includes(capability)) return 'optimization';
  if (['presentation', 'deployment'].includes(capability)) return 'delivery';
  return 'implementation';
}

export function stageRank(stage) {
  return STAGE_INDEX.get(stage) ?? PIPELINE_STAGES.length;
}

const CAPABILITY_SIGNALS = {
  'skill-governance': /技能(?:库)?|skill|路由器|技能路由|no_skill/i,
  'skill-authoring': /(?:创建|制作|编写|更新|维护|修复).{0,8}(?:(?:agent\s*)?skill|技能)|skill\.md|技能文件|技能包/i,
  orchestration: /并行|多\s*agents?|多智能体|分工|agent团队|编排|multi[ -]?agents?/i,
  requirements: /需求|范围|规格|产品规划|方案|蓝图|先梳理|从零|还不清楚|访谈/i,
  accessibility: /无障碍|可访问性|wcag|a11y|读屏|键盘导航/i,
  seo: /seo|搜索引擎|搜索排名|站点地图|sitemap|meta tags?/i,
  performance: /性能|加载慢|提速|page speed|core web vitals|lcp|inp|cls/i,
  deployment: /部署|上线|发布|托管|预览环境|生产环境|deploy|hosting/i,
  verification: /测试|验证|核验|验收|审查|复核|回归|质量门|test|review/i,
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
  const text = String(query || '').normalize('NFKC').toLowerCase();
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
  const text = String(query || '').normalize('NFKC').toLowerCase();
  if (capability === 'frontend-implementation') return /前端|react|vue|next\.js|网页|网站|页面|\bweb\b|\bhtml\b|组件/i.test(text)
    && /开发|实现|搭建|创建|制作|修改|修复|重构|前端|react|vue|next\.js|网页应用|代码|build|create|implement/i.test(text)
    && !(/抓取|采集|爬虫/.test(text) && !/开发|实现|前端|代码/.test(text));
  if (capability === 'visual-design') return /视觉|界面|网页|网站|\bui\b|\bux\b|设计系统|品牌|落地页|配色|字体|组件规范|移动端|信息架构|可用性/i.test(text)
    && /设计|改版|优化|美化|精修|开发|创建|制作|实现|做|配色|字体|改得|build|create|design|polish|improve/i.test(text);
  if (capability === 'personal-site') return CAPABILITY_SIGNALS['personal-site'].test(text)
    || /个人博客|(?:自己|简历|经历|作品|resume|projects).{0,30}(?:网站|网页|website)|(?:网站|网页|website).{0,30}(?:自己|简历|经历|作品|resume|projects)/i.test(text);
  if (capability === 'general') return false;
  return CAPABILITY_SIGNALS[capability]?.test(text) ?? true;
}

export function skillDomainCompatible(skill, query) {
  const {id, identity} = normalizedFields(skill);
  const text = String(query || '').normalize('NFKC').toLowerCase();
  if (id === 'council-multi-model' && !/评议会|council|外部.{0,8}(?:评审|批评)|external critique/i.test(text)) return false;
  if (/(?:^|[\s-])(?:cad|gcode|dfam)(?:[\s-]|$)|freecad|autocad|三维审查/.test(identity)
      && !/\bcad\b|freecad|autocad|三维|3d|建模|工程图|机械|电气|gcode|stl|step文件/i.test(text)) return false;
  const capability = inferCapability(skill);
  if (capability === 'prompt-engineering' && !/提示词|提示语|\bprompt\b|(?:不知道|不会|说不清|表达不清).{0,30}(?:ai|模型|描述|表达)|(?:想法|需求).{0,12}(?:模糊|混乱)/i.test(text)) return false;
  if (['frontend-implementation', 'visual-design', 'personal-site'].includes(capability)
      && !capabilityActionCompatible(capability, text)) return false;
  if (capability === 'image-production') {
    // Looking at an attachment is not a request to edit or generate it.
    const requested = /(?:生成|制作|画|绘制|设计|编辑|修改|美化|修复|处理|替换|调整|抠图|去背景|加字|p图).{0,12}(?:图片|图像|照片|海报|插画|背景|头像)|(?:图片|图像|照片|海报|插画|背景|头像).{0,12}(?:生成|制作|编辑|修改|美化|修复|替换|调整|抠图|去背景|加字)|(?:generate|create|draw|edit|retouch|remove background).{0,24}(?:image|photo|picture|poster|illustration)/i.test(text);
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
