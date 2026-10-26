import fs from 'node:fs';
import path from 'node:path';
import {GLOBAL_ROOT} from './paths.mjs';

const registryPath = path.join(GLOBAL_ROOT, '技能注册表', 'skills.json');
const canonicalRoot = path.join(GLOBAL_ROOT, '技能');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const additions = [];

function group({source, sourceUrl, category, family, implicit = true, risk = 'low', commands = [], items}) {
  for (const [id, summaryZh, aliases = [], triggers = [], negative = []] of items) {
    additions.push({
      id,
      nameZh: id,
      aliases: [...new Set([id, ...aliases])],
      summaryZh,
      category,
      family,
      implicit,
      status: 'ready',
      risk,
      triggers: [...new Set([id, ...triggers])],
      negative,
      requirements: {commands},
      source,
      sourceUrl,
      path: path.join(canonicalRoot, id),
    });
  }
}

group({
  source: 'Personal Homepage Skill', sourceUrl: 'https://github.com/powerycy/personal-homepage-skill',
  category: '前端与产品设计', family: 'personal-site', commands: ['node', 'npm'], items: [
    ['personal-homepage-skill', '按“参考优先”的流程制作高质量个人主页、个人网站、作品集和 16:9 HTML 演示文稿，并完成视觉与内容质检。', ['个人主页生成', '作品集网站', '个人网站', '个人品牌网站', '个人博客网站', 'HTML演示文稿'], ['个人主页', '个人网站', '个人网页', '个人站点', '个人官网', '个人品牌网站', '个人博客网站', '作品集网站', '作品集主页', '求职主页', '简历网站', '创作者主页', '项目展示网站', '自我介绍网站', 'personal website', 'personal homepage', 'portfolio website', 'html ppt'], ['普通后台', '纯后端']],
  ],
});

group({
  source: 'Ponytail', sourceUrl: 'https://github.com/DietrichGebert/ponytail',
  category: '代码效率与审查', family: 'code-simplification', implicit: false, items: [
    ['ponytail', '以“尽量少写代码”的资深工程师视角审视需求，寻找删除、复用和简化方案。', ['极简开发', '少写代码'], ['简化实现', '少写代码']],
    ['ponytail-audit', '审计代码库中的过度设计、重复实现和不必要抽象，并给出删减建议。', ['代码极简审计'], ['过度设计', '重复代码', '极简审计']],
    ['ponytail-debt', '识别真正值得偿还的技术债，并按收益和风险排序。', ['技术债排序'], ['技术债', '代码债务']],
    ['ponytail-gain', '评估某项开发工作的实际收益，避免投入到低价值改动。', ['开发收益评估'], ['收益评估', '值不值得做']],
    ['ponytail-help', '解释 Ponytail 的命令、配置和推荐工作方式。', ['Ponytail帮助'], ['ponytail help']],
    ['ponytail-review', '用最小化和可维护性标准复核代码变更。', ['极简代码复核'], ['极简审查', '删代码审查']],
  ],
});

group({
  source: 'Agent Skills for Context Engineering', sourceUrl: 'https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering',
  category: '技能与智能体', family: 'context-engineering', commands: ['python'], items: [
    ['context-compression', '为长会话设计压缩与摘要策略，在减少 Token 的同时保留关键决策和证据。', ['上下文压缩'], ['长会话压缩', '上下文太长', '减少token']],
    ['filesystem-context', '把大型上下文拆到文件中按需读取，减少一次性塞入提示词的噪音。', ['文件化上下文'], ['文件上下文', '按需读取上下文']],
    ['tool-design', '设计边界清晰、参数少歧义、返回可验证的 Agent 工具接口。', ['Agent工具设计'], ['设计mcp工具', '工具接口', 'tool schema']],
    ['evaluation', '为 Agent 能力建立数据集、评分标准、测试和回归评测。', ['Agent评测'], ['agent评测', '技能评测', '验收数据集', '评测数据集']],
    ['harness-engineering', '设计 Agent、工具、记忆、权限、日志和停止条件组成的完整运行框架。', ['Agent运行框架'], ['agent框架', 'harness', '智能体运行环境']],
  ],
});

