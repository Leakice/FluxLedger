import test from 'node:test';
import assert from 'node:assert/strict';
import { creditLimit, periodEnd, buildFlowModel } from './ledger.js';
import { flowChart } from './charts.js';
const cards=[{id:'a',name:'Daily',last4:'1234',color:'#888'},{id:'b',name:'Travel',last4:'5678',color:'#555'}];
const entries=[
 {id:1,type:'income',card:'a',amount:100,date:'2026-09-01',category:'Salary'},
 {id:2,type:'expense',card:'a',amount:140,date:'2026-09-02',category:'Food & Drinks'},
 {id:3,type:'credit',card:'a',amount:50,date:'2026-08-01',category:'Credit limit'},
 {id:4,type:'credit',card:'a',amount:80,date:'2026-09-03',category:'Credit limit'},
 {id:5,type:'credit',card:'a',amount:200,date:'2026-10-01',category:'Credit limit'},
 {id:6,type:'income',card:'b',amount:25,date:'2026-09-01',category:'Other'}
];
test('credit limit uses latest effective snapshot, not the sum; future limits excluded',()=>{
 assert.equal(creditLimit(entries,'a','2026-09-30'),80);
 assert.equal(creditLimit(entries,'a','2026-08-31'),50);
 assert.equal(creditLimit(entries,'b','2026-09-30'),0);
 assert.equal(creditLimit([...entries,{id:7,type:'credit',card:'a',amount:0,date:'2026-09-03'}],'a','2026-09-30'),0);
});
test('funding contains income and credit only; editing expenses never changes capacity',()=>{
 const model=buildFlowModel(entries.filter(e=>e.date.startsWith('2026-09')),entries,cards,'2026-09-30');
 assert.equal(model.income,125);assert.equal(model.credit,80);assert.equal(model.capacity,205);
 const changed=entries.map(e=>e.id===2?{...e,amount:250}:e);
 const updated=buildFlowModel(changed.filter(e=>e.date.startsWith('2026-09')),changed,cards,'2026-09-30');
 assert.equal(updated.capacity,205);assert.equal(updated.gap,70);
});
test('expense category filtering retains the real funding sources',()=>{
 const model=buildFlowModel(entries,entries,cards,'2026-09-30','Shopping');
 assert.equal(model.income,125);assert.equal(model.credit,80);assert.equal(model.spent,0);
});
test('card selection and edited card details retain stable transaction links',()=>{
 const edited=[{...cards[0],name:'Changed',last4:'9999'}];
 const model=buildFlowModel(entries,entries,edited,'2026-09-30');
 assert.equal(model.income,100);assert.equal(model.credit,80);assert.equal(model.cards[0].spent,140);
 assert.equal(model.cards[0].last4,'9999');
});
test('period end handles leap years and year selection',()=>{
 assert.equal(periodEnd('2024-02','month'),'2024-02-29');
 assert.equal(periodEnd('2026-02','month'),'2026-02-28');
 assert.equal(periodEnd('2026-09','year'),'2026-12-31');
});
test('SVG escapes card names and never fabricates another income source',()=>{
 const model=buildFlowModel(entries,entries,[{...cards[0],name:'<img onerror=x>'}],'2026-09-30');
 const svg=flowChart(model,'Sankey diagram',s=>s);
 assert.ok(svg.includes('Credit limit'));assert.ok(svg.includes('Income'));
 assert.ok(!svg.includes('Other income'));assert.ok(!svg.includes('<img'));
 assert.ok(!/NaN|Infinity/.test(svg));
 const empty=flowChart(buildFlowModel([],[],cards,'2026-09-30'),'Sankey diagram',s=>s);
 assert.ok(!/NaN|Infinity/.test(empty));
});
