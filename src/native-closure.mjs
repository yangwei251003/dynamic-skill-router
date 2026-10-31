import {closedSuppliedProse} from './supplied-prose.mjs';
// A small, no-I/O grammar for supplied-data transformations. A successful
// parse is a closure witness, not permission to execute or discover anything.
const TOKEN = '\\uE000\\d+\\uE001';
const AGGREGATE = '中位数|平均值|均值|总和|最大值|最小值|median|mean|average|sum|maximum|minimum';
const UNKNOWN = /^(?:未知|未(?:知|给出|提供)|待定|缺失|若干|一些|unknown|unspecified|missing|null|undefined|[?？]+)$/i;
const incomplete = value => UNKNOWN.test(value.trim()) || /\.\.\.|…/.test(value);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function suppliedLiterals(raw) {
  if (!raw || raw.length > 1200 || /[\uE000\uE001]/.test(raw)) return null;
  const values = [];
  // Only paired literals are replaced. Unmatched quotation marks stay in the
  // instruction and cannot satisfy any complete operation below.
  const instruction = raw.normalize('NFKC').replace(/“[^”\n]{1,800}”|「[^」\n]{1,800}」|『[^』\n]{1,800}』|‘[^’\n]{1,800}’|"[^"\n]{1,800}"|'[^'\n]{1,800}'/g, value => {
    const token = `\uE000${values.length}\uE001`;
    values.push(value.slice(1,-1));
    return token;
  });
  return {instruction, values};
}

function literal(value, values) {
  const token = /^\uE000(\d+)\uE001$/.exec(value.trim());
  return token ? values[Number(token[1])] : null;
}

function declaredCount(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '一二三四五六七八九';
  if (digits.includes(value) && value.length === 1) return digits.indexOf(value) + 1;
  if (value === '两') return 2;
  if (value === '十') return 10;
  if (/^十[一二三四五六七八九]$/.test(value)) return 11 + digits.indexOf(value[1]);
  if (value === '二十') return 20;
  return NaN;
}

function numberList(source, values) {
  source = (literal(source, values) ?? source).trim();
  let count;
  const declared = /^(?:([\d一二三四五六七八九十两]+)个)?(?:数字|数值|数)\s*[:：]?\s*/.exec(source)
    || /^(?:(\d+)\s+)?(?:numbers|values)\s*:?\s*/i.exec(source);
  if (declared) {
    if (declared[1]) count = declaredCount(declared[1]);
    source = source.slice(declared[0].length);
  }
  if (/^\[[\s\S]*\]$/.test(source)) source = source.slice(1,-1).trim();
  const parts = source.split(/\s*[,，、;；]\s*/);
  return parts.length >= 1 && parts.length <= 20 && (count === undefined || count === parts.length)
    && parts.every(value => /^[+-]?\d+(?:\.\d+)?$/.test(value)
      && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e9);
}

function textList(source, values) {
  const quoted = literal(source, values);
  const parts = (quoted ?? source).split(/\s*[,，、;；]\s*/);
  if (parts.length < 2 || parts.length > 20) return false;
  return parts.every(part => {
    const item = (quoted === null ? literal(part, values) ?? part : part).trim();
    // Unquoted operands must be scalar words, never descriptions of an absent
    // collection. Quoted items may contain arbitrary words, including tool names.
    return item.length > 0 && item.length <= 80 && !incomplete(item)
      && (quoted !== null || literal(part, values) !== null || /^[\p{L}\p{N}_-]+$/u.test(item));
  });
}

function fieldPresent(source, field, values) {
  const text = literal(source, values);
  field = (literal(field, values) ?? field).trim();
  if (text === null || !/^[\p{L}\p{N}][\p{L}\p{N}_ -]{0,29}$/u.test(field)) return false;
  // Bind the requested label to a supplied record value. Merely mentioning a
  // label elsewhere does not prove that the requested input was supplied.
  const record = new RegExp('(?:^|[;；,，\\n])\\s*' + escape(field)
    + '\\s*(?:[:：=]\\s*([^;；,，\\n]+)|(?=[A-Za-z0-9])([^;；,，\\n]+))', 'i').exec(text);
  const value = (record?.[1] ?? record?.[2] ?? '').trim();
  return !!value && !incomplete(value);
}

