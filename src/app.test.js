// Behavior-locking integration tests for src/App.vue, written against the
// pre-refactor app: they pin down the current persistence semantics (deep
// watchers, startup-only transformations, filter never persisted) so the
// explicit-save refactor in this PR must keep the same observable results.
// Requires scripts/test-setup.mjs via `--import` for the Vue loader and DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDataFile, createDataBackup } from './dataTransfer.js';
import {
  MapStorage, STORAGE_KEYS, mountApp, flush, snapshotKeys, captureExport,
  pinDeterminism, clearTrackedTimers, legacyFixture, simpleFixture, expenseOf,
} from './appTestHelpers.js';

const { transactions: TRANSACTIONS_KEY, cards: CARDS_KEY, hiddenBuiltInCardIds: HIDDEN_KEY,
  language: LANGUAGE_KEY, theme: THEME_KEY } = STORAGE_KEYS;

const storedTransactions = storage => JSON.parse(storage.getItem(TRANSACTIONS_KEY));
const storedCards = storage => JSON.parse(storage.getItem(CARDS_KEY));
const storedHidden = storage => JSON.parse(storage.getItem(HIDDEN_KEY));

test('loads the ledger from storage, saves new entries, and reloads them', async () => {
  const fixture = simpleFixture();
  const app = await mountApp({ storage: new MapStorage(fixture) });
  try {
    assert.deepEqual(app.state.entries.map(e => e.id), [301, 302]);
    assert.equal(app.state.entries.find(e => e.id === 302).onCredit, false);
    assert.deepEqual(snapshotKeys(app.storage), { ...fixture, [LANGUAGE_KEY]: 'en', [THEME_KEY]: 'light', [HIDDEN_KEY]: null });
    app.state.saveEntry(expenseOf('9001'));
    await flush();
    assert.ok(storedTransactions(app.storage).some(e => e.id === '9001'));
    assert.equal(app.storage.getItem(CARDS_KEY), fixture[CARDS_KEY], 'transaction-only change must not touch stored cards');
    app.unmount();
    const reloaded = await mountApp({ storage: app.storage });
    try {
      assert.ok(reloaded.state.entries.some(e => e.id === '9001'));
    } finally { reloaded.unmount(); }
  } finally { app.unmount(); }
});

test('transaction add, edit, delete and undo round-trip through storage', async () => {
  const app = await mountApp({ storage: new MapStorage(simpleFixture()) });
  try {
    app.state.saveEntry(expenseOf('9001', { amount: 5 }));
    await flush();
    assert.equal(storedTransactions(app.storage).find(e => e.id === '9001').amount, 5);
    app.state.saveEntry(expenseOf('9001', { amount: 7 }));
    await flush();
    assert.equal(storedTransactions(app.storage).find(e => e.id === '9001').amount, 7);
    app.state.remove(app.state.entries.find(e => e.id === '9001'));
    await flush();
    assert.ok(!storedTransactions(app.storage).some(e => e.id === '9001'));
    app.state.undo();
    await flush();
    assert.equal(storedTransactions(app.storage).find(e => e.id === '9001').amount, 7);
    assert.equal(app.state.deleted, null);
  } finally { app.unmount(); }
});

test('account add, edit and delete persist through storage', async () => {
  const restore = pinDeterminism();
  const app = await mountApp({ storage: new MapStorage(simpleFixture()) });
  try {
    app.state.saveCard({ name: 'Trip card', last4: '3003', network: 'Visa', accountType: 'Savings card', color: '#19ac87' });
    await flush();
    const createdId = 'card-' + Date.now();
    assert.ok(storedCards(app.storage).some(c => c.id === createdId && c.name === 'Trip card'));
    assert.ok(app.state.cards.includes(createdId), 'new account joins the current selection');
    app.state.saveCard({ ...app.state.bankCards.find(c => c.id === createdId), name: 'Trip card 2' });
    await flush();
    assert.equal(storedCards(app.storage).find(c => c.id === createdId).name, 'Trip card 2');
    app.state.removeCard(createdId);
    await flush();
    assert.ok(!storedCards(app.storage).some(c => c.id === createdId));
    assert.equal(app.storage.getItem(HIDDEN_KEY), null, 'deleting a user account never touches hidden ids');
  } finally { app.unmount(); clearTrackedTimers(); restore(); }
});

test('deleting a built-in account saves hidden ids and it stays hidden after reload', async () => {
  const app = await mountApp({ storage: new MapStorage(simpleFixture()) });
  try {
    app.state.removeCard('online-wechat');
    await flush();
    assert.equal(app.storage.getItem(HIDDEN_KEY), '["online-wechat"]');
    assert.ok(!storedCards(app.storage).some(c => c.id === 'online-wechat'));
    app.unmount();
    const reloaded = await mountApp({ storage: app.storage });
    try {
      assert.ok(!reloaded.state.bankCards.some(c => c.id === 'online-wechat'));
      assert.ok(reloaded.state.hiddenBuiltInCardIds.includes('online-wechat'));
    } finally { reloaded.unmount(); }
  } finally { app.unmount(); }
});

