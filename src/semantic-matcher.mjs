const TASK_ACTION = /制作|创建|开发|搭建|生成|实现|设计|改版|重做|优化|完善|美化|精修|编辑|修改|修复|转换|提取|读取|分析|审查|检查|测试|调试|部署|发布|整理|归类|重命名|写|画|做|研究|搜索|查找|验证|核验|翻译|润色|总结|规划|配置|升级|迁移|重构|自动化|批量|build|create|develop|generate|implement|design|redesign|improve|edit|fix|convert|extract|read|analy[sz]e|review|test|debug|deploy|publish|organize|rename|write|research|search|verify|translate|polish|plan|configure|upgrade|migrate|refactor|automate/i;

const BUILD_ACTION = /制作|创建|开发|搭(?:建|一个|个)?|生成|实现|设计|改版|重做|建设|做一个|做个|想做|需要一个|帮我做|build|create|develop|generate|implement|design|redesign/i;
const EDIT_ACTION = /优化|完善|美化|精修|编辑|修改|修复|改版|重构|升级|调整|improve|polish|edit|modify|fix|refactor|upgrade|redesign/i;
const READ_ACTION = /读取|提取|解析|分析|审查|检查|查看|总结|识别|转换|合并|拆分|read|extract|parse|analy[sz]e|review|inspect|summari[sz]e|convert|merge|split/i;

// Cross-language concepts let Chinese requests match English-only frontmatter.
// Weights reflect how distinctive a concept is across a large skill catalog.
const CONCEPTS = [
  ['personal', 4.5, /个人(?:品牌|网站|网页|主页|官网|站点|博客|作品|简历)?|作品集|求职主页|创作者主页|自我介绍|personal|portfolio|resume homepage|creator homepage|developer portfolio|designer portfolio|personal brand|self-introduction/i],
  ['website', 2.2, /网站|网页|主页|站点|官网|页面|web(?:site| page| app)?|homepage|landing page|marketing site/i],
  ['frontend', 2.8, /前端|react|vue|next\.?js|nuxt|html|css|frontend|web component/i],
  ['ui-ux', 2.6, /界面|交互|视觉|ui\b|ux\b|user interface|user experience/i],
  ['design', 1.2, /设计|改版|美化|精修|高级感|design|redesign|style|visual/i],
  ['document', 1.8, /文档|文件|document|content/i],
  ['word', 4.2, /word文档|word文件|\.docx\b|docx\b|word document/i],
  ['pdf', 4.5, /\.pdf\b|pdf文件|pdf文档|pdf\b/i],
  ['spreadsheet', 4.2, /excel|\.xlsx\b|电子表格|工作簿|spreadsheet|workbook/i],
  ['presentation', 3.8, /pptx?|幻灯片|演示文稿|slide deck|presentation/i],
  ['image', 2.8, /图片|图像|照片|插画|海报|image|photo|illustration|poster/i],
  ['video', 3.2, /视频|影片|短片|video|movie|footage/i],
  ['audio', 3.4, /音频|声音|语音|音乐|audio|sound|music/i],
  ['email', 4.2, /邮件|电子邮件|邮箱|email|e-mail/i],
  ['file-batch', 3.8, /批量文件|一批文件|多个文件|文件夹|目录|bulk file|batch file/i],
  ['rename', 4.5, /重命名|改名|rename/i],
  ['convert', 2.8, /格式转换|转换格式|转成|convert|conversion/i],
  ['research', 3.0, /研究|调研|文献|research|literature/i],
  ['academic-paper', 4.0, /学术论文|研究论文|论文写作|论文初稿|投稿|academic paper|research paper|manuscript/i],
  ['citation', 4.0, /引用|参考文献|doi|citation|reference verification/i],
  ['review', 2.4, /审查|评审|审核|复核|审稿|review|audit|inspect/i],
  ['statistics', 3.8, /统计|假设检验|p值|回归分析|statistics|statistical|hypothesis test/i],
  ['data', 2.2, /数据|表格数据|dataset|data analysis|tabular/i],
  ['browser', 3.0, /浏览器|网页操作|点击|填表|登录态|browser|playwright|web automation/i],
  ['scraping', 4.0, /爬虫|抓取|采集网页|网页采集|scrape|scraping|crawler|crawl/i],
  ['accessibility', 4.2, /无障碍|可访问性|读屏|键盘导航|wcag|a11y|accessibility/i],
  ['performance', 3.5, /性能|卡顿|加载慢|lcp|inp|cls|core web vitals|performance|page speed/i],
  ['seo', 4.2, /搜索引擎优化|搜索排名|结构化数据|站点地图|seo|sitemap/i],
  ['animation', 3.0, /动效|动画|转场|滚动叙事|animation|motion|transition|scrolltrigger|gsap/i],
  ['three-d', 4.0, /三维|3d|three\.?js|webgl|gltf|shader|glsl/i],
  ['code', 1.8, /代码|编程|源码|函数|code|coding|programming|source code/i],
  ['debug', 3.6, /报错|错误|异常|调试|debug|bug|exception|error/i],
  ['test', 2.8, /测试|回归|验收|test|testing|e2e|regression/i],
  ['architecture', 3.6, /架构|系统设计|模块设计|architecture|system design/i],
  ['deployment', 3.8, /部署|上线|发布|托管|deploy|deployment|hosting|release/i],
  ['git', 4.0, /git|提交|commit|推送|push|分支|branch/i],
  ['skill', 3.8, /技能|skill/i],
  ['agent', 3.2, /智能体|代理|agent|multi-agent|multi agent/i],
  ['prompt', 3.8, /提示词|prompt/i],
  ['memory', 4.0, /记忆|长期记忆|memory/i],
  ['automation', 3.0, /自动化|定时|工作流|automation|workflow|scheduled/i],
  ['translate', 4.0, /翻译|中译英|英译中|translate|translation/i],
  ['polish', 3.2, /润色|改写|去ai味|机器味|polish|rewrite|humanize/i],
];