// Modifiers must be complete suffixes. In particular, an output instruction
// cannot consume a following lookup, explanation, file write or second task.
const OUTPUT = /[,，;；]\s*(?:(?:只)?(?:输出|返回|给出|给)\s*(?:结果|答案|这个数|数值|数字|(?:逗号|顿号|空格)分隔的[\p{L}\p{N}_-]{1,12})|(?:return|output|give)\s+(?:only\s+)?(?:the\s+)?(?:result|answer|value|number|(?:comma|space)[- ]separated\s+(?:values|items|words)))\s*$/iu;
const ORDER = /(?:[,，;；]|并且|并|\s+and\s+)?\s*(?:保留|保持)(?:首次(?:出现)?|第一次出现|原有|原|输入)顺序\s*$|(?:[,;]|\s+and\s+)?\s*(?:preserve|preserving|keep|keeping)\s+(?:(?:the\s+)?(?:original|input)\s+order|(?:the\s+)?first[- ]occurrence\s+order)\s*$/i;
const PROHIBITION = /[,，;；]\s*(?:(?:不|不要|禁止|无需|不必)(?:联网|(?:查询|访问|检索)(?:任何|外部|其他)?(?:系统|数据库|网站|网页|资料)|(?:使用|调用)(?:任何|外部)?(?:工具|插件))|without\s+(?:network\s+access|external\s+lookups?|tools))\s*$/i;

export function closedSuppliedTransformation(raw) {
  const prose = closedSuppliedProse(raw);
  if (prose) return prose;
  const supplied = suppliedLiterals(String(raw || '').trim());
  if (!supplied) return null;
  const {values} = supplied;
  let text = supplied.instruction.trim().replace(/[。.!?？！]+$/,'').trim()
    .replace(/^(?:(?:请|帮我|直接)\s*)+/,'').replace(/^please\s+/i,'');
  // A precisely scoped prohibition only removes authority; it is never treated
  // as a requested lookup. Keep the untouched original request in assessment.
  text = text.replace(PROHIBITION,'');
  const instructionText = text;
  text = text.replace(OUTPUT,'');
  const withoutOrder = text.replace(ORDER,'');
  const ordered = withoutOrder !== text;
  text = withoutOrder;

  let match = /^(?:把|将|对)\s*(.+?)\s*(?:进行)?(?:去重|去掉重复项|删除重复项)$/.exec(text)
    || /^(?:去重|deduplicate)\s*[:：]?\s*(.+)$/i.exec(text)
    || /^remove\s+duplicates\s+from\s+(.+)$/i.exec(text);
  if (match && textList(match[1], values)) return {kind:'deduplicate', instructionText};
  if (ordered) return null;

  match = new RegExp('^(?:给定|已给出|given)\\s*(.+?)[,，;；]\\s*(?:求|计算|calculate|compute|find)\\s*(?:the\\s+)?(' + AGGREGATE + ')$', 'i').exec(text)
    || new RegExp('^(?:求|计算)?\\s*(.+?)\\s*的\\s*(' + AGGREGATE + ')(?:是多少|为多少)?$', 'i').exec(text);
  if (match && numberList(match[1], values)) return {kind:'aggregate', instructionText};
  match = new RegExp('^(?:calculate|compute|find)\\s+(?:the\\s+)?(' + AGGREGATE + ')\\s+(?:of|for)\\s+(.+)$','i').exec(text);
  if (match && numberList(match[2], values)) return {kind:'aggregate', instructionText};

  match = new RegExp('^(?:给定|已给出)\\s*(' + TOKEN + ')\\s*[,，;；]\\s*(?:只)?(?:输出|返回|给出)\\s*(.+)$').exec(text)
    || new RegExp('^从\\s*(' + TOKEN + ')\\s*(?:中|里)\\s*(?:提取|摘出)\\s*(.+)$').exec(text)
    || new RegExp('^given\\s*(' + TOKEN + ')\\s*[,;]\\s*(?:return|output)\\s+(?:only\\s+)?(?:the\\s+)?(.+)$','i').exec(text);
  if (match && fieldPresent(match[1],match[2],values)) return {kind:'field', instructionText};
  match = new RegExp('^(?:extract|return|output)\\s+(?:the\\s+)?(.+?)\\s+from\\s*(' + TOKEN + ')$','i').exec(text);
  if (match && fieldPresent(match[2],match[1],values)) return {kind:'field', instructionText};
  return null;
}