test('borrower credit entry auto-creates a loan account and saves both account and transaction', async () => {
  const restore = pinDeterminism();
  const app = await mountApp({ storage: new MapStorage(simpleFixture()) });
  try {
    app.state.saveEntry({ id: '9002', type: 'credit', description: '借款', borrower: 'Alice', amount: 1000, date: '2026-09-10', card: '' });
    await flush();
    const loanId = 'loan-' + Date.now();
    assert.equal(app.state.formError, '');
    const stored = storedTransactions(app.storage);
    assert.ok(stored.some(e => e.id === '9002' && e.card === loanId), 'transaction saved with the loan card');
    assert.ok(storedCards(app.storage).some(c => c.id === loanId && c.loanBorrower === 'Alice'), 'loan account saved');
  } finally { app.unmount(); restore(); }
});

test('borrower validation failure still persists the auto-created loan account (recorded legacy behavior)', async () => {
  const restore = pinDeterminism();
  const fixture = simpleFixture();
  const app = await mountApp({ storage: new MapStorage(fixture) });
  try {
    app.state.saveEntry({ id: '9003', type: 'credit', description: '借款', borrower: 'Bob', amount: -5, date: '2026-09-10', card: '' });
    await flush();
    const loanId = 'loan-' + Date.now();
    assert.equal(app.state.formError, 'Invalid amount');
    assert.equal(app.storage.getItem(TRANSACTIONS_KEY), fixture[TRANSACTIONS_KEY], 'rejected transaction is not stored');
    assert.ok(storedCards(app.storage).some(c => c.id === loanId && c.loanBorrower === 'Bob'),
      'legacy deep-watch behavior keeps the auto-created account after failure');
  } finally { app.unmount(); restore(); }
});

test('income on an online loan account is rejected without writing any storage key', async () => {
  const fixture = simpleFixture();
  const app = await mountApp({ storage: new MapStorage(fixture) });
  try {
    const before = snapshotKeys(app.storage);
    app.state.saveEntry({ id: '9004', type: 'income', card: 'credit-baitiao', amount: 50, date: '2026-09-06', category: 'Salary', description: 'Loan funding' });
    await flush();
    assert.equal(app.state.notification, 'Online loan funding uses credit limits, not income.');
    assert.deepEqual(snapshotKeys(app.storage), before);
  } finally { app.unmount(); }
});

test('JSON import replaces the whole ledger and persists the completed final state', async () => {
  const app = await mountApp({ storage: new MapStorage(simpleFixture()) });
  try {
    const file = JSON.stringify({
      app: 'FluxLedger', version: 1, exportedAt: '2026-01-01T00:00:00.000Z',
      transactions: [{ id: 501, type: 'expense', card: '1001', amount: 9, date: '2026-08-15', category: 'Food & Drinks', description: 'Imported snack' }],
      cards: [{ id: '1001', name: 'Imported card', last4: '', noLast4: true, network: 'Other', accountType: 'Alipay', color: '#123456' }],
      hiddenBuiltInCardIds: ['online-alipay'],
    });
    const payload = parseDataFile(file, { cards: app.state.bankCards });
    app.state.importData(payload);
    await flush();
    const transactions = storedTransactions(app.storage);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].id, 501);
    assert.equal(transactions[0].onCredit, false, 'final stored state carries the inferred onCredit flag');
    const cards = storedCards(app.storage);
    assert.ok(cards.some(c => c.id === '1001'));
    assert.ok(!cards.some(c => c.id === 'online-alipay'), 'hidden built-in account stays hidden');
    assert.ok(cards.some(c => c.id === 'credit-baitiao'), 'missing built-in accounts are completed on import');
    assert.equal(app.storage.getItem(HIDDEN_KEY), '["online-alipay"]');
    assert.ok(!storedCards(app.storage).some(c => c.id === '4329'), 'import replaces, not merges, the account list');
    app.unmount();
    const reloaded = await mountApp({ storage: app.storage });
    try {
      assert.equal(reloaded.state.entries.length, 1);
      assert.ok(!reloaded.state.bankCards.some(c => c.id === 'online-alipay'));
    } finally { reloaded.unmount(); }
  } finally { app.unmount(); }
});

test('legacy CSV import replaces the ledger through the current account list', async () => {
  const app = await mountApp({ storage: new MapStorage(simpleFixture()) });
  try {
    const csv = ['Description,Type,Category,Date,Account,Amount',
      'Coffee,expense,Food & Drinks,2026-09-06,Everyday card · 1001,3.5'].join('\n');
    const payload = parseDataFile(csv, { cards: app.state.bankCards });
    assert.equal(payload.format, 'csv');
    app.state.importData(payload);
    await flush();
    const transactions = storedTransactions(app.storage);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].description, 'Coffee');
    assert.equal(transactions[0].card, '4329');
    assert.equal(transactions[0].onCredit, false);
  } finally { app.unmount(); }
});

