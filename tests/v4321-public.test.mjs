import assert from 'node:assert/strict';
import {test} from 'node:test';
import {specialtyMismatch} from '../src/specialty-alignment-v4.mjs';
import {searchSkills} from '../src/advisor-v4.mjs';

// Invented skill inventory and requests for an isolated public regression.
const availability={discovered:true,readable:true,enabled:true,compatible:true,toolsAvailable:null};
const inventory={id:'fixture-skill-stocktake',nameZh:'技能库盘点',summaryZh:'审计技能库、技能索引和技能路由器的覆盖与匹配。',triggers:['技能索引','技能'],sourceId:'example',availability};
const code={id:'fixture-code',nameZh:'fixture-code',summaryZh:'Review program code.',triggers:['代码'],sourceId:'other',availability};
const opts={index:{revision:'example',coverage:{},errors:[],skills:[inventory,code]},source:'example',limit:1,dryRun:true,useFeedback:false,runtimeTools:[],capabilityIndex:{capabilities:[],coverage:{},errors:[]}};
const recommended=query=>searchSkills(query,opts).consultCandidates.some(card=>card.id===inventory.id&&card.suggestedMode!=='skip');

test('direct upgrade objectives can consult a relevant inventory manual',()=>{
  for(const q of ['请升级我的技能索引，并复核代码。','请把技能索引升级并复核代码。']){
    assert.equal(specialtyMismatch(inventory,q,q),null,q);
    assert(recommended(q),q);
  }
});

test('explanation and prohibition are not direct upgrade objectives',()=>{
  for(const q of ['请解释如何升级技能索引，并说明相关代码。','不要升级技能索引，只检查代码。']){
    assert(specialtyMismatch(inventory,q,q),q);
    assert(!recommended(q),q);
  }
});

test('quoted requests do not become active upgrade objectives',()=>{
  const q='参考材料称“升级技能索引并复核代码”，请解释上述代码。';
  assert(specialtyMismatch(inventory,'请解释上述代码',q));
  assert(!recommended(q));
});

test('a sparse cross-language manual can fall below the consultation threshold',
  {todo:'Known in 4.3.19 and 4.3.21: relevant card can be returned with skip mode'},()=>{
    const sparse={...inventory,nameZh:'fixture-skill-stocktake',summaryZh:'Audit agent skill inventory and router coverage.'};
    const sparseOptions={...opts,index:{...opts.index,skills:[sparse,code]}};
    const cards=searchSkills('请升级我的技能索引，并复核代码。',sparseOptions).consultCandidates;
    assert(cards.some(card=>card.id===sparse.id&&card.suggestedMode!=='skip'));
  });
