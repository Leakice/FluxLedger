import test from 'node:test';
import assert from 'node:assert/strict';
import { flowChart, ribbon } from './charts.js';
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
