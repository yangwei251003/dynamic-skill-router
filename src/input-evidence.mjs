// V4 input obligations, not permissions. Consume the existing source-filtered
// active clauses once, before another consumer can mistake a source for data.
// A complete existing grammar is the only positive witness of supplied closure.
const resource=/(公网来源|本地网络来源):[^\s。；;，,]+/g;
const usesInput=/阅读|读取|查阅|查看|获取|打开|访问|浏览|检索|搜索|总结|概括|对照|比较|对比|\b(?:read|fetch|open|browse|visit|consult|search|retrieve|summari[sz]e|compare)\b/i;
const restricted=/(?:受限|私有|私人|需(?:要)?(?:先)?登录|登录后|已有登录|登录权限|账号|身份认证)|\b(?:restricted|private|authenticated|authentication[- ]required|login[- ]required|sign[- ]in[- ]required|signed[- ]in|logged[- ]in|existing\s+(?:login|session)|requires?\s+(?:a\s+)?(?:login|authentication))\b/i;
const explanation=/^\s*(?:(?:please|only|now|currently)\s+|请|现在|本次|只|仅)*(?:explain|describe|what\b|how\b|解释|介绍|说明如何|如何)/i;
const localCopy=/本地|离线|\b(?:local|offline)\b/i;
const suppliedOnly=/^(?:请)?(?:只|仅)(?:用|使用|根据|依据|基于).{0,15}(?:给定|提供|粘贴|附上).{0,15}(?:正文|内容|摘录|资料|材料|文本)|^\s*(?:use|consult)\s+only\s+(?:the\s+)?(?:provided|supplied|pasted|attached)\b/i;
const citationOnly=/^\s*(?:(?:请)?(?:只|仅)(?:引用|列出|给出)(?:这个|该)?(?:链接|网址)|(?:only\s+)?(?:quote|cite)\s+(?:this\s+)?(?:url|link)\b)/i;

export function inputEvidence(clauses, closureWitness=null) {
 const active=(Array.isArray(clauses)?clauses:[]).filter(x=>typeof x==='string');
 if(closureWitness)return {closure:'provided',closureWitness,sources:[],authority:'advisory-only'};
 const supplied=active.some(clause=>suppliedOnly.test(clause));
 const sources=[];
 for(const [clauseIndex,evidence] of active.entries()){
  const found=[...evidence.matchAll(resource)];
  if(!found.length)continue;
  // An explicit supplied-only restriction owns the whole supplied body,
  // including unquoted sentences that describe read/open commands.
  const reference=supplied||explanation.test(evidence)||citationOnly.test(evidence);
  const local=localCopy.test(evidence);
  // A coordinated source argument inherits the preceding input relation, not
  // its access class. Other clauses never lend authentication or permission.
  const preceding=sources.at(-1);
  const continued=preceding?.clauseIndex===clauseIndex-1&&preceding.role==='required'
   && /^(?:以及|和|与|并且|and\b|also\b)/i.test(evidence);
  const role=reference?'reference':local?'local-copy':usesInput.test(evidence)||continued?'required':'unresolved';
  const next=active[clauseIndex+1]||'';
  const accessQualifier=!/(?:公网来源|本地网络来源):/.test(next)
   && /^(?:请)?(?:用|使用|凭|通过)|^\s*(?:use|using|with|via)\b/i.test(next)?next:'';
  const access=restricted.test(evidence+' '+accessQualifier)?'restricted':'unspecified';
  for(const match of found)sources.push({kind:'network-resource',reference:match[0],
   location:match[1]==='公网来源'?'public-network':'local-network',role,access,
   clauseIndex,evidence,source:'user-request',authority:'advisory-only'});
 }
 return {closure:'unproven',closureWitness:null,sources,authority:'advisory-only'};
}
