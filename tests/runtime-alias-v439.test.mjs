import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {discoverSkills, resolveDiscoveredSkill} from "../src/discovery-v4.mjs";

const tempBase=fs.realpathSync(os.tmpdir());
const root=fs.mkdtempSync(path.join(tempBase,"router-alias-v439-"));
function fixture(leaf,name) {
  const dir=path.join(root,leaf);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"SKILL.md"),`---\nname: ${name}\ndescription: Synthetic local document fixture.\n---\n\n# ${name}\n`,"utf8");
  return dir;
}
const one=fixture("one","Shared"),two=fixture("two","Shared"),legacy=fixture("legacy/doc","Legacy");
const item=(id,dir,provider="documents",extra={})=>({id,path:path.join(dir,"SKILL.md"),provider,enabled:true,...extra});
function index(runtimeSkills,{sources=[],registry=[],host="codex"}={}) {
  return discoverSkills({host,sources,registry,runtimeSkills,force:true,snapshotRoot:root});
}
function legacyIndex(runtimeSkills) {
  return index(runtimeSkills,{
    sources:[{id:"legacy",kind:"legacy",root:path.join(root,"legacy"),recursive:true}],
    registry:[{id:"legacy-doc",nameZh:"Legacy",summaryZh:"local",path:legacy,aliases:["old-doc"]}]
  });
}

test.after(()=>{
  const actual=fs.realpathSync(root);
  const relative=path.relative(tempBase,actual);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(actual).startsWith("router-alias-v439-")) {
    throw new Error("Refusing to remove a fixture outside the dedicated temporary directory");
  }
  fs.rmSync(actual,{recursive:true,force:true});
});

test("a current host-qualified ID resolves while the existing generated ID remains valid",()=>{
  const i=index([item("documents:documents",one)]);
  assert.equal(resolveDiscoveredSkill("documents:documents",i).skill.path,one);
  assert.equal(resolveDiscoveredSkill("plugin:documents:documents-documents",i).skill.path,one);
});
test("all enabled host IDs survive physical path deduplication",()=>{
  const i=index([item("documents:documents",one),item("archive:document",one,"archive")]);
  assert.equal(i.skills.length,1);
  assert.equal(resolveDiscoveredSkill("documents:documents",i).skill.path,one);
  assert.equal(resolveDiscoveredSkill("archive:document",i).skill.path,one);
});
test("legacy and enabled runtime origin of the same file retain both IDs",()=>{
  const i=legacyIndex([item("documents:documents",legacy)]);
  assert.equal(resolveDiscoveredSkill("legacy-doc",i).skill.path,legacy);
  assert.equal(resolveDiscoveredSkill("documents:documents",i).skill.path,legacy);
});
test("colliding exact generated IDs return all distinct physical candidates",()=>{
  const i=index([item("documents:tables",one),item("documents-tables",two)]);
  const got=resolveDiscoveredSkill("plugin:documents:documents-tables",i);
  assert.equal(got.found,false);
  assert.equal(got.ambiguous,true);
  assert.equal(got.candidates.length,2);
});
test("same exact runtime ID on distinct physical paths is ambiguous",()=>{
  const i=index([item("documents:shared",one),item("documents:shared",two,"other")]);
  const got=resolveDiscoveredSkill("documents:shared",i);
  assert.equal(got.found,false);
  assert.equal(got.ambiguous,true);
  assert.equal(got.candidates.length,2);
});
test("short aliases for distinct skills remain ambiguous",()=>{
  const i=index([item("documents:first",one),item("documents:second",two)]);
  const got=resolveDiscoveredSkill("Shared",i);
  assert.equal(got.ambiguous,true);
  assert.equal(got.candidates.length,2);
});
test("a disabled runtime ID cannot resolve through an enabled legacy origin",()=>{
  const i=legacyIndex([item("documents:documents",legacy,"documents",{enabled:false})]);
  assert.equal(resolveDiscoveredSkill("legacy-doc",i).skill.path,legacy);
  assert.equal(resolveDiscoveredSkill("documents:documents",i).found,false);
  assert.equal(i.skills.find(s=>s.id==="legacy-doc").aliases.includes("documents:documents"),false);
});
test("a conflicting canonical name does not bypass its disabled runtime identity",()=>{
  const i=index([item("documents:shared",one,"documents",{enabled:false})],{
    sources:[{id:"legacy",kind:"legacy",root:root,recursive:true}],
    registry:[{id:"documents:shared",nameZh:"Legacy Shared",summaryZh:"local",path:one}]
  });
  assert.equal(resolveDiscoveredSkill("documents:shared",i).found,false);
});
test("a runtime identity for another host cannot resolve as currently available",()=>{
  const i=index([item("documents:documents",one,"documents",{host:"codex"})],{host:"workbuddy"});
  assert.equal(resolveDiscoveredSkill("documents:documents",i).found,false);
  assert.equal(i.skills[0].availability.compatible,false);
});
test("contradictory same-host runtime entries for the same ID fail closed",()=>{
  const i=index([item("documents:documents",one),item("documents:documents",one,"documents",{enabled:false})]);
  assert.equal(resolveDiscoveredSkill("documents:documents",i).found,false);
  assert.equal(i.skills[0].aliases.includes("documents:documents"),false);
});
test("an empty supplied runtime inventory does not inherit plugin IDs",()=>{
  const i=index([]);
  assert.equal(i.skills.length,0);
  assert.equal(resolveDiscoveredSkill("documents:documents",i).found,false);
});
test("legacy normalized aliases remain available",()=>{
  const i=legacyIndex([]);
  assert.equal(resolveDiscoveredSkill("OLD DOC",i).skill.id,"legacy-doc");
});

test("qualified runtime IDs do not become punctuation-stripped aliases",()=>{
  const i=index([item("documents:documents",one)]);
  assert.equal(resolveDiscoveredSkill("documentsdocuments",i).found,false);
});
test("a pre-existing normalized legacy alias survives an enabled matching runtime ID",()=>{
  const i=index([item("documents:documents",legacy)],{
    sources:[{id:"legacy",kind:"legacy",root:path.join(root,"legacy"),recursive:true}],
    registry:[{id:"legacy-doc",nameZh:"Legacy",summaryZh:"local",path:legacy,aliases:["documents:documents"]}]
  });
  assert.equal(resolveDiscoveredSkill("DOCUMENTS DOCUMENTS",i).skill.id,"legacy-doc");
});
test("a disabled runtime ID is not restored by a normalized matching legacy alias",()=>{
  const i=index([item("documents:documents",legacy,"documents",{enabled:false})],{
    sources:[{id:"legacy",kind:"legacy",root:path.join(root,"legacy"),recursive:true}],
    registry:[{id:"legacy-doc",nameZh:"Legacy",summaryZh:"local",path:legacy,aliases:["documents:documents"]}]
  });
  assert.equal(resolveDiscoveredSkill("DOCUMENTS DOCUMENTS",i).found,false);
});
test("an exact legacy ID and runtime ID for different files are ambiguous",()=>{
  const i=index([item("documents:shared",one)],{
    sources:[{id:"legacy",kind:"legacy",root:path.join(root,"legacy"),recursive:true}],
    registry:[{id:"documents:shared",nameZh:"Legacy",summaryZh:"local",path:legacy}]
  });
  const got=resolveDiscoveredSkill("documents:shared",i);
  assert.equal(got.ambiguous,true);
  assert.equal(got.candidates.length,2);
});