const PERSONAL_SITE = /个人(?:网站|网页|主页|官网|站点|博客|品牌站)|个人品牌(?:网站|网页|官网|站点)|作品集(?:网站|网页|主页|站点)?|求职(?:网站|网页|主页)|简历(?:网站|网页|主页)|自我介绍(?:网站|网页|页面)|(?:展示|介绍)(?:我|自己|个人).{0,16}(?:项目|作品|简历).{0,16}(?:网站|网页|主页)|(?:我|自己|个人).{0,16}(?:项目|作品|简历).{0,16}(?:网站|网页|主页)|(?:personal|portfolio|resume|creator|developer|designer).{0,16}(?:site|website|homepage|portfolio)|(?:site|website|homepage).{0,20}(?:resume|portfolio|projects)/i;
const WEB_TARGET = /网站|网页|页面|官网|站点|前端|react|vue|next\.?js|web(?:site| page| app)|landing page|marketing site/i;
const LANDING_TARGET = /落地页|营销页|品牌官网|企业官网|产品官网|saas.{0,8}(?:网站|官网|页面)|landing page|marketing site|brand site/i;
const PROMPT_WORK = /(?:创建|制作|生成|编写|写|设计|开发|整理|优化|改写|重写|润色|压缩|缩短|精简|扩写|扩展|适配|转换|调整|修改|修复|返修|迭代|完善|升级).{0,16}(?:提示词|提示语|prompt)|(?:提示词|提示语|prompt).{0,16}(?:创建|制作|生成|编写|写|设计|开发|整理|优化|改写|重写|润色|压缩|缩短|精简|扩写|扩展|适配|转换|调整|修改|修复|返修|迭代|完善|升级)/i;
const PROMPT_EXPRESSION_NEED = /(?:不知道|不会|说不清|表达不清|描述不清).{0,24}(?:提示词|prompt|(?:表达|描述|说明|提需求).{0,8}(?:给|向|让).{0,4}(?:ai|模型|chatgpt|claude|gemini|智能体)|(?:给|向|让).{0,4}(?:ai|模型|chatgpt|claude|gemini|智能体).{0,8}(?:表达|描述|说明|提需求))|(?:需求|想法).{0,8}(?:模糊|混乱|说不清|表达不清).{0,16}(?:ai|模型|提示词|prompt)|(?:don't know how|not sure how|help me).{0,20}(?:write|phrase|express|describe).{0,16}(?:prompt|to (?:an )?ai|for (?:chatgpt|claude|gemini))/i;
const PROMPT_REVERSE_ENGINEERING = /(?:反推|逆向|复刻|还原|恢复原).{0,24}(?:提示词|prompt)|(?:提示词|prompt).{0,16}(?:反推|逆向|复刻|还原)/i;
const DIRECT_PROMPT_EXECUTION = /(?:按|使用|用|根据|照着).{0,8}(?:这段|这个|以下|我的)?\s*(?:提示词|prompt).{0,16}(?:直接|立即)?\s*(?:生成|制作|创建|执行|运行|完成|跑)|(?:直接执行|直接运行).{0,8}(?:这段|这个|以下)?\s*(?:提示词|prompt)/i;
const PROMPT_OPT_OUT = /(?:不要|不需要|无需).{0,8}(?:生成|创建|编写|优化|改写)?\s*(?:提示词|prompt).{0,8}(?:直接|只要|仅要)|(?:提示词|prompt).{0,8}(?:不要|不需要|无需).{0,8}(?:直接|只要|仅要)/i;

function wantsPromptOptimization(query) {
  return (PROMPT_WORK.test(query) || PROMPT_EXPRESSION_NEED.test(query))
    && !PROMPT_REVERSE_ENGINEERING.test(query)
    && !DIRECT_PROMPT_EXECUTION.test(query)
    && !PROMPT_OPT_OUT.test(query);
}

const INTENT_PROFILES = [
  {
    id: 'prompt-optimization', skillId: 'omnimodal-prompt-architect', boost: 24,
    matches: (q) => wantsPromptOptimization(q),
  },
  {
    id: 'personal-site-build', skillId: 'personal-homepage-skill', boost: 24,
    matches: (q) => (BUILD_ACTION.test(q) || EDIT_ACTION.test(q)) && PERSONAL_SITE.test(q),
  },
  {
    id: 'landing-brand-design', skillId: 'design-taste-frontend', boost: 20,
    matches: (q) => (BUILD_ACTION.test(q) || EDIT_ACTION.test(q)) && LANDING_TARGET.test(q),
  },
  {
    id: 'frontend-production', skillId: 'frontend-dev', boost: 16,
    matches: (q) => BUILD_ACTION.test(q) && WEB_TARGET.test(q) && !PERSONAL_SITE.test(q) && !LANDING_TARGET.test(q)
      && !((/已有|现有|当前|这个/.test(q)) && EDIT_ACTION.test(q))
      && !/转场|动画|动效|缓动|transition|animation|motion|gsap|scrolltrigger/i.test(q),
  },
  {
    id: 'existing-ui-polish', skillId: 'impeccable', boost: 18,
    matches: (q) => EDIT_ACTION.test(q) && /已有|现有|这个|当前/.test(q) && /界面|网页|页面|\bui\b|视觉|响应式|交互/i.test(q),
  },
  {
    id: 'word-document', skillId: 'docx', boost: 18,
    matches: (q) => (BUILD_ACTION.test(q) || EDIT_ACTION.test(q)) && !/读取|提取|抽取|解析|read|extract|parse/i.test(q) && /word|\.docx\b|docx\b/i.test(q)
      && !/markdown|提取正文|提取文本|抽取正文|抽取文本/i.test(q),
  },
  {
    id: 'document-to-markdown', skillId: 'markitdown-docs', boost: 22,
    matches: (q) => /markdown|读取|提取正文|提取文本|抽取正文|抽取文本|解析文档|read|extract text|parse document/i.test(q)
      && /word|\.docx\b|docx\b|pdf|\.pdf\b|图片|图像|ocr/i.test(q),
  },
  {
    id: 'pdf-operation', skillId: 'pdf', boost: 18,
    matches: (q) => (BUILD_ACTION.test(q) || EDIT_ACTION.test(q) || READ_ACTION.test(q) || /合并|拆分|旋转|水印|加密|解密|填写|压缩|ocr/i.test(q)) && /pdf|\.pdf\b/i.test(q)
      && !/markdown|提取正文|提取文本|抽取正文|抽取文本/i.test(q),
  },
  {
    id: 'spreadsheet-operation', skillId: 'xlsx', boost: 18,
    matches: (q) => (BUILD_ACTION.test(q) || EDIT_ACTION.test(q) || READ_ACTION.test(q)) && /excel|\.xlsx\b|电子表格|工作簿/i.test(q),
  },
  {
    id: 'ai-presentation', skillId: 'aippt', boost: 18,
    matches: (q) => /ai.{0,6}(?:生成|制作|设计).{0,6}(?:ppt|演示文稿)|自动生成.{0,6}(?:ppt|演示文稿)|智绘ppt/i.test(q),
  },
  {
    id: 'edit-presentation', skillId: 'pptx', boost: 18,
    matches: (q) => (EDIT_ACTION.test(q) || READ_ACTION.test(q)) && /现有|已有|这个|\.pptx\b|pptx文件/i.test(q) && /pptx?|幻灯片|演示文稿/i.test(q),
  },
  {
    id: 'batch-file-operation', skillId: 'batch-file-processor', boost: 20,
    matches: (q) => /批量|一批|多个|文件夹|目录/.test(q) && /重命名|改名|格式转换|归类|整理|去重|重复文件|rename|convert|organize/i.test(q),
  },
  {
    id: 'web-scraping', skillId: 'web-scraper', boost: 20,
    matches: (q) => /批量|多个|一批|采集|抓取|爬取|爬虫|scrape|crawl/i.test(q) && /网页|网站|url|文章|数据|web/i.test(q),
  },
  {
    id: 'browser-testing', skillId: 'playwright', boost: 18,
    matches: (q) => /浏览器|网页|页面|表单|登录|e2e|端到端/i.test(q) && /测试|自动化|点击|填写|截图|playwright/i.test(q),
  },
  {
    id: 'skill-authoring', skillId: 'skill-creator', boost: 20,
    matches: (q) => /创建|制作|开发|编写|更新|升级|改进|优化|维护|修复/i.test(q) && /(?:agent\s*)?skill|(?:agent|智能体)?技能|技能文件|技能包|skill\.md/i.test(q),
  },
  {
    id: 'skill-routing-governance', skillId: 'skill-stocktake', boost: 24,
    matches: (q) => /优化|调整|放宽|改造|升级|修复|审查|检查|盘点|治理|改进/i.test(q)
      && /技能路由|技能匹配|技能识别|技能扫描|候选技能|no_skill|多技能(?:协调|协作|组合)/i.test(q),
  },
  {
    id: 'deep-research', skillId: 'deep-research', boost: 18,
    matches: (q) => /深度研究|系统性回顾|系统综述|文献综述|文献回顾|元分析|meta-analysis|systematic review|deep research/i.test(q),
  },
  {
    id: 'academic-writing', skillId: 'academic-paper', boost: 18,
    matches: (q) => /写|撰写|起草|修改|规划|outline|draft/i.test(q) && /学术论文|研究论文|论文初稿|paper|manuscript/i.test(q),
  },
  {
    id: 'email-writing', skillId: 'email-skill', boost: 16,
    matches: (q) => /写|起草|回复|发送|整理|撰写/i.test(q) && /邮件|email|e-mail/i.test(q),
  },
  {
    id: 'translation', skillId: 'another_them', boost: 0,
    // Reserved: there are several translation skills and no safe unique owner yet.
    matches: () => false,
  },
];

const CHINESE_STOP = new Set([
  '一个', '这个', '那个', '一下', '帮我', '请你', '给我', '我的', '我们', '需要', '想要', '可以', '进行', '完成', '任务', '项目', '内容', '东西', '问题', '开始', '使用', '实现', '制作', '生成', '开发', '设计',
]);
const ASCII_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'use', 'using', 'when', 'user', 'users', 'skill', 'asks', 'create', 'build', 'make', 'help']);

