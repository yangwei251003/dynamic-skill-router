import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'router-open-source-home-'));
fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
fs.writeFileSync(path.join(home,'.codex','config.toml'),'# Isolated empty fixture, not a real account.\n');
// The demo and test wrappers promise the bundled fixture data even when the
// caller has configured a different router data root in their environment.
const env={...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,'.codex'),SKILL_ROUTER_DATA_ROOT:path.join(root,'examples','data'),SKILL_ROUTER_LOG_ROOT:path.join(home,'logs'),SKILL_ROUTER_HOME:home};
try {
 const probe=spawnSync(process.execPath,['--input-type=module','-e','import os from "node:os";process.stdout.write(os.homedir())'],{env,encoding:'utf8'});
 if(probe.stdout!==home)throw new Error('Home isolation failed; refusing to inspect real host configuration.');
 const args=process.argv.slice(2);if(!args.length)throw new Error('Pass Node arguments, for example src/cli.mjs health --contract-version 4 --host generic');
 const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',stdio:'inherit'});
 if(result.error)throw result.error;process.exitCode=result.status??1;
} finally {fs.rmSync(home,{recursive:true,force:true});}
