import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataBackup, parseDataFile } from './dataTransfer.js';
import { withBuiltInAccountCards } from './ledger.js';

const cards = [
  { id: '4329', name: 'Everyday card', last4: '4329', network: 'Visa', color: '#f4cf35' },
  { id: '8851', name: 'Lifestyle card', last4: '8851', network: 'Mastercard', color: '#2784f7' }
];
const entries = [
  { id: 1, description: 'Salary', amount: 1000, type: 'income', category: 'Salary', card: '4329', date: '2026-09-01' },
  { id: 2, description: 'Lunch', amount: 18.5, type: 'expense', category: 'Food & Drinks', card: '4329', date: '2026-09-10' }
];

test('data backup round-trips transactions and cards',()=>{
  const backup=createDataBackup(entries,cards,new Date('2026-09-10T08:00:00Z'));
  const parsed=parseDataFile(backup,{cards:[]});
  assert.equal(parsed.format,'json');
  assert.deepEqual(parsed.entries,entries);
  assert.deepEqual(parsed.cards,cards);
  assert.deepEqual(parsed.hiddenBuiltInCardIds,[]);
  assert.match(backup,/"app": "FluxLedger"/);
});

test('backup preserves deleted built-ins before card normalization',()=>{
  const visibleCards=withBuiltInAccountCards(cards,['credit-huabei']);
  const backup=createDataBackup(entries,visibleCards,new Date('2026-09-10T08:00:00Z'),['credit-huabei']);
  const parsed=parseDataFile(backup,{cards:[]});
  const restored=withBuiltInAccountCards(parsed.cards,parsed.hiddenBuiltInCardIds);
  assert.deepEqual(parsed.hiddenBuiltInCardIds,['credit-huabei']);
  assert.ok(!restored.some(card=>card.id==='credit-huabei'));
  assert.equal(restored.filter(card=>card.id==='credit-baitiao').length,1);
});

test('older backups without hidden built-in state remain compatible',()=>{
  const parsed=parseDataFile(JSON.stringify({transactions:entries,cards}),{cards:[]});
  assert.deepEqual(parsed.hiddenBuiltInCardIds,[]);
});

test('loan borrower and card identity survive a complete backup round trip',()=>{
  const loanCard={id:'loan-alice',name:'Alice',last4:'',noLast4:true,network:'借款',accountType:'Credit card',loanBorrower:'Alice',color:'#627084'};
  const loanEntry={id:3,description:'借款',borrower:' Alice ',amount:500,type:'credit',category:'Credit limit',card:loanCard.id,date:'2026-09-10'};
  const parsed=parseDataFile(createDataBackup([loanEntry],[loanCard]),{cards:[]});
  assert.equal(parsed.entries[0].borrower,'Alice');
  assert.equal(parsed.entries[0].card,loanCard.id);
  assert.deepEqual(parsed.cards,[loanCard]);
});

test('normalization only retains a non-empty string borrower when supplied',()=>{
  const unrelated=[entries[0],{...entries[1],id:3,borrower:42},{...entries[1],id:4,borrower:'   '}];
  const parsed=parseDataFile(createDataBackup(unrelated,cards),{cards:[]});
  assert.ok(parsed.entries.every(entry=>!Object.hasOwn(entry,'borrower')));
});

test('backup round-trips cards without a last four while rejecting malformed non-empty values',()=>{
  const noLastFour={id:'online-wallet',name:'Wallet',last4:'',noLast4:true,network:'Online banking',accountType:'Online banking',color:'#123456'};
  const walletEntry={...entries[0],card:noLastFour.id};
  const backup=createDataBackup([walletEntry],[noLastFour]);
  const parsed=parseDataFile(backup,{cards:[]});
  assert.deepEqual(parsed.cards,[noLastFour]);
  assert.equal(parsed.entries[0].card,noLastFour.id);
  assert.throws(()=>createDataBackup([], [{...noLastFour,last4:'123'}]),/Card data is invalid/);
  assert.throws(()=>parseDataFile(JSON.stringify({transactions:[],cards:[{...noLastFour,last4:'12x4'}]})),/Card data is invalid/);
});

test('legacy CSV import maps localized fields to the current cards',()=>{
  const csv='\uFEFF交易说明,类型,分类,日期,银行卡,金额\r\nLunch,支出,餐饮,2026-09-10,日常消费卡 · 4329,18.50';
  const parsed=parseDataFile(csv,{cards});
  assert.equal(parsed.format,'csv');
  assert.equal(parsed.entries.length,1);
  assert.equal(parsed.entries[0].type,'expense');
  assert.equal(parsed.entries[0].category,'Food & Drinks');
  assert.equal(parsed.entries[0].card,'4329');
  assert.equal(parsed.entries[0].amount,18.5);
});

test('legacy CSV import matches the complete card label instead of digits in its name',()=>{
  const similarCards = [
    { id: 'first', name: 'Account', last4: '1234', network: 'Visa', color: '#123456' },
    { id: 'second', name: 'Account 1234', last4: '5678', network: 'Visa', color: '#654321' }
  ];
  const csv='Description,Type,Category,Date,Card,Amount\nLunch,Expense,Food & Drinks,2026-09-10,Account 1234 · 5678,18.50';
  const parsed=parseDataFile(csv,{cards:similarCards});
  assert.equal(parsed.entries[0].card,'second');
});

test('legacy CSV import rejects an ambiguous last-four-only card reference',()=>{
  const duplicateLast4Cards = [
    ...cards,
    { id: 'another-card', name: 'Backup card', last4: '4329', network: 'Visa', color: '#123456' }
  ];
  const csv='Description,Type,Category,Date,Card,Amount\nLunch,Expense,Food & Drinks,2026-09-10,4329,18.50';
  assert.throws(()=>parseDataFile(csv,{cards:duplicateLast4Cards}),/card that does not exist/);
});

test('import rejects transactions that reference an unknown card',()=>{
  const payload=JSON.stringify({transactions:[{...entries[0],card:'missing'}],cards});
  assert.throws(()=>parseDataFile(payload,{cards:[]}),/card that does not exist/);
});


test('credit purchase flags and repayment UUID links survive backup round trips',()=>{
 const purchase={...entries[1],id:'purchase-uuid',onCredit:true,amount:1000,card:'8851'};
 const payment={...entries[1],id:'payment-uuid',type:'repayment',category:'Repayments',amount:400,card:'4329',toCard:'8851',purchaseId:purchase.id};
 const records=[entries[0],purchase,payment];
 assert.deepEqual(parseDataFile(createDataBackup(records,cards)).entries,records);
 for(const patch of [{purchaseId:'missing'},{toCard:'missing'},{amount:1001}])assert.throws(()=>createDataBackup([purchase,{...payment,...patch}],cards));
 assert.throws(()=>parseDataFile(JSON.stringify({transactions:[purchase,{...purchase},payment],cards})),/Duplicate/);
});
