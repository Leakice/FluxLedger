import { entryKinds, periodEnd } from './ledger.js';

export const navigationPages = ['Dashboard', 'Transactions'];
export const transactionFilters = [
  { type: 'all', label: 'All', action: 'Add transaction', icon: '≡' },
  ...entryKinds,
];

// All is the complete ledger, independent of Dashboard filters. Typed views
// retain the original period/category rules and effective-date credit history.
export function selectTransactionRows(entries, {
  kind = 'all', month = '', period = 'month', cardIds = [],
  category = 'All categories', search = '', translate = value => value,
  accountLabel = id => id,
} = {}) {
  const prefix = period === 'year' ? month.slice(0, 4) : month;
  const asOf = kind === 'credit' ? periodEnd(month, period) : '';
  const query = search.toLowerCase();
  return entries.filter(entry => {
    if (kind !== 'all') {
      if (entry.type !== kind || !cardIds.includes(entry.card)) return false;
      if (kind === 'credit') {
        if (entry.date > asOf) return false;
      } else {
        if (!entry.date.startsWith(prefix)) return false;
        if (category !== 'All categories' && (category === 'Income' ? entry.type !== 'income' : entry.category !== category)) return false;
      }
    }
    return (entry.description + ' ' + translate(entry.category) + ' ' + entry.category + ' ' + accountLabel(entry.card)).toLowerCase().includes(query);
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}
