export const entryKinds = [
  { type: 'expense', label: 'Expenses', action: 'Add expense', icon: '↗' },
  { type: 'income', label: 'Income', action: 'Add income', icon: '↙' },
  { type: 'credit', label: 'Credit limit', action: 'Set credit limit', icon: '◇' },
];

export const creditAccountCards = [
  { id: 'credit-baitiao', name: '白条', last4: '', noLast4: true, network: 'Other', accountType: 'Credit card', color: '#8659e7' },
  { id: 'credit-huabei', name: '花呗', last4: '', noLast4: true, network: 'Other', accountType: 'Credit card', color: '#ed8d60' },
  { id: 'credit-meituan', name: '美团月付', last4: '', noLast4: true, network: 'Other', accountType: 'Credit card', color: '#19ac87' },
  { id: 'credit-douyin', name: '抖音月付', last4: '', noLast4: true, network: 'Other', accountType: 'Credit card', color: '#4c5868' },
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
  if (!definition) return undefined;
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
    normalizedCards.push(builtInCard ? { ...builtInCard, ...card, id: card.id } : card);
  }

  for (const builtInCard of visibleBuiltInCards) {
    if (!claimedBuiltInIds.has(builtInCard.id) && !seenIds.has(builtInCard.id)) normalizedCards.push({ ...builtInCard });
  }
  return normalizedCards;
}
export function creditLimit(entries, cardId, asOf) {
  const settings = entries.filter(e => e.type === 'credit' && e.card === cardId && e.date <= asOf);
  settings.sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
  return settings[0]?.amount ?? 0;
}

export function periodEnd(month, period) {
  if (period === 'year') return `${month.slice(0, 4)}-12-31`;
  const [year, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(year, m, 0).getDate()).padStart(2, '0')}`;
}

export function buildFlowModel(periodEntries, allEntries, cards, asOf, category = 'All categories') {
  const nodes = cards.map(card => {
    const records = periodEntries.filter(e => e.card === card.id);
    const income = records.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
    const credit = creditLimit(allEntries, card.id, asOf);
    const expenses = records.filter(e => e.type === 'expense' && (category === 'All categories' || e.category === category));
    const spent = expenses.reduce((s, e) => s + e.amount, 0);
    return { ...card, income, credit, capacity: income + credit, expenses, spent, gap: Math.max(0, spent - income - credit) };
  });
  const sum = key => nodes.reduce((s, c) => s + c[key], 0);
  return { cards: nodes, income: sum('income'), credit: sum('credit'), capacity: sum('capacity'), spent: sum('spent'), gap: sum('gap') };
}
