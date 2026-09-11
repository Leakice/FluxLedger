// Keep v1 field names and legacy type values; transactions reference only id.
export const accountTypes = ['Savings card', 'Credit card', 'Online loan', 'Alipay', 'WeChat Pay', 'Online banking', 'Other'];
export const accountTypeOf = account => account.accountType || 'Savings card';
export const isBankAccount = account => ['Savings card', 'Credit card'].includes(accountTypeOf(account));
export const isOnlineLoanAccount = account => !!account && accountTypeOf(account) === 'Online loan';
export const isCreditSpendingAccount = account => !!account && (isOnlineLoanAccount(account) || accountTypeOf(account) === 'Credit card');
export function inferCreditExpenses(entries, cards) {
  return entries.map(entry => entry.type === 'expense' && isCreditSpendingAccount(cards.find(c => c.id === entry.card)) ? { ...entry, onCredit: true } : entry);
}
export const canRecordIncome = (account, originalEntry) => !isOnlineLoanAccount(account) ||
  (originalEntry?.type === 'income' && originalEntry.card === account.id);
export const loanProviders = ['白条', '花呗', '美团月付', '抖音月付', 'Other'];
export const accountLast4 = account => isBankAccount(account) && !account.noLast4 ? account.last4 || '' : '';
export const accountProvider = account => isBankAccount(account) || isOnlineLoanAccount(account) ? account.network : accountTypeOf(account);

export const entryKinds = [
  { type: 'expense', label: 'Expenses', action: 'Add expense', icon: '↗' },
  { type: 'income', label: 'Income', action: 'Add income', icon: '↙' },
  { type: 'repayment', label: 'Repayments', action: 'Repay credit', icon: '→' },
  { type: 'credit', label: 'Credit limit', action: 'Set credit limit', icon: '◇' },
];

export const creditAccountCards = [
  { id: 'credit-baitiao', name: '白条', last4: '', noLast4: true, network: '白条', accountType: 'Online loan', color: '#8659e7' },
  { id: 'credit-huabei', name: '花呗', last4: '', noLast4: true, network: '花呗', accountType: 'Online loan', color: '#ed8d60' },
  { id: 'credit-meituan', name: '美团月付', last4: '', noLast4: true, network: '美团月付', accountType: 'Online loan', color: '#19ac87' },
  { id: 'credit-douyin', name: '抖音月付', last4: '', noLast4: true, network: '抖音月付', accountType: 'Online loan', color: '#4c5868' },
];

export const onlineBalanceCards = [
  { id: 'online-wechat', name: '微信余额', last4: '', noLast4: true, network: 'Online banking', accountType: 'Online banking', color: '#19ac87' },
  { id: 'online-alipay', name: '支付宝余额', last4: '', noLast4: true, network: 'Online banking', accountType: 'Online banking', color: '#2784f7' },
  { id: 'online-yuebao', name: '余额宝余额', last4: '', noLast4: true, network: 'Online banking', accountType: 'Online banking', color: '#f4cf35' },
  { id: 'online-lingqiantong', name: '零钱通余额', last4: '', noLast4: true, network: 'Online banking', accountType: 'Online banking', color: '#19ac87' },
  { id: 'online-xiaohebao', name: '支付宝小荷包', last4: '', noLast4: true, network: 'Online banking', accountType: 'Online banking', color: '#8659e7' },
];

const builtInAccountCards = [...creditAccountCards, ...onlineBalanceCards];
export const builtInAccountCardIds = new Set(builtInAccountCards.map(card => card.id));
export const isBuiltInAccountCard = id => builtInAccountCardIds.has(id);

export function resolveCreditAccountCard(cards, accountName) {
  const definition = creditAccountCards.find(card => card.name === accountName);
  if (!definition) return cards.find(card => card.name === accountName && (isOnlineLoanAccount(card) || accountTypeOf(card) === 'Credit card'));
  return cards.find(card => card.id === definition.id) || cards.find(card => card.name === definition.name);
}

export function findLoanCard(cards, borrower, currentCardId) {
  const normalizedBorrower = String(borrower ?? '').trim();
  if (!normalizedBorrower) return undefined;
  return cards.find(card => card.id === currentCardId && card.loanBorrower === normalizedBorrower) ||
    cards.find(card => card.loanBorrower === normalizedBorrower);
}

export const defaultCards = [
  { id: '4329', name: 'Everyday card', last4: '4329', network: 'Visa', accountType: 'Savings card', color: '#f4cf35' },
  { id: '8851', name: 'Lifestyle card', last4: '8851', network: 'Mastercard', accountType: 'Savings card', color: '#2784f7' },
  ...builtInAccountCards,
];

