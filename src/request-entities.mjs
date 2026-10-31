// Catalogue entities are matched first; request verbs qualify their spans.
// This module never reads a catalogue, filesystem, or external source. Callers
// must remove quoted/reported/future/negative instructions before calling it.
const escape = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const useVerb = /使用|调用|启用|采用|借助|遵循|按照?|(?<!引|作|效|费|适)用(?!于|户|途)|\b(?:use|using|apply|invoke|follow|enable)\b/giu;
const interveningAction = /解释|说明|介绍|讨论|比较|对比|查找|搜索|列出|提到|描述|制作|生成|开发|实现|检查|审查|分析|总结|翻译|把|将|\b(?:explain|describe|discuss|compare|search|find|list|mention|create|generate|build|implement|inspect|review|analy[sz]e|summari[sz]e|translate)\b/i;

export function requestedName(clauses, name) {
  if (!String(name||'').trim()) return null;
  name=String(name).normalize('NFKC');
  const latinStart=/^[a-z0-9_]/i.test(name), latinEnd=/[a-z0-9_]$/i.test(name);
  const pattern=new RegExp(`${latinStart?'(?<![a-z0-9_:.\\-])':''}${escape(name)}${latinEnd?'(?![a-z0-9_\\-]|[.:][a-z0-9])':''}`,'giu');
  for (const [clauseIndex,raw] of clauses.entries()) {
    const clause=String(raw).normalize('NFKC');
    // Preserve Unicode case folding; avoid building spans for absent ASCII/Han names.
    if (/^[\x00-\x7f\p{Script=Han}]+$/u.test(name) && !clause.toLowerCase().includes(name.toLowerCase()))continue;
    for (const match of clause.matchAll(pattern)) {
      const start=match.index, before=clause.slice(0,start), after=clause.slice(start+match[0].length);
      if (/^的(?:输出|结果|截图|介绍|说明)/.test(after))continue;
      if (before.endsWith('$') && (before.length===1 || !/[a-z0-9_]/i.test(before.at(-2))))
        return {name,clauseIndex,start,end:start+match[0].length,relation:'explicit-marker'};
      const verb=[...before.matchAll(useVerb)].at(-1);
      if(!verb)continue;
      const between=before.slice(verb.index+verb[0].length);
      if(between.length>100 || /[。！？!?;；\n]/.test(between) || interveningAction.test(between))continue;
      return {name,clauseIndex,start,end:start+match[0].length,verb:verb[0],relation:'requested-entity'};
    }
  }
  return null;
}

export function unquoteRequestedNames(text) {
  return String(text).replace(/[“"「『`]([$\p{L}\p{N}_.:-]+)[”"」』`]/gu,(whole,name,offset,raw)=>{
    const prefix=raw.slice(0,offset).split(/[。！？!?;；，,\n]/).at(-1);
    return requestedName([prefix+name],name.replace(/^\$/,'')) ? name : whole;
  });
}
