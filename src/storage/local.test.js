// Unit tests for the local storage data layer. Each test injects its own
// backend, so nothing here touches a real browser localStorage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultBackend,
  loadTransactions, saveTransactions,
  loadCards, saveCards,
  loadHiddenBuiltInCardIds, saveHiddenBuiltInCardIds,
  loadLanguage, saveLanguage,
  loadTheme, saveTheme,
  exportBackup, parseImportFile,
} from './local.js';
import { MapStorage } from '../../scripts/test-env.mjs';

const TRANSACTIONS_KEY = 'cascade-transactions-v1';
const CARDS_KEY = 'fluxledger-cards-v1';
const HIDDEN_KEY = 'fluxledger-hidden-built-in-cards-v1';
const LANGUAGE_KEY = 'cascade-language';
const THEME_KEY = 'cascade-theme';

const sampleTransactions = [{ id: 1, type: 'expense', amount: 5, date: '2026-09-01' }];
const sampleCards = [{ id: '4329', name: 'Everyday card' }];
const throwingGetItem = { getItem: () => { throw new Error('storage read failed'); } };
const throwingSetItem = { getItem: () => null, setItem: () => { throw new Error('storage write failed'); } };
const countWrites = backend => {
  let writes = 0;
  return { backend, count: () => writes, getItem: backend.getItem.bind(backend), setItem: (...args) => { writes += 1; return backend.setItem(...args); } };
};

test('transactions save/load round-trip and store the original JSON encoding', () => {
  const storage = new MapStorage();
  assert.deepEqual(loadTransactions(sampleTransactions, storage), sampleTransactions);
  saveTransactions(sampleTransactions, storage);
  assert.equal(storage.getItem(TRANSACTIONS_KEY), JSON.stringify(sampleTransactions));
  assert.deepEqual(loadTransactions([], storage), sampleTransactions);
});

test('cards save/load round-trip and store the original JSON encoding', () => {
  const storage = new MapStorage();
  saveCards(sampleCards, storage);
  assert.equal(storage.getItem(CARDS_KEY), JSON.stringify(sampleCards));
  assert.deepEqual(loadCards([], storage), sampleCards);
});

test('hidden built-in card ids save/load round-trip and store the original JSON encoding', () => {
  const storage = new MapStorage();
  saveHiddenBuiltInCardIds(['online-wechat', 'online-alipay'], storage);
  assert.equal(storage.getItem(HIDDEN_KEY), '["online-wechat","online-alipay"]');
  assert.deepEqual(loadHiddenBuiltInCardIds([], storage), ['online-wechat', 'online-alipay']);
});

test('missing keys fall back without writing anything', () => {
  const wrapped = countWrites(new MapStorage());
  assert.deepEqual(loadTransactions(['fallback-entry'], wrapped), ['fallback-entry']);
  assert.deepEqual(loadCards([{ id: 'fallback-card' }], wrapped), [{ id: 'fallback-card' }]);
  assert.deepEqual(loadHiddenBuiltInCardIds(['fallback-id'], wrapped), ['fallback-id']);
  assert.equal(loadLanguage('en', wrapped), 'en');
  assert.equal(loadTheme(wrapped), false);
  assert.equal(wrapped.count(), 0, 'load operations must not persist anything');
});

test('corrupted JSON in the three data keys falls back per key', () => {
  const storage = new MapStorage({
    [TRANSACTIONS_KEY]: '{"broken":',
    [CARDS_KEY]: '[1,2',
    [HIDDEN_KEY]: 'not json',
  });
  assert.deepEqual(loadTransactions(['t-fallback'], storage), ['t-fallback']);
  assert.deepEqual(loadCards(['c-fallback'], storage), ['c-fallback']);
  assert.deepEqual(loadHiddenBuiltInCardIds(['h-fallback'], storage), ['h-fallback']);
});

test('JSON null in the three data keys falls back per key', () => {
  const storage = new MapStorage({
    [TRANSACTIONS_KEY]: 'null',
    [CARDS_KEY]: 'null',
    [HIDDEN_KEY]: 'null',
  });
  assert.deepEqual(loadTransactions(['t-fallback'], storage), ['t-fallback']);
  assert.deepEqual(loadCards(['c-fallback'], storage), ['c-fallback']);
  assert.deepEqual(loadHiddenBuiltInCardIds(['h-fallback'], storage), ['h-fallback']);
});

test('other legal JSON values pass through without added validation or cleaning', () => {
  const storage = new MapStorage({
    [TRANSACTIONS_KEY]: 'false',
    [CARDS_KEY]: '{"weird":"shape"}',
    [HIDDEN_KEY]: '"0"',
  });
  assert.equal(loadTransactions(['fallback'], storage), false);
  assert.deepEqual(loadCards(['fallback'], storage), { weird: 'shape' });
  assert.equal(loadHiddenBuiltInCardIds(['fallback'], storage), '0');
});

