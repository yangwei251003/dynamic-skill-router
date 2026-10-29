import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'router-open-source-home-'));
fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
fs.writeFileSync(path.join(home,'.codex','config.toml'),'# Isolated empty fixture, not a real account.\n');
const env={...process.env,SKILL_ROUTER_LOG_ROOT:path.join(home,'logs'),SKILL_ROUTER_STATE_ROOT:path.join(home,'logs'),SKILL_ROUTER_HOME:home,SKILL_ROUTER_DISABLE_BACKGROUND_REFRESH:'1'};
try {
 const probe=spawnSync(process.execPath,['--input-type=module','-e','process.stdout.write(process.env.SKILL_ROUTER_HOME || "")'],{env,encoding:'utf8'});
 if(probe.stdout!==home)throw new Error('Router path isolation failed; refusing to inspect real host configuration.');
 const args=process.argv.slice(2);if(!args.length)throw new Error('Pass Node arguments, for example src/cli.mjs health --contract-version 4 --host generic');
 const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',stdio:'inherit'});
 if(result.error)throw result.error;process.exitCode=result.status??1;
} finally {
 const resolved=path.resolve(home),temporaryRoot=path.resolve(os.tmpdir());
 if(path.dirname(resolved)!==temporaryRoot || !path.basename(resolved).startsWith('router-open-source-home-'))throw new Error('Refusing cleanup outside the dedicated temporary root.');
 fs.rmSync(resolved,{recursive:true,force:true});
}
