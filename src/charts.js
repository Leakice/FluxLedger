const money = n => '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ribbon(x1,y1,h1,x2,y2,h2,color) {
  const curve=(x2-x1)*.48;
  return '<path class="flow-ribbon" d="M'+x1+','+y1+' C'+(x1+curve)+','+y1+' '+(x2-curve)+','+y2+' '+x2+','+y2+' L'+x2+','+(y2+h2)+' C'+(x2-curve)+','+(y2+h2)+' '+(x1+curve)+','+(y1+h1)+' '+x1+','+(y1+h1)+'Z" fill="'+color+'"/>';
}
function label(x,y,name,value) {
  return '<g class="flow-label"><rect class="label-box" x="'+x+'" y="'+y+'" width="125" height="37" rx="7" fill="var(--panel)" fill-opacity=".94"/><text x="'+(x+8)+'" y="'+(y+13)+'" font-size="10" fill="var(--muted)">'+escapeHtml(name)+'</text><text x="'+(x+8)+'" y="'+(y+29)+'" font-size="12" fill="var(--ink)">'+money(value)+'</text></g>';
}
function block(x,y,h,color,value,total) {
  return '<rect x="'+x+'" y="'+y+'" width="38" height="'+Math.max(h,3)+'" rx="7" fill="'+color+'" stroke="var(--panel)" stroke-width="2"/>'+(h>26?'<text x="'+(x+19)+'" y="'+(y+20)+'" text-anchor="middle" fill="white" font-size="11">'+(total?Math.round(value/total*100):0)+'%</text>':'');
}
function slots(values,height) {
  const total=values.reduce((s,v)=>s+v,0), available=height-64-values.length*9;
  const base=Math.min(35,available/Math.max(values.length,1));
  const remainder=Math.max(0,available-base*values.length);
  let y=38;
  return values.map(value=>{const h=base+(total?value/total*remainder:0);const result={y,h};y+=h+9;return result;});
}
export function flowChart(model,chartType,t) {
  const {cards,income,credit,capacity}=model;
  if(!cards.length)return '<div class="chart-empty">'+escapeHtml(t('Select a card to see your money flow.'))+'</div>';
  const categories=[...new Set(cards.flatMap(c=>c.expenses.map(e=>e.category)))];
  const totals=categories.map(name=>({name,value:cards.reduce((s,c)=>s+c.expenses.filter(e=>e.category===name).reduce((a,e)=>a+e.amount,0),0)}));
  if(chartType==='Category breakdown') {
    const max=Math.max(...totals.map(g=>g.value),1);
    if(!totals.length)return '<div class="chart-empty">'+escapeHtml(t('No transactions for these filters.'))+'</div>';
    return '<svg viewBox="0 0 960 '+Math.max(335,totals.length*48)+'">'+totals.map((g,i)=>'<text x="10" y="'+(32+i*47)+'" font-size="12" fill="var(--muted)">'+escapeHtml(t(g.name))+'</text><rect x="160" y="'+(12+i*47)+'" width="'+(g.value/max*630)+'" height="29" rx="8" fill="#498cff"/><text x="'+(174+g.value/max*630)+'" y="'+(32+i*47)+'" font-size="12" fill="var(--ink)">'+money(g.value)+'</text>').join('')+'</svg>';
  }
  const unused=cards.reduce((s,c)=>s+Math.max(0,c.capacity-c.spent),0);
  const targets=[...totals,...(unused?[{name:'Unallocated capacity',value:unused}]:[])];
  const height=Math.max(350,cards.length*65+60,targets.length*45+60);
  const ss=slots([income,credit],height), cs=slots(cards.map(c=>c.capacity),height), ts=slots(targets.map(g=>g.value),height);
  const sourceUsed=[0,0], cardUsed=cards.map(()=>0), targetUsed=targets.map(()=>0);
  let paths='';
  cards.forEach((card,i)=>{
    [card.income,card.credit].forEach((value,j)=>{
      if(!value)return;
      const sh=ss[j].h*value/([income,credit][j]||1);
      const ch=cs[i].h*value/(card.capacity||1);
      paths+=ribbon(52,ss[j].y+sourceUsed[j],sh,400,cs[i].y+cardUsed[i],ch,j?'url(#credit-flow)':'url(#income-flow)');
      sourceUsed[j]+=sh;cardUsed[i]+=ch;
    });
  });
  cards.forEach((card,i)=>{
    let used=0;
    targets.forEach((target,j)=>{
      const amount=target.name==='Unallocated capacity'?Math.max(0,card.capacity-card.spent):card.expenses.filter(e=>e.category===target.name).reduce((s,e)=>s+e.amount,0);
      const funded=target.name==='Unallocated capacity'?amount:amount*Math.min(1,card.capacity/(card.spent||1));
      if(!funded)return;
      const ch=cs[i].h*funded/(card.capacity||1);
      const th=ts[j].h*funded/(target.value||1);
      paths+=ribbon(438,cs[i].y+used,ch,777,ts[j].y+targetUsed[j],th,'url(#expense-flow)');
      used+=ch;targetUsed[j]+=th;
    });
  });
  return '<svg viewBox="0 0 960 '+height+'" role="img" aria-label="'+escapeHtml(t('Income and credit limit flow through cards to expenses'))+'"><defs><linearGradient id="income-flow"><stop stop-color="#8a5cf6" stop-opacity=".55"/><stop offset="1" stop-color="#5997fa" stop-opacity=".26"/></linearGradient><linearGradient id="credit-flow"><stop stop-color="#627084" stop-opacity=".45"/><stop offset="1" stop-color="#5189d6" stop-opacity=".3"/></linearGradient><linearGradient id="expense-flow"><stop stop-color="#2483ff" stop-opacity=".48"/><stop offset="1" stop-color="#39c4d9" stop-opacity=".28"/></linearGradient></defs><g font-family="Arial,Microsoft YaHei,sans-serif"><g font-size="11" fill="var(--muted)"><text x="14" y="18">'+escapeHtml(t('1. Source'))+'</text><text x="400" y="18">'+escapeHtml(t('2. Cards'))+'</text><text x="777" y="18">'+escapeHtml(t('3. Allocation'))+'</text></g>'+paths+
    [income,credit].map((v,i)=>block(14,ss[i].y,ss[i].h,i?'#343e4f':'#8855f5',v,capacity)+label(59,ss[i].y+3,t(i?'Credit limit':'Income'),v)).join('')+
    cards.map((c,i)=>'<g><title>'+escapeHtml(t(c.name)+' • '+c.last4+': '+money(c.capacity))+'</title>'+block(400,cs[i].y,cs[i].h,c.color,c.capacity,capacity)+label(445,cs[i].y+3,t(c.name).slice(0,16)+' • '+c.last4,c.capacity)+'</g>').join('')+
    targets.map((g,i)=>'<g><title>'+escapeHtml(t(g.name)+': '+money(g.value))+'</title>'+block(777,ts[i].y,ts[i].h,g.name==='Unallocated capacity'?'#a0b7c5':'#24b6d2',g.value,Math.max(capacity,model.spent))+label(821,ts[i].y+2,t(g.name),g.value)+'</g>').join('')+'</g></svg>';
}