group({
  source: 'Vercel Agent Skills', sourceUrl: 'https://github.com/vercel-labs/agent-skills',
  category: '前端与产品设计', family: 'react-engineering', items: [
    ['composition-patterns', '用组合式组件和稳定 API 设计 React 组件，避免布尔参数爆炸。', ['React组合模式'], ['react组件设计', '组合组件', 'boolean props']],
    ['react-view-transitions', '正确实现 React 与 Next.js 页面转场、共享元素和进入退出动画。', ['React页面转场'], ['view transition', '页面转场', '共享元素动画']],
    ['react-native-skills', '按 Vercel 的 React Native 性能与组件规范审查和实现移动端界面。', ['React Native规范'], ['react native', 'expo性能', '移动端组件']],
    ['web-design-guidelines', '依据现代网页界面规范审查可访问性、交互、表单、响应式和视觉细节。', ['网页设计规范'], ['网页规范审查', 'web design guidelines', '界面规范']],
  ],
});

group({
  source: 'Addy Osmani Web Quality Skills', sourceUrl: 'https://github.com/addyosmani/web-quality-skills',
  category: '网页质量与发布', family: 'web-quality', items: [
    ['web-quality-audit', '以证据为依据执行网页发布前总审计，覆盖性能、可访问性、SEO 与最佳实践。', ['网页质量总审计'], ['网页质量', '发布前审计', 'lighthouse audit']],
    ['seo', '检查并改进元数据、结构化数据、站点地图与搜索引擎可见性。', ['搜索引擎优化'], ['seo', '搜索排名', '结构化数据'], ['批量抓取', '网页爬取', '爬虫']],
    ['accessibility', '依据 WCAG 2.2 审计键盘、读屏、语义、对比度和触控可访问性。', ['网页无障碍'], ['可访问性', 'wcag', 'a11y', '读屏']],
    ['performance', '通过实测定位加载、渲染、网络和主线程瓶颈并制定网页性能优化方案。', ['网页性能优化'], ['网页性能', '加载慢', 'page speed']],
    ['core-web-vitals', '针对 LCP、INP、CLS 等核心网页指标进行测量、诊断和优化。', ['核心网页指标'], ['core web vitals', 'lcp', 'inp', 'cls']],
    ['best-practices', '检查网页安全、兼容性、依赖、错误处理和现代工程最佳实践。', ['网页最佳实践'], ['web best practices', '网页安全检查', '兼容性']],
  ],
});

group({
  source: 'UI Craft', sourceUrl: 'https://github.com/educlopez/ui-craft',
  category: '前端与产品设计', family: 'frontend-quality', implicit: false, items: [
    ['ui-craft', '以完整设计工程体系处理页面塑形、设计令牌、视觉精修、响应式、可访问性和交付收尾。', ['UI Craft设计工程'], ['ui craft', '设计工程全流程']],
  ],
});

group({
  source: 'GSAP Skills', sourceUrl: 'https://github.com/greensock/gsap-skills',
  category: '网页动效与三维', family: 'gsap', items: [
    ['gsap-core', '正确使用 GSAP 核心补间、缓动、控制和生命周期。', ['GSAP核心'], ['gsap tween', 'gsap动画']],
    ['gsap-frameworks', '在主流前端框架中正确组织和清理 GSAP 动画。', ['GSAP框架集成'], ['gsap框架', 'vue gsap', 'svelte gsap']],
    ['gsap-performance', '诊断并优化 GSAP 动画性能、重绘、合成层和移动端表现。', ['GSAP性能'], ['gsap卡顿', '动画性能']],
    ['gsap-plugins', '根据需求选择和配置 GSAP 官方插件。', ['GSAP插件'], ['gsap插件', 'plugin gsap']],
    ['gsap-react', '在 React 中使用 useGSAP、作用域和清理机制实现可靠动画。', ['GSAP React'], ['react gsap', 'usegsap']],
    ['gsap-scrolltrigger', '实现并调试 ScrollTrigger 滚动触发、固定、同步和响应式动画。', ['GSAP滚动触发'], ['scrolltrigger', '滚动叙事']],
    ['gsap-timeline', '用 Timeline 编排复杂动画序列、标签、重叠和播放控制。', ['GSAP时间线'], ['gsap timeline', '动画序列']],
    ['gsap-utils', '使用 GSAP 工具函数处理随机、映射、循环、吸附和分布。', ['GSAP工具函数'], ['gsap utils', 'gsap工具']],
  ],
});

