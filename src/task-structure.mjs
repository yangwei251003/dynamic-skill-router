// Advisory task structure. Never use this projection to grant permissions;
// authorization is assessed from the untouched, source-filtered request.
const FORMATS = 'html?|css|jsx?|tsx?|mjs|cjs|py|ps1|sh|jsonl?|ya?ml|toml|txt|md|csv|xlsx?|docx?|pptx?|pdf|tex|png|jpe?g|webp|gif|bmp|tiff?|svg|mp4|mov|mkv|webm|wav|mp3|flac|step|stp|stl|fcstd|geojson|gpkg|shp|canvas';
const file = new RegExp('(?<![a-z0-9_])([a-z0-9_@-]+(?:[.][a-z0-9_@-]+)*)[.]('+FORMATS+')(?=$|[^a-z0-9_])','gi');
const technologyName=/^(?:node|three|next|nuxt|vue|d3|p5|reveal|chart|babylon|pixi|fabric|paper|tone|socket|anime|ember|backbone|require)\.js$/i;
export function semanticTaskText(text) {
  return String(text || '').normalize('NFKC')
    // Qualified source identifiers carry structure, not the meaning of their
    // suffix (e.g. a reference named tax:rate is not tax advice). Keep the
    // original request elsewhere for exact source repair and explicit names.
    .replace(/(?<![a-z0-9_$])(?:[a-z][a-z0-9_-]*:[a-z0-9_-]+)(?![a-z0-9_:/])/gi, value=>
      /^(?:https?|app|plugin):/i.test(value)||/^[a-z]{1,3}\d+:[a-z]{1,3}\d+$/i.test(value)?value:'源码标识符')
    .replace(/(?:[a-z]:[\\/]|\.{1,2}[\\/])[^\s"'<>，。；;]+/gi, path=>{
      const ext=path.match(new RegExp('[.]('+FORMATS+')$','i'))?.[1];
      return ext?'.'+ext.toLowerCase():'本地路径';
    }).replace(file, (match,base,ext) => technologyName.test(match)?match:
    /^skill$/i.test(base)&&/^md$/i.test(ext) ? 'SKILL.md' : '.'+ext.toLowerCase());
}

