// Harness for mounting src/App.vue under node --test: Map-backed localStorage
// per test, flushed reactivity, pinned clocks/UUIDs, and captured export blobs.
// Requires scripts/test-setup.mjs to have been preloaded (--import) so the Vue
// SFC loader and browser globals exist before any of this runs.
import { MapStorage } from '../scripts/test-env.mjs';

export { MapStorage };

export const STORAGE_KEYS = {
  transactions: 'cascade-transactions-v1',
  cards: 'fluxledger-cards-v1',
  hiddenBuiltInCardIds: 'fluxledger-hidden-built-in-cards-v1',
  language: 'cascade-language',
  theme: 'cascade-theme',
};

const trackedTimers = new Set();
let timersHooked = false;
function hookTimers() {
  if (timersHooked) return;
  timersHooked = true;
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

export function clearTrackedTimers() {
  for (const id of [...trackedTimers]) clearTimeout(id);
}

// Waits out Vue's pre-flush deep watchers (queued on the next tick) plus any
// macrotask follow-ups, so both watcher-based and explicit saves have landed.
export async function flush() {
  const { nextTick } = await import('vue');
  for (let i = 0; i < 3; i += 1) {
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

export async function mountApp({ storage = new MapStorage() } = {}) {
  hookTimers();
  globalThis.localStorage = storage;
  const [{ default: App }, { createApp }] = await Promise.all([import('./App.vue'), import('vue')]);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(App);
  app.mount(el);
  await flush();
  return {
    app,
    el,
    storage,
    state: app._instance.setupState,
    unmount() {
      app.unmount();
      el.remove();
    },
  };
}

export function snapshotKeys(storage) {
  const snapshot = {};
  for (const key of Object.values(STORAGE_KEYS)) snapshot[key] = storage.getItem(key);
  return snapshot;
}

// DataManagerDialog exposes only `open`, so drive its internal exportData via
// the component instance and capture the Blob handed to URL.createObjectURL.
export async function captureExport(state) {
  let blob = null;
  const original = globalThis.URL.createObjectURL;
  globalThis.URL.createObjectURL = value => {
    blob = value;
    return 'blob:captured';
  };
  try {
    state.dataDialog.$.setupState.exportData();
  } finally {
    if (original === undefined) delete globalThis.URL.createObjectURL;
    else globalThis.URL.createObjectURL = original;
  }
  return blob ? blob.text() : null;
}

const FIXED_NOW = Date.parse('2026-09-13T12:00:00.000Z');

// Pins `new Date()` (no args), `Date.now()` and crypto.randomUUID to
// deterministic values; returns a restore function.
export function pinDeterminism() {
  const RealDate = Date;
  const originalRandomUUID = globalThis.crypto.randomUUID;
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
  globalThis.crypto.randomUUID = () =>
    `00000000-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;
  return () => {
    globalThis.Date = RealDate;
    globalThis.crypto.randomUUID = originalRandomUUID;
  };
}

// Old data whose raw storage differs from the in-memory state after startup:
// built-in accounts lack the completion markers, expenses lack onCredit.
export function legacyFixture() {
  const cards = [
    { id: '4329', name: 'Everyday card', last4: '1001', network: 'Visa', accountType: 'Savings card', color: '#f4cf35' },
    { id: 'credit-baitiao', name: '白条', last4: '', noLast4: true, network: '白条', accountType: 'Credit card', color: '#8659e7' },
  ];
  const transactions = [
    { id: 101, type: 'expense', card: 'credit-baitiao', amount: 30, date: '2026-09-01', category: 'Shopping', description: 'Snack' },
    { id: 102, type: 'income', card: '4329', amount: 100, date: '2026-09-02', category: 'Salary', description: 'Payday' },
  ];
  return {
    [STORAGE_KEYS.transactions]: JSON.stringify(transactions),
    [STORAGE_KEYS.cards]: JSON.stringify(cards),
  };
}

export function simpleFixture() {
  const cards = [
    { id: '4329', name: 'Everyday card', last4: '1001', network: 'Visa', accountType: 'Savings card', color: '#f4cf35' },
    { id: '8851', name: 'Lifestyle card', last4: '1002', network: 'Mastercard', accountType: 'Savings card', color: '#2784f7' },
  ];
  const transactions = [
    { id: 301, type: 'income', card: '4329', amount: 90, date: '2026-09-01', category: 'Salary', description: 'Payday' },
    { id: 302, type: 'expense', card: '4329', amount: 12, date: '2026-09-03', category: 'Food & Drinks', description: 'Lunch' },
  ];
  return {
    [STORAGE_KEYS.transactions]: JSON.stringify(transactions),
    [STORAGE_KEYS.cards]: JSON.stringify(cards),
  };
}

export const expenseOf = (id, overrides = {}) => ({
  id, type: 'expense', card: '4329', amount: 5, date: '2026-09-05',
  category: 'Food & Drinks', description: 'Coffee', ...overrides,
});