group({
  source: 'Three.js Skills', sourceUrl: 'https://github.com/CloudAI-X/threejs-skills',
  category: '网页动效与三维', family: 'threejs', implicit: true, items: [
    ['threejs-fundamentals', '建立 Three.js 场景、相机、渲染器、坐标与动画循环。', ['Three.js基础'], ['three.js基础', 'webgl场景']],
    ['threejs-geometry', '创建和优化 Three.js 几何体、缓冲属性与实例化对象。', ['Three.js几何体'], ['three.js几何', 'instanced mesh']],
    ['threejs-materials', '选择和配置 Three.js 材质、透明、混合与物理渲染参数。', ['Three.js材质'], ['three.js材质', 'pbr材质']],
    ['threejs-lighting', '设计 Three.js 灯光、阴影、环境光与性能平衡。', ['Three.js灯光'], ['three.js灯光', 'webgl阴影']],
    ['threejs-textures', '加载、配置并优化 Three.js 纹理、色彩空间和贴图。', ['Three.js纹理'], ['three.js纹理', 'texture']],
    ['threejs-loaders', '加载并管理 glTF、模型、纹理和异步资源。', ['Three.js模型加载'], ['gltf加载', 'three.js loader']],
    ['threejs-animation', '控制 Three.js 关键帧、骨骼、混合器和程序动画。', ['Three.js动画'], ['three.js动画', 'animation mixer']],
    ['threejs-shaders', '编写和调试 Three.js GLSL Shader、Uniform 与自定义材质。', ['Three.js着色器'], ['shader', 'glsl', 'three.js着色器']],
    ['threejs-postprocessing', '配置 Bloom、景深、抗锯齿等 Three.js 后期处理管线。', ['Three.js后期处理'], ['postprocessing', 'bloom', 'three.js后期']],
    ['threejs-interaction', '实现 Three.js 射线检测、指针、选择、拖拽和交互反馈。', ['Three.js交互'], ['raycaster', 'three.js交互', '3d点击']],
  ],
});

group({
  source: 'MengTo Skills', sourceUrl: 'https://github.com/MengTo/Skills',
  category: '视觉研究与灵感', family: 'visual-research', implicit: false, risk: 'medium', items: [
    ['design-first-ui-prompting', '把模糊视觉描述转成包含布局、字体、色彩、动效和限制条件的高质量 UI 提示。', ['设计优先UI提示'], ['设计提示词', 'ui prompt']],
    ['daily-ui-inspiration-capture', '收集、去重并记录一组高信号网页与界面参考。', ['每日UI灵感采集'], ['收集网页灵感', 'ui inspiration']],
    ['video-to-superprompt', '分析网页动效视频，将时间线、运动规律和交互拆成可重建提示。', ['视频转动效提示'], ['网页动效视频分析', '动效视频分析成可重建提示词', 'video superprompt']],
    ['html-to-interaction-prompts', '从现有 HTML 页面提炼结构、状态和交互语言，形成可复用提示。', ['网页转交互提示'], ['html交互分析', '网页交互提示']],
    ['stitched-full-page-capture', '对懒加载、动画和 WebGL 页面进行稳定的分段滚动与完整截图。', ['可靠全页截图'], ['长网页截图', 'webgl截图', '全页截图']],
    ['audit-reference-originality', '审查作品对参考的借鉴是否越界，并建立原创性证据清单。', ['参考原创性审计'], ['原创性审查', '是否抄袭', '参考换皮', '只抄了参考网站', '参考网站或换皮']],
    ['web-technique-to-skill', '把已经验证成功的网页实现方法沉淀成可复用 Agent Skill。', ['网页技术沉淀技能'], ['把网页效果做成skill', '技术沉淀']],
  ],
});

group({
  source: 'Video Shotcraft', sourceUrl: 'https://github.com/Vincentwei1021/video-shotcraft',
  category: '视频与动效制作', family: 'remotion-video-production', commands: ['node', 'npm'], items: [
    ['video-shotcraft', '用 152 张镜头配方卡、Remotion 模板、真实页面截图、2.5D 运镜和节奏化声音设计制作电影感产品宣传视频。', ['电影感产品视频', 'Remotion宣传片'], ['产品宣传视频', '网页宣传片', '动效镜头', 'Remotion视频', 'Ink Press模板']],
  ],
});

for (const id of ['video-to-superprompt', 'stitched-full-page-capture', 'audit-reference-originality']) {
  const skill = additions.find((item) => item.id === id);
  if (skill) skill.implicit = true;
}

const replacing = new Set(additions.map((item) => item.id));
registry.skills = [...registry.skills.filter((item) => !replacing.has(item.id)), ...additions]
  .sort((a, b) => a.id.localeCompare(b.id, 'en'));
registry.updatedAt = '2026-08-26';
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({added: additions.length, total: registry.skills.length, registryPath}, null, 2));