test('a throwing getItem falls back like the original read()', () => {
  assert.deepEqual(loadTransactions(['t-fallback'], throwingGetItem), ['t-fallback']);
  assert.deepEqual(loadCards(['c-fallback'], throwingGetItem), ['c-fallback']);
  assert.deepEqual(loadHiddenBuiltInCardIds(['h-fallback'], throwingGetItem), ['h-fallback']);
});

test('language uses raw string semantics with the empty string falling back', () => {
  assert.equal(loadLanguage('en', new MapStorage({ [LANGUAGE_KEY]: 'zh' })), 'zh');
  assert.equal(loadLanguage('en', new MapStorage({ [LANGUAGE_KEY]: '' })), 'en');
  assert.equal(loadLanguage('en', new MapStorage()), 'en');
  const storage = new MapStorage();
  saveLanguage('zh', storage);
  assert.equal(storage.getItem(LANGUAGE_KEY), 'zh', 'language is stored raw, not JSON-wrapped');
});

test('theme keeps the dark/light raw encoding behind a boolean API', () => {
  assert.equal(loadTheme(new MapStorage({ [THEME_KEY]: 'dark' })), true);
  assert.equal(loadTheme(new MapStorage({ [THEME_KEY]: 'light' })), false);
  assert.equal(loadTheme(new MapStorage({ [THEME_KEY]: 'DARK' })), false);
  assert.equal(loadTheme(new MapStorage()), false);
  const storage = new MapStorage();
  saveTheme(true, storage);
  assert.equal(storage.getItem(THEME_KEY), 'dark');
  saveTheme(false, storage);
  assert.equal(storage.getItem(THEME_KEY), 'light');
});

test('write failures are not silently reported as success', () => {
  assert.throws(() => saveTransactions(sampleTransactions, throwingSetItem), /storage write failed/);
  assert.throws(() => saveCards(sampleCards, throwingSetItem), /storage write failed/);
  assert.throws(() => saveHiddenBuiltInCardIds([], throwingSetItem), /storage write failed/);
  assert.throws(() => saveLanguage('zh', throwingSetItem), /storage write failed/);
  assert.throws(() => saveTheme(true, throwingSetItem), /storage write failed/);
});

test('injected backends are isolated from each other and from the default', () => {
  // Runs without a browser too: install an explicit default backend and
  // restore whatever was there (possibly nothing) afterwards.
  const original = globalThis.localStorage;
  const defaultStorage = new MapStorage({ [LANGUAGE_KEY]: 'sentinel' });
  globalThis.localStorage = defaultStorage;
  try {
    assert.equal(defaultBackend(), defaultStorage, 'the default backend resolves the current global localStorage');
    const first = new MapStorage();
    const second = new MapStorage();
    saveTransactions(sampleTransactions, first);
    saveLanguage('zh', second);
    saveTheme(true, second);
    assert.equal(defaultStorage.getItem(TRANSACTIONS_KEY), null, 'injected-backend writes must not reach the default backend');
    assert.equal(defaultStorage.getItem(LANGUAGE_KEY), 'sentinel', 'injected-backend writes must not touch the default backend');
    assert.equal(second.getItem(TRANSACTIONS_KEY), null);
    assert.deepEqual(loadTransactions(['fallback'], second), ['fallback']);
  } finally {
    if (original === undefined) {
      try { delete globalThis.localStorage; } catch { /* keep environment as-is */ }
    } else {
      globalThis.localStorage = original;
    }
  }
});

test('import and export wrappers keep the dataTransfer contract', () => {
  const storage = new MapStorage();
  saveCards([{ id: '1001', name: 'Imported card', last4: '', noLast4: true, network: 'Other', accountType: 'Alipay', color: '#123456' }], storage);
  const payload = parseImportFile(JSON.stringify({
    app: 'FluxLedger', version: 1, exportedAt: '2026-01-01T00:00:00.000Z',
    transactions: [{ id: 1, type: 'expense', card: '1001', amount: 9, date: '2026-08-15', category: 'Food & Drinks', description: 'Snack' }],
    cards: [{ id: '1001', name: 'Imported card', last4: '', noLast4: true, network: 'Other', accountType: 'Alipay', color: '#123456' }],
  }), loadCards([], storage));
  assert.equal(payload.format, 'json');
  assert.equal(payload.entries.length, 1);
  assert.deepEqual(payload.cards, loadCards([], storage), 'import parses against the passed full account list');
  const backup = exportBackup([{ id: 1, type: 'expense', card: '1001', amount: 9, date: '2026-08-15', category: 'Food & Drinks', description: 'Snack', onCredit: false }],
    payload.cards, ['online-wechat'], new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(JSON.parse(backup).exportedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(JSON.parse(backup).hiddenBuiltInCardIds, ['online-wechat']);
});
