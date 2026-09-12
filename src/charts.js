import { accountLast4 } from './ledger.js';
const money = n => '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function details(meta) {
  if (!meta) return '';
  return ' tabindex="0" data-flow-id="'+escapeHtml(meta.id)+'" data-source="'+escapeHtml(meta.source || '')+'" data-target="'+escapeHtml(meta.target || '')+'" data-title="'+escapeHtml(meta.title)+'" data-value="'+meta.value+'" data-total="'+meta.total+'"'+(meta.category != null?' data-category="'+escapeHtml(meta.category)+'"':'')+' aria-label="'+escapeHtml(meta.title+': '+money(meta.value))+'"';
}
function interactiveNode(html,id,title,value,total,category) {
  return '<g class="flow-interactive-node"'+details({id,title,value,total,category})+'>'+html+'</g>';
}
export function ribbon(x1,y1,h1,x2,y2,h2,color,meta) {
  const curve=(x2-x1)*.5, r=meta ? 0 : Math.min(h1/2,h2/2,10,Math.max(0,(x2-x1)/4));
  const d='M'+x1+','+(y1+r)+' Q'+x1+','+y1+' '+(x1+r)+','+y1+
    ' C'+(x1+curve)+','+y1+' '+(x2-curve)+','+y2+' '+(x2-r)+','+y2+
    ' Q'+x2+','+y2+' '+x2+','+(y2+r)+' L'+x2+','+(y2+h2-r)+
    ' Q'+x2+','+(y2+h2)+' '+(x2-r)+','+(y2+h2)+
    ' C'+(x2-curve)+','+(y2+h2)+' '+(x1+curve)+','+(y1+h1)+' '+(x1+r)+','+(y1+h1)+
    ' Q'+x1+','+(y1+h1)+' '+x1+','+(y1+h1-r)+' Z';
  return '<path class="flow-ribbon" d="'+d+'" fill="'+color+'"'+details(meta)+'/>';
}
function label(x,y,name,value) {
  return '<g class="flow-label"><text x="'+(x+8)+'" y="'+(y+13)+'" font-size="10" fill="var(--muted)">'+escapeHtml(name)+'</text><text x="'+(x+8)+'" y="'+(y+29)+'" font-size="12" fill="var(--ink)">'+money(value)+'</text></g>';
}
// One amount-to-pixel scale across every column keeps even the thinnest links aligned.
export function flowSlots(values,height,scale) {
  const heights=values.map(v=>Math.max(0,v*scale));
  const count=heights.filter(Boolean).length;
  let y=36+Math.max(0,(height-48-heights.reduce((a,b)=>a+b,0)-Math.max(0,count-1)*6)/2);
  return heights.map((h,i)=>{const slot={y,h,offset:(h-values[i]*scale)/2};if(h)y+=h+6;return slot});
}
function wrapLabel(value, width, size=8) {
  const lines=[]; let line='', used=0;
  for (const char of String(value)) {
    const advance=/[^\x00-\x7F]/.test(char)?size:size*.62;
    if (line && used+advance>width) { lines.push(line); line=''; used=0; }
    line+=char; used+=advance;
  }
  if(line)lines.push(line);
  return lines;
}
function insideNode(x,slot,width,color) {
  return '<g class="flow-node"><rect x="'+x+'" y="'+slot.y+'" width="'+width+'" height="'+slot.h+'" rx="8" fill="'+escapeHtml(color)+'"/></g>';
}
function outsideLabel(x,slot,name,side,available) {
  const size=available<90?9:11;
  const lines=wrapLabel(name,available,size);
  // Long labels use two lines at most; the tooltip retains the complete name.
  const shown=lines.slice(0,2);
  if(lines.length>2)shown[1]=shown[1].slice(0,-1)+'…';
  const lineHeight=size+2;
  const y=slot.y+slot.h/2-(shown.length-1)*lineHeight/2;
  return '<text class="flow-edge-label" text-anchor="'+(side==='left'?'end':'start')+'" dominant-baseline="middle" fill="var(--muted)" font-size="'+size+'">'+shown.map((line,i)=>'<tspan x="'+x+'" y="'+(y+i*lineHeight)+'">'+escapeHtml(line)+'</tspan>').join('')+'</text>';
}

