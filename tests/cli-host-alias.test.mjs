import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const CLI=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','src','cli.mjs');

test('CLI aliases and canonical host share the hook discovery cache key',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'router-cli-host-'));
  try{
    const options={sources:[],registry:[],runtimeSkills:[],pluginConfigPath:path.join(root,'absent-config.toml'),pluginCacheRoot:path.join(root,'absent-cache')};
    function refresh(extraOptions,args=[]){
      const run=spawnSync(process.execPath,[CLI,'refresh-index','--input-json',...args],{
        input:JSON.stringify({options:{...options,...extraOptions}}),encoding:'utf8',windowsHide:true,timeout:10000,
        env:{...process.env,SKILL_ROUTER_STATE_ROOT:root,SKILL_ROUTER_DISABLE_BACKGROUND_REFRESH:'1'},
      });
      assert.equal(run.status,0,run.stderr);
      const output=JSON.parse(run.stdout);
      const persisted=JSON.parse(fs.readFileSync(output.outputPath,'utf8'));
      return {outputPath:output.outputPath,key:JSON.parse(persisted._cache.key)};
    }
    const canonical=refresh({host:'antigravity'});
    const jsonAlias=refresh({host:'gemini'});
    const flagAlias=refresh({host:'codex'},['--host','gemini']);
    assert.equal(jsonAlias.outputPath,canonical.outputPath);
    assert.equal(flagAlias.outputPath,canonical.outputPath);
    assert.equal(jsonAlias.key.host,'antigravity');
    assert.equal(flagAlias.key.host,'antigravity');
    assert.equal(refresh({}).key.host,'codex','omitted host keeps existing discovery default');
    assert.equal(refresh({host:'codex'}).key.host,'codex','canonical hosts are unchanged');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
});