function compact(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(/[\s_$@/\\:：,，。.!！?？()（）\[\]【】'"“”‘’_-]+/g, '');
}

function chineseNgrams(value = '') {
  const terms = new Set();
  for (const run of String(value).normalize('NFKC').match(/[\u3400-\u9fff]{2,}/gu) || []) {
    for (let size = 2; size <= Math.min(4, run.length); size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        const term = run.slice(index, index + size);
        if (!CHINESE_STOP.has(term)) terms.add(term);
      }
    }
  }
  return terms;
}

function asciiTokens(value = '') {
  return new Set(String(value).normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g)
    ?.filter((term) => !ASCII_STOP.has(term)) || []);
}

function extractFeatures(value = '') {
  const raw = String(value).normalize('NFKC').toLowerCase();
  const concepts = new Map();
  for (const [id, weight, pattern] of CONCEPTS) if (pattern.test(raw)) concepts.set(id, weight);
  return {
    raw,
    compact: compact(raw),
    concepts,
    chinese: chineseNgrams(raw),
    ascii: asciiTokens(raw),
    hasTaskAction: TASK_ACTION.test(raw),
  };
}

function skillDocument(skill) {
  return [
    skill.id,
    skill.nameZh,
    ...(skill.aliases || []),
    ...(skill.triggers || []),
    skill.summaryZh,
    skill.category,
    skill.family,
  ].filter(Boolean).join('\n');
}

