import { dictionary } from './locales.js';

const CATEGORY_NAMES = ['Food & Drinks','Entertainment','Utilities','Shopping','Subscription','Other','Salary','Income','Credit limit','Transfer'];

function fail(message) {
  throw new Error(message);
}

function entryType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'income' || normalized === '收入') return 'income';
  if (normalized === 'credit' || normalized === 'credit limit' || normalized === '信用额度') return 'credit';
  if (normalized === 'expense' || normalized === 'expenses' || normalized === '支出') return 'expense';
  fail('Transaction data is invalid.');
}

function categoryName(value) {
  const normalized = String(value || '').trim();
  return CATEGORY_NAMES.find(category => category === normalized || dictionary[category] === normalized) || normalized;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeId(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim();
  if (/^\d+$/.test(text)) return Number(text);
  return fallback;
}

function normalizeEntries(value) {
  if (!Array.isArray(value)) fail('No transaction data found.');
  const usedIds = new Set();
  const fallback = Date.now();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') fail('Transaction data is invalid.');
    const type = entryType(entry.type);
    const description = String(entry.description ?? '').trim();
    const amount = Number(entry.amount);
    const category = categoryName(entry.category);
    const date = String(entry.date ?? '').trim();
    const card = String(entry.card ?? '').trim();
    if (!description || !Number.isFinite(amount) || amount < 0 || !category || !validDate(date) || !card || (type !== 'credit' && amount <= 0)) {
      fail('Transaction data is invalid.');
    }
    let id = normalizeId(entry.id, fallback + index + 1);
    while (usedIds.has(String(id))) id = fallback + index + usedIds.size + 1;
    usedIds.add(String(id));
    const normalized = { id, description, amount, type, category, date, card };
    if (typeof entry.borrower === 'string' && entry.borrower.trim()) normalized.borrower = entry.borrower.trim();
    return normalized;
  });
}

function normalizeCards(value) {
  if (!Array.isArray(value)) fail('Card data is invalid.');
  const usedIds = new Set();
  return value.map(card => {
    if (!card || typeof card !== 'object') fail('Card data is invalid.');
    const id = String(card.id ?? card.last4 ?? '').trim();
    const name = String(card.name ?? '').trim();
    const last4 = String(card.last4 ?? '').trim();
    const network = String(card.network ?? '').trim();
    const color = String(card.color ?? '').trim();
    if (!id || usedIds.has(id) || !name || (last4 !== '' && !/^\d{4}$/.test(last4)) || !network || !/^#[0-9a-f]{6}$/i.test(color)) {
      fail('Card data is invalid.');
    }
    usedIds.add(id);
    const normalized = { id, name, last4, network, color };
    if (typeof card.noLast4 === 'boolean') normalized.noLast4 = card.noLast4;
    if (typeof card.accountType === 'string' && card.accountType.trim()) normalized.accountType = card.accountType.trim();
    if (card.accountTypeVersion === 1) normalized.accountTypeVersion = 1;
    if (typeof card.loanBorrower === 'string' && card.loanBorrower.trim()) normalized.loanBorrower = card.loanBorrower.trim();
    return normalized;
  });
}

function validateCardReferences(entries, cards) {
  const cardIds = new Set(cards.map(card => card.id));
  if (entries.some(entry => !cardIds.has(entry.card))) fail('The file references a card that does not exist.');
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);
  }
  return rows;
}

function findColumn(headers, aliases) {
  const normalized = aliases.map(value => value.trim().toLowerCase());
  return headers.findIndex(header => normalized.includes(header.trim().toLowerCase()));
}

function parseCsv(text, cards) {
  const rows = parseCsvRows(text);
  const headers = rows.shift()?.map((header, index) => `${index === 0 ? header.replace(/^\uFEFF/, '') : header}`) || [];
  const columns = {
    description: findColumn(headers, ['Description','交易说明','描述']),
    type: findColumn(headers, ['Type','类型']),
    category: findColumn(headers, ['Category','分类']),
    date: findColumn(headers, ['Date','日期']),
    card: findColumn(headers, ['Account','账户','Card','银行卡']),
    amount: findColumn(headers, ['Amount','Amount (¥)','Amount ($)','金额','金额（人民币）','金额（美元）'])
  };
  if (Object.values(columns).some(index => index < 0) || !rows.length) fail('No transaction data found.');
  const resolveCard = value => {
    const target = value.trim();
    const matches = cards.filter(item => {
      const names = new Set([item.name, dictionary[item.name]].filter(Boolean));
      return item.id === target || item.last4 === target ||
        [...names].some(name => (item.last4 ? `${name} · ${item.last4}` : name) === target);
    });
    if (matches.length !== 1) fail('The file references a card that does not exist.');
    return matches[0].id;
  };
  const entries = rows.map((row, index) => ({
    id: Date.now() + index + 1,
    description: row[columns.description],
    type: entryType(row[columns.type]),
    category: categoryName(row[columns.category]),
    date: row[columns.date],
    card: resolveCard(row[columns.card] || ''),
    amount: Number(String(row[columns.amount] ?? '').replace(/[^\d.-]/g, ''))
  }));
  return { format: 'csv', entries: normalizeEntries(entries), cards: normalizeCards(cards) };
}

function normalizeHiddenBuiltInCardIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('Hidden card data is invalid.');
  return [...new Set(value.map(id => String(id ?? '').trim()).filter(Boolean))];
}

export function createDataBackup(entries, cards, exportedAt = new Date(), hiddenBuiltInCardIds = []) {
  const normalizedCards = normalizeCards(cards);
  const normalizedEntries = normalizeEntries(entries);
  validateCardReferences(normalizedEntries, normalizedCards);
  return JSON.stringify({
    app: 'FluxLedger',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    transactions: normalizedEntries,
    cards: normalizedCards,
    hiddenBuiltInCardIds: normalizeHiddenBuiltInCardIds(hiddenBuiltInCardIds)
  }, null, 2);
}

export function parseDataFile(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) fail('The selected file is empty.');
  const content = text.replace(/^\uFEFF/, '').trim();
  const currentCards = normalizeCards(options.cards || []);
  if (content.startsWith('{') || content.startsWith('[')) {
    let payload;
    try {
      payload = JSON.parse(content);
    } catch {
      fail('The selected file is not valid JSON or CSV.');
    }
    const rawEntries = Array.isArray(payload) ? payload : payload.transactions ?? payload.entries;
    const rawCards = Array.isArray(payload) ? currentCards : payload.cards ?? currentCards;
    const entries = normalizeEntries(rawEntries);
    const cards = normalizeCards(rawCards);
    validateCardReferences(entries, cards);
    const hiddenBuiltInCardIds = normalizeHiddenBuiltInCardIds(Array.isArray(payload) ? undefined : payload.hiddenBuiltInCardIds);
    return { format: 'json', entries, cards, hiddenBuiltInCardIds };
  }
  return parseCsv(content, currentCards);
}
