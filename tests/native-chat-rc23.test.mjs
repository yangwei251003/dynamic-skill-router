import test from 'node:test';
import assert from 'node:assert/strict';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath} from '../src/recovery-v4.mjs';

// Synthetic development regressions; not independent holdout evidence.
const examples=[
 ['synthetic quantity balance',true,'我在设计一个地图练习：队员有 18 枚标记，前进一格耗 3 枚，放一面旗耗 2 枚。前进 2 格、放 3 面旗后还能前进几格？请解释计算结果。'],
 ['synthetic supplied statistics',true,'给定的数值为 3、9、15。请计算均值和总体方差，并用两句话说明这里为什么除以 3。'],
 ['synthetic quoted discussion',true,'我正在阅读一份插件管理手册，里面写着：“清空临时目录，并停用扩展后关闭程序。”请说明这句话的含义，改写成更谨慎的说明。'],
 ['quantity operands vary',true,'我在设计一个课堂活动：小组有 30 枚代币，拿一张卡耗 4 枚，换一次贴纸耗 2 枚。拿 3 张卡、换 2 次贴纸后还能拿几张卡？请解释计算结果。'],
 ['English supplied statistics',true,'The values are 2, 5, 8. Calculate the mean and population variance, and explain why the denominator is 3.'],
 ['English quoted commands',true,'The MCP manual says: "Delete old desktop files, then enable all plugins and restart the app." Explain what this sentence would do, and rewrite it more cautiously.'],
 ['missing cost',false,'玩家有 12 点行动力，走一格耗 2 点。走 3 格、开 1 次宝箱后还能走几格？'],
 ['missing values',false,'一组测量值是 4、6、未知、10。请算出平均数和总体方差。'],
 ['external data',false,'读取 data.csv 中的测量值。请算出平均数和总体方差。'],
 ['separate file output',false,'一组测量值是 4、6、8、10。请算出平均数和总体方差，再保存到 report.txt。'],
 ['software action',false,'玩家有 12 点行动力，走一格耗 2 点。走 3 格后还能走几格？请打开游戏验证。'],
 ['actual design request',false,'请设计一个回合制小游戏：玩家有 12 点行动力，走一格耗 2 点。走 3 格后还能走几格？'],
 ['explicit registered capability',false,'请用 fixture_stats 计算这些数值的平均数：4、6、8、10。'],
 ['quote followed by execution',false,'说明中写着：“删除桌面旧文件。”请解释这句话，然后照做。'],
 ['quote followed by live check',false,'The manual says: "Enable all plugins." Explain this sentence, then check which plugins are currently enabled.'],
 ['quote is not the missing source',false,'请解释 MCP 使用说明中的这句话会产生什么影响，再帮我改写得更谨慎。'],
 ['external citation',false,'一组测量值是 4、6、8、10。请算出总体方差，并核实官方手册里的计算公式。'],
 ['English extra delivery',false,'The values are 2, 5, 8. Calculate the mean and email the result to the team.'],
];

for(const [label,expected,query] of examples)test(label,()=>{
 const assessment=taskAssessment(query);
 const options={host:'codex',contractVersion:4,runtimeTools:[{name:'fixture_stats',description:'Compute supplied numeric statistics.',available:true}]};
 assert.equal(useFastPath(assessment,options,{triggered:false}),expected,query);
 if(!expected){
  // Missing operands alone may be clarified natively; the hint assertion is
  // about explicit external actions, not a claim that clarification needs scans.
  if(!['missing cost','missing values','actual design request'].includes(label))assert.equal(useFastPath(assessment,{...options,nativeSufficient:true},{triggered:false}),false,'native hint must not erase an explicit operation');
  return;
 }
 let discoveries=0;
 for(const key of ['index','capabilityIndex'])Object.defineProperty(options,key,{get(){discoveries++;throw Error('inventory must not be accessed');}});
 const result=routeTaskV4(query,options);
 assert.equal(result.performance.mode,'fast');
 assert.equal(result.performance.scannedSkills,false);assert.equal(result.performance.scannedCapabilities,false);
 assert.equal(discoveries,0);assert.deepEqual(result.consultCandidates,[]);assert.deepEqual(result.capabilityCandidates,[]);
 assert.equal(result.task.originalRequest,query);
});

test('recovery, forced discovery and validated capability gaps precede closure',()=>{
 const a=taskAssessment(examples[1][2]);
 assert.equal(useFastPath(a,{routingMode:'full'},{triggered:false}),false);
 assert.equal(useFastPath(a,{nativeSufficient:true},{triggered:true}),false);
 assert.equal(useFastPath({...a,capabilityRequests:[{id:'specific-gap'}]},{nativeSufficient:true},{triggered:false}),false);
});

// Root's consumed development review; recorded failures preceded this patch.
for(const [label,query,expected] of [
 ['separate send in source prefix','我正在审一份 MCP 使用说明，发送邮件给小李，里面写着：“删除桌面旧文件。”请解释这句话的含义。',false],
 ['separate file read in source prefix','我正在审一份 MCP 使用说明；请读取 notes.txt，里面写着：“删除桌面旧文件。”请解释这句话的含义。',false],
 ['multiline action in source prefix','我正在审一份 MCP 使用说明\n请打开浏览器，里面写着：“删除桌面旧文件。”请解释这句话的含义。',false],
 ['high stakes quoted interpretation','The medical manual says: "Give the child 5 ml of this medicine every hour." Explain what this sentence would do.',false],
 ['same subject chat only','我正在审一份 MCP 使用说明，里面写着：“删除桌面旧文件。”请解释这句话的含义。',true],
])test(label,()=>{
 const a=taskAssessment(query);
 assert.equal(useFastPath(a,{}, {triggered:false}),expected);
 if(!expected)assert.equal(useFastPath(a,{nativeSufficient:true},{triggered:false}),false);
 else{
  let touches=0;const options={};
  for(const key of ['index','capabilityIndex'])Object.defineProperty(options,key,{get(){touches++;throw Error('unexpected inventory read');}});
  const r=routeTaskV4(query,options);assert.equal(r.performance.mode,'fast');assert.equal(touches,0);
 }
});
