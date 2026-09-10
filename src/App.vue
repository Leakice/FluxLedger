<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { seed } from './seed';
import { dictionary } from './locales';
import { flowChart } from './charts';

const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const entries=ref(read('cascade-transactions-v1',seed));
const language=ref(localStorage.getItem('cascade-language')||'en');
const dark=ref(localStorage.getItem('cascade-theme')==='dark');
const page=ref('Analytics'), report=ref('Overview'), period=ref('month'), month=ref('2026-09');
const cards=ref(['4329','8851']), category=ref('All categories'), expanded=ref(false), chartType=ref('Sankey diagram'), search=ref('');
const dialog=ref(null), notification=ref(''), deleted=ref(null);
const categoryOptions=['Food & Drinks','Entertainment','Utilities','Shopping','Subscription','Other','Salary'];
const filterCategories=['All categories','Food & Drinks','Subscription','Income','Shopping','Entertainment','Utilities','Other'];
const form=reactive({description:'',amount:'',type:'expense',category:'Food & Drinks',date:'2026-09-10',card:'4329'});
const t=s=>language.value==='zh'?(dictionary[s]||s):s;
const money=n=>'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=n=>(n>=0?'+ ':'− ')+money(n);
const dateLabel=(value,short=false)=>new Date(value+'-01T12:00:00').toLocaleDateString(language.value==='zh'?'zh-CN':'en-US',short?{month:'short'}:{month:'long',year:'numeric'});
const matchesCategory=e=>category.value==='All categories'||(category.value==='Income'?e.type==='income':category.value===e.category);
const filtered=computed(()=>entries.value.filter(e=>e.date.startsWith(period.value==='year'?month.value.slice(0,4):month.value)&&cards.value.includes(e.card)&&matchesCategory(e)));
const income=computed(()=>filtered.value.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0));
const expenses=computed(()=>filtered.value.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0));
const net=computed(()=>income.value-expenses.value);
const revenue=computed(()=>report.value==='Income'?income.value:report.value==='Expenses'?expenses.value:net.value);
const revenueLabel=computed(()=>report.value==='Income'?'Total Income':report.value==='Expenses'?'Total Expenses':period.value==='year'?'Net Yearly Revenue':'Net Monthly Revenue');
const previousMonth=computed(()=>{const d=new Date(month.value+'-01T12:00:00');d.setMonth(d.getMonth()-1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')});
const previousRows=computed(()=>entries.value.filter(e=>e.date.startsWith(period.value==='year'?String(Number(month.value.slice(0,4))-1):previousMonth.value)&&cards.value.includes(e.card)&&matchesCategory(e)));
const previousIncome=computed(()=>previousRows.value.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0));
const previousExpenses=computed(()=>previousRows.value.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0));
const growth=computed(()=>{const prev=previousIncome.value-previousExpenses.value;return prev?`${net.value>=prev?'↗':'↘'} ${Math.abs(Math.round((net.value-prev)/Math.abs(prev)*100))}%`:'—'});
const periodLabel=computed(()=>period.value==='year'?month.value.slice(0,4):dateLabel(month.value));
const previousLabel=computed(()=>period.value==='year'?String(Number(month.value.slice(0,4))-1):dateLabel(previousMonth.value,true));
const sources=computed(()=>{const totals={};filtered.value.filter(e=>e.type===(report.value==='Income'?'income':'expense')).forEach(e=>totals[e.category]=(totals[e.category]||0)+e.amount);return Object.entries(totals).sort((a,b)=>b[1]-a[1])});
const percent=i=>{const total=sources.value.reduce((s,e)=>s+e[1],0);return total?Math.round((sources.value[i]?.[1]||0)/total*100):0};
const donutStyle=computed(()=>({background:`conic-gradient(#ff852b 0 ${percent(0)}%,var(--panel) ${percent(0)}% ${Math.min(100,percent(0)+1)}%,#e6e9ea ${Math.min(100,percent(0)+1)}% 100%)`}));
const flow=computed(()=>flowChart(filtered.value,chartType.value,t));
const rows=computed(()=>(page.value==='History'?entries.value:filtered.value).filter(e=>(e.description+' '+t(e.category)+' '+e.category).toLowerCase().includes(search.value.toLowerCase())).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id));
const months=computed(()=>Array.from({length:6},(_,i)=>{const d=new Date(month.value+'-01T12:00:00');d.setMonth(d.getMonth()-5+i);const prefix=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');const data=entries.value.filter(e=>e.date.startsWith(prefix)&&cards.value.includes(e.card)&&matchesCategory(e));return{label:dateLabel(prefix,true),income:data.filter(e=>e.type==='income').reduce((s,e)=>s+e.amount,0),expense:data.filter(e=>e.type==='expense').reduce((s,e)=>s+e.amount,0),count:data.length}}));
const chartMax=computed(()=>Math.max(...months.value.map(e=>Math.max(e.income,e.expense)),1000)*1.12);
const linePoints=computed(()=>months.value.map((e,i)=>`${65+i*64},${176-e.expense/chartMax.value*145}`).join(' '));
const frequencyPoints=computed(()=>{const max=Math.max(...months.value.map(e=>e.count),1);return months.value.map((e,i)=>`${i*72},${72-e.count/max*48}`).join(' ')});
let toastTimer;
function toast(message){notification.value=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>notification.value='',4000)}
function navigate(next){page.value=next;if(next==='Dashboard')report.value='Overview'}
function reset(){period.value='month';month.value='2026-09';cards.value=['4329','8851'];category.value='All categories';toast('Filters reset')}
function openForm(){form.date=month.value+'-10';dialog.value.showModal()}
function add(){const amount=Number(form.amount);if(!Number.isFinite(amount)||amount<=0||!form.description.trim())return;entries.value.push({...form,description:form.description.trim(),amount,id:Date.now()});month.value=form.date.slice(0,7);form.description='';form.amount='';dialog.value.close();toast('Transaction saved on this device')}
function remove(entry){deleted.value=entry;entries.value=entries.value.filter(e=>e.id!==entry.id);toast('Transaction deleted')}
function undo(){if(deleted.value){entries.value.push(deleted.value);deleted.value=null;notification.value=''}}
function exportCsv(){const cell=v=>'"'+String(v).replace(/^([=+@-])/,"'$1").replaceAll('"','""')+'"';const csv='\uFEFF'+[['Description','Type','Category','Date','Card','Amount'].map(t),...filtered.value.map(e=>[e.description,t(e.type==='income'?'Income':'Expense'),t(e.category),e.date,e.card,e.amount])].map(r=>r.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`cascade-${month.value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Transactions exported')}
watch(entries,value=>localStorage.setItem('cascade-transactions-v1',JSON.stringify(value)),{deep:true});
watch(language,value=>{localStorage.setItem('cascade-language',value);document.documentElement.lang=value==='zh'?'zh-CN':'en';document.title=value==='zh'?'Cascade — 本地记账':'Cascade — Money in motion'},{immediate:true});
watch(dark,value=>{document.body.classList.toggle('dark',value);localStorage.setItem('cascade-theme',value?'dark':'light')},{immediate:true});
</script>

<template>
  <header>
    <a class="brand" href="#" :aria-label="t('Cascade home')" @click.prevent="navigate('Analytics')"><svg viewBox="0 0 40 44"><path d="M4 3v19c0 8 9 13 17 15V20C11 17 7 10 4 3Zm18 5v17c8 3 12 9 14 16V23c0-7-6-12-14-15Z" fill="currentColor"/></svg></a>
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
        <div class="section-heading"><div class="title-group"><h1>{{ t('Money Flow') }}</h1><select v-model="chartType" :aria-label="t('Chart type')"><option v-for="item in ['Sankey diagram','Category breakdown']" :key="item" :value="item">{{ t(item) }}</option></select></div><div class="tools"><button class="icon" :title="t('Export transactions')" @click="exportCsv"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H5V3h2m7 0v5h5M12 17V10m-3 3 3-3 3 3"/></svg></button><button class="icon" :title="t('Add transaction')" @click="openForm">＋</button></div></div>
        <div id="flow-chart" v-html="flow"/>
        <div class="flow-footer"><span><i class="live-dot"/>{{ t('Your money, at a glance') }}</span><span>{{ periodLabel }} ↗</span></div>
      </div>
      <aside><div class="aside-title"><h2>{{ t('Filters') }}</h2><button class="icon" :title="t('Reset filters')" @click="reset">↺</button></div>
        <label class="filter-label">{{ t('Time period') }}</label><div class="pills" id="period"><button :class="{active:period==='month'}" @click="period='month'">{{ t('Month') }}</button><button :class="{active:period==='year'}" @click="period='year'">{{ t('Year') }}</button><input id="month" type="month" :value="month" :aria-label="t('Select period')" @change="month=$event.target.value||'2026-09'"></div>
        <label class="filter-label">{{ t('Cards') }}</label><label v-for="(card,index) in ['4329','8851']" :key="card" class="card-option"><span class="credit" :class="index?'blue':'yellow'"><b>{{ index?'●●':'VISA' }}</b></span><span><small>{{ t('Credit card') }}</small><br>•••• {{ card }}</span><input v-model="cards" type="checkbox" :value="card"></label>
        <label class="filter-label categories-label">{{ t('Categories') }}</label><div class="pills categories"><button v-for="item in filterCategories.slice(0,expanded?8:5)" :key="item" :class="{active:category===item}" @click="category=item">{{ t(item) }}</button><button class="show-more" @click="expanded=!expanded">{{ t(expanded?'Show less':'Show more') }}</button></div><div class="filter-note">{{ t('A little clarity. A better balance.') }}</div>
      </aside></div>
      <section class="reports"><div class="report-heading"><h2>{{ t('New report') }}</h2><div class="segmented"><button v-for="item in ['Overview','Income','Expenses']" :key="item" :class="{active:report===item}" @click="report=item">{{ t(item) }}</button></div><span class="report-date">{{ t('YOUR MONTH IN NUMBERS') }}</span></div>
        <div class="report-grid"><div class="left-reports"><article class="revenue"><span class="muted">{{ t(revenueLabel) }}</span><div><strong>{{ report==='Expenses'?money(revenue):signed(revenue) }}</strong><span class="growth" :title="t('Net revenue change from previous month')">{{ growth }}</span></div></article>
          <article class="frequency"><div class="card-heading"><div><h3>{{ t('Transaction Frequency') }}</h3><small>{{ t('Monthly count of transactions') }}</small></div><span class="circle-decoration">↗</span></div><div id="frequency-chart"><svg viewBox="0 0 360 90"><defs><linearGradient id="frequency-line"><stop stop-color="#dfe5e9"/><stop offset=".75" stop-color="#0c75d4"/><stop offset="1" stop-color="#cdd3d7"/></linearGradient></defs><polyline :points="frequencyPoints" fill="none" stroke="url(#frequency-line)" stroke-width="2.6" stroke-linejoin="round"/><rect x="260" y="2" width="28" height="23" rx="7" fill="#111"/><text x="274" y="18" text-anchor="middle" fill="white" font-size="10">{{ filtered.length }}</text></svg></div><div class="stat-row"><span>{{ period==='year'?periodLabel:dateLabel(month,true) }}</span><b>{{ filtered.length }} ↗</b></div><div class="stat-row"><span>{{ previousLabel }}</span><b>{{ previousRows.length }} ↗</b></div></article>
        </div>
        <article class="sources"><div class="card-heading"><h3>{{ t(report==='Income'?'Income Sources':'Expense Sources') }}</h3><span class="circle-decoration">↗</span></div><div class="donut-wrap"><div class="donut" :style="donutStyle"><div><small>{{ t('Total') }}</small><strong>{{ sources.length }}</strong></div></div><span class="donut-label">{{ percent(0) }}%</span></div><div v-for="i in [0,1]" :key="i" class="stat-row"><span>{{ t(sources[i]?.[0]||(i?'—':'No transactions')) }}</span><b>{{ percent(i) }}%</b></div></article>
        <article class="balance"><div class="card-heading"><h3>{{ t('Monthly Balance') }}</h3><span class="legend"><i/>{{ t('Income') }}<i/>{{ t('Expenses') }}</span></div><div id="balance-chart"><svg viewBox="0 0 430 208"><g font-family="Arial" font-size="9" fill="#93999e"><g v-for="i in [0,1,2,3]" :key="i"><text x="0" :y="178-i*47">{{ i?'$'+Math.round(chartMax*i/3/1000)+'K':'0' }}</text><path :d="`M35 ${176-i*47}H424`" stroke="var(--line)" stroke-dasharray="2 5"/></g><g v-for="(bar,i) in months" :key="i"><rect :x="40+i*64" :y="176-bar.income/chartMax*145" width="50" :height="Math.max(bar.income/chartMax*145,3)" rx="8" :fill="i===4?'#1d78fa':'#c2e7fa'"/><text :x="65+i*64" y="198" text-anchor="middle">{{ bar.label }}</text><g v-if="i===4&&bar.income"><rect :x="47+i*64" :y="149-bar.income/chartMax*145" width="42" height="21" rx="7" fill="#111"/><text :x="68+i*64" :y="163-bar.income/chartMax*145" text-anchor="middle" fill="white">${{ (bar.income/1000).toFixed(1) }}K</text></g></g><polyline :points="linePoints" fill="none" stroke="#5bbdca" stroke-width="2"/><circle v-for="(bar,i) in months" :key="'dot'+i" :cx="65+i*64" :cy="176-bar.expense/chartMax*145" r="2.5" stroke="#5bbdca" stroke-width="1.5" fill="var(--panel)"/></g></svg></div><div class="stat-row"><span>{{ period==='year'?periodLabel:dateLabel(month,true) }}</span><b>+{{ money(income) }}</b><b>−{{ money(expenses) }}</b></div><div class="stat-row"><span>{{ previousLabel }}</span><b>+{{ money(previousIncome) }}</b><b>−{{ money(previousExpenses) }}</b></div></article>
        </div>
      </section>
    </section>
    <section v-else id="transactions"><div class="section-heading"><div><span class="eyebrow">{{ t('YOUR EVERYDAY MONEY') }}</span><h1>{{ t(page==='History'?'Transaction history':'Transactions') }}</h1></div><button class="primary" @click="openForm">{{ t('＋ Add transaction') }}</button></div><div class="list-toolbar"><input v-model="search" type="search" :placeholder="t('Search transactions…')"><span>{{ rows.length }} {{ language==='zh'?'笔交易':'transactions' }}</span></div><div class="table-wrap"><table><thead><tr><th v-for="item in ['Description','Category','Date','Card','Amount']" :key="item">{{ t(item) }}</th><th/></tr></thead><tbody><tr v-for="entry in rows" :key="entry.id"><td>{{ entry.id<300?t(entry.description):entry.description }}</td><td>{{ t(entry.category) }}</td><td>{{ entry.date }}</td><td>•••• {{ entry.card }}</td><td :class="entry.type">{{ entry.type==='income'?'+':'−' }}{{ money(entry.amount) }}</td><td><button :title="t('Delete transaction')" @click="remove(entry)">×</button></td></tr><tr v-if="!rows.length"><td colspan="6" class="empty-state">{{ t('No transactions found.') }}</td></tr></tbody></table></div></section>
  </main>
  <footer><span class="footer-brand">cascade<span>®</span></span><span>{{ t('A clear view of your financial world.') }}</span><span>{{ t('Local workspace') }} <i class="live-dot"/></span></footer>
  <dialog ref="dialog"><form @submit.prevent="add"><div class="card-heading"><h2>{{ t('Add transaction') }}</h2><button type="button" class="icon" @click="dialog.close()">×</button></div><p class="muted">{{ t('A small entry. A clearer picture.') }}</p><label>{{ t('Description') }}<input v-model="form.description" required maxlength="80" :placeholder="t('e.g. Groceries')"></label><div class="form-row"><label>{{ t('Amount ($)') }}<input v-model="form.amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label><label>{{ t('Type') }}<select v-model="form.type"><option value="expense">{{ t('Expense') }}</option><option value="income">{{ t('Income') }}</option></select></label></div><label>{{ t('Category') }}<select v-model="form.category"><option v-for="item in categoryOptions" :key="item" :value="item">{{ t(item) }}</option></select></label><div class="form-row"><label>{{ t('Date') }}<input v-model="form.date" type="date" required></label><label>{{ t('Card') }}<select v-model="form.card"><option value="4329">Visa •••• 4329</option><option value="8851">{{ t('Mastercard •••• 8851') }}</option></select></label></div><button class="primary submit" type="submit">{{ t('Save transaction ↗') }}</button></form></dialog>
  <div class="toast" :class="{show:notification}" role="status">{{ t(notification) }}<button v-if="notification==='Transaction deleted'&&deleted" class="undo" @click="undo">{{ language==='zh'?'撤销':'Undo' }}</button></div>
</template>