export const creationAction = /制作|创建|建立|搭建|生成|绘制|编写|开发|实现|设计|构建|整理|做(?:一个|一套|一份)?|\b(?:make|create|build|generate|produce|draw|write|develop|implement|design|prepare)\b/i;
export const modificationAction = /修改|编辑|修复|重构|更新|调整|替换|改版|新增|增加|\b(?:edit|modify|fix|repair|refactor|update|adjust|replace|add)\b/i;
const observes = /读取|查看|审查|检查|核对|审阅|只读|输入文件|源文件|\b(?:read|inspect|review|check|audit|source|input)\b/i;
const delivery = /交付|导出|输出|保存|另存|产出|\b(?:deliver|export|output|save|produce)\b/i;
const preview = /预览|缩略图|截图|读回|验收|检查渲染|\b(?:preview|thumbnail|screenshot|readback|render check)\b/i;
const imageObject = /图片|图像|照片|插画|海报|头像|\b(?:image|photo|picture|illustration|poster|portrait)\b/i;
const imageAction = /(?:生成|制作|画|绘制|设计|编辑|修改|重绘|\b(?:generate|create|draw|design|edit|retouch)\b)[^。；;\n]{0,35}(?:图片|图像|照片|插画|海报|头像|\b(?:image|photo|picture|illustration|poster|portrait)\b)/i;
export function taskStructure(text) {
  const semanticText=semanticTaskText(text);
  const clauses=semanticText.split(/[。！？!?；;\n]+|[.!?](?=\s|$)|\band\s+(?=(?:then\s+)?(?:read|inspect|review|audit|check|create|generate|build|edit|save|export|write|produce)\b)|并(?:且)?(?=另存|保存|导出|生成|制作|创建|新建|编写|读取|审查|审阅|检查)/i).map(x=>x.trim()).filter(Boolean);
  const artifacts=[];
  const needsCreation=clauses.some(x=>creationAction.test(x)||modificationAction.test(x));
  const intentClauses=clauses.map((clause,index)=>{
    // A delivery format need not be a filename: “export PPTX” and “export
    // deck.pptx” have the same output role. Word boundaries avoid identifiers
    // such as jsonParser. Bare formats require an operation in this clause;
    // mentioning a format in an explanation is not an artifact request.
    const formatPattern=(creationAction.test(clause)||modificationAction.test(clause)||delivery.test(clause)||observes.test(clause))
      ? '(?<![a-z0-9_])(?:[.])?('+FORMATS+')(?=$|[^a-z0-9_])'
      : '[.]('+FORMATS+')(?=$|[^a-z0-9_])';
    const formats=[...clause.matchAll(new RegExp(formatPattern,'gi'))].map(m=>m[1].toLowerCase());
    const isPreview=preview.test(clause)&&!imageAction.test(clause);
    for(const format of new Set(formats)) {
      const raster=/^(?:png|jpe?g|webp|gif|bmp|tiff?)$/.test(format);
      const role=isPreview&&raster?'verification':observes.test(clause)&&!delivery.test(clause)&&!creationAction.test(clause)&&!modificationAction.test(clause)?'input':delivery.test(clause)||creationAction.test(clause)||modificationAction.test(clause)?'output':'unspecified';
      artifacts.push({format,role,clauseIndex:index,evidence:clause});
    }
    // A preview image is evidence about another artifact, not a bitmap-creation
    // task. Retain its clause and purpose while excluding the raster format.
    return isPreview?clause.replace(/\.(?:png|jpe?g|webp|gif|bmp|tiff?)(?=$|[^a-z0-9_])/gi,'预览文件'):clause;
  });
  return {semanticText,clauses,artifacts,needsCreation,intentText:intentClauses.join('\n'),advisoryOnly:true};
}

export function hasProducedFormat(text, pattern) {
  const task=taskStructure(text);
  return task.artifacts.some(x=>pattern.test(x.format)&&x.role==='output')
    || task.needsCreation&&task.artifacts.some(x=>pattern.test(x.format)&&x.role==='unspecified');
}
export function requestedRasterWork(text) {
  const task=taskStructure(text);
  // Evaluate action/object pairs in their clause, never across another output.
  return task.clauses.some(clause=>{
    if(imageAction.test(clause))return true;
    if(imageObject.test(clause)&&/(?:图片|照片|image|photo)[^。；;\n]{0,30}(?:编辑|修改|去背景|\bedit\b|\bretouch\b)/i.test(clause))return true;
    const raster=/\.(?:png|jpe?g|webp|gif|bmp|tiff?)(?=$|[^a-z0-9_])/i.test(clause);
    const localEdit=/(?:^|[^可])(?:编辑|修改|修图|重绘|\bedit\b|\bretouch\b)[^.。；;，,\n]{0,70}\.(?:png|jpe?g|webp|gif|bmp|tiff?)(?=$|[^a-z0-9_])/i.test(clause);
    const localCreate=/(?:生成|制作|绘制|画|设计|\b(?:generate|create|draw|design)\b)[^.。；;，,\n]{0,40}\.(?:png|jpe?g|webp|gif|bmp|tiff?)(?=$|[^a-z0-9_])/i.test(clause)
      && !/图表|曲线|误差图|折线|柱状|散点|\b(?:plot|chart|graph|curve|histogram)\b/i.test(clause);
    return raster&&(localEdit||localCreate&&!preview.test(clause)||/抠图|去背景|替换.{0,20}背景|背景.{0,20}(?:替换|换成)|\breplace\b.{0,25}\bbackground\b/i.test(clause));
  });
}
