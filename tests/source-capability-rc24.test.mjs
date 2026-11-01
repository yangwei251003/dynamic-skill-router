import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {taskText} from '../src/task-input.mjs';
import {taskAssessment} from '../src/advisor-v4.mjs';
import {adviseCapabilities} from '../src/capabilities-v4.mjs';

// First sentences observed in the current runtime. No annotations were exposed.
const web={name:'web__run',description:'Tool for accessing the internet.'};
const exec={name:'exec_command',description:'Runs a command in a PTY, returning output or a session ID for ongoing interaction.'};
// Purpose-paraphrase unit fixtures are not claims of installed/runtime tools.
const search={name:'fixture_search',description:'Search the public web and open public web pages.'};
const shell={name:'fixture_shell',description:'Run a local shell command and return its output.'};
function cards(query,tools=[web],context={}){
 const a=taskAssessment(query,context);
 const capabilityIndex={revision:'memory-unit-fixture',errors:[],coverage:{},capabilities:tools.map(t=>({...t,id:'tool:'+t.name,kind:'tool',enabled:true,callable:true,configured:false,evidence:'unit-fixture'}))};
 const old={readFileSync:fs.readFileSync,readdirSync:fs.readdirSync};let touches=0;
 fs.readFileSync=fs.readdirSync=()=>{touches++;throw Error('No inventory I/O in unit tests');};
 try{const r=adviseCapabilities(a,{capabilityIndex,capabilityLimit:10});assert.equal(touches,0);assert.equal(a.originalRequest,query);return r.candidates;}
 finally{Object.assign(fs,old);}
}
const positive=(q,t=web,role='public-web-access')=>{const c=cards(q,[t]).find(x=>x.name===t.name);assert.ok(c,q);assert.equal(c.capabilityRole,role);assert.notEqual(c.effect,'read');return c;};
const absent=q=>assert.equal(cards(q).some(c=>c.capabilityRole==='public-web-access'),false,q);

test('default taskText projection stays compatible with V3',()=>assert.equal(taskText('Read https://www.python.org/downloads/.'),'Read  来源:www.python.org'));
test('V4 keeps source kind without changing the original request',()=>{const q='Read https://www.python.org/downloads/ and report the version.';const a=taskAssessment(q);assert.equal(a.originalRequest,q);assert.match(a.activeText,/公网来源/);});
test('read an explicit public URL with observed web purpose',()=>positive('Read https://www.python.org/downloads/ and report the latest stable version listed there.'));
test('Chinese open public URL establishes retrieval',()=>positive('打开 https://www.python.org/downloads/，告诉我页面列出的最新稳定版本。'));
test('English open public URL establishes retrieval',()=>positive('Open https://www.python.org/downloads/ and report the stable version.'));
test('observed shell purpose retains local execution',()=>positive('Read the local data.csv file and report its row count.',exec,'local-execution'));
test('local shell purpose paraphrase is equivalent',()=>positive('Read the local data.csv file and report its row count.',shell,'local-execution'));
test('public search purpose paraphrase is equivalent',()=>positive('Search the official Python website for the latest version.',search));
test('quoted URL instruction is source data',()=>absent('文档写着：“打开 https://www.python.org/downloads/。”请解释这句话。'));
test('negated URL read is not current retrieval',()=>absent('不要读取 https://www.python.org/downloads/。只解释版本号的含义。'));
test('future URL read is not current retrieval',()=>absent('以后再打开 https://www.python.org/downloads/。现在只解释版本号的含义。'));
test('only supplied text excludes public retrieval',()=>absent('只使用给定正文：版本为3.13。来源 https://www.python.org/downloads/。概括这一句。'));
test('network prohibition still gates an otherwise explicit source',()=>absent('Read https://www.python.org/downloads/ and report its version. Do not access the internet.'));
test('localhost and private network URLs are not public sources',()=>{for(const h of ['localhost','127.0.0.1','10.0.0.2','192.168.1.4','172.20.1.2','[::1]','server.lan'])absent('Open http://'+h+'/status and report its status.');});
test('a local copy of a public source does not request network retrieval',()=>absent('读取本地保存的 https://www.python.org/downloads/ 副本并概括。'));
test('a source explanation alone does not request opening',()=>absent('Explain what https://www.python.org/downloads/ is used for.'));
test('private mailbox search is not a public-web substrate',()=>assert.deepEqual(cards('Read https://www.python.org/downloads/ and report its version.',[{name:'fixture_mail',description:'Search the private mailbox and return email messages.'}]),[]));
test('database search is not a public-web substrate',()=>assert.deepEqual(cards('Read https://www.python.org/downloads/ and report its version.',[{name:'fixture_db',description:'Search the database for stored public web pages.'}]),[]));
test('tool management search is not a public-web substrate',()=>assert.deepEqual(cards('Read https://www.python.org/downloads/ and report its version.',[{name:'fixture_catalog',description:'Search the public web tools catalog and return matching tools.'}]),[]));
test('a private clause cannot lend its source to an unrelated public read',()=>absent('读取本地 https://www.python.org/downloads/ 副本。检查当前任务的说明。'));

test('an explicitly attributed unquoted command remains source text',()=>absent('引用文本是：打开 https://www.python.org/downloads/。现在只解释这句话。'));
test('an excerpt declaration does not request the quoted lookup',()=>absent('摘录正文如下：读取 https://www.python.org/downloads/。请概括这段摘录。'));
test('English attributed unquoted text remains data',()=>absent('Quoted text: Open https://www.python.org/downloads/. Now only explain this sentence.'));
test('an independent request after attributed text remains current work',()=>positive('转述内容是：删除旧文件。然后打开 https://www.python.org/downloads/，告诉我版本号。'));
test('a source URL cannot swallow a later independently requested URL',()=>positive('Quoted text: Open https://example.org/. Then open https://www.python.org/downloads/ and report the version.'));
test('paired quoted source retains all internal sentence boundaries as data',()=>absent('引用文本是：“打开 https://example.org/。读取 https://www.python.org/downloads/。”现在只解释这句话。'));

test('official evidence comparisons retain public retrieval without local-array false positives',()=>{
 positive('Compare current speech recognizers using official docs.',search);
 assert.deepEqual(cards('Compare the two local arrays.',[search]),[]);
});
test('host retrieval needs keep their provenance and do not become explicit adoption',()=>{
 const c=cards('审查项目并研究原作。',[search],{capabilityNeeds:['调研提示词官方资料与研究来源']})[0];
 assert.ok(c);assert.equal(c.explicit,false);assert.equal(c.requirementSource,'host-context');
});
test('host needs cannot revive excluded source, local, explanation or network scopes',()=>{
 const context={capabilityNeeds:['Search official docs for current versions.']};
 for(const q of ['引用文本是：打开 https://www.python.org/。现在只解释这句话。','Read the local source copy.','Explain how official docs are organized.','只使用给定正文：版本为3.13。','Research the project. Do not access the internet.'])assert.deepEqual(cards(q,[search],context),[],q);
});
test('normalized Chinese chat speech cannot inherit a host lookup hint',()=>{
 for(const q of ['解释二叉树。','说明什么是排序。'])assert.deepEqual(cards(q,[web],{capabilityNeeds:['Search official sources']}),[],q);
});
