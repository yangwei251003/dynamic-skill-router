import {primaryPurpose} from './purpose-evidence.mjs';
import {gameImplementation,imageArtifact,latexArtifact} from './task-intents.mjs';

// Match a specialist's stated job and prerequisites, not isolated words such as
// node, canvas, budget, control or return. These checks never authorize actions.
export function specialistPurposeCompatible(skill,text){
 const purpose=primaryPurpose(skill).toLowerCase();
 const query=String(text).toLowerCase();
 const rules=[
  [/(?:returns authorization|refund processing|reverse logistics|退货|退款|保修索赔)/, /退货|退款|逆向物流|保修|\b(?:refund|warranty|reverse logistics|product returns?|return (?:an? |the )?(?:item|product|order))\b/],
  [/(?:sorting skills|ecc install plan|技能.{0,15}(?:分桶|安装清单))/, /(?:skill|技能|ecc).{0,60}(?:安装|整理|精简|分桶|筛选|install|sort|trim|organize|buckets)|(?:安装|整理|精简|分桶|install|sort|trim|organize).{0,60}(?:skill|技能|ecc)/],
  [/(?:agent control plane|智能体控制平台)/, /nasiko|智能体控制平台|agent control plane/],
  [/(?:brand needs to discover|brand.{0,45}identity.{0,30}interviews|品牌.{0,20}(?:访谈|定位|识别))/, /品牌|\bbrand\b.{0,40}(?:identity|position|voice|personality|purpose|discovery|interview)/],
  [/(?:response depth|response length|token budget|回复长度)/, /回复.{0,20}(?:长度|深度|字数|token)|回答.{0,20}(?:长度|深度|字数)|\b(?:token (?:budget|count|usage|limit)|response (?:length|depth)|answer (?:size|depth)|short version|brief answer|detailed answer)\b/],
  [/(?:completed .{0,20}compute booking|已预订.{0,20}gpu)/, /\bit[oô](?![a-z])|(?:booked|booking|预订|租用).{0,25}(?:gpu|compute|节点)|(?:gpu|compute|节点).{0,25}(?:booked|booking|预订|租用)/],
  [/(?:tool.interface layer of an agent system|agent.{0,25}tool schemas|智能体工具接口)/, /\bmcp\b|\bagent\b|智能体|工具.{0,12}(?:接口|schema|描述|协议)|function.calling|tool.{0,15}(?:schema|description|interface|set)/],
  [/(?:three\.?js textures|uv mapping|cubemaps)/, /three\.?js|\buv\b|cubemaps?|hdr environment|环境贴图|纹理映射|三维材质|3d.{0,20}(?:texture|material)/],
 ];
 for(const [specialist,request] of rules)if(specialist.test(purpose)&&!request.test(query))return false;
 const providers=[[/飞书云空间|\bfeishu\b|\blark\b/,/飞书|\bfeishu\b|\blark\b/],[/google drive/,/google\s*drive/],[/dropbox/,/dropbox/],[/onedrive/,/onedrive/]];
 const requested=providers.filter(([,pattern])=>pattern.test(query));
 if(requested.length&&providers.some(([pattern])=>pattern.test(purpose))&&!requested.some(([pattern])=>pattern.test(purpose)))return false;
 if(/^create and edit native google docs/.test(purpose)&&!/google docs|谷歌文档/.test(query))return false;
 if(/\bjava\b|\bquarkus\b|\bspring boot\b/.test(purpose)&&/\bnode\.?js\b|\b(?:python|django|flask|fastapi)\b/.test(query)
   && !/\bjava\b|\bquarkus\b|\bspring ?boot\b/.test(query))return false;
 if(/(?:visual art.{0,35}(?:png|pdf)|静态.{0,15}(?:画作|海报|艺术))/.test(purpose)&&gameImplementation(query)&&!imageArtifact(query))return false;
 if(/open plans and html artifacts/.test(purpose)&&!/批注|评审计划|展示计划|计划.{0,12}(?:评审|审阅)|annotat|present.{0,20}(?:plan|review)|review.{0,20}plan|human feedback/.test(query))return false;
 if(/(?:consistent photo adjustments across a set|批量.{0,15}照片.{0,15}(?:风格|色调))/.test(purpose)
   && !/批量|多张|一组|统一.{0,15}(?:照片|图片)|batch|photos|set of images|multiple images|all (?:these|my)|cohesive|same style/.test(query))return false;
 if(/(?:detect existing tex live|install.{0,30}(?:tex live|mactex))/.test(purpose)
   && !(latexArtifact(query)&&/安装|缺少|不存在|找不到|环境缺失|install|not found|not installed|missing|no (?:tex|latex|compiler)/.test(query)))return false;
 return true;
}
