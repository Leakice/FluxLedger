// Two-version replay harness for the PR2 storage refactor. Mounts the App from
// a given repo root (baseline worktree or PR worktree), replays fixed user
// scenarios against a fresh Map-backed localStorage, and records the five
// storage keys' raw strings plus page side effects after every checkpoint.
// Fixed clock / Date.now() / UUID sequence / export time make both runs
// byte-comparable. Usage:
//   node scripts/replay/replay.mjs --app <repoRoot> --out <snapshots.json>
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerVueLoader, setupDom, MapStorage } from '../test-env.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' }, out: { type: 'string' } } });
if (!values.app || !values.out) {
  console.error('usage: node scripts/replay/replay.mjs --app <repoRoot> --out <snapshots.json>');
  process.exit(1);
}
registerVueLoader();
setupDom();

const KEYS = {
  transactions: 'cascade-transactions-v1',
  cards: 'fluxledger-cards-v1',
  hidden: 'fluxledger-hidden-built-in-cards-v1',
  language: 'cascade-language',
  theme: 'cascade-theme',
};
const KEY_NAMES = Object.values(KEYS);

// ---- determinism: fixed clock, Date.now(), UUID sequence for the whole run ----
const FIXED_NOW = Date.parse('2026-09-13T12:00:00.000Z');
const RealDate = Date;
let uuidSeq = 0;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(FIXED_NOW);
  }
  static now() {
    return FIXED_NOW;
  }
};
globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;

// ---- timer tracking so toasts never hold the process open ----
const trackedTimers = new Set();
{
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const id = originalSetTimeout((...args) => {
      trackedTimers.delete(id);
      fn(...args);
    }, ms, ...rest);
    trackedTimers.add(id);
    return id;
  };
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.clearTimeout = id => {
    trackedTimers.delete(id);
    return originalClearTimeout(id);
  };
}
function clearTrackedTimers() {
  for (const id of [...trackedTimers]) clearTimeout(id);
}

const appRoot = resolve(values.app);
const appModulePromise = import(pathToFileURL(resolve(appRoot, 'src/App.vue')).href);

async function flush() {
  const { nextTick } = await import('vue');
  for (let i = 0; i < 3; i += 1) {
    await nextTick();
    await new Promise(done => setTimeout(done, 0));
  }
}

let current = null; // { app, el }
async function mount(storage) {
  globalThis.localStorage = storage;
  const [{ default: App }, { createApp }] = await Promise.all([appModulePromise, import('vue')]);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(App);
  app.mount(el);
  await flush();
  current = { app, el };
  return app._instance.setupState;
}
function unmount() {
  if (!current) return;
  current.app.unmount();
  current.el.remove();
  current = null;
}
function reload() {
  const { storage } = context;
  unmount();
  return mount(storage);
}

function snapshot(name) {
  const storage = context.storage;
  const keys = {};
  for (const key of KEY_NAMES) keys[key] = storage.getItem(key);
  return {
    name,
    keys,
    page: {
      lang: document.documentElement.lang,
      title: document.title,
      bodyClass: document.body.className,
    },
  };
}

const context = { storage: null };
const scenarios = [];
function scenario(name, fixture, run) {
  scenarios.push({ name, fixture, run });
}

async function checkpoint(name) {
  await flush();
  context.checkpoints.push(snapshot(name));
}

async function exportJson(name) {
  let blob = null;
  const original = globalThis.URL.createObjectURL;
  globalThis.URL.createObjectURL = value => {
    blob = value;
    return 'blob:captured';
  };
  try {
    await flush();
    document.querySelector('.data-manager-trigger').click();
    await flush();
    document.querySelector('.data-actions .data-action').click();
    await flush();
  } finally {
    if (original === undefined) delete globalThis.URL.createObjectURL;
    else globalThis.URL.createObjectURL = original;
  }
  if (!blob) throw new Error('export produced no blob');
  context.exports.push({ name, backup: await blob.text() });
}

