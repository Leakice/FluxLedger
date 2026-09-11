import test from 'node:test';
import assert from 'node:assert/strict';
import { creditLimit, periodEnd, buildFlowModel, creditAccountCards, onlineBalanceCards, withBuiltInAccountCards, resolveCreditAccountCard, findLoanCard } from './ledger.js';
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
test('every built-in credit and online-balance account has one no-last-four card',()=>{
 const expected=[...creditAccountCards,...onlineBalanceCards];
 const cards=withBuiltInAccountCards([]);
 assert.equal(cards.length,expected.length);
 assert.ok(cards.filter(card=>expected.some(expectedCard=>expectedCard.id===card.id)).every(card=>card.last4===''));
 assert.deepEqual(cards.map(card=>card.name).sort(),expected.map(card=>card.name).sort());
 assert.ok(!withBuiltInAccountCards([],['online-wechat']).some(card=>card.id==='online-wechat'));
});

test('built-in migration preserves a name-matched card ID and does not add a duplicate',()=>{
 const persisted={id:'legacy-user-id',name:'白条',last4:'1234',network:'Visa',color:'#123456'};
 const migrated=withBuiltInAccountCards([persisted]);
 const matches=migrated.filter(card=>card.name==='白条');
 assert.equal(matches.length,1);
 assert.equal(matches[0].id,'legacy-user-id');
 assert.ok(!migrated.some(card=>card.id==='credit-baitiao'));
 const model=buildFlowModel([{...entries[0],card:'legacy-user-id'}],[],migrated,'2026-09-30');
 assert.equal(model.cards.find(card=>card.id==='legacy-user-id').income,100);
});

test('credit account selection resolves a migrated legacy ID from runtime cards',()=>{
 const legacy={id:'legacy-baitiao-id',name:'白条',last4:'',noLast4:true,network:'Other',accountType:'Credit card',color:'#123456'};
 const migrated=withBuiltInAccountCards([legacy]);
 assert.equal(resolveCreditAccountCard(migrated,'白条'),migrated.find(card=>card.id===legacy.id));
 assert.equal(resolveCreditAccountCard(migrated,'白条').id,'legacy-baitiao-id');
 assert.ok(!migrated.some(card=>card.id==='credit-baitiao'));
});

test('loan identity prefers the restored entry card and never needs a duplicate',()=>{
 const loan={id:'loan-legacy',name:'Alice',last4:'',network:'借款',color:'#627084',loanBorrower:'Alice'};
 assert.equal(findLoanCard([loan],' Alice ','loan-legacy'),loan);
 assert.equal(findLoanCard([loan],'Alice','missing'),loan);
});

