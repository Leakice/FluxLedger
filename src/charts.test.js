import test from 'node:test';
import assert from 'node:assert/strict';
import { flowChart, ribbon, flowSlots } from './charts.js';
const t = x => x;
const model = {income:100,credit:0,capacity:100,spent:50,cards:[
{id:'a',name:'Same <name>',color:'#498cff',income:60,credit:0,capacity:60,spent:30,expenses:[{category:'Food',amount:30}]},
{id:'b',name:'Same <name>',color:'#498cff',income:40,credit:0,capacity:40,spent:20,expenses:[{category:'Food',amount:20}]}
]};
test('duplicate labels keep distinct account endpoints, escaped titles and exact funded values', () => {
  for (const width of [320,960]) {
    const svg=flowChart(model,'Sankey diagram',t,width);
    assert.match(svg,/data-flow-id="account:a"/);
    assert.match(svg,/data-flow-id="account:b"/);
    assert.match(svg,/data-source="account:a" data-target="target:0"[^>]*data-value="30"/);
    assert.match(svg,/data-source="account:b" data-target="target:0"[^>]*data-value="20"/);
    assert.doesNotMatch(svg,/<name>/);
    assert.doesNotMatch(svg,/NaN|Infinity/);
  }
});
test('rounded ribbons clamp radii for narrow gaps and tiny amounts', () => {
  const path=ribbon(0,10,.01,1,20,.02,'#fff');
  assert.match(path,/Q/);
  assert.match(path,/M0,10.005/);
  assert.doesNotMatch(path,/NaN|Infinity/);
});
test('no funding and no selected accounts remain renderable', () => {
  const zero={...model,income:0,capacity:0,cards:model.cards.map(c=>({...c,income:0,capacity:0}))};
  assert.doesNotMatch(flowChart(zero,'Sankey diagram',t,320),/NaN|Infinity/);
  assert.match(flowChart({...zero,cards:[]},'Sankey diagram',t,320),/chart-empty/);
});

test('tiny nodes preserve the exact same scale as large nodes',()=>{
  const slots=flowSlots([.01,100],350,2);
  assert.equal(slots[0].h,.02);
  assert.equal(slots[0].offset,0);
  assert.equal(slots[1].h,200);
  assert.equal(slots[1].offset,0);
});
test('attached ribbons overlap nodes and retain equal thickness at both ends',()=>{
  for(const width of [240,320,960]){
    const svg=flowChart(model,'Sankey diagram',t,width);
    assert.doesNotMatch(svg,/label-box/);
    const paths=[...svg.matchAll(/<path class="flow-ribbon" d="([^"]+)"[^>]*data-value="([^"]+)"/g)];
    for(const [,d,value] of paths){
      const numbers=[...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>Number(m[0]));
      const topSource=numbers[1],topTarget=numbers[11],bottomTarget=numbers[23],bottomSource=numbers[31];
      assert.ok(Math.abs((bottomTarget-topTarget)-(bottomSource-topSource))<1e-8);
      assert.ok(Number(value)>0);
    }
    assert.ok(paths.length>0);
  }
});

test('rendered node heights follow exact values across columns and widths',()=>{
  for(const width of [280,390,960]){
    const svg=flowChart(model,'Sankey diagram',t,width);
    const nodes=[...svg.matchAll(/class="flow-interactive-node"[^>]*data-value="([^"]+)"[^>]*>[\s\S]*?<rect[^>]*height="([^"]+)"/g)];
    assert.ok(nodes.length>=5);
    const scale=Number(nodes[0][2])/Number(nodes[0][1]);
    for(const [,value,height] of nodes)assert.ok(Math.abs(Number(height)/Number(value)-scale)<1e-8);
  }
});

test('allocation nodes and outgoing links carry escaped original categories only for expenses',()=>{
  const category='Food & "Drinks" <snacks>';
  const data={...model,cards:model.cards.map(c=>({...c,expenses:c.expenses.map(e=>({...e,category}))}))};
  for(const width of [320,960]) {
    const svg=flowChart(data,'Sankey diagram',name=>'Translated '+name,width);
    for(const id of ['target:0','out:0:0','out:1:0']) {
      const tag=svg.match(new RegExp('<[^>]*data-flow-id="'+id+'"[^>]*>'))?.[0];
      assert.ok(tag);
      assert.ok(tag.includes('data-category="Food &amp; &quot;Drinks&quot; &lt;snacks&gt;"'));
    }
    for(const id of ['target:1','out:0:1','out:1:1']) {
      const tag=svg.match(new RegExp('<[^>]*data-flow-id="'+id+'"[^>]*>'))?.[0];
      assert.ok(tag);
      assert.doesNotMatch(tag,/data-category=/);
    }
    assert.doesNotMatch(flowChart(data,'Category breakdown',t,width),/data-flow-id|data-category/);
  }
});