function capacityChart(model,chartType,t,width=960) {
  const {cards,income,credit,capacity}=model;
  if(!cards.length)return '<div class="chart-empty">'+escapeHtml(t('Select an account to see your money flow.'))+'</div>';
  const categories=[...new Set(cards.flatMap(c=>c.expenses.map(e=>e.category)))];
  const totals=categories.map(name=>({name,value:cards.reduce((s,c)=>s+c.expenses.filter(e=>e.category===name).reduce((a,e)=>a+e.amount,0),0)}));
  if(chartType==='Category breakdown') {
    const max=Math.max(...totals.map(g=>g.value),1);
    if(!totals.length)return '<div class="chart-empty">'+escapeHtml(t('No transactions for these filters.'))+'</div>';
    return '<svg viewBox="0 0 960 '+Math.max(335,totals.length*48)+'">'+totals.map((g,i)=>'<text x="10" y="'+(32+i*47)+'" font-size="12" fill="var(--muted)">'+escapeHtml(t(g.name))+'</text><rect x="160" y="'+(12+i*47)+'" width="'+(g.value/max*630)+'" height="29" rx="8" fill="#498cff"/><text x="'+(174+g.value/max*630)+'" y="'+(32+i*47)+'" font-size="12" fill="var(--ink)">'+money(g.value)+'</text>').join('')+'</svg>';
  }
  const unused=cards.reduce((s,c)=>s+Math.max(0,c.capacity-c.spent),0);
  const targets=[...totals,...(unused?[{name:'Unallocated capacity',value:unused}]:[])];
  const canvasWidth=Math.max(200,Math.min(960,Math.floor(width)));
  const nodeWidth=canvasWidth<480?18:24;
  const padL=Math.min(110,canvasWidth*.18), padR=Math.min(155,canvasWidth*.25);
  const xs=[padL,(padL+canvasWidth-padR-nodeWidth)/2,canvasWidth-padR-nodeWidth];
  const columns=[[income,credit],cards.map(c=>c.capacity),targets.map(g=>g.value)];
  const count=Math.max(...columns.map(values=>values.filter(v=>v>0).length));
  const flowHeight=Math.max(280,count*36);
  const height=48+flowHeight+Math.max(0,count-1)*6;
  const largestTotal=Math.max(0,...columns.map(values=>values.reduce((a,b)=>a+b,0)));
  const safeScale=largestTotal>0?flowHeight/largestTotal:0;
  const [ss,cs,ts]=columns.map(values=>flowSlots(values,height,safeScale));
  const sourceUsed=ss.map(s=>s.offset), cardUsed=cs.map(s=>s.offset), targetUsed=ts.map(s=>s.offset);
  let paths='';
  cards.forEach((card,i)=>{
    [card.income,card.credit].forEach((value,j)=>{
      if(!value)return;
      const sh=value*safeScale;
      const ch=value*safeScale;
      paths+=ribbon(xs[0]+nodeWidth-8,ss[j].y+sourceUsed[j],sh,xs[1]+8,cs[i].y+cardUsed[i],ch,j?'url(#credit-flow)':'url(#income-flow)',{id:'in:'+i+':'+j,source:'source:'+j,target:'account:'+card.id,title:t(j?'Credit limit':'Income')+' → '+t(card.name),value,total:capacity});
      sourceUsed[j]+=sh;cardUsed[i]+=ch;
    });
  });
  cards.forEach((card,i)=>{
    let used=cs[i].offset;
    targets.forEach((target,j)=>{
      const amount=target.name==='Unallocated capacity'?Math.max(0,card.capacity-card.spent):card.expenses.filter(e=>e.category===target.name).reduce((s,e)=>s+e.amount,0);
      const funded=target.name==='Unallocated capacity'?amount:amount*Math.min(1,card.capacity/(card.spent||1));
      if(!funded)return;
      const ch=funded*safeScale;
      const th=funded*safeScale;
      paths+=ribbon(xs[1]+nodeWidth-8,cs[i].y+used,ch,xs[2]+8,ts[j].y+targetUsed[j],th,'url(#expense-flow)',{id:'out:'+i+':'+j,source:'account:'+card.id,target:'target:'+j,title:t(card.name)+' → '+t(target.name),value:funded,total:capacity,category:target.name==='Unallocated capacity'?undefined:target.name});
      used+=ch;targetUsed[j]+=th;
    });
  });
  return '<svg class="sankey-chart" viewBox="0 0 '+canvasWidth+' '+height+'" role="img" aria-label="'+escapeHtml(t('Income and credit limit flow through accounts to expenses'))+'"><defs><linearGradient id="income-flow"><stop stop-color="#8a5cf6" stop-opacity=".55"/><stop offset="1" stop-color="#5997fa" stop-opacity=".26"/></linearGradient><linearGradient id="credit-flow"><stop stop-color="#627084" stop-opacity=".45"/><stop offset="1" stop-color="#5189d6" stop-opacity=".3"/></linearGradient><linearGradient id="expense-flow"><stop stop-color="#2483ff" stop-opacity=".48"/><stop offset="1" stop-color="#39c4d9" stop-opacity=".28"/></linearGradient></defs><g font-family="inherit"><g class="flow-column-labels" font-size="'+(canvasWidth<480?9:11)+'" fill="var(--muted)">'+['1. Source','2. Accounts','3. Allocation'].map((name,i)=>'<text text-anchor="'+(i===0?'start':i===2?'end':'middle')+'" x="'+(xs[i]+(i===0?0:i===2?nodeWidth:nodeWidth/2))+'" y="18">'+escapeHtml(t(name))+'</text>').join('')+'</g>'+paths+
    [income,credit].map((v,i)=>v>0?interactiveNode(insideNode(xs[0],ss[i],nodeWidth,i?'#343e4f':'#8855f5',t(i?'Credit limit':'Income'),v,capacity)+outsideLabel(xs[0]-8,ss[i],t(i?'Credit limit':'Income'),'left',padL-12),'source:'+i,t(i?'Credit limit':'Income'),v,capacity):'').join('')+
    cards.map((c,i)=>{const name=t(c.name)+(accountLast4(c)?' • '+accountLast4(c):'');return c.capacity>0?interactiveNode(insideNode(xs[1],cs[i],nodeWidth,c.color,name,c.capacity,capacity),'account:'+c.id,name,c.capacity,capacity):''}).join('')+
    targets.map((g,i)=>g.value>0?interactiveNode(insideNode(xs[2],ts[i],nodeWidth,g.name==='Unallocated capacity'?'#a0b7c5':'#24b6d2',t(g.name),g.value,capacity)+outsideLabel(xs[2]+nodeWidth+8,ts[i],t(g.name),'right',padR-12),'target:'+i,t(g.name),g.value,capacity,g.name==='Unallocated capacity'?undefined:g.name):'').join('')+'</g></svg>';
}

