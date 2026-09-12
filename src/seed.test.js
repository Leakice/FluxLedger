import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './seed.js';
import { defaultCards, inferCreditExpenses, validateLedger, creditPurchases, creditLimit, accountBalances, cents, buildFlowModel } from './ledger.js';

test('demo ledger validates after first-run inference and covers six months', () => {
  const entries = inferCreditExpenses(seed, defaultCards);
  assert.equal(validateLedger(entries, defaultCards), '');
  assert.deepEqual(entries, seed.map(e => e.type === 'expense' ? { ...e, onCredit: !!e.onCredit } : e));
  for (const month of ['04', '05', '06', '07', '08', '09']) {
    const rows = entries.filter(e => e.date.startsWith(`2026-${month}`));
    assert.ok(rows.some(e => e.type === 'income'));
    assert.ok(rows.some(e => e.type === 'expense'));
  }
});

test('demo repayments reconcile across months, accounts and payment states', () => {
  const purchases = creditPurchases(seed, '2026-09-30');
  assert.deepEqual(new Set(purchases.map(e => e.status)), new Set(['Paid', 'Partially paid', 'Unpaid']));
  assert.equal(purchases.find(e => e.id === 4).due, 0);
  assert.equal(purchases.find(e => e.id === 9).due, 1400);
  assert.equal(purchases.find(e => e.id === 12).due, 0);
  assert.equal(creditPurchases(seed, '2026-08-31').find(e => e.id === 4).due, 1200);
  assert.equal(creditLimit(seed, 'credit-baitiao', '2026-08-31'), 2000);
  assert.equal(creditLimit(seed, 'credit-baitiao', '2026-09-30'), 3000);
  const balances = accountBalances(seed, defaultCards, '2026-09-30');
  assert.equal(balances.reduce((sum, e) => sum + cents(e.debt), 0), 244000);
  assert.ok(balances.every(e => e.cash >= 0));
});

test('September demo totals reconcile and allocation categories remain legible', () => {
  const rows = seed.filter(e => e.date.startsWith('2026-09'));
  const model = buildFlowModel(rows, seed, defaultCards, '2026-09-30');
  assert.equal(model.income, 11000);
  assert.equal(model.spent, 10560);
  assert.equal(model.income - model.spent, 440);
  assert.equal(model.credit, 4600);
  assert.equal(model.capacity, 15600);
  assert.equal(model.repayments.reduce((sum, e) => sum + cents(e.amount), 0), 276000);
  const unused = model.cards.reduce((sum, card) => sum + Math.max(0, card.capacity - card.spent), 0);
  assert.equal(unused, 5040);
  assert.ok(unused / model.capacity < 1 / 3, 'unused capacity must not dominate the demo');
  assert.ok(model.cards.every(card => card.spent <= card.capacity), 'every account funds its own spending');
  const categories = new Map();
  for (const row of rows.filter(e => e.type === 'expense')) categories.set(row.category, (categories.get(row.category) || 0) + row.amount);
  assert.equal(categories.size, 6);
  assert.ok([...categories.values()].every(amount => amount >= 800), 'small categories need readable nodes');
});
