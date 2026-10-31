// A short primary-purpose projection keeps incidental workflow vocabulary from
// claiming a specialist capability. It is evidence for routing, not authority.
export function primaryPurpose(skill = {}) {
  return String(skill.summaryZh || skill.description || '').normalize('NFKC')
    .split(/[。；;!?\n]|[.](?=\s|$)/)[0].trim();
}

const languages = /(?<![a-z0-9_])(?:python|javascript|typescript|java|rust|golang|go|cpp|c\+\+|csharp|c#|ruby|dart|swift|kotlin|php|scala|elixir|haskell)(?![a-z0-9_])/gi;
const canonical = value => ({golang:'go',cpp:'c++',csharp:'c#'}[value] || value);
export function languageEvidence(text = '') {
  return [...new Set([...String(text).matchAll(languages)].filter(x=>x[0].toLowerCase()!=='go'
    || /^go$/i.test(String(text).trim()) || /Go(?=\p{Script=Han})/u.test(String(text).slice(x.index))
    || /\bgo\s+(?:code|patch|diff|source|program|language|review|cache|module|test|build|run|idioms|patterns)\b|(?:代码|补丁|源码|语言).{0,8}\bgo\b|golang/i.test(text))
    .map(x=>canonical(x[0].toLowerCase())))];
}

export function applicableLanguages(purpose, request) {
  const supported = languageEvidence(purpose), requested = languageEvidence(request);
  return !supported.length || !requested.length || requested.some(x=>supported.includes(x));
}

export const inspectionAction = /审查|审阅|复核|检查|核验|评审|\b(?:review|audit|inspect|check)\b/i;
export const codeObject = /补丁|代码|源码|差异|改动|\.(?:go|rs|py|js|ts|jsx|tsx|java|cpp|h|cs)\b|\b(?:code|patch|diff|python|javascript|typescript|java|rust|golang|go|cpp|csharp|ruby|dart|swift)\b|\b(?:innerHTML|outerHTML|textContent|eval|document\.write|querySelector|addEventListener|sync\.Mutex|SQL\s+injection)\b/i;
export function inspectionOfCode(text) {
  const value = String(text || '');
  // A request to create an auditing product does not request an audit now.
  if(/^(?:请\s*)?(?:制作|开发|实现|创建|编写|构建|设计|build\b|create\b|implement\b|develop\b|design\b)/i.test(value))return false;
  return inspectionAction.test(value) && codeObject.test(value);
}