// Keep actual repayment cash flows separate from the capacity illustration above.
export function flowChart(model, chartType, t, width) {
  return capacityChart(model, chartType, t, width);
}

export function repaymentChart(model, t) {
  const repayments = model.repayments || [];
  const heading = '<section class="repayment-flows"><h3>'+escapeHtml(t('Repayment flow'))+'</h3><p>'+escapeHtml(t('Repayment moves cash to a credit account. It is not another expense.'))+'</p>';
  if (!repayments.length) return heading + '<p>'+escapeHtml(t('No repayments for these filters.'))+'</p></section>';
  const name = (card,id) => card ? t(card.name)+(accountLast4(card)?' · '+accountLast4(card):'') : id;
  const groups = [];
  for (const r of repayments) {
    let group = groups.find(g=>g.card===r.card && g.toCard===r.toCard);
    if (!group) { group={card:r.card,toCard:r.toCard,source:r.source,target:r.target,records:[],value:0};groups.push(group); }
    group.records.push(r);group.value+=Math.round(r.amount*100);
  }
  const max = Math.max(...groups.map(g=>g.value));
  const svg = '<div class="repayment-scroll"><svg viewBox="0 0 960 '+(groups.length*94+36)+'" role="img" aria-label="'+escapeHtml(t('Repayment flow'))+'"><g font-family="inherit">'+groups.map((g,i)=>{
    const y=28+i*94, h=8+g.value/max*40;
    const title=name(g.source,g.card)+' → '+name(g.target,g.toCard)+': '+money(g.value/100);
    return '<g><title>'+escapeHtml(title)+'</title>'+ribbon(235,y,h,710,y,h,'#25ad9a')+'<path d="M693 '+(y+h/2-5)+' l8 5 -8 5" fill="none" stroke="white" stroke-width="2"/>'+label(14,y,name(g.source,g.card),g.value/100)+label(755,y,name(g.target,g.toCard),g.value/100)+'<text x="450" y="'+(y+h+16)+'" font-size="11" fill="var(--muted)">'+escapeHtml(t('Repayments'))+'</text></g>';
  }).join('')+'</g></svg></div>';
  const mobile='<div class="repayment-mobile">'+groups.map(g=>'<div class="mobile-route"><span>'+escapeHtml(name(g.source,g.card))+'</span><b aria-hidden="true">→</b><span>'+escapeHtml(name(g.target,g.toCard))+'</span><strong>'+money(g.value/100)+'</strong></div>').join('')+'</div>';
  const details='<div class="repayment-details">'+groups.map(g=>'<details><summary>'+escapeHtml(name(g.source,g.card)+' → '+name(g.target,g.toCard)+' · '+money(g.value/100))+'</summary>'+g.records.map(r=>'<p>'+escapeHtml(r.date+' · '+r.description+' · '+money(r.amount)+' · '+t('Linked credit purchase')+': '+(r.purchase?.description||r.purchaseId)+(r.purchase?' · '+t(r.purchase.status)+' · '+t('Amount due')+' '+money(r.purchase.due):''))+'</p>').join('')+'</details>').join('')+'</div>';
  return heading+svg+mobile+details+'</section>';
}