export function withBuiltInAccountCards(cards, hiddenCardIds = []) {
  const hiddenIds = new Set(hiddenCardIds);
  const visibleBuiltInCards = builtInAccountCards.filter(card => !hiddenIds.has(card.id));
  const persistedCards = cards.filter(card => !hiddenIds.has(card.id));
  const persistedIds = new Set(persistedCards.map(card => card.id));
  const claimedBuiltInIds = new Set();
  const seenIds = new Set();
  const normalizedCards = [];

  for (const card of persistedCards) {
    // Stable IDs win. Name matching only migrates a legacy/user card when no
    // persisted card already owns the built-in ID, and must retain that card's ID.
    const builtInCard = visibleBuiltInCards.find(candidate => candidate.id === card.id) ||
      visibleBuiltInCards.find(candidate => !persistedIds.has(candidate.id) && !claimedBuiltInIds.has(candidate.id) && candidate.name === card.name);
    if (seenIds.has(card.id)) continue;
    seenIds.add(card.id);
    if (builtInCard) claimedBuiltInIds.add(builtInCard.id);
    const normalized = builtInCard ? { ...builtInCard, ...card, id: card.id } : card;
    // These built-in lenders were incorrectly stored as credit cards in v1.
    // Version 1 marks migrated or explicitly saved types so future edits survive reload.
    // IDs, amounts and transaction types stay intact.
    if (builtInCard && isOnlineLoanAccount(builtInCard) && card.accountTypeVersion !== 1) {
      if (!card.accountType || card.accountType === 'Credit card') {
        normalized.accountType = 'Online loan';
        if (!card.network || card.network === 'Other') normalized.network = builtInCard.network;
      }
      normalized.accountTypeVersion = 1;
    }
    normalizedCards.push(normalized);
  }

  for (const builtInCard of visibleBuiltInCards) {
    if (!claimedBuiltInIds.has(builtInCard.id) && !seenIds.has(builtInCard.id)) normalizedCards.push({ ...builtInCard, ...(isOnlineLoanAccount(builtInCard) ? { accountTypeVersion: 1 } : {}) });
  }
  return normalizedCards;
}
export function creditLimit(entries, cardId, asOf) {
  const settings = entries.filter(e => e.type === 'credit' && e.card === cardId && e.date <= asOf);
  settings.reverse().sort((a, b) => b.date.localeCompare(a.date) || (Number(b.id) - Number(a.id) || 0));
  return settings[0]?.amount ?? 0;
}

export function periodEnd(month, period) {
  if (period === 'year') return `${month.slice(0, 4)}-12-31`;
  const [year, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(year, m, 0).getDate()).padStart(2, '0')}`;
}

export function buildFlowModel(periodEntries, allEntries, cards, asOf, category = 'All categories', allCards = cards) {
  const nodes = cards.map(card => {
    const records = periodEntries.filter(e => e.card === card.id);
    const income = records.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
    const credit = creditLimit(allEntries, card.id, asOf);
    const expenses = records.filter(e => e.type === 'expense' && (category === 'All categories' || e.category === category));
    const spent = expenses.reduce((s, e) => s + e.amount, 0);
    return { ...card, income, credit, capacity: income + credit, expenses, spent, gap: Math.max(0, spent - income - credit) };
  });
  const sum = key => nodes.reduce((s, c) => s + c[key], 0);
  const repayments = periodEntries.filter(e => e.type === 'repayment' && e.date <= asOf && (cards.some(c => c.id === e.card || c.id === e.toCard))).filter(e => category === 'All categories' || allEntries.find(p => p.id === e.purchaseId)?.category === category);
  return { repayments: repayments.map(e => ({ ...e, source: allCards.find(c => c.id === e.card), target: allCards.find(c => c.id === e.toCard), purchase: creditPurchases(allEntries, asOf).find(p => p.id === e.purchaseId) })), cards: nodes, income: sum('income'), credit: sum('credit'), capacity: sum('capacity'), spent: sum('spent'), gap: sum('gap') };
}

// Derive balances from records in cents: saving, editing and deleting cannot double-post.
export const cents = amount => Math.round(Number(amount) * 100);
export function creditPurchases(entries, asOf = '9999-12-31') {
  return entries.filter(e => e.type === 'expense' && e.onCredit && e.date <= asOf).map(e => {
    const paid = entries.filter(r => r.type === 'repayment' && r.purchaseId === e.id && r.date <= asOf).reduce((s,r) => s + cents(r.amount), 0);
    const due = cents(e.amount) - paid;
    return { ...e, paid: paid / 100, due: due / 100, status: due === 0 ? 'Paid' : paid > 0 ? 'Partially paid' : 'Unpaid' };
  });
}
export function accountBalances(entries, cards, asOf) {
  const purchases = creditPurchases(entries, asOf);
  return cards.map(card => {
    const cash = entries.filter(e => e.card === card.id && e.date <= asOf).reduce((s,e) => s + (e.type === 'income' ? cents(e.amount) : e.type === 'repayment' || (e.type === 'expense' && !e.onCredit) ? -cents(e.amount) : 0), 0);
    const debt = purchases.filter(e => e.card === card.id).reduce((s,e) => s + cents(e.due), 0);
    return { ...card, cash: cash / 100, debt: debt / 100 };
  });
}
export function validateLedger(entries, cards) {
  const ids = new Set();
  for (const e of entries) {
    if (ids.has(e.id)) return 'Duplicate transaction';
    ids.add(e.id);
    if (!entryKinds.some(k => k.type === e.type) || !cards.some(c => c.id === e.card)) return 'Invalid account or transaction';
    if (!Number.isFinite(e.amount) || e.amount < 0 || (e.type !== 'credit' && cents(e.amount) <= 0) || Math.abs(e.amount * 100 - cents(e.amount)) > 0.00001) return 'Invalid amount';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date)) || new Date(e.date).toISOString().slice(0,10) !== e.date) return 'Invalid date';
    if (e.type === 'repayment') {
      const purchase = entries.find(p => p.id === e.purchaseId && p.type === 'expense' && p.onCredit);
      if (!purchase || purchase.card !== e.toCard || e.card === e.toCard) return 'Select a linked credit purchase and a different paying account';
      if (e.date < purchase.date) return 'Repayment cannot precede purchase';
    }
  }
  if (creditPurchases(entries).some(e => e.due < 0)) return 'Repayment exceeds amount due';
  return '';
}
export function saveTransaction(entries, entry, cards) {
  const next = inferCreditExpenses(entries.some(e => e.id === entry.id) ? entries.map(e => e.id === entry.id ? entry : e) : [...entries, entry], cards);
  const error = validateLedger(next, cards);
  if (error) throw new Error(error);
  return next;
}
