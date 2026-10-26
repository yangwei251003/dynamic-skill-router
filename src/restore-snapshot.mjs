import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROUTER_ROOT, GLOBAL_ROOT, REGISTRY_PATH} from './paths.mjs';

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inside = (file, root) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const defaultRoots = [ROUTER_ROOT, REGISTRY_PATH, path.join(GLOBAL_ROOT,'用户偏好.md'), ...['.codex/AGENTS.md','.workbuddy/CODEBUDDY.md','.gemini/GEMINI.md','.claude/CLAUDE.md'].map(p=>path.join(os.homedir(),p))];
function canonical(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  const parent=path.dirname(file); return parent===file ? file : path.join(canonical(parent),path.basename(file));
}
export function restoreSnapshot(snapshotPath, {apply=false, allowedRoots=defaultRoots}={}) {
  const snapshot=fs.realpathSync(snapshotPath);
  const entries=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json'),'utf8').replace(/^\uFEFF/,''));
  const newPath=path.join(snapshot,'created-files.json');
  const created=fs.existsSync(newPath)?JSON.parse(fs.readFileSync(newPath,'utf8')):[];
  const roots=allowedRoots.map(p=>canonical(path.resolve(p)));
  const checked=[];
  for(const entry of [...entries,...created.map(original=>({original,existed:false}))]) {
    const target=path.resolve(entry.original);
    if(!roots.some(root=>inside(canonical(target),root))) throw new Error(`Target outside release scope: ${target}`);
    const source=entry.existed?path.resolve(snapshot,entry.backup):null;
    if(source && (!inside(canonical(source),snapshot) || digest(source)!==entry.sha256.toLowerCase())) throw new Error(`Backup checksum/path failed: ${source}`);
    if(!checked.some(x=>x.target===target)) checked.push({target,source,action:source?'restore':'quarantine-if-present'});
  }
  if(!apply) return {dryRun:true,verified:true,files:checked};
  const rescue=path.join(snapshot,`before-restore-${Date.now()}`);
  fs.mkdirSync(rescue,{recursive:true});
  // Preserve every current file before changing any target. No directory is deleted.
  const journal=checked.map((item,i)=>({...item,rescue:path.join(rescue,`${i}.bak`),present:fs.existsSync(item.target)}));
  for(const item of journal) if(item.present) fs.copyFileSync(item.target,item.rescue);
  fs.writeFileSync(path.join(rescue,'journal.json'),JSON.stringify(journal,null,2));
  for(const item of journal) {
    if(item.source) { fs.mkdirSync(path.dirname(item.target),{recursive:true}); fs.copyFileSync(item.source,item.target); }
    else if(item.present) fs.unlinkSync(item.target);
  }
  return {restored:true,files:checked.length,rescue};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { const snapshot=process.argv.slice(2).find(x=>!x.startsWith('--')); if(!snapshot) throw new Error('Usage: node src/restore-snapshot.mjs SNAPSHOT [--apply]'); console.log(JSON.stringify(restoreSnapshot(snapshot,{apply:process.argv.includes('--apply')}),null,2)); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