export function buildSemanticContext(query, registry, policy = {}) {
  const queryFeatures = extractFeatures(query);
  const intentBoosts = new Map();
  if (policy.enabled !== false) {
    const promptOptimizationActive = wantsPromptOptimization(queryFeatures.raw);
    for (const profile of INTENT_PROFILES) {
      // A request to write or repair a prompt is a meta-task. Keep downstream
      // execution profiles from hijacking it because the prompt mentions a
      // website, screenshot, presentation, video, or another target artifact.
      if (promptOptimizationActive && profile.id !== 'prompt-optimization') continue;
      if (!profile.boost || !profile.matches(queryFeatures.raw)) continue;
      intentBoosts.set(profile.skillId, {id: profile.id, boost: profile.boost});
    }
  }
  return {
    query: queryFeatures,
    intentBoosts,
    documents: new Map(registry.skills.map((skill) => [skill.id, extractFeatures(skillDocument(skill))])),
    policy,
  };
}

function lexicalScore(query, document) {
  let score = 0;
  let longMatches = 0;
  for (const term of [...query.chinese].sort((a, b) => b.length - a.length)) {
    if (!document.chinese.has(term)) continue;
    if (term.length >= 3) longMatches += 1;
    score += term.length === 4 ? 1.25 : term.length === 3 ? 0.8 : 0.35;
    if (score >= 5) break;
  }
  let asciiMatches = 0;
  for (const term of query.ascii) {
    if (!document.ascii.has(term)) continue;
    asciiMatches += 1;
    score += 0.75;
    if (asciiMatches >= 5) break;
  }
  return {score: Math.min(8, score), longMatches, asciiMatches};
}