// Feeds a file to the data manager dialog's real file input and confirms the
// replacement through the rendered preview, so both versions run the whole
// DataManagerDialog chain (chooseFile → parse → preview → import) and not just
// the resulting App.importData call.
async function importViaDialog(text, fileName) {
  document.querySelector('.data-manager-trigger').click();
  await flush();
  const file = new File([text], fileName, {
    type: fileName.endsWith('.json') ? 'application/json' : 'text/csv',
  });
  const input = document.querySelector('.data-file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await flush();
  if (!document.querySelector('.data-import-preview')) throw new Error('import preview did not render');
  document.querySelector('.data-import-preview .primary.submit').click();
  await flush();
}

// ---- fixtures ----
const seededCards = [
  { id: '4329', name: 'Everyday card', last4: '1001', network: 'Visa', accountType: 'Savings card', color: '#f4cf35' },
  { id: '8851', name: 'Lifestyle card', last4: '1002', network: 'Mastercard', accountType: 'Savings card', color: '#2784f7' },
];
const seededTransactions = [
  { id: 301, type: 'income', card: '4329', amount: 90, date: '2026-09-01', category: 'Salary', description: 'Payday' },
  { id: 302, type: 'expense', card: '4329', amount: 12, date: '2026-09-03', category: 'Food & Drinks', description: 'Lunch' },
];
const fixtures = {
  empty: () => new MapStorage({}),
  seeded: () => new MapStorage({
    [KEYS.transactions]: JSON.stringify(seededTransactions),
    [KEYS.cards]: JSON.stringify(seededCards),
  }),
  legacy: () => new MapStorage({
    [KEYS.transactions]: JSON.stringify([
      { id: 101, type: 'expense', card: 'credit-baitiao', amount: 30, date: '2026-09-01', category: 'Shopping', description: 'Snack' },
      { id: 102, type: 'income', card: '4329', amount: 100, date: '2026-09-02', category: 'Salary', description: 'Payday' },
    ]),
    [KEYS.cards]: JSON.stringify([
      { id: '4329', name: 'Everyday card', last4: '1001', network: 'Visa', accountType: 'Savings card', color: '#f4cf35' },
      { id: 'credit-baitiao', name: '白条', last4: '', noLast4: true, network: '白条', accountType: 'Credit card', color: '#8659e7' },
    ]),
  }),
  corrupted: () => new MapStorage({
    [KEYS.transactions]: '{"broken":',
    [KEYS.cards]: '[1,2',
    [KEYS.hidden]: 'not json',
  }),
  rawPrefs: () => new MapStorage({
    [KEYS.transactions]: JSON.stringify(seededTransactions),
    [KEYS.cards]: JSON.stringify(seededCards),
    [KEYS.language]: '',
    [KEYS.theme]: 'DARK',
  }),
};

const importFile = JSON.stringify({
  app: 'FluxLedger', version: 1, exportedAt: '2026-01-01T00:00:00.000Z',
  transactions: [{ id: 501, type: 'expense', card: '1001', amount: 9, date: '2026-08-15', category: 'Food & Drinks', description: 'Imported snack' }],
  cards: [{ id: '1001', name: 'Imported card', last4: '', noLast4: true, network: 'Other', accountType: 'Alipay', color: '#123456' }],
  hiddenBuiltInCardIds: ['online-alipay'],
});
const csvFile = ['Description,Type,Category,Date,Account,Amount',
  'Coffee,expense,Food & Drinks,2026-09-06,Everyday card · 1001,3.5'].join('\n');

const state = () => current.app._instance.setupState;
const expense = (id, overrides = {}) => ({
  id, type: 'expense', card: '4329', amount: 5, date: '2026-09-05',
  category: 'Food & Drinks', description: 'Coffee', ...overrides,
});

// ---- scenario 1: transactions, filters, theme, reload, export ----
scenario('1-mixed-flow', fixtures.seeded, async () => {
  await checkpoint('open');
  document.querySelectorAll('.language-switch button')[1].click();
  await checkpoint('switch-zh');
  state().saveEntry(expense(1001));
  await checkpoint('add-expense');
  state().saveEntry(expense(1001, { amount: 7, description: 'Coffee edit' }));
  await checkpoint('edit-expense');
  state().remove(state().entries.find(e => e.id === 1001));
  await checkpoint('delete-expense');
  state().undo();
  await checkpoint('undo');
  document.querySelector('.bank-card-list input[type=checkbox]').click();
  await checkpoint('filter-one-account');
  document.querySelectorAll('nav button')[0].click();
  await checkpoint('filter-all-accounts');
  document.querySelector('.theme-switch button').click();
  await checkpoint('dark-theme');
  await reload();
  await checkpoint('reload');
  await exportJson('export-after-reload');
});

// ---- scenario 2: account lifecycle ----
scenario('2-account-lifecycle', fixtures.seeded, async () => {
  await checkpoint('open');
  state().saveCard({ name: 'Trip card', last4: '3003', network: 'Visa', accountType: 'Savings card', color: '#19ac87' });
  await checkpoint('add-account');
  const createdId = state().bankCards.find(c => c.name === 'Trip card').id;
  state().saveCard({ ...state().bankCards.find(c => c.id === createdId), name: 'Trip card 2' });
  await checkpoint('edit-account');
  state().removeCard(createdId);
  await checkpoint('delete-user-account');
  state().removeCard('online-xiaohebao');
  await checkpoint('delete-built-in-account');
  await reload();
  await checkpoint('reload');
});

// ---- scenario 3: borrower auto-account, success and failure branches ----
scenario('3-loan-account', fixtures.seeded, async () => {
  await checkpoint('open');
  state().saveEntry({ id: 2001, type: 'credit', description: '借款', borrower: 'Alice', amount: 1000, date: '2026-09-10', card: '' });
  await checkpoint('loan-success');
  state().saveEntry({ id: 2002, type: 'credit', description: '借款', borrower: 'Bob', amount: -5, date: '2026-09-10', card: '' });
  await checkpoint('loan-validation-failure');
  state().saveEntry({ id: 2003, type: 'income', card: 'credit-baitiao', amount: 50, date: '2026-09-06', category: 'Salary', description: 'Loan funding' });
  await checkpoint('income-on-loan-rejected');
});

// ---- scenario 4: JSON import round trip ----
scenario('4-json-import', fixtures.seeded, async () => {
  await checkpoint('open');
  await importViaDialog(importFile, 'backup.json');
  await checkpoint('imported');
  await exportJson('export-after-import');
  await reload();
  await checkpoint('reload');
});

// ---- scenario 5: legacy CSV import round trip ----
scenario('5-csv-import', fixtures.seeded, async () => {
  await checkpoint('open');
  await importViaDialog(csvFile, 'legacy.csv');
  await checkpoint('imported');
  await exportJson('export-after-import');
  await reload();
  await checkpoint('reload');
});

// ---- scenario 6: empty storage startup ----
scenario('6-empty-startup', fixtures.empty, async () => {
  await checkpoint('open');
  await exportJson('first-open-export');
  state().saveEntry(expense(1001));
  await checkpoint('first-transaction-save');
  state().saveCard({ name: 'Trip card', last4: '3003', network: 'Visa', accountType: 'Savings card', color: '#19ac87' });
  await checkpoint('first-account-save');
  await reload();
  await checkpoint('reload');
});

// ---- scenario 7: legacy data startup (completion + inference, no writes) ----
scenario('7-legacy-startup', fixtures.legacy, async () => {
  await checkpoint('open');
  await exportJson('first-open-export');
  state().saveEntry({ id: 2004, type: 'expense', card: 'credit-baitiao', amount: 8, date: '2026-09-08', category: 'Shopping', description: 'Credit snack' });
  await checkpoint('transaction-save-after-inference');
  state().saveCard({ ...state().bankCards.find(c => c.id === '4329'), name: 'Renamed card' });
  await checkpoint('account-save-after-completion');
  await reload();
  await checkpoint('reload');
});

// ---- scenario 8: corrupted JSON data ----
scenario('8-corrupted-data', fixtures.corrupted, async () => {
  await checkpoint('open');
  state().language = 'zh';
  await checkpoint('switch-zh');
  state().saveEntry(expense(1001));
  await checkpoint('save-over-corrupted-key');
  await reload();
  await checkpoint('reload');
});

// ---- scenario 9: raw preference strings, chart-jump filters, hidden restore ----
scenario('9-prefs-and-filters', fixtures.rawPrefs, async () => {
  await checkpoint('open');
  // Uncheck the second account (no records), keeping the first account's
  // capacity above zero so the flow chart keeps rendering its account node.
  document.querySelectorAll('.bank-card-list input[type=checkbox]')[1].click();
  await checkpoint('filter-one-account');
  document.querySelector('#flow-chart [data-flow-id^="account:"]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await checkpoint('chart-jump-filter');
  document.querySelectorAll('nav button')[0].click();
  await checkpoint('reset-filters');
  document.querySelector('.theme-switch button').click();
  await checkpoint('dark-theme');
  const row = [...document.querySelectorAll('.bank-card-row')]
    .find(item => item.querySelector('input').value === 'online-lingqiantong');
  row.querySelector('.bank-card-edit').click();
  await flush();
  document.querySelector('.card-delete').click();
  await checkpoint('delete-built-in');
  await reload();
  await checkpoint('reload');
});

// ---- run everything ----
const results = [];
for (const { name, fixture, run } of scenarios) {
  context.storage = fixture();
  context.checkpoints = [];
  context.exports = [];
  await mount(context.storage);
  try {
    await run();
  } finally {
    unmount();
    clearTrackedTimers();
  }
  results.push({ name, checkpoints: context.checkpoints, exports: context.exports });
  console.error(`scenario ${name}: ${context.checkpoints.length} checkpoints, ${context.exports.length} exports`);
}

const output = {
  meta: {
    appRoot,
    node: process.version,
    fixedNow: new Date(FIXED_NOW).toISOString(),
    generatedAt: 'fixed-clock run',
  },
  scenarios: results,
};
writeFileSync(values.out, JSON.stringify(output, null, 1));
console.error(`wrote ${values.out}`);
