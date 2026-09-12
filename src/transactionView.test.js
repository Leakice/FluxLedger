import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationPages, transactionFilters, selectTransactionRows, flowTransactionFilter } from './transactionView.js';
import { dictionary } from './locales.js';

const entries = [
  { id: 1, type: 'expense', date: '2025-08-01', card: 'a', category: 'Shopping', description: 'Old groceries' },
  { id: 2, type: 'expense', date: '2026-09-10', card: 'a', category: 'Food & Drinks', description: 'Lunch' },
  { id: 3, type: 'income', date: '2026-09-10', card: 'a', category: 'Salary', description: 'Pay' },
  { id: 4, type: 'expense', date: '2026-09-11', card: 'b', category: 'Shopping', description: 'Clothes' },
  { id: 5, type: 'credit', date: '2026-08-01', card: 'a', category: 'Credit limit', description: 'First limit' },
  { id: 6, type: 'credit', date: '2026-09-30', card: 'a', category: 'Credit limit', description: 'Updated limit' },
  { id: 7, type: 'credit', date: '2026-10-01', card: 'a', category: 'Credit limit', description: 'Future limit' },
  { id: 8, type: 'income', date: '2026-01-01', card: 'a', category: 'Other', description: 'Gift' },
  { id: 9, type: 'credit', date: '2026-09-12', card: 'b', category: 'Credit limit', description: 'Other account limit' },
];
const options = { month: '2026-09', period: 'month', cardIds: ['a'], category: 'All categories' };
const ids = rows => rows.map(row => row.id);

test('navigation has a dedicated repayment destination and all five filters are translated', () => {
  assert.deepEqual(navigationPages, ['Dashboard', 'Transactions', 'Repayment records']);
  assert.deepEqual(transactionFilters.map(filter => filter.type), ['all', 'expense', 'income', 'repayment', 'credit']);
  for (const item of [...navigationPages, ...transactionFilters.map(filter => filter.label)]) assert.ok(dictionary[item]);
});

test('All shows the complete ledger across accounts, dates, categories and credit snapshots', () => {
  const original = structuredClone(entries);
  assert.deepEqual(ids(selectTransactionRows(entries)), [7, 6, 9, 4, 3, 2, 5, 8, 1]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'all', cardIds: null, category: 'Missing' })), [7, 6, 9, 4, 3, 2, 5, 8, 1]);
  assert.deepEqual(entries, original, 'sorting must not mutate the persisted ledger');
});

test('expense and income retain selected period, account and category filters', () => {
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'expense' })), [2]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'income' })), [3]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'expense', cardIds: ['a','b'], category: 'Shopping' })), [4]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'expense', category: 'Income' })), []);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'income', category: 'Income' })), [3]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'income', period: 'year' })), [3,8]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'income', cardIds: null })), [3]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'income', cardIds: [] })), []);
});

test('credit history includes earlier snapshots through the effective date, not just the latest limit', () => {
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'credit', category: 'Shopping' })), [6,5]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'credit', period: 'year' })), [7,6,5]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'credit', cardIds: ['b'] })), [9]);
});

test('search works in All and typed views for description, translated category and account', () => {
  const translated = { ...options, translate: value => dictionary[value] || value, accountLabel: id => id === 'a' ? '支付宝 · Alipay' : 'Bank · 1234' };
  assert.deepEqual(ids(selectTransactionRows(entries, { ...translated, search: 'OLD GROCERIES' })), [1]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...translated, kind: 'expense', search: '餐饮' })), [2]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...translated, cardIds: null, search: '1234' })), [9,4]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...translated, kind: 'credit', search: 'ALIPAY' })), [6,5]);
  assert.deepEqual(selectTransactionRows(entries, { ...translated, search: 'not present' }), []);
  assert.deepEqual(selectTransactionRows([], translated), []);
});


test('repayment filters match either account and the linked purchase category',()=>{
 const purchase={id:'p',type:'expense',onCredit:true,card:'credit',category:'Shopping',description:'Laptop',date:'2026-08-01',amount:1000};
 const payment={id:'r',type:'repayment',card:'cash',toCard:'credit',purchaseId:'p',category:'Repayments',description:'Payment',date:'2026-09-10',amount:400};
 for(const cardIds of [['cash'],['credit']])assert.deepEqual(selectTransactionRows([purchase,payment],{kind:'repayment',month:'2026-09',cardIds,category:'Shopping'}),[payment]);
 assert.deepEqual(selectTransactionRows([purchase,payment],{kind:'repayment',month:'2026-09',cardIds:['cash'],search:'credit'}),[payment]);
});

test('All respects accounts while retaining every date and category', () => {
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'all', category: 'Missing' })), [7,6,3,2,5,8,1]);
  assert.deepEqual(ids(selectTransactionRows(entries, { ...options, kind: 'all', cardIds: ['b'] })), [9,4]);
  assert.deepEqual(selectTransactionRows(entries, { ...options, kind: 'all', cardIds: ['missing'] }), []);
  assert.deepEqual(selectTransactionRows(entries, { kind: 'all', cardIds: [] }), []);
});

test('All retains repayments matching either paying or receiving account', () => {
  const payment = { id: 'r', type: 'repayment', card: 'cash', toCard: 'credit', category: 'Repayments', description: 'Payment', date: '2026-09-10' };
  for (const cardIds of [['cash'], ['credit'], ['cash','credit'], null]) assert.deepEqual(selectTransactionRows([...entries,payment], { kind: 'all', cardIds, search: 'Payment' }), [payment]);
  assert.deepEqual(selectTransactionRows([payment], { kind: 'all', cardIds: ['a'] }), []);
});

test('account filter labels have Chinese translations', () => {
  assert.equal(dictionary['All accounts'], '全部账户');
  assert.equal(dictionary['Custom selection'], '自定义组合');
});

test('Sankey nodes and links map to typed account and category filters',()=>{
  const cases=[
    [{flowId:'account:a'},'expense',['a'],null],
    [{flowId:'target:0',category:'Food & Drinks'},'expense',null,'Food & Drinks'],
    [{flowId:'source:0'},'income',null,null],
    [{flowId:'source:1'},'credit',null,null],
    [{flowId:'in:0:0',source:'source:0',target:'account:a'},'income',['a'],null],
    [{flowId:'in:0:1',source:'source:1',target:'account:a'},'credit',['a'],null],
    [{flowId:'out:0:0',source:'account:a',target:'target:0',category:'Food & Drinks'},'expense',['a'],'Food & Drinks'],
  ];
  for(const [dataset,recordKind,cardIds,category] of cases)assert.deepEqual(flowTransactionFilter(dataset),{recordKind,cardIds,category});
});
test('unallocated capacity and unknown Sankey targets do not navigate',()=>{
  for(const dataset of [{flowId:'target:1'},{flowId:'out:0:1',source:'account:a',target:'target:1'},{flowId:'target:1',category:'Unallocated capacity'},{flowId:'unknown'},{flowId:'source:2'},{flowId:'account:'},{flowId:'target:unknown',category:'Shopping'},{}])assert.equal(flowTransactionFilter(dataset),null);
});
test('Sankey filters retain month and year rules when selecting transactions',()=>{
  const filter=flowTransactionFilter({flowId:'out:0:0',source:'account:a',target:'target:0',category:'Food & Drinks'});
  for(const period of ['month','year'])assert.deepEqual(ids(selectTransactionRows(entries,{...filter,kind:filter.recordKind,month:'2026-09',period})),[2]);
});
