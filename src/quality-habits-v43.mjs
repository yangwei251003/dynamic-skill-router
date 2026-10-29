import {createHash} from 'node:crypto';

const OUTER = 'dynamic-skill-router-v4';
const INNER = 'dynamic-skill-router-quality-v43';
const marker = (name, edge) => `<!-- ${name}:${edge} -->`;
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

// A small supplement to the existing rules, not a replacement for their hard
// constraints. Deliberately does not embed the twelve prompts or upgrade brief.
const HABITS = [
  '`taskContext` 用于解释和补足当前请求，不产生新授权；宿主支持时用 `invocationContext` 收紧当前阶段与允许动作。方法建议可为空，只按具体缺口选择，允许跳过或弃用，不把任务改成固定问卷或长流程。',
  '有助于当前成果时，主动获取优秀范例和一手资料，核对来源、适用性与许可后落实到产物。主动探索最多同时两条独立线，累计不超过已明确任务预算的 20%；上限不是配额，无明确预算不虚构百分比，证据足够或无新信息即停，不借探索扩大授权。',
  '验收以最终产物、实际运行和必要读回为据；只对有证据的尝试提交 `report_outcome`，结果未验证可记 `unknown`，不把未调用当失败。全局只存用户明确的稳定偏好，经核实的项目事实归对应项目，临时假设不永久化；记录来源、范围与时效，新证据优先。',
].join('\n\n');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function occurrences(content, needle) {
  const positions = [];
  let offset = 0;
  while ((offset = content.indexOf(needle, offset)) !== -1) {
    positions.push(offset);
    offset += needle.length;
  }
  return positions;
}

function standalone(content, start, end) {
  return (start === 0 || content[start - 1] === '\n' || start === 1 && content[0] === '\uFEFF')
    && (end === content.length || content[end] === '\n' || content.slice(end, end + 2) === '\r\n');
}

function findPair(content, name, required) {
  const begin = marker(name, 'begin');
  const end = marker(name, 'end');
  const begins = occurrences(content, begin);
  const ends = occurrences(content, end);
  const prefixes = occurrences(content, `<!-- ${name}:`);
  if (prefixes.length !== begins.length + ends.length || begins.length > 1 || ends.length > 1
    || begins.length !== ends.length || required && begins.length !== 1) {
    fail('INVALID_RULE_MARKERS', `Expected ${required ? 'one complete' : 'zero or one complete'} ${name} marker pair.`);
  }
  if (!begins.length) return null;
  const start = begins[0];
  const endStart = ends[0];
  const finish = endStart + end.length;
  if (start >= endStart || !standalone(content, start, start + begin.length) || !standalone(content, endStart, finish)) {
    fail('INVALID_RULE_MARKERS', `The ${name} markers are reversed or not on standalone lines.`);
  }
  return {start, endStart, finish};
}

function inspect(content) {
  if (typeof content !== 'string') fail('INVALID_RULE_CONTENT', 'Rule content must be a string.');
  const outer = findPair(content, OUTER, true);
  const inner = findPair(content, INNER, false);
  if (inner && (inner.start <= outer.start || inner.finish >= outer.endStart)) {
    fail('INVALID_RULE_MARKERS', 'The quality-habits block must be inside the dynamic router block.');
  }
  return {outer, inner};
}

function newlineFor(content, outer) {
  const body = content.slice(outer.start, outer.finish);
  return body.includes('\r\n') ? '\r\n' : '\n';
}

function qualityBlock(newline) {
  return `${marker(INNER, 'begin')}${newline}${HABITS.replace(/\n/g, newline)}${newline}${marker(INNER, 'end')}`;
}

function hanCount(content) {
  return (content.match(/\p{Script=Han}/gu) || []).length;
}

/**
 * Pure, minimal global-rule transformation. It inserts one owned child block
 * and preserves every existing byte of text. Never writes a file or installs.
 * Keep the first changed result's snapshot; an idempotent call returns null.
 */
export function mergeQualityHabits(content) {
  const {outer, inner} = inspect(content);
  const newline = newlineFor(content, outer);
  const block = qualityBlock(newline);
  if (hanCount(HABITS) > 600) fail('QUALITY_HABITS_TOO_LARGE', 'The quality supplement exceeds 600 Han characters.');
  if (inner) {
    const current = content.slice(inner.start, inner.finish);
    if (current !== block) fail('QUALITY_HABITS_CONFLICT', 'The existing owned quality block has changed; refusing to replace it.');
    return {content, changed:false, addedHanCharacters:0, snapshot:null};
  }
  const inserted = block + newline;
  const merged = content.slice(0, outer.endStart) + inserted + content.slice(outer.endStart);
  const snapshot = {
    schemaVersion:1,
    outerMarker:OUTER,
    ownedMarker:INNER,
    operation:'insert',
    insertedBlock:block,
    trailingSeparator:newline,
    insertedSha256:hash(inserted),
    originalRouterBlockSha256:hash(content.slice(outer.start, outer.finish)),
    baselineContentSha256:hash(content),
    candidateContentSha256:hash(merged),
  };
  return {content:merged, changed:true, addedHanCharacters:hanCount(HABITS), snapshot};
}

/**
 * Remove only this insertion if it is still unchanged. Later edits to other
 * router paragraphs or external sections survive, including new video rules.
 * Snapshot hashes describe provenance; whole-document equality is not required.
 */
export function restoreQualityHabits(content, snapshot) {
  const {inner} = inspect(content);
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.outerMarker !== OUTER
    || snapshot.ownedMarker !== INNER || snapshot.operation !== 'insert'
    || !['\n', '\r\n'].includes(snapshot.trailingSeparator)
    || typeof snapshot.insertedBlock !== 'string'
    || snapshot.insertedBlock !== qualityBlock(snapshot.trailingSeparator)
    || snapshot.insertedSha256 !== hash(snapshot.insertedBlock + snapshot.trailingSeparator)) {
    fail('INVALID_RULE_SNAPSHOT', 'The restoration snapshot is invalid or belongs to another managed rule block.');
  }
  if (!inner) return {content, changed:false};
  const actual = content.slice(inner.start, inner.finish);
  const suffix = content.slice(inner.finish, inner.finish + snapshot.trailingSeparator.length);
  if (actual !== snapshot.insertedBlock || suffix !== snapshot.trailingSeparator) {
    fail('QUALITY_HABITS_CONFLICT', 'The inserted quality block or its separator changed; refusing to overwrite concurrent edits.');
  }
  return {
    content:content.slice(0, inner.start) + content.slice(inner.finish + snapshot.trailingSeparator.length),
    changed:true,
  };
}