export function scoreSemanticMatch(skill, context) {
  if (context.policy?.enabled === false) return {score: 0, strong: false, reasons: []};
  const document = context.documents.get(skill.id);
  if (!document) return {score: 0, strong: false, reasons: []};
  const profile = context.intentBoosts.get(skill.id);
  const overlapping = [];
  let conceptScore = 0;
  for (const [concept, weight] of context.query.concepts) {
    if (!document.concepts.has(concept)) continue;
    overlapping.push(concept);
    conceptScore += weight;
  }
  const lexical = lexicalScore(context.query, document);
  // Descriptions only participate when the request actually asks for work or
  // an explicit high-confidence intent profile matched. This avoids routing
  // casual mentions and explanations to production workflows.
  if (!profile && !context.query.hasTaskAction) return {score: 0, strong: false, reasons: []};
  const score = Math.min(30, (profile?.boost || 0) + Math.min(9, conceptScore) + lexical.score);
  const distinctiveConcepts = overlapping.filter((concept) => (context.query.concepts.get(concept) || 0) >= 2.5);
  const threshold = context.policy?.activationThreshold ?? 13;
  const strong = Boolean(profile) || (score >= threshold && (distinctiveConcepts.length >= 2 || lexical.longMatches >= 2 || lexical.asciiMatches >= 3));
  const reasons = [];
  if (profile) reasons.push(`识别任务意图“${profile.id}”`);
  if (overlapping.length) reasons.push(`技能描述语义匹配：${overlapping.slice(0, 4).join('/')}`);
  if (!profile && lexical.longMatches >= 2) reasons.push('技能描述与任务存在多处自然语言重合');
  return {score, strong, reasons, concepts: overlapping};
}

export function semanticIntentProfiles() {
  return INTENT_PROFILES.map(({id, skillId, boost}) => ({id, skillId, boost})).filter((item) => item.boost > 0);
}
