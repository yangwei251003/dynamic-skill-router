import assert from 'node:assert/strict';
import {routeTaskV4,searchSkills} from '../src/advisor-v4.mjs';
const availability={discovered:true,readable:true,enabled:true,compatible:true};
const index=[
 {id:'plugin:plugin-creator:create-plugin',name:'create-plugin',sourceId:'plugin:plugin-creator',summaryZh:'Create Codex plugins',availability},
 {id:'plugin-creator',name:'plugin-creator',sourceId:'legacy',summaryZh:'Create Qoder plugins',availability},
];
const query='[$plugin-creator](app://connector_openai_plugin_creator) 请升级动态技能路由器成为插件';
const result=routeTaskV4(query,{index,host:'codex',routeId:'plugin-test'});
assert(result.consultCandidates.some(x=>x.id===index[0].id&&x.explicit));
assert(!result.consultCandidates.some(x=>x.id==='plugin-creator'));
for(const prefix of ['不要使用 ','以后使用 ','示例：','“']) {
 const r=routeTaskV4(prefix+query+(prefix==='“'?'”':''),{index});
 assert(!r.consultCandidates.some(x=>x.explicit),prefix);
}
const noRuntime=routeTaskV4(query,{index:[index[1]]});
assert(noRuntime.consultCandidates.some(x=>x.explicit));
const follow=searchSkills('创建插件',{index,routeId:result.routeId});
assert.equal(follow.routeId,result.routeId);
console.log('PASS: plugin mentions, provider identity, negative/future/example/quoted scope, routeId reuse');
