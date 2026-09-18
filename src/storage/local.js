// Central access point for the five persisted keys. One storage backend
// (anything with getItem/setItem) serves every operation; the default is the
// browser localStorage, resolved lazily at call time so this module stays
// importable outside the browser. Key names, encodings, fallbacks and read
// semantics must stay byte-compatible with the pre-storage-module app.
import { createDataBackup, parseDataFile } from '../dataTransfer.js';

export const KEYS = {
  transactions: 'cascade-transactions-v1',
  cards: 'fluxledger-cards-v1',
  hiddenBuiltInCardIds: 'fluxledger-hidden-built-in-cards-v1',
  language: 'cascade-language',
  theme: 'cascade-theme',
};

export const defaultBackend = () => globalThis.localStorage;

// Session backend (PR3 cloud mode): src/storage/cloud.js installs a
// per-account namespaced backend once the visitor signs in. Only the three
// data keys ever consult it; language/theme stay device preferences on the
// original keys. Guest mode never installs one, so all reads and writes keep
// hitting the original keys byte-identically.
let sessionBackend = null;
export const setSessionBackend = backend => { sessionBackend = backend; };
const dataBackend = () => sessionBackend ?? defaultBackend();

// Original read() semantics: missing key, JSON null, invalid JSON and a
// throwing getItem all fall back; other legal JSON values pass through
// untouched (no validation or cleaning beyond the original).
function readJson(key, fallback, backend) {
  try {
    return JSON.parse(backend.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export const loadTransactions = (fallback = [], backend = dataBackend()) =>
  readJson(KEYS.transactions, fallback, backend);
export const saveTransactions = (value, backend = dataBackend()) =>
  backend.setItem(KEYS.transactions, JSON.stringify(value));

export const loadCards = (fallback = [], backend = dataBackend()) =>
  readJson(KEYS.cards, fallback, backend);
export const saveCards = (value, backend = dataBackend()) =>
  backend.setItem(KEYS.cards, JSON.stringify(value));

export const loadHiddenBuiltInCardIds = (fallback = [], backend = dataBackend()) =>
  readJson(KEYS.hiddenBuiltInCardIds, fallback, backend);
export const saveHiddenBuiltInCardIds = (value, backend = dataBackend()) =>
  backend.setItem(KEYS.hiddenBuiltInCardIds, JSON.stringify(value));

// Language keeps its original raw-string encoding (no JSON wrapping) and the
// getItem exception behavior of the original `getItem(...) || 'en'` read.
export const loadLanguage = (fallback = 'en', backend = defaultBackend()) =>
  backend.getItem(KEYS.language) || fallback;
export const saveLanguage = (value, backend = defaultBackend()) =>
  backend.setItem(KEYS.language, value);

// Theme is exposed as a boolean; the stored form stays the original
// raw 'dark' / 'light' string.
export const loadTheme = (backend = defaultBackend()) =>
  backend.getItem(KEYS.theme) === 'dark';
export const saveTheme = (dark, backend = defaultBackend()) =>
  backend.setItem(KEYS.theme, dark ? 'dark' : 'light');

// Import/export keep dataTransfer's rules unchanged; these wrappers exist so
// business components reach the data layer instead of dataTransfer directly.
export const exportBackup = (entries, cards, hiddenBuiltInCardIds, exportedAt = new Date()) =>
  createDataBackup(entries, cards, exportedAt, hiddenBuiltInCardIds);
export const parseImportFile = (text, cards) =>
  parseDataFile(text, { cards });
