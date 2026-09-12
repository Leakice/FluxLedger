import { entryKinds, periodEnd } from './ledger.js';

export const navigationPages = ['Dashboard', 'Transactions', 'Repayment records'];
export const transactionFilters = [
  { type: 'all', label: 'All', action: 'Add transaction', icon: '≡' },
  ...entryKinds,
];

// cardIds null keeps every account; an explicit empty array selects nothing so the
// list stays consistent with zeroed stats when no account is checked. All spans
// dates while respecting the selected accounts and categories. Typed views
// retain the original period rules and effective-date credit history.
export function selectTransactionRows(entries, {
  kind = 'all', month = '', period = 'month', cardIds = null,
  category = 'All categories', search = '', translate = value => value,
  accountLabel = id => id,
} = {}) {
  const prefix = period === 'year' ? month.slice(0, 4) : month;
  const asOf = kind === 'credit' ? periodEnd(month, period) : '';
  const query = search.toLowerCase();
  return entries.filter(entry => {
    if (cardIds && !cardIds.includes(entry.card) && !cardIds.includes(entry.toCard)) return false;
    if (category !== 'All categories' && (category === 'Income' ? entry.type !== 'income' : (entry.type==='repayment'?entries.find(p=>p.id===entry.purchaseId)?.category:entry.category) !== category)) return false;
    if (kind !== 'all') {
      if (entry.type !== kind) return false;
      if (kind === 'credit') {
        if (entry.date > asOf) return false;
      } else {
        if (!entry.date.startsWith(prefix)) return false;
      }
    }
    return (entry.description + ' ' + translate(entry.category) + ' ' + entry.category + ' ' + accountLabel(entry.card)+' '+(entry.toCard?accountLabel(entry.toCard):'')).toLowerCase().includes(query);
  }).sort((a, b) => b.date.localeCompare(a.date) || (Number(b.id)-Number(a.id)||String(b.id).localeCompare(String(a.id))));
}

// SVG category metadata uses the original name, independent of translated labels.
// An undefined category keeps the current filter: account nodes inherit the
// category scope the chart was rendered with, while category-agnostic elements
// (income and credit nodes and their ribbons) explicitly clear it.
export function flowTransactionFilter({flowId='',source='',target='',category}={}) {
  const account=id=>/^account:.+$/.test(id)?id.slice(8):null;
  const allocation=id=>/^target:\d+$/.test(id)&&category&&category!=='Unallocated capacity';
  const result=(recordKind,cardId,category)=>({recordKind,cardIds:cardId?[cardId]:null,category});
  if(account(flowId))return result('expense',account(flowId));
  if(allocation(flowId))return result('expense',null,category);
  if(flowId==='source:0')return result('income',null,'All categories');
  if(flowId==='source:1')return result('credit',null,'All categories');
  if(/^in:\d+:\d+$/.test(flowId)&&account(target)) {
    if(source==='source:0')return result('income',account(target),'All categories');
    if(source==='source:1')return result('credit',account(target),'All categories');
  }
  if(/^out:\d+:\d+$/.test(flowId)&&account(source)&&allocation(target))return result('expense',account(source),category);
  return null;
}
