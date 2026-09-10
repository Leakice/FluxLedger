<script setup>
import { ref, computed, watch } from 'vue';
import { seed } from './seed';
import { dictionary } from './locales';
import { flowChart } from './charts';
import { defaultCards, entryKinds, creditLimit, periodEnd, buildFlowModel } from './ledger';
import EntryDialog from './components/EntryDialog.vue';
import CardDialog from './components/CardDialog.vue';
import DataManagerDialog from './components/DataManagerDialog.vue';

const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const entries=ref(read('cascade-transactions-v1',seed));
const bankCards=ref(read('fluxledger-cards-v1',defaultCards));
const entryDialog=ref(null), cardDialog=ref(null), dataDialog=ref(null), recordKind=ref('expense');
const language=ref(localStorage.getItem('cascade-language')||'en');
const dark=ref(localStorage.getItem('cascade-theme')==='dark');
const page=ref('Analytics'), report=ref('Overview'), period=ref('month'), month=ref('2026-09');
const cards=ref(bankCards.value.map(c=>c.id)), category=ref('All categories'), expanded=ref(false), chartType=ref('Sankey diagram'), search=ref('');
const notification=ref(''), deleted=ref(null), filtersOpen=ref(false);
const asOf=computed(()=>periodEnd(month.value,period.value));
const cardName=id=>{const card=bankCards.value.find(c=>c.id===id);return card?t(card.name)+' · '+card.last4:id};
const limitFor=id=>creditLimit(entries.value,id,asOf.value);
const totalCredit=computed(()=>bankCards.value.filter(c=>cards.value.includes(c.id)).reduce((s,c)=>s+limitFor(c.id),0));
const filterCategories=['All categories','Food & Drinks','Subscription','Income','Shopping','Entertainment','Utilities','Other'];
const t=s=>language.value==='zh'?(dictionary[s]||s):s;
const money=n=>'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=n=>(n>=0?'+ ':'− ')+money(n);
const dateLabel=(value,short=false)=>new Date(value+'-01T12:00:00').toLocaleDateString(language.value==='zh'?'zh-CN':'en-US',short?{month:'short'}:{month:'long',year:'numeric'});
const matchesCategory=e=>category.value==='All categories'||(category.value==='Income'?e.type==='income':category.value===e.category);
const periodEntries=computed(()=>entries.value.filter(e=>e.date.startsWith(period.value==='year'?month.value.slice(0,4):month.value)&&cards.value.includes(e.card)));
const filtered=computed(()=>periodEntries.value.filter(e=>e.type!=='credit'&&matchesCategory(e)));
const income=computed(()=>filtered.value.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0));
const expenses=computed(()=>filtered.value.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0));
const net=computed(()=>income.value-expenses.value);
const revenue=computed(()=>report.value==='Income'?income.value:report.value==='Expenses'?expenses.value:net.value);
const revenueLabel=computed(()=>report.value==='Income'?'Total Income':report.value==='Expenses'?'Total Expenses':period.value==='year'?'Net Yearly Revenue':'Net Monthly Revenue');
const previousMonth=computed(()=>{const d=new Date(month.value+'-01T12:00:00');d.setMonth(d.getMonth()-1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')});
const previousRows=computed(()=>entries.value.filter(e=>e.type!=='credit'&&e.date.startsWith(period.value==='year'?String(Number(month.value.slice(0,4))-1):previousMonth.value)&&cards.value.includes(e.card)&&matchesCategory(e)));
const previousIncome=computed(()=>previousRows.value.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0));
const previousExpenses=computed(()=>previousRows.value.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0));
const growth=computed(()=>{const prev=previousIncome.value-previousExpenses.value;return prev?`${net.value>=prev?'↗':'↘'} ${Math.abs(Math.round((net.value-prev)/Math.abs(prev)*100))}%`:'—'});
const periodLabel=computed(()=>period.value==='year'?month.value.slice(0,4):dateLabel(month.value));
const previousLabel=computed(()=>period.value==='year'?String(Number(month.value.slice(0,4))-1):dateLabel(previousMonth.value,true));
const sources=computed(()=>{const totals={};filtered.value.filter(e=>e.type===(report.value==='Income'?'income':'expense')).forEach(e=>totals[e.category]=(totals[e.category]||0)+e.amount);return Object.entries(totals).sort((a,b)=>b[1]-a[1])});
const percent=i=>{const total=sources.value.reduce((s,e)=>s+e[1],0);return total?Math.round((sources.value[i]?.[1]||0)/total*100):0};
const donutStyle=computed(()=>({background:`conic-gradient(#ff852b 0 ${percent(0)}%,var(--panel) ${percent(0)}% ${Math.min(100,percent(0)+1)}%,#e6e9ea ${Math.min(100,percent(0)+1)}% 100%)`}));
const flowModel=computed(()=>buildFlowModel(periodEntries.value,entries.value,bankCards.value.filter(c=>cards.value.includes(c.id)),asOf.value,category.value));
const flow=computed(()=>flowChart(flowModel.value,chartType.value,t));
const rows=computed(()=>(page.value==='History'?entries.value:recordKind.value==='credit'?entries.value.filter(e=>e.type==='credit'&&cards.value.includes(e.card)&&e.date<=asOf.value):periodEntries.value.filter(e=>e.type===recordKind.value&&matchesCategory(e))).filter(e=>(e.description+' '+t(e.category)+' '+e.category+' '+cardName(e.card)).toLowerCase().includes(search.value.toLowerCase())).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id));
const months=computed(()=>Array.from({length:6},(_,i)=>{const d=new Date(month.value+'-01T12:00:00');d.setMonth(d.getMonth()-5+i);const prefix=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');const data=entries.value.filter(e=>e.type!=='credit'&&e.date.startsWith(prefix)&&cards.value.includes(e.card)&&matchesCategory(e));return{label:dateLabel(prefix,true),income:data.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0),expense:data.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0),count:data.length}}));
const chartMax=computed(()=>Math.max(...months.value.map(e=>Math.max(e.income,e.expense)),1000)*1.12);
const linePoints=computed(()=>months.value.map((e,i)=>`${65+i*64},${176-e.expense/chartMax.value*145}`).join(' '));
const frequencyPoints=computed(()=>{const max=Math.max(...months.value.map(e=>e.count),1);return months.value.map((e,i)=>`${i*72},${72-e.count/max*48}`).join(' ')});
let toastTimer;
function toast(message){notification.value=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>notification.value='',4000)}
function navigate(next){page.value=next;if(next==='Dashboard')report.value='Overview'}
function reset(){period.value='month';month.value='2026-09';cards.value=bankCards.value.map(c=>c.id);category.value='All categories';toast('Filters reset')}
function openForm(type='expense',entry=null){entryDialog.value.open(type,month.value+'-10',entry)}
function saveEntry(entry){const existing=entries.value.findIndex(e=>e.id===entry.id);if(existing>=0)entries.value[existing]=entry;else entries.value.push({...entry,id:Date.now()});month.value=entry.date.slice(0,7);recordKind.value=entry.type;toast(existing>=0?'Transaction updated':'Transaction saved on this device')}
function saveCard(card){if(card.id){const index=bankCards.value.findIndex(c=>c.id===card.id);bankCards.value[index]=card;}else{card.id='card-'+Date.now();bankCards.value.push(card);cards.value.push(card.id)}toast('Card saved')}
function remove(entry){deleted.value=entry;entries.value=entries.value.filter(e=>e.id!==entry.id);toast('Transaction deleted')}
function undo(){if(deleted.value){entries.value.push(deleted.value);deleted.value=null;notification.value=''}}
function importData(payload){entries.value=payload.entries;bankCards.value=payload.cards;cards.value=bankCards.value.map(c=>c.id);deleted.value=null;search.value='';category.value='All categories';recordKind.value='expense';filtersOpen.value=false;const latest=[...entries.value].filter(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((a,b)=>b.date.localeCompare(a.date))[0];if(latest){month.value=latest.date.slice(0,7);period.value='month'}}
watch(bankCards,value=>localStorage.setItem('fluxledger-cards-v1',JSON.stringify(value)),{deep:true});
watch(entries,value=>localStorage.setItem('cascade-transactions-v1',JSON.stringify(value)),{deep:true});
watch(language,value=>{localStorage.setItem('cascade-language',value);document.documentElement.lang=value==='zh'?'zh-CN':'en';document.title=value==='zh'?'Cascade — 本地记账':'Cascade — Money in motion'},{immediate:true});
watch(dark,value=>{document.body.classList.toggle('dark',value);localStorage.setItem('cascade-theme',value?'dark':'light')},{immediate:true});
</script>

<template>
  <header>
    <a class="brand" href="#" :aria-label="t('Cascade home')" @click.prevent="navigate('Analytics')"><img src="/assets/sankey-diagram-alt-svgrepo-com.svg" alt=""/></a>
    <nav><button v-for="item in ['Dashboard','Transactions','Analytics','History']" :key="item" :class="{active:page===item}" @click="navigate(item)">{{ t(item) }}</button></nav>
    <div class="header-right">
      <div class="language-switch" aria-label="Language / 语言"><button v-for="lang in ['en','zh']" :key="lang" :class="{selected:language===lang}" :aria-pressed="language===lang" @click="language=lang">{{ lang.toUpperCase() }}</button></div>
      <div class="theme-switch"><button :class="{selected:dark}" :title="t('Dark mode')" :aria-pressed="dark" @click="dark=true">☾</button><button :class="{selected:!dark}" :title="t('Light mode')" :aria-pressed="!dark" @click="dark=false">☼</button></div>
      <button class="icon notification" :aria-label="t('Notifications')" @click="toast('You’re all caught up. Your records are saved locally.')"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9M9 21h6"/></svg><i/></button>
      <button class="avatar" :title="t('Local account')" @click="toast('Local account · Data is stored in this browser')">JL</button>
    </div>
  </header>
  <main>
    <section v-if="page==='Analytics'||page==='Dashboard'">
      <div class="workspace"><div class="flow-panel">
        <div class="section-heading"><div class="title-group"><h1>{{ t('Money Flow') }}</h1><select v-model="chartType" :aria-label="t('Chart type')"><option v-for="item in ['Sankey diagram','Category breakdown']" :key="item" :value="item">{{ t(item) }}</option></select></div><div class="tools"><button class="data-manager-trigger" :title="t('Data management')" :aria-label="t('Data management')" @click="dataDialog.open()"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg><span>{{ t('Data management') }}</span></button><button v-for="kind in entryKinds" :key="kind.type" class="quick-entry" :class="kind.type" :title="t(kind.action)" @click="openForm(kind.type)"><span>{{ kind.icon }}</span>{{ t(kind.label) }}</button></div></div>
        <p class="chart-scroll-hint">↔ {{ t('Swipe to explore the money flow') }}</p><div class="flow-scroll" tabindex="0" role="region" :aria-label="t('Money flow chart, scroll horizontally')"><div id="flow-chart" v-html="flow"/></div>
        <div class="flow-footer"><span><i class="live-dot"/>{{ t('Income + credit limit · capacity, not cash balance') }}</span><span>{{ periodLabel }} ↗</span></div><p v-if="flowModel.gap>0" class="funding-note">{{ t('Expenses above recorded funding') }}: {{ money(flowModel.gap) }}</p>
      </div>
      <aside class="filter-panel" :class="{'is-expanded':filtersOpen}"><div class="aside-title"><h2 class="desktop-filter-title">{{ t('Filters') }}</h2><button class="mobile-filter-toggle" :aria-expanded="filtersOpen" aria-controls="filter-content" @click="filtersOpen=!filtersOpen"><span><strong>{{ t('Filters') }}</strong><small>{{ periodLabel }} · {{ cards.length }}/{{ bankCards.length }} {{ t('Cards') }} · {{ t(category) }}</small></span><span class="filter-chevron" aria-hidden="true">⌄</span></button><button class="icon" :title="t('Reset filters')" @click="reset">↺</button></div><div id="filter-content" class="filter-content">
        <label class="filter-label">{{ t('Time period') }}</label><div class="pills" id="period"><button :class="{active:period==='month'}" @click="period='month'">{{ t('Month') }}</button><button :class="{active:period==='year'}" @click="period='year'">{{ t('Year') }}</button><input id="month" type="month" :value="month" :aria-label="t('Select period')" @change="month=$event.target.value||'2026-09'"></div>
        <div class="cards-label"><span>{{ t('Cards') }}</span><button class="text-button" @click="cardDialog.open()">{{ t('Add card') }} ＋</button></div><div class="bank-card-list"><div v-for="card in bankCards" :key="card.id" class="bank-card-row"><button class="bank-card-edit" :aria-label="t('Edit card')+' '+t(card.name)" @click="cardDialog.open(card)"><span class="credit mini-card" :style="{background:card.color}"><b>{{ card.network }}</b></span><span class="bank-details"><strong>{{ t(card.name) }}</strong><small>•••• {{ card.last4 }} <span class="edit-hint">✎</span></small></span></button><input v-model="cards" type="checkbox" :value="card.id" :aria-label="t('Filter card')+' '+t(card.name)"></div></div>
        <label class="filter-label categories-label">{{ t('Categories') }}</label><div class="pills categories"><button v-for="item in filterCategories.slice(0,expanded?8:5)" :key="item" :class="{active:category===item}" @click="category=item">{{ t(item) }}</button><button class="show-more" @click="expanded=!expanded">{{ t(expanded?'Show less':'Show more') }}</button></div><div class="filter-note">{{ t('A little clarity. A better balance.') }}</div>
      </div></aside></div>
      <section class="reports"><div class="report-heading"><h2>{{ t('New report') }}</h2><div class="segmented"><button v-for="item in ['Overview','Income','Expenses']" :key="item" :class="{active:report===item}" @click="report=item">{{ t(item) }}</button></div><span class="report-date">{{ t('YOUR MONTH IN NUMBERS') }}</span></div>
        <div class="report-grid"><div class="left-reports"><article class="revenue"><span class="muted">{{ t(revenueLabel) }}</span><div><strong>{{ report==='Expenses'?money(revenue):signed(revenue) }}</strong><span class="growth" :title="t('Net revenue change from previous month')">{{ growth }}</span></div></article>
          <article class="frequency"><div class="card-heading"><div><h3>{{ t('Transaction Frequency') }}</h3><small>{{ t('Monthly count of transactions') }}</small></div><span class="circle-decoration">↗</span></div><div id="frequency-chart"><svg viewBox="0 0 360 90"><defs><linearGradient id="frequency-line"><stop stop-color="#dfe5e9"/><stop offset=".75" stop-color="#0c75d4"/><stop offset="1" stop-color="#cdd3d7"/></linearGradient></defs><polyline :points="frequencyPoints" fill="none" stroke="url(#frequency-line)" stroke-width="2.6" stroke-linejoin="round"/><rect x="260" y="2" width="28" height="23" rx="7" fill="#111"/><text x="274" y="18" text-anchor="middle" fill="white" font-size="10">{{ filtered.length }}</text></svg></div><div class="stat-row"><span>{{ period==='year'?periodLabel:dateLabel(month,true) }}</span><b>{{ filtered.length }} ↗</b></div><div class="stat-row"><span>{{ previousLabel }}</span><b>{{ previousRows.length }} ↗</b></div></article>
        </div>
        <article class="sources"><div class="card-heading"><h3>{{ t(report==='Income'?'Income Sources':'Expense Sources') }}</h3><span class="circle-decoration">↗</span></div><div class="donut-wrap"><div class="donut" :style="donutStyle"><div><small>{{ t('Total') }}</small><strong>{{ sources.length }}</strong></div></div><span class="donut-label">{{ percent(0) }}%</span></div><div v-for="i in [0,1]" :key="i" class="stat-row"><span>{{ t(sources[i]?.[0]||(i?'—':'No transactions')) }}</span><b>{{ percent(i) }}%</b></div></article>
        <article class="balance"><div class="card-heading"><h3>{{ t('Monthly Balance') }}</h3><span class="legend"><i/>{{ t('Income') }}<i/>{{ t('Expenses') }}</span></div><div id="balance-chart"><svg viewBox="0 0 430 208"><g font-family="Arial" font-size="9" fill="#93999e"><g v-for="i in [0,1,2,3]" :key="i"><text x="0" :y="178-i*47">{{ i?'$'+Math.round(chartMax*i/3/1000)+'K':'0' }}</text><path :d="`M35 ${176-i*47}H424`" stroke="var(--line)" stroke-dasharray="2 5"/></g><g v-for="(bar,i) in months" :key="i"><rect :x="40+i*64" :y="176-bar.income/chartMax*145" width="50" :height="Math.max(bar.income/chartMax*145,3)" rx="8" :fill="i===4?'#1d78fa':'#c2e7fa'"/><text :x="65+i*64" y="198" text-anchor="middle">{{ bar.label }}</text><g v-if="i===4&&bar.income"><rect :x="47+i*64" :y="149-bar.income/chartMax*145" width="42" height="21" rx="7" fill="#111"/><text :x="68+i*64" :y="163-bar.income/chartMax*145" text-anchor="middle" fill="white">${{ (bar.income/1000).toFixed(1) }}K</text></g></g><polyline :points="linePoints" fill="none" stroke="#5bbdca" stroke-width="2"/><circle v-for="(bar,i) in months" :key="'dot'+i" :cx="65+i*64" :cy="176-bar.expense/chartMax*145" r="2.5" stroke="#5bbdca" stroke-width="1.5" fill="var(--panel)"/></g></svg></div><div class="stat-row"><span>{{ period==='year'?periodLabel:dateLabel(month,true) }}</span><b>+{{ money(income) }}</b><b>−{{ money(expenses) }}</b></div><div class="stat-row"><span>{{ previousLabel }}</span><b>+{{ money(previousIncome) }}</b><b>−{{ money(previousExpenses) }}</b></div></article>
        </div>
      </section>
    </section>
    <section v-else id="transactions">
      <div class="section-heading"><div><span class="eyebrow">{{ t('YOUR EVERYDAY MONEY') }}</span><h1>{{ t(page==='History'?'Transaction history':'Transactions') }}</h1></div><button class="data-manager-trigger" :title="t('Data management')" :aria-label="t('Data management')" @click="dataDialog.open()"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg><span>{{ t('Data management') }}</span></button></div>
      <div class="entry-portals">
        <div v-for="kind in entryKinds" :key="kind.type" class="entry-portal" :class="[kind.type,{active:recordKind===kind.type&&page!=='History'}]">
          <button class="portal-select" :aria-pressed="recordKind===kind.type&&page!=='History'" @click="recordKind=kind.type;page='Transactions';category='All categories';search=''"><span class="portal-icon">{{ kind.icon }}</span><span><small>{{ t(kind.label) }}</small><strong>{{ money(kind.type==='credit'?totalCredit:periodEntries.filter(e=>e.type===kind.type).reduce((s,e)=>s+e.amount,0)) }}</strong></span><span class="portal-arrow">↗</span></button>
          <button class="portal-add" @click="openForm(kind.type)">＋ {{ t(kind.action) }}</button>
        </div>
      </div>
      <div v-if="recordKind==='credit'&&page!=='History'" class="credit-explanation"><span>◇</span>{{ t('The latest limit replaces the previous limit. It is not income.') }}<span class="muted">{{ t('As of') }} {{ asOf }}</span></div>
      <div class="list-toolbar"><input v-model="search" type="search" :placeholder="t('Search transactions…')"><span>{{ page==='History'?t('History'):t(entryKinds.find(k=>k.type===recordKind)?.label) }} · {{ rows.length }} {{ language==='zh'?'笔记录':'records' }}</span></div>
      <div class="table-wrap desktop-transactions"><table><thead><tr><th v-for="item in ['Description','Type','Category','Date','Card','Amount','Actions']" :key="item">{{ t(item) }}</th></tr></thead>
        <TransitionGroup name="row" tag="tbody"><tr v-for="entry in rows" :key="entry.id"><td>{{ entry.id<300||entry.type==='credit'?t(entry.description):entry.description }}</td><td><span class="type-badge" :class="entry.type">{{ t(entryKinds.find(k=>k.type===entry.type)?.label) }}</span></td><td>{{ t(entry.category) }}</td><td>{{ entry.date }}</td><td>{{ cardName(entry.card) }}</td><td :class="entry.type">{{ entry.type==='credit'?'':entry.type==='income'?'+':'−' }}{{ money(entry.amount) }}</td><td><div class="row-actions"><button class="row-edit" :aria-label="t('Edit transaction')+' '+entry.description" @click="openForm(entry.type,entry)">✎ {{ t('Edit') }}</button><button class="row-delete" :aria-label="t('Delete transaction')+' '+entry.description" @click="remove(entry)">×</button></div></td></tr></TransitionGroup>
        <tbody v-if="!rows.length"><tr><td colspan="7" class="empty-state">{{ t('No transactions found.') }}<button class="text-button empty-add" @click="openForm(recordKind)">＋ {{ t(entryKinds.find(k=>k.type===recordKind)?.action) }}</button></td></tr></tbody>
      </table></div>
      <TransitionGroup name="row" tag="ul" class="mobile-transactions" :aria-label="t('Transactions')">
        <li v-for="entry in rows" :key="entry.id" class="transaction-card">
          <div class="transaction-card-heading"><span class="type-badge" :class="entry.type">{{ t(entryKinds.find(k=>k.type===entry.type)?.label) }}</span><time :datetime="entry.date">{{ entry.date }}</time></div>
          <h3>{{ entry.id<300||entry.type==='credit'?t(entry.description):entry.description }}</h3>
          <strong class="transaction-amount" :class="entry.type">{{ entry.type==='credit'?'':entry.type==='income'?'+':'−' }}{{ money(entry.amount) }}</strong>
          <dl><div><dt>{{ t('Category') }}</dt><dd>{{ t(entry.category) }}</dd></div><div><dt>{{ t('Card') }}</dt><dd>{{ cardName(entry.card) }}</dd></div></dl>
          <div class="row-actions"><button class="row-edit" :aria-label="t('Edit transaction')+' '+entry.description" @click="openForm(entry.type,entry)">✎ {{ t('Edit') }}</button><button class="row-delete" :aria-label="t('Delete transaction')+' '+entry.description" @click="remove(entry)">× {{ t('Delete') }}</button></div>
        </li>
      </TransitionGroup>
      <div v-if="!rows.length" class="mobile-empty empty-state">{{ t('No transactions found.') }}<button class="text-button empty-add" @click="openForm(recordKind)">＋ {{ t(entryKinds.find(k=>k.type===recordKind)?.action) }}</button></div>
    </section>
  </main>
  <footer><span class="footer-brand">cascade<span>®</span></span><span>{{ t('A clear view of your financial world.') }}</span><span>{{ t('Local workspace') }} <i class="live-dot"/></span></footer>
  <EntryDialog ref="entryDialog" :cards="bankCards" :t="t" @save="saveEntry"/>
  <CardDialog ref="cardDialog" :t="t" @save="saveCard"/>
  <DataManagerDialog ref="dataDialog" :entries="entries" :cards="bankCards" :t="t" @import="importData" @notify="toast"/>
  <div class="toast" :class="{show:notification}" role="status">{{ t(notification) }}<button v-if="notification==='Transaction deleted'&&deleted" class="undo" @click="undo">{{ language==='zh'?'撤销':'Undo' }}</button></div>
</template>
