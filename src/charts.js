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
function slots(values,height,minimum=35) {
  const total=values.reduce((s,v)=>s+v,0), available=height-64-values.length*9;
  const base=Math.min(minimum,available/Math.max(values.length,1));
  const remainder=Math.max(0,available-base*values.length);
  let y=38;
  return values.map(value=>{const h=base+(total?value/total*remainder:0);const result={y,h};y+=h+9;return result;});
}

function wrapLabel(value, width, size=11) {
  const lines=[]; let line='', used=0;
  for (const char of String(value)) {
    const advance=/[^\x00-\x7F]/.test(char)?size:size*.62;
    if (line && used+advance>width) { lines.push(line); line=''; used=0; }
    line+=char; used+=advance;
  }
  if(line)lines.push(line);
  return lines;
}
function nodeLines(name,value,width) {
  return [...wrapLabel(name,width-12),...wrapLabel(money(value),width-12)];
}
function insideNode(x,slot,width,color,name,value,total) {
  const lines=nodeLines(name,value,width);
  const hex=color.replace('#','');
  const rgb=hex.length===3?hex.split('').map(c=>parseInt(c+c,16)):[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
  const ink=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>155?'#17212d':'#fff';
  const top=slot.y+(slot.h-(lines.length+1)*15)/2+12;
  return '<g class="flow-node"><title>'+escapeHtml(name+': '+money(value))+'</title><rect x="'+x+'" y="'+slot.y+'" width="'+width+'" height="'+slot.h+'" rx="8" fill="'+escapeHtml(color)+'"/><text text-anchor="middle" fill="'+ink+'" font-size="11" font-weight="600">'+lines.map((line,i)=>'<tspan x="'+(x+width/2)+'" y="'+(top+i*15)+'">'+escapeHtml(line)+'</tspan>').join('')+'<tspan x="'+(x+width/2)+'" y="'+(top+lines.length*15)+'" font-size="10">'+(total?Math.round(value/total*100):0)+'%</tspan></text></g>';
}

export function flowChart(model,chartType,t,width=960) {
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
  const compact=width<960;
  const canvasWidth=compact?Math.max(240,Math.floor(width)):960;
  const nodeWidth=compact?Math.min(150,canvasWidth*.27):38;
  const xs=compact?[2,(canvasWidth-nodeWidth)/2,canvasWidth-nodeWidth-2]:[14,400,777];
  const names=[t('Income'),t('Credit limit'),...cards.map(c=>t(c.name)+(c.last4?' • '+c.last4:'')),...targets.map(g=>t(g.name))];
  const values=[income,credit,...cards.map(c=>c.capacity),...targets.map(g=>g.value)];
  const minimum=compact?Math.max(...names.map((name,i)=>(nodeLines(name,values[i],nodeWidth).length+1)*15+20)):35;
  const height=compact?Math.max(350,64+Math.max(2,cards.length,targets.length)*(minimum+9)):Math.max(350,cards.length*65+60,targets.length*45+60);
  const ss=slots([income,credit],height,minimum), cs=slots(cards.map(c=>c.capacity),height,minimum), ts=slots(targets.map(g=>g.value),height,minimum);
  const sourceUsed=[0,0], cardUsed=cards.map(()=>0), targetUsed=targets.map(()=>0);
  let paths='';
  cards.forEach((card,i)=>{
    [card.income,card.credit].forEach((value,j)=>{
      if(!value)return;
      const sh=ss[j].h*value/([income,credit][j]||1);
      const ch=cs[i].h*value/(card.capacity||1);
      paths+=ribbon(xs[0]+nodeWidth,ss[j].y+sourceUsed[j],sh,xs[1],cs[i].y+cardUsed[i],ch,j?'url(#credit-flow)':'url(#income-flow)');
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
      paths+=ribbon(xs[1]+nodeWidth,cs[i].y+used,ch,xs[2],ts[j].y+targetUsed[j],th,'url(#expense-flow)');
      used+=ch;targetUsed[j]+=th;
    });
  });
  return '<svg class="sankey-chart" viewBox="0 0 '+canvasWidth+' '+height+'" role="img" aria-label="'+escapeHtml(t('Income and credit limit flow through cards to expenses'))+'"><defs><linearGradient id="income-flow"><stop stop-color="#8a5cf6" stop-opacity=".55"/><stop offset="1" stop-color="#5997fa" stop-opacity=".26"/></linearGradient><linearGradient id="credit-flow"><stop stop-color="#627084" stop-opacity=".45"/><stop offset="1" stop-color="#5189d6" stop-opacity=".3"/></linearGradient><linearGradient id="expense-flow"><stop stop-color="#2483ff" stop-opacity=".48"/><stop offset="1" stop-color="#39c4d9" stop-opacity=".28"/></linearGradient></defs><g font-family="Arial,Microsoft YaHei,sans-serif"><g font-size="11" fill="var(--muted)">'+['1. Source','2. Cards','3. Allocation'].map((name,i)=>'<text text-anchor="'+(compact?'middle':'start')+'" x="'+(xs[i]+(compact?nodeWidth/2:0))+'" y="18">'+(compact?wrapLabel(t(name),nodeWidth).map((line,j)=>'<tspan x="'+(xs[i]+nodeWidth/2)+'" y="'+(14+j*12)+'">'+escapeHtml(line)+'</tspan>').join(''):escapeHtml(t(name)))+'</text>').join('')+'</g>'+paths+
    (compact ? [income,credit].map((v,i)=>insideNode(xs[0],ss[i],nodeWidth,i?'#343e4f':'#8855f5',t(i?'Credit limit':'Income'),v,capacity)).join('')+cards.map((c,i)=>insideNode(xs[1],cs[i],nodeWidth,c.color,t(c.name)+(c.last4?' • '+c.last4:''),c.capacity,capacity)).join('')+targets.map((g,i)=>insideNode(xs[2],ts[i],nodeWidth,g.name==='Unallocated capacity'?'#a0b7c5':'#24b6d2',t(g.name),g.value,Math.max(capacity,model.spent))).join('') : [income,credit].map((v,i)=>block(14,ss[i].y,ss[i].h,i?'#343e4f':'#8855f5',v,capacity)+label(59,ss[i].y+3,t(i?'Credit limit':'Income'),v)).join('')+
    cards.map((c,i)=>'<g><title>'+escapeHtml(t(c.name)+(c.last4?' • '+c.last4:'')+': '+money(c.capacity))+'</title>'+block(400,cs[i].y,cs[i].h,c.color,c.capacity,capacity)+label(445,cs[i].y+3,t(c.name).slice(0,16)+(c.last4?' • '+c.last4:''),c.capacity)+'</g>').join('')+
    targets.map((g,i)=>'<g><title>'+escapeHtml(t(g.name)+': '+money(g.value))+'</title>'+block(777,ts[i].y,ts[i].h,g.name==='Unallocated capacity'?'#a0b7c5':'#24b6d2',g.value,Math.max(capacity,model.spent))+label(821,ts[i].y+2,t(g.name),g.value)+'</g>').join(''))+'</g></svg>';
}