test('built-in migration fills missing defaults without overwriting persisted edits',()=>{
 const persisted={id:'credit-baitiao',name:'My credit account',last4:'2468',network:'Visa',color:'#123456'};
 const normalized=withBuiltInAccountCards([persisted]);
 const card=normalized.find(item=>item.id==='credit-baitiao');
 assert.equal(normalized.filter(item=>item.id==='credit-baitiao').length,1);
 assert.deepEqual(card,{...creditAccountCards[0],...persisted,accountTypeVersion:1});
 assert.equal(withBuiltInAccountCards([card]).find(item=>item.id===card.id).name,'My credit account');
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

test('Sankey preserves rounded colored nodes with names, amounts and percentages inside',()=>{
 const model=buildFlowModel(entries,entries,[{...cards[0],name:'银行卡很长的名称 <script> & extra description',last4:'9999'}],'2026-09-30');
 for(const width of [280,343,600,900]){
  const svg=flowChart(model,'Sankey diagram',s=>s,width);
  assert.ok(svg.includes(`viewBox="0 0 ${width} `));
  assert.ok(!svg.includes('label-box'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('9999'));
  assert.ok(!/NaN|Infinity/.test(svg));
  const groups=[...svg.matchAll(/<g class="flow-node">(.*?)<\/g>/g)].map(m=>m[1]);
  const columns=new Set();
  for(const group of groups){
   const rect=group.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
   const [x,y,w,h]=rect.slice(1).map(Number);
   columns.add(x);
   assert.ok(x>=0 && x+w<=width);
   for(const span of group.matchAll(/<tspan x="([\d.]+)" y="([\d.]+)"/g)){
    assert.equal(Number(span[1]),x+w/2);
    assert.ok(Number(span[2])>y && Number(span[2])<y+h);
   }
  }
  assert.equal(columns.size,3);
  const positions=[...columns].sort((a,b)=>a-b);
  assert.ok(Math.abs(positions[1]+Math.min(150,width*.23)/2-width/2)<.01);
 }
});


test('legacy lender accounts migrate to online loans without losing IDs or credit history', () => {
 const legacy = creditAccountCards.map(card => ({ ...card, accountType: 'Credit card', network: 'Other' }));
 legacy[0].id = 'legacy-baitiao';
 const migrated = withBuiltInAccountCards(legacy);
 for (const old of legacy) {
  const account = migrated.find(card => card.id === old.id);
  assert.equal(account.accountType, 'Online loan');
  assert.equal(account.network, old.name);
  const records = [
   { id: 1, type: 'credit', card: old.id, amount: 500, date: '2026-09-01', category: 'Credit limit' },
   { id: 2, type: 'credit', card: old.id, amount: 800, date: '2026-09-10', category: 'Credit limit' },
   { id: 3, type: 'expense', card: old.id, amount: 100, date: '2026-09-11', category: 'Shopping' }
  ];
  const model = buildFlowModel(records, records, [account], '2026-09-30');
  assert.equal(model.income, 0); assert.equal(model.credit, 800);
  assert.equal(model.capacity, 800); assert.equal(model.spent, 100);
 }
 assert.deepEqual(withBuiltInAccountCards(migrated), migrated);
 assert.ok(!withBuiltInAccountCards([], ['credit-huabei']).some(card => card.id === 'credit-huabei'));
});

import { accountBalances, creditPurchases, saveTransaction, validateLedger } from './ledger.js';
const creditRecords = [
 {id:'salary',type:'income',card:'a',amount:2000,date:'2026-08-01',category:'Salary'},
 {id:'purchase',type:'expense',onCredit:true,card:'b',amount:1000,date:'2026-08-02',description:'Laptop',category:'Shopping'},
];
const repayment = {id:'r1',type:'repayment',card:'a',toCard:'b',purchaseId:'purchase',amount:400,date:'2026-09-10',description:'First payment'};
test('partial and full repayments reconcile cash, debt, status and expense statistics',()=>{
 const partial=saveTransaction(creditRecords,repayment,cards);
 assert.deepEqual(creditPurchases(partial).map(p=>[p.paid,p.due,p.status]),[[400,600,'Partially paid']]);
 assert.deepEqual(accountBalances(partial,cards,'2026-09-30').map(c=>[c.cash,c.debt]),[[1600,0],[0,600]]);
 const full=saveTransaction(partial,{...repayment,id:'r2',amount:600},cards);
 assert.deepEqual(creditPurchases(full).map(p=>[p.paid,p.due,p.status]),[[1000,0,'Paid']]);
 assert.deepEqual(accountBalances(full,cards,'2026-09-30').map(c=>[c.cash,c.debt]),[[1000,0],[0,0]]);
 assert.equal(buildFlowModel(full,full,cards,'2026-09-30').spent,1000);
 assert.equal(buildFlowModel(full,full,cards,'2026-09-30').income,2000);
});
test('retry, edit, deletion and restoration do not double-post money',()=>{
 const partial=saveTransaction(creditRecords,repayment,cards);
 const retry=saveTransaction(partial,repayment,cards);
 assert.equal(retry.length,3);
 assert.equal(creditPurchases(retry)[0].due,600);
 const edited=saveTransaction(retry,{...repayment,amount:250},cards);
 assert.equal(creditPurchases(edited)[0].due,750);
 const removed=edited.filter(e=>e.id!=='r1');
 assert.equal(creditPurchases(removed)[0].status,'Unpaid');
 assert.equal(accountBalances(removed,cards,'2026-09-30')[0].cash,2000);
 assert.equal(creditPurchases(saveTransaction(removed,repayment,cards))[0].due,600);
});
test('invalid links, dates, amounts, duplicates and changes to paid purchases are rejected',()=>{
 for(const patch of [{amount:1001},{amount:-1},{amount:0},{amount:0.001},{amount:NaN},{toCard:'a'},{card:'b'},{purchaseId:'missing'},{date:'2026-07-01'},{date:'2026-02-30'}]) {
  assert.throws(()=>saveTransaction(creditRecords,{...repayment,...patch},cards));
 }
 const partial=saveTransaction(creditRecords,repayment,cards);
 assert.throws(()=>saveTransaction(partial,{...repayment,id:'r2',amount:601},cards));
 assert.throws(()=>saveTransaction(partial,{...creditRecords[1],amount:399},cards));
 assert.throws(()=>saveTransaction(partial,{...creditRecords[1],onCredit:false},cards));
 assert.throws(()=>saveTransaction(partial,{...creditRecords[1],card:'a'},cards));
 assert.ok(validateLedger(partial.filter(e=>e.id!=='purchase'),cards));
 assert.ok(validateLedger([...partial,repayment],cards));
});
test('cent arithmetic settles decimal amounts exactly and historical balance excludes future payments',()=>{
 const tiny=[{...creditRecords[1],amount:0.3}];
 const first=saveTransaction(tiny,{...repayment,amount:0.1},cards);
 const full=saveTransaction(first,{...repayment,id:'r2',amount:0.2,date:'2026-10-01'},cards);
 assert.equal(creditPurchases(full)[0].due,0);
 assert.equal(creditPurchases(full,'2026-09-30')[0].due,0.2);
 assert.equal(accountBalances(full,cards,'2026-09-30')[0].cash,-0.1);
});
test('repayment Sankey retains both endpoints with one selected account and links prior-month purchases',()=>{
 const all=saveTransaction(creditRecords,repayment,cards);
 for(const selected of [[cards[0]],[cards[1]],cards]) {
  const model=buildFlowModel([repayment],all,selected,'2026-09-30','Shopping',cards);
  assert.equal(model.repayments.length,1);
  assert.equal(model.spent,0);
  const html=flowChart(model,'Sankey diagram',s=>s);
  assert.ok(html.includes('Daily · 1234 → Travel · 5678'));
  assert.ok(html.includes('Laptop'));
  assert.ok(html.includes('¥400.00'));
  assert.ok(!/NaN|Infinity/.test(html));
  assert.ok(!flowChart(model,'Category breakdown',s=>s).includes('Repayment flow'));
 }
 assert.equal(buildFlowModel([repayment],all,cards,'2026-09-30','Utilities').repayments.length,0);
 assert.equal(buildFlowModel([repayment],all,cards,'2026-08-31').repayments.length,0);
});
test('repayment graph escapes descriptions and account names',()=>{
 const all=saveTransaction(creditRecords,{...repayment,description:'<script>alert(1)</script>'},cards);
 const model=buildFlowModel(all,all,[{...cards[0],name:'<img src=x>'},cards[1]],'2026-09-30');
 const html=flowChart(model,'Sankey diagram',s=>s);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));
});

test('same-day credit limits work with UUID record identifiers',()=>{
 const limits=[{type:'credit',card:'a',id:'old-uuid',amount:100,date:'2026-09-01'},{type:'credit',card:'a',id:'new-uuid',amount:200,date:'2026-09-01'}];
 assert.equal(creditLimit(limits,'a','2026-09-30'),200);
});
