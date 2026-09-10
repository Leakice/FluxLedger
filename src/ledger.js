export const entryKinds = [
  { type: 'expense', label: 'Expenses', action: 'Add expense', icon: '↗' },
  { type: 'income', label: 'Income', action: 'Add income', icon: '↙' },
  { type: 'credit', label: 'Credit limit', action: 'Set credit limit', icon: '◇' },
];

export const creditAccountCards = [
  { id: 'credit-baitiao', name: '白条', last4: '', noLast4: true, network: 'Other', color: '#8659e7' },
  { id: 'credit-huabei', name: '花呗', last4: '', noLast4: true, network: 'Other', color: '#ed8d60' },
  { id: 'credit-meituan', name: '美团月付', last4: '', noLast4: true, network: 'Other', color: '#19ac87' },
  { id: 'credit-douyin', name: '抖音月付', last4: '', noLast4: true, network: 'Other', color: '#4c5868' },
];
export const defaultCards = [
  { id: '4329', name: 'Everyday card', last4: '4329', network: 'Visa', color: '#f4cf35' },
  { id: '8851', name: 'Lifestyle card', last4: '8851', network: 'Mastercard', color: '#2784f7' },
  ...creditAccountCards,
];

export function withCreditAccountCards(cards) {
  const normalizedCards = cards.map(card => {
    const creditCard = creditAccountCards.find(candidate => candidate.id === card.id || candidate.name === card.name);
    return creditCard ? { ...card, ...creditCard } : card;
  });
  return [...normalizedCards, ...creditAccountCards.filter(creditCard => !normalizedCards.some(card => card.id === creditCard.id))];
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
