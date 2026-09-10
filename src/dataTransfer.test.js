import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataBackup, parseDataFile } from './dataTransfer.js';

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
  assert.match(backup,/"app": "FluxLedger"/);
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
