<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { seed } from './seed';
import { dictionary } from './locales';
import { flowChart, repaymentChart } from './charts';
import { bindFlowInteraction } from './flowInteraction';
import { defaultCards, entryKinds, creditLimit, periodEnd, buildFlowModel, withBuiltInAccountCards, isBuiltInAccountCard, findLoanCard, accountLast4, accountProvider, isOnlineLoanAccount, canRecordIncome, creditPurchases, accountBalances, saveTransaction, validateLedger, inferCreditExpenses } from './ledger';
import { navigationPages, transactionFilters, selectTransactionRows, flowTransactionFilter } from './transactionView';
import SourceChart from './components/SourceChart.vue';
import FrequencyChart from './components/FrequencyChart.vue';
import EntryDialog from './components/EntryDialog.vue';
import CardDialog from './components/CardDialog.vue';
import DataManagerDialog from './components/DataManagerDialog.vue';

const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const entries=ref(read('cascade-transactions-v1',seed));
const hiddenBuiltInCardIds=ref(read('fluxledger-hidden-built-in-cards-v1',[]));
const bankCards=ref(withBuiltInAccountCards(read('fluxledger-cards-v1',defaultCards),hiddenBuiltInCardIds.value));
entries.value=inferCreditExpenses(entries.value,bankCards.value);
const entryDialog=ref(null), cardDialog=ref(null), dataDialog=ref(null), recordKind=ref('all');
const language=ref(localStorage.getItem('cascade-language')||'en');
const dark=ref(localStorage.getItem('cascade-theme')==='dark');
const page=ref('Dashboard'), report=ref('Overview'), period=ref('month'), month=ref('2026-09');
const cards=ref(bankCards.value.map(c=>c.id)), category=ref('All categories'), expanded=ref(false), chartType=ref('Sankey diagram'), search=ref('');
const allAccountsSelected=computed(()=>cards.value.length===bankCards.value.length);
const accountFilter=computed({get:()=>allAccountsSelected.value?'':cards.value.length===1?cards.value[0]:'__custom__',set:id=>{cards.value=id?[id]:bankCards.value.map(c=>c.id)}});
const accountFilterLabel=computed(()=>allAccountsSelected.value?cards.value.length+'/'+bankCards.value.length:cards.value.length===1?cardName(cards.value[0]):t('Custom selection')+' ('+cards.value.length+')');
const formError=ref('');
const notification=ref(''), deleted=ref(null), filtersOpen=ref(false);
const asOf=computed(()=>periodEnd(month.value,period.value));
const cardName=id=>{const card=bankCards.value.find(c=>c.id===id);return card?t(card.name)+(accountLast4(card)?' · '+accountLast4(card):''):id};
const limitFor=id=>creditLimit(entries.value,id,asOf.value);
const totalCredit=computed(()=>bankCards.value.filter(c=>cards.value.includes(c.id)).reduce((s,c)=>s+limitFor(c.id),0));
const filterCategories=['All categories','Food & Drinks','Subscription','Income','Shopping','Entertainment','Utilities','Transfer','Other'];
const t=s=>language.value==='zh'?(dictionary[s]||s):s;
const money=n=>'¥'+Math.abs(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=n=>(n>=0?'+ ':'− ')+money(n);
const dateLabel=(value,short=false)=>new Date(value+'-01T12:00:00').toLocaleDateString(language.value==='zh'?'zh-CN':'en-US',short?{month:'short'}:{month:'long',year:'numeric'});
const matchesCategory=e=>category.value==='All categories'||(category.value==='Income'?e.type==='income':category.value===(e.type==='repayment'?entries.value.find(p=>p.id===e.purchaseId)?.category:e.category));
const periodEntries=computed(()=>entries.value.filter(e=>e.date.startsWith(period.value==='year'?month.value.slice(0,4):month.value)&&(cards.value.includes(e.card)||cards.value.includes(e.toCard))));
const filtered=computed(()=>periodEntries.value.filter(e=>e.type!=='credit'&&matchesCategory(e)));
const income=computed(()=>filtered.value.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0));
const expenses=computed(()=>filtered.value.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0));
const net=computed(()=>income.value-expenses.value);
const revenue=computed(()=>report.value==='Income'?income.value:report.value==='Expenses'?expenses.value:net.value);
const revenueLabel=computed(()=>report.value==='Income'?'Total Income':report.value==='Expenses'?'Total Expenses':period.value==='year'?'Net Yearly Revenue':'Net Monthly Revenue');
const previousMonth=computed(()=>{const d=new Date(month.value+'-01T12:00:00');d.setMonth(d.getMonth()-1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')});
const previousRows=computed(()=>entries.value.filter(e=>e.type!=='credit'&&e.date.startsWith(period.value==='year'?String(Number(month.value.slice(0,4))-1):previousMonth.value)&&(cards.value.includes(e.card)||cards.value.includes(e.toCard))&&matchesCategory(e)));
const previousIncome=computed(()=>previousRows.value.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0));
const previousExpenses=computed(()=>previousRows.value.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0));
const growth=computed(()=>{const prev=previousIncome.value-previousExpenses.value;return prev?`${net.value>=prev?'↗':'↘'} ${Math.abs(Math.round((net.value-prev)/Math.abs(prev)*100))}%`:'—'});
const periodLabel=computed(()=>period.value==='year'?month.value.slice(0,4):dateLabel(month.value));
const previousLabel=computed(()=>period.value==='year'?String(Number(month.value.slice(0,4))-1):dateLabel(previousMonth.value,true));
const sources=computed(()=>{const totals={};filtered.value.filter(e=>e.type===(report.value==='Income'?'income':'expense')).forEach(e=>totals[e.category]=(totals[e.category]||0)+e.amount);return Object.entries(totals).sort((a,b)=>b[1]-a[1])});
const percent=i=>{const total=sources.value.reduce((s,e)=>s+e[1],0);return total?Math.round((sources.value[i]?.[1]||0)/total*100):0};
const flowModel=computed(()=>buildFlowModel(periodEntries.value,entries.value,bankCards.value.filter(c=>cards.value.includes(c.id)),asOf.value,category.value,bankCards.value));
const repaymentMonth=ref('2026-09');
const repaymentModel=computed(()=>buildFlowModel(entries.value.filter(e=>e.date.startsWith(repaymentMonth.value)),entries.value,bankCards.value,periodEnd(repaymentMonth.value,'month'),'All categories',bankCards.value));
const repaymentFlow=computed(()=>repaymentChart(repaymentModel.value,t));
const repaymentBalances=computed(()=>accountBalances(entries.value,bankCards.value,periodEnd(repaymentMonth.value,'month')));
const repaymentRows=computed(()=>entries.value.filter(e=>e.type==='repayment'&&e.date.startsWith(repaymentMonth.value)).sort((a,b)=>b.date.localeCompare(a.date)));
const balances=computed(()=>accountBalances(entries.value,bankCards.value,asOf.value));
const purchases=computed(()=>creditPurchases(entries.value,asOf.value));
const purchaseFor=id=>purchases.value.find(p=>p.id===id);
const flowContainer=ref(null), flowWidth=ref(960);
let flowResizeFrame = null;
const flowObserver=new ResizeObserver(([entry])=>{
  if(flowResizeFrame!==null)cancelAnimationFrame(flowResizeFrame);
  flowResizeFrame=requestAnimationFrame(()=>{flowWidth.value=Math.floor(entry.contentRect.width)});
});
watch(flowContainer,element=>{flowObserver.disconnect();if(element)flowObserver.observe(element)},{flush:'post'});
onBeforeUnmount(()=>{flowObserver.disconnect();if(flowResizeFrame!==null)cancelAnimationFrame(flowResizeFrame);disposeFlow()});
const flow=computed(()=>flowChart(flowModel.value,chartType.value,t,flowWidth.value));
let disposeFlow=()=>{};
watch([flowContainer,flow],()=>{
  disposeFlow();
  disposeFlow=bindFlowInteraction(flowContainer.value,t,activateFlow);
},{flush:'post'});
watch([flowModel,chartType,language],()=>{
  if(flowContainer.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    flowContainer.value.querySelector('.sankey-chart')?.animate([{opacity:.5},{opacity:1}],{duration:260,easing:'ease-out'});
},{flush:'post'});
const rows=computed(()=>selectTransactionRows(entries.value,{kind:recordKind.value,month:month.value,period:period.value,cardIds:cards.value,category:category.value,search:search.value,translate:t,accountLabel:cardName}));
const activeRecordFilter=computed(()=>transactionFilters.find(kind=>kind.type===recordKind.value));
const months=computed(()=>Array.from({length:6},(_,i)=>{const d=new Date(month.value+'-01T12:00:00');d.setMonth(d.getMonth()-5+i);const prefix=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');const data=entries.value.filter(e=>e.type!=='credit'&&e.date.startsWith(prefix)&&(cards.value.includes(e.card)||cards.value.includes(e.toCard))&&matchesCategory(e));return{label:dateLabel(prefix,true),income:data.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0),expense:data.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0),count:data.length}}));
const chartMax=computed(()=>Math.max(...months.value.map(e=>Math.max(e.income,e.expense)),1000)*1.12);
const linePoints=computed(()=>months.value.map((e,i)=>`${65+i*64},${176-e.expense/chartMax.value*145}`).join(' '));
let toastTimer;
function toast(message){notification.value=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>notification.value='',4000)}
function navigate(next){page.value=navigationPages.includes(next)?next:'Dashboard';if(page.value==='Dashboard')report.value='Overview'}
function activateFlow(dataset){const filter=flowTransactionFilter(dataset);if(!filter)return;recordKind.value=filter.recordKind;cards.value=filter.cardIds??bankCards.value.map(c=>c.id);category.value=filter.category??'All categories';search.value='';navigate('Transactions')}
function selectRecordKind(kind){recordKind.value=recordKind.value===kind?'all':kind;category.value='All categories'}
function reset(){period.value='month';month.value='2026-09';cards.value=bankCards.value.map(c=>c.id);category.value='All categories';toast('Filters reset')}
function openForm(type='expense',entry=null){formError.value='';entryDialog.value.open(type==='all'?'expense':type,(page.value==='Repayment records'?repaymentMonth.value:month.value)+'-10',entry)}
function openRepayment(entry){openForm('repayment',{id:null,description:'Repayment · '+entry.description,purchaseId:entry.id,toCard:entry.card,card:bankCards.value.find(c=>c.id!==entry.card)?.id||'',amount:purchaseFor(entry.id)?.due||'',date:asOf.value < entry.date ? entry.date : month.value+'-'+String(Math.max(10,entry.date.startsWith(month.value)?Number(entry.date.slice(-2)):1)).padStart(2,'0')})}
function loanCardFor(borrower, currentCardId) {
  const existing = findLoanCard(bankCards.value, borrower, currentCardId);
  if (existing) return existing.id;
  const card = { id: 'loan-'+Date.now(), name: borrower, last4: '', noLast4: true, network: '借款', accountType: 'Credit card', loanBorrower: borrower, color: '#627084' };
  bankCards.value.push(card);cards.value.push(card.id);
  return card.id;
}
function saveEntry(entry){
  if(entry.type==='income'&&!canRecordIncome(bankCards.value.find(card=>card.id===entry.card),entries.value.find(item=>item.id===entry.id))){toast('Online loan funding uses credit limits, not income.');return}
  if(entry.type==='credit'&&entry.description==='借款'&&entry.borrower){entry={...entry,card:loanCardFor(entry.borrower.trim(),entry.card),borrower:entry.borrower.trim()}}
  const existing=entries.value.some(e=>e.id===entry.id);
  try{entries.value=saveTransaction(entries.value,{...entry,id:entry.id??crypto.randomUUID()},bankCards.value)}catch(error){formError.value=error.message;return;}
  entryDialog.value.close();if(entry.type==='repayment')repaymentMonth.value=entry.date.slice(0,7);month.value=entry.date.slice(0,7);if(recordKind.value!=='all')recordKind.value=entry.type;toast(existing?'Transaction updated':'Transaction saved on this device');
}
function saveCard(card){
  const isNew = !card.id;
  if(card.id){const index=bankCards.value.findIndex(c=>c.id===card.id);bankCards.value[index]=card;}
  else{card.id='card-'+Date.now();bankCards.value.push(card);cards.value.push(card.id)}
  toast('Account saved');
  if(isNew&&isOnlineLoanAccount(card))entryDialog.value.open('credit',month.value+'-10',{card:card.id,description:card.name});
}
function removeCard(id){
  if(entries.value.some(entry=>entry.card===id||entry.toCard===id)){toast('Delete linked entries first');return}
  bankCards.value=bankCards.value.filter(card=>card.id!==id);cards.value=cards.value.filter(cardId=>cardId!==id);
  if(isBuiltInAccountCard(id)&&!hiddenBuiltInCardIds.value.includes(id))hiddenBuiltInCardIds.value.push(id);
  toast('Account deleted');
}
function remove(entry){const next=entries.value.filter(e=>e.id!==entry.id);const error=validateLedger(next,bankCards.value);if(error){toast(error);return;}deleted.value=entry;entries.value=next;toast('Transaction deleted')}
function undo(){if(deleted.value){try{entries.value=saveTransaction(entries.value,deleted.value,bankCards.value);deleted.value=null;notification.value=''}catch(error){toast(error.message)}}}
function importData(payload){entries.value=payload.entries;hiddenBuiltInCardIds.value=payload.hiddenBuiltInCardIds||[];bankCards.value=withBuiltInAccountCards(payload.cards,hiddenBuiltInCardIds.value);entries.value=inferCreditExpenses(entries.value,bankCards.value);cards.value=bankCards.value.map(c=>c.id);deleted.value=null;search.value='';category.value='All categories';recordKind.value='all';filtersOpen.value=false;const latest=[...entries.value].filter(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((a,b)=>b.date.localeCompare(a.date))[0];if(latest){month.value=latest.date.slice(0,7);period.value='month'}}
watch(bankCards,value=>localStorage.setItem('fluxledger-cards-v1',JSON.stringify(value)),{deep:true});
watch(hiddenBuiltInCardIds,value=>localStorage.setItem('fluxledger-hidden-built-in-cards-v1',JSON.stringify(value)),{deep:true});
watch(entries,value=>localStorage.setItem('cascade-transactions-v1',JSON.stringify(value)),{deep:true});
watch(language,value=>{localStorage.setItem('cascade-language',value);document.documentElement.lang=value==='zh'?'zh-CN':'en';document.title=value==='zh'?'FluxLedger——回应每一次资金流动。':'FluxLedger — In tune with every money movement.'},{immediate:true});
watch(dark,value=>{document.body.classList.toggle('dark',value);localStorage.setItem('cascade-theme',value?'dark':'light')},{immediate:true});
</script>

<template>
  <header>
    <a class="brand" href="#" :aria-label="t('Cascade home')" @click.prevent="navigate('Dashboard')"><img src="/assets/sankey-diagram-alt-svgrepo-com.svg" alt=""/></a>
    <nav><button v-for="item in navigationPages" :key="item" :class="{active:page===item}" @click="navigate(item)">{{ t(item) }}</button></nav>
    <div class="header-right">
      <div class="language-switch" aria-label="Language / 语言"><button v-for="lang in ['en','zh']" :key="lang" :class="{selected:language===lang}" :aria-pressed="language===lang" @click="language=lang">{{ lang.toUpperCase() }}</button></div>
      <div class="theme-switch"><button :class="{selected:dark}" :title="t('Dark mode')" :aria-pressed="dark" @click="dark=true">☾</button><button :class="{selected:!dark}" :title="t('Light mode')" :aria-pressed="!dark" @click="dark=false">☼</button></div>
      <button class="icon notification" :aria-label="t('Notifications')" @click="toast('You’re all caught up. Your records are saved locally.')"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9M9 21h6"/></svg><i/></button>
      <button class="avatar" :title="t('Local account')" @click="toast('Local account · Data is stored in this browser')">QY</button>
    </div>
  </header>
  <main>
    <section v-if="page==='Dashboard'">
      <div class="workspace"><div class="flow-panel">
        <div class="section-heading"><div class="title-group"><h1>{{ t('Money Flow') }}</h1><select v-model="chartType" :aria-label="t('Chart type')"><option v-for="item in ['Sankey diagram','Category breakdown']" :key="item" :value="item">{{ t(item) }}</option></select></div><div class="tools"><button class="data-manager-trigger" :title="t('Data management')" :aria-label="t('Data management')" @click="dataDialog.open()"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg><span>{{ t('Data management') }}</span></button><button v-for="kind in entryKinds" :key="kind.type" class="quick-entry" :class="kind.type" :title="t(kind.action)" @click="openForm(kind.type)"><span>{{ kind.icon }}</span>{{ t(kind.label) }}</button></div></div>
        <p v-if="chartType!=='Sankey diagram'" class="chart-scroll-hint">↔ {{ t('Swipe to explore the money flow') }}</p><div ref="flowContainer" class="flow-scroll" :class="{'is-sankey':chartType==='Sankey diagram'}" tabindex="0" role="region" :aria-label="t(chartType==='Sankey diagram'?'Money Flow':'Money flow chart, scroll horizontally')"><div id="flow-chart" v-html="flow"/></div>
        <div class="flow-footer"><span><i class="live-dot"/>{{ t('Income + credit limit · capacity, not cash balance') }}</span><span>{{ periodLabel }} ↗</span></div><p v-if="flowModel.gap>0" class="funding-note">{{ t('Expenses above recorded funding') }}: {{ money(flowModel.gap) }}</p>
      </div>
      <aside class="filter-panel" :class="{'is-expanded':filtersOpen}"><div class="aside-title"><h2 class="desktop-filter-title">{{ t('Filters') }}</h2><button class="mobile-filter-toggle" :aria-expanded="filtersOpen" aria-controls="filter-content" @click="filtersOpen=!filtersOpen"><span><strong>{{ t('Filters') }}</strong><small>{{ periodLabel }} · {{ cards.length }}/{{ bankCards.length }} {{ t('Accounts') }} · {{ t(category) }}</small></span><span class="filter-chevron" aria-hidden="true">⌄</span></button><button class="icon" :title="t('Reset filters')" @click="reset">↺</button></div><div id="filter-content" class="filter-content">
        <label class="filter-label">{{ t('Time period') }}</label><div class="pills" id="period"><button :class="{active:period==='month'}" @click="period='month'">{{ t('Month') }}</button><button :class="{active:period==='year'}" @click="period='year'">{{ t('Year') }}</button><input id="month" type="month" :value="month" :aria-label="t('Select period')" @change="month=$event.target.value||'2026-09'"></div>
        <div class="cards-label"><span>{{ t('Accounts') }}</span><button class="text-button" @click="cardDialog.open()">{{ t('Add account') }} ＋</button></div><div class="bank-card-list"><div v-for="card in bankCards" :key="card.id" class="bank-card-row"><button class="bank-card-edit" :aria-label="t('Edit account')+' '+t(card.name)" @click="cardDialog.open(card)"><span class="credit mini-card" :style="{background:card.color}"><b>{{ t(accountProvider(card)) }}</b></span><span class="bank-details"><strong>{{ t(card.name) }}</strong><small v-if="accountLast4(card)">•••• {{ accountLast4(card) }} <span class="edit-hint">✎</span></small></span></button><input v-model="cards" type="checkbox" :value="card.id" :aria-label="t('Filter account')+' '+t(card.name)"></div></div>
        <label class="filter-label categories-label">{{ t('Categories') }}</label><div class="pills categories"><button v-for="item in filterCategories.slice(0,expanded?filterCategories.length:5)" :key="item" :class="{active:category===item}" @click="category=item">{{ t(item) }}</button><button class="show-more" @click="expanded=!expanded">{{ t(expanded?'Show less':'Show more') }}</button></div><div class="filter-note">{{ t('A little clarity. A better balance.') }}</div>
      </div></aside></div>
      <section class="reports"><div class="report-heading"><h2>{{ t('New report') }}</h2><div class="segmented" role="group" :aria-label="t('New report')"><button v-for="item in ['Overview','Income','Expenses']" :key="item" :class="{active:report===item}" :aria-pressed="report===item" @click="report=item">{{ t(item) }}</button></div><span class="report-date">{{ t('YOUR MONTH IN NUMBERS') }}</span></div>
        <div class="report-grid" :key="[report,month,period,cards.join(','),category].join('|')"><div class="left-reports"><article class="revenue"><span class="muted">{{ t(revenueLabel) }}</span><div><strong>{{ report==='Expenses'?money(revenue):signed(revenue) }}</strong><span class="growth" :title="t('Net revenue change from previous month')">{{ growth }}</span></div></article>
          <article class="frequency"><div class="card-heading"><div><h3>{{ t('Transaction Frequency') }}</h3><small>{{ t('Monthly count of transactions') }}</small></div><span class="circle-decoration">↗</span></div><FrequencyChart :months="months" :label="t('Transaction Frequency')"/><div class="stat-row"><span>{{ period==='year'?periodLabel:dateLabel(month,true) }}</span><b>{{ filtered.length }} ↗</b></div><div class="stat-row"><span>{{ previousLabel }}</span><b>{{ previousRows.length }} ↗</b></div></article>
        </div>
        <article class="sources"><div class="card-heading"><h3>{{ t(report==='Income'?'Income Sources':'Expense Sources') }}</h3><button class="circle-decoration source-link" :aria-label="t('Transactions')+' · '+t(report==='Income'?'Income':'Expenses')" @click="recordKind=report==='Income'?'income':'expense';search='';navigate('Transactions')">↗</button></div><SourceChart :sources="sources" :translate="t" :money="money"/></article>
        <article class="balance"><div class="card-heading"><h3>{{ t('Monthly Balance') }}</h3><span class="legend"><i/>{{ t('Income') }}<i/>{{ t('Expenses') }}</span></div><div id="balance-chart"><svg viewBox="0 0 430 208"><g font-family="Arial" font-size="10" fill="var(--muted)"><g v-for="i in [0,1,2,3]" :key="i"><text x="0" :y="178-i*47">{{ i?'¥'+Math.round(chartMax*i/3/1000)+'K':'0' }}</text><path :d="`M35 ${176-i*47}H424`" stroke="var(--line)" stroke-dasharray="2 5"/></g><g v-for="(bar,i) in months" :key="i" class="balance-month" :class="{'is-current':i===months.length-1}" :style="{'--bar-delay':i*35+'ms'}"><rect class="balance-bar" :x="40+i*64" :y="176-bar.income/chartMax*145" width="50" :height="Math.max(bar.income/chartMax*145,3)" rx="8" :fill="i===months.length-1?'var(--report-accent)':'var(--report-bar)'"/><text :x="65+i*64" y="198" text-anchor="middle">{{ bar.label }}</text><g v-if="i===months.length-1&&bar.income"><rect :x="47+i*64" :y="149-bar.income/chartMax*145" width="42" height="21" rx="7" fill="#111"/><text :x="68+i*64" :y="163-bar.income/chartMax*145" text-anchor="middle" fill="white">¥{{ (bar.income/1000).toFixed(1) }}K</text></g></g><polyline class="report-line balance-trend" pathLength="1" :points="linePoints" fill="none" stroke="var(--report-trend)" stroke-width="2.5"/><circle v-for="(bar,i) in months" :key="'dot'+i" :cx="65+i*64" :cy="176-bar.expense/chartMax*145" r="2.5" stroke="var(--report-trend)" stroke-width="1.5" fill="var(--panel)"/></g></svg></div><div class="stat-row"><span>{{ period==='year'?periodLabel:dateLabel(month,true) }}</span><b>+{{ money(income) }}</b><b>−{{ money(expenses) }}</b></div><div class="stat-row"><span>{{ previousLabel }}</span><b>+{{ money(previousIncome) }}</b><b>−{{ money(previousExpenses) }}</b></div></article>
        </div>
      </section>
    </section>
    <section v-else-if="page==='Repayment records'" id="repayment-records">
      <div class="section-heading"><h1>{{ t('Repayment records') }}</h1><div class="tools"><input type="month" :value="repaymentMonth" @change="repaymentMonth=$event.target.value||repaymentMonth" :aria-label="t('Select period')"><button class="primary" @click="openForm('repayment')">{{ t('Repay credit') }}</button></div></div>
      <div class="repayment-chart" v-html="repaymentFlow"/>
        <section class="account-balances"><article v-for="account in repaymentBalances" :key="account.id"><strong>{{ cardName(account.id) }}</strong><span>{{ t('Recorded cash balance') }} {{ signed(account.cash) }}</span><span>{{ t('Outstanding credit') }} {{ money(account.debt) }}</span></article></section>
      <div class="table-wrap" v-if="repaymentRows.length"><table><thead><tr><th>{{ t('Date') }}</th><th>{{ t('Description') }}</th><th>{{ t('Account') }}</th><th>{{ t('Amount') }}</th><th>{{ t('Actions') }}</th></tr></thead><tbody><tr v-for="entry in repaymentRows" :key="entry.id"><td>{{ entry.date }}</td><td>{{ entry.description }}</td><td>{{ cardName(entry.card) }} → {{ cardName(entry.toCard) }}</td><td>{{ money(entry.amount) }}</td><td><button @click="openForm('repayment',entry)">{{ t('Edit') }}</button><button @click="remove(entry)">{{ t('Delete') }}</button></td></tr></tbody></table></div>
    </section>
    <section v-else id="transactions">
      <div class="section-heading"><div><span class="eyebrow">{{ t('YOUR EVERYDAY MONEY') }}</span><h1>{{ t('Transactions') }}</h1></div><button class="data-manager-trigger" :title="t('Data management')" :aria-label="t('Data management')" @click="dataDialog.open()"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg><span>{{ t('Data management') }}</span></button></div>
      <div class="entry-portals">
        <div v-for="kind in entryKinds" :key="kind.type" class="entry-portal" :class="[kind.type,{active:recordKind===kind.type}]">
          <button class="portal-select" :aria-pressed="recordKind===kind.type" @click="selectRecordKind(kind.type)"><span class="portal-icon">{{ kind.icon }}</span><span><small>{{ t(kind.label) }}</small><strong>{{ money(kind.type==='credit'?totalCredit:periodEntries.filter(e=>e.type===kind.type).reduce((s,e)=>s+e.amount,0)) }}</strong></span><span class="portal-arrow">↗</span></button>
          <button class="portal-add" @click="openForm(kind.type)">＋ {{ t(kind.action) }}</button>
        </div>
      </div>
      <div v-if="recordKind==='credit'" class="credit-explanation"><span>◇</span>{{ t('The latest limit replaces the previous limit. It is not income.') }}<span class="muted">{{ t('As of') }} {{ asOf }}</span></div>
      <div class="list-toolbar"><input v-model="search" type="search" :placeholder="t('Search transactions…')"><select class="mobile-account-filter" v-model="accountFilter" :aria-label="t('Filter account')"><option value="">{{ t('All accounts') }}</option><option v-if="accountFilter==='__custom__'" value="__custom__" disabled>{{ t('Custom selection') }} ({{ cards.length }})</option><option v-for="card in bankCards" :key="card.id" :value="card.id">{{ cardName(card.id) }}</option></select><select class="mobile-account-filter" v-model="category" :aria-label="t('Categories')"><option v-for="item in filterCategories" :key="item" :value="item">{{ t(item) }}</option></select><span>{{ t(activeRecordFilter.label) }} · {{ rows.length }} {{ language==='zh'?'笔记录':'records' }} · {{ accountFilterLabel }}{{ category!=='All categories'?' · '+t(category):'' }}</span></div>
      <div class="table-wrap desktop-transactions"><table><thead><tr><th v-for="item in ['Description','Type','Category','Date','Account','Amount','Actions']" :key="item"><select v-if="item==='Account'" class="account-column-filter" v-model="accountFilter" :aria-label="t('Filter account')"><option value="">{{ t('All accounts') }}</option><option v-if="accountFilter==='__custom__'" value="__custom__" disabled>{{ t('Custom selection') }} ({{ cards.length }})</option><option v-for="card in bankCards" :key="card.id" :value="card.id">{{ cardName(card.id) }}</option></select><select v-else-if="item==='Category'" class="account-column-filter" v-model="category" :aria-label="t('Categories')"><option v-for="item in filterCategories" :key="item" :value="item">{{ t(item) }}</option></select><template v-else>{{ t(item) }}</template></th></tr></thead>
        <TransitionGroup name="row" tag="tbody"><tr v-for="entry in rows" :key="entry.id"><td>{{ entry.id<300||entry.type==='credit'?t(entry.description):entry.description }}<small v-if="entry.onCredit&&purchaseFor(entry.id)" class="entry-detail">{{ t(purchaseFor(entry.id).status) }} · {{ t('Amount due') }} {{ money(purchaseFor(entry.id).due) }}</small></td><td><span class="type-badge" :class="entry.type">{{ t(entry.onCredit?'Credit purchase':entryKinds.find(k=>k.type===entry.type)?.label) }}</span></td><td>{{ t(entry.category) }}</td><td>{{ entry.date }}</td><td>{{ cardName(entry.card) }}<template v-if="entry.type==='repayment'"> → {{ cardName(entry.toCard) }}<small class="entry-detail">{{ t('Linked credit purchase') }}: {{ entries.find(p=>p.id===entry.purchaseId)?.description }}</small></template></td><td :class="entry.type">{{ entry.type==='credit'?'':entry.type==='income'?'+':'−' }}{{ money(entry.amount) }}</td><td><div class="row-actions"><button v-if="entry.onCredit&&purchaseFor(entry.id)?.due>0" class="row-edit" @click="openRepayment(entry)">{{ t('Repay credit') }}</button><button class="row-edit" :aria-label="t('Edit transaction')+' '+entry.description" @click="openForm(entry.type,entry)">✎ {{ t('Edit') }}</button><button class="row-delete" :aria-label="t('Delete transaction')+' '+entry.description" @click="remove(entry)">×</button></div></td></tr></TransitionGroup>
        <tbody v-if="!rows.length"><tr><td colspan="7" class="empty-state">{{ t('No transactions found.') }}<button class="text-button empty-add" @click="openForm(recordKind)">＋ {{ t(activeRecordFilter.action) }}</button></td></tr></tbody>
      </table></div>
      <TransitionGroup name="row" tag="ul" class="mobile-transactions" :aria-label="t('Transactions')">
        <li v-for="entry in rows" :key="entry.id" class="transaction-card">
          <div class="transaction-card-heading"><span class="type-badge" :class="entry.type">{{ t(entry.onCredit?'Credit purchase':entryKinds.find(k=>k.type===entry.type)?.label) }}</span><time :datetime="entry.date">{{ entry.date }}</time></div>
          <h3>{{ entry.id<300||entry.type==='credit'?t(entry.description):entry.description }}</h3><small v-if="entry.onCredit&&purchaseFor(entry.id)" class="entry-detail">{{ t(purchaseFor(entry.id).status) }} · {{ t('Amount due') }} {{ money(purchaseFor(entry.id).due) }}</small>
          <strong class="transaction-amount" :class="entry.type">{{ entry.type==='credit'?'':entry.type==='income'?'+':'−' }}{{ money(entry.amount) }}</strong>
          <dl><div><dt>{{ t('Category') }}</dt><dd>{{ t(entry.category) }}</dd></div><div><dt>{{ t('Account') }}</dt><dd>{{ cardName(entry.card) }}<template v-if="entry.type==='repayment'"> → {{ cardName(entry.toCard) }}<small class="entry-detail">{{ t('Linked credit purchase') }}: {{ entries.find(p=>p.id===entry.purchaseId)?.description }}</small></template></dd></div></dl>
          <div class="row-actions"><button v-if="entry.onCredit&&purchaseFor(entry.id)?.due>0" class="row-edit" @click="openRepayment(entry)">{{ t('Repay credit') }}</button><button class="row-edit" :aria-label="t('Edit transaction')+' '+entry.description" @click="openForm(entry.type,entry)">✎ {{ t('Edit') }}</button><button class="row-delete" :aria-label="t('Delete transaction')+' '+entry.description" @click="remove(entry)">× {{ t('Delete') }}</button></div>
        </li>
      </TransitionGroup>
      <div v-if="!rows.length" class="mobile-empty empty-state">{{ t('No transactions found.') }}<button class="text-button empty-add" @click="openForm(recordKind)">＋ {{ t(activeRecordFilter.action) }}</button></div>
    </section>
  </main>
  <footer><img class="footer-brand" src="/assets/logo-mini.svg" alt="QYNT" width="105" height="119"/><span>{{ t('A clear view of your financial world.') }}</span><a class="footer-contact" href="mailto:leakice@qq.com,2632364603@qq.com">{{ t('Contact us') }}</a></footer>
  <EntryDialog :entries="entries" :error="formError" ref="entryDialog" :cards="bankCards" :t="t" @save="saveEntry"/>
  <CardDialog ref="cardDialog" :t="t" @save="saveCard" @remove="removeCard"/>
  <DataManagerDialog ref="dataDialog" :entries="entries" :cards="bankCards" :hidden-built-in-card-ids="hiddenBuiltInCardIds" :t="t" @import="importData" @notify="toast"/>
  <div class="toast" :class="{show:notification}" role="status">{{ t(notification) }}<button v-if="notification==='Transaction deleted'&&deleted" class="undo" @click="undo">{{ language==='zh'?'撤销':'Undo' }}</button></div>
</template>
