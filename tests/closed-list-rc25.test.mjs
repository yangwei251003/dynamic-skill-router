import test from 'node:test';
import assert from 'node:assert/strict';
import {closedChatTask} from '../src/chat-task-closure.mjs';
import {taskAssessment,routeTaskV4} from '../src/advisor-v4.mjs';
import {useFastPath} from '../src/recovery-v4.mjs';

// Synthetic development fixtures; not independent acceptance evidence.
export const examples=[
 ['synthetic ordinal labels',true,'按数字从小到大排列这四项：第 26 号、第 5 号、第 61 号、第 11 号。不要补充说明。'],
 ['descending finite values',true,'请按数字从大到小排列以下三个数值：-2.5、+7、0。只输出结果。'],
 ['English ascending labels',true,'Sort these three items in ascending numerical order: item 12, item -4, item 2. Return only the result.'],
 ['unknown operand',false,'按数字从小到大排列这四项：第 26 号、第 5 号、未知、第 11 号。'],
 ['file input',false,'按数字从小到大排列 input.csv 中这四项。'],
 ['URL input',false,'Sort the numbers at https://example.test/numbers in ascending order.'],
 ['file output',false,'按数字从小到大排列这三项：18、3、9。保存到 output.txt。'],
 ['visualization code',false,'用 JavaScript 制作排序可视化代码，按数字从小到大排列这三项：18、3、9。'],
 ['independent action',false,'Sort these three items in ascending numerical order: item 12, item -4, item 2. Then send the result to Ada.'],
 ['high stakes',false,'按药物剂量从小到大排列这三项：18、3、9。'],
 ['named capability',false,'请使用 fixture_sort 按数字从小到大排列这三项：18、3、9。'],
 ['incorrect cardinality',false,'按数字从小到大排列这四项：第 26 号、第 5 号、第 11 号。'],
];

for(const [label,expected,query] of examples)test(label,()=>{
 const witness=closedChatTask(query);
 assert.equal(!!witness,expected,query);
 const options={host:'codex',contractVersion:4,runtimeTools:[{name:'fixture_sort',description:'Sort numeric values.',available:true}]};
 assert.equal(useFastPath(taskAssessment(query),options,{triggered:false}),expected,query);
 if(!expected)return;
 assert.equal(witness.kind,'supplied-numeric-sort');
 assert.equal(witness.chatOnly,true);
 assert.equal(witness.inputCount,label==='synthetic ordinal labels'?4:3);
 let touches=0;
 for(const key of ['index','capabilityIndex'])Object.defineProperty(options,key,{get(){touches++;throw Error('unexpected inventory access');}});
 const result=routeTaskV4(query,options);
 assert.equal(result.performance.mode,'fast');
 assert.equal(result.performance.scannedSkills,false);
 assert.equal(result.performance.scannedCapabilities,false);
 assert.equal(touches,0);
 assert.equal(result.task.originalRequest,query);
 assert.deepEqual(result.consultCandidates,[]);
 assert.deepEqual(result.capabilityCandidates,[]);
});

test('forced discovery and recovery retain priority over numeric closure',()=>{
 const assessment=taskAssessment(examples[0][2]);
 assert.equal(useFastPath(assessment,{routingMode:'full'},{triggered:false}),false);
 assert.equal(useFastPath(assessment,{nativeSufficient:true},{triggered:true}),false);
});