test('export uses the complete in-memory snapshot and writes nothing to storage', async () => {
  const fixture = legacyFixture();
  const app = await mountApp({ storage: new MapStorage(fixture) });
  const restore = pinDeterminism();
  try {
    const backup = await captureExport(app.state);
    const parsed = JSON.parse(backup);
    assert.equal(parsed.exportedAt, '2026-09-13T12:00:00.000Z', 'export timestamp is fixed for comparison');
    assert.ok(parsed.transactions.some(e => e.onCredit === true), 'export carries inferred transactions from memory');
    assert.ok(parsed.cards.some(c => c.id === 'credit-baitiao' && c.accountType === 'Online loan' && c.accountTypeVersion === 1),
      'export carries completed accounts from memory');
    assert.ok(parsed.cards.some(c => c.id === 'online-wechat'), 'memory snapshot includes built-ins missing from raw storage');
    assert.deepEqual(parsed, JSON.parse(createDataBackup(app.state.entries, app.state.bankCards, new Date(), app.state.hiddenBuiltInCardIds)),
      'dialog export byte-matches a backup built from the full memory snapshot');
    assert.equal(app.storage.getItem(TRANSACTIONS_KEY), fixture[TRANSACTIONS_KEY], 'export must not rewrite storage');
    assert.equal(app.storage.getItem(CARDS_KEY), fixture[CARDS_KEY]);
  } finally { app.unmount(); restore(); }
});

test('account filter changes never write any storage key', async () => {
  const app = await mountApp({ storage: new MapStorage(simpleFixture()) });
  try {
    const before = snapshotKeys(app.storage);
    app.state.cards = ['4329'];
    await flush();
    app.state.accountFilter = '8851';
    await flush();
    app.state.reset();
    await flush();
    assert.deepEqual(app.state.cards, app.state.bankCards.map(c => c.id));
    app.state.activateFlow({ flowId: 'account:4329' });
    await flush();
    assert.equal(app.state.page, 'Transactions');
    assert.deepEqual(app.state.cards, ['4329']);
    assert.deepEqual(snapshotKeys(app.storage), before, 'filters are ephemeral UI state');
  } finally { app.unmount(); }
});

test('startup completion and inference update memory but do not write storage', async () => {
  const fixture = legacyFixture();
  const app = await mountApp({ storage: new MapStorage(fixture) });
  try {
    const baitiao = app.state.bankCards.find(c => c.id === 'credit-baitiao');
    assert.equal(baitiao.accountType, 'Online loan', 'stored credit-card type is corrected in memory');
    assert.equal(baitiao.accountTypeVersion, 1);
    assert.ok(app.state.bankCards.some(c => c.id === 'online-wechat'), 'missing built-ins are completed in memory');
    assert.equal(app.state.entries.find(e => e.id === 101).onCredit, true, 'expenses are inferred in memory');
    assert.equal(app.storage.getItem(TRANSACTIONS_KEY), fixture[TRANSACTIONS_KEY]);
    assert.equal(app.storage.getItem(CARDS_KEY), fixture[CARDS_KEY]);
  } finally { app.unmount(); }
});

test('language and theme persist with their immediate page side effects', async () => {
  const app = await mountApp({ storage: new MapStorage() });
  try {
    assert.equal(app.storage.getItem(LANGUAGE_KEY), 'en', 'immediate watch writes the default language');
    assert.equal(app.storage.getItem(THEME_KEY), 'light', 'immediate watch writes the default theme');
    assert.equal(document.documentElement.lang, 'en');
    assert.equal(document.title, 'FluxLedger — In tune with every money movement.');
    assert.ok(!document.body.classList.contains('dark'));
    app.state.language = 'zh';
    await flush();
    assert.equal(app.storage.getItem(LANGUAGE_KEY), 'zh');
    assert.equal(document.documentElement.lang, 'zh-CN');
    assert.equal(document.title, 'FluxLedger——回应每一次资金流动。');
    app.state.dark = true;
    await flush();
    assert.equal(app.storage.getItem(THEME_KEY), 'dark');
    assert.ok(document.body.classList.contains('dark'));
  } finally { app.unmount(); }
});

test('language and theme use raw string rules, not JSON fallback rules', async () => {
  const app = await mountApp({ storage: new MapStorage({ [LANGUAGE_KEY]: '', [THEME_KEY]: 'DARK' }) });
  try {
    assert.equal(app.state.language, 'en', 'empty string falls back to en');
    assert.equal(app.state.dark, false, "only 'dark' counts as dark");
    assert.equal(app.storage.getItem(LANGUAGE_KEY), 'en', 'immediate watch rewrites the resolved language');
    assert.equal(app.storage.getItem(THEME_KEY), 'light', 'immediate watch rewrites the resolved theme');
  } finally { app.unmount(); }
});
