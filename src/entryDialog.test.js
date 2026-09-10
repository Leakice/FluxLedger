import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, compileTemplate, compileScript } from '@vue/compiler-sfc';

test('entry dialog calls the loan predicate and compiles all transaction card branches',async()=>{
  const source=await readFile(new URL('./components/EntryDialog.vue',import.meta.url),'utf8');
  const {descriptor}=parse(source);
  assert.match(descriptor.template.content,/v-if="isLoan\(\)"/);
  const compiled=compileTemplate({source:descriptor.template.content,filename:'EntryDialog.vue',id:'entry-dialog'});
  assert.deepEqual(compiled.errors,[]);
  assert.match(compiled.code,/isLoan\(\)/);
  assert.match(descriptor.template.content,/form\.type!==['"]credit['"]/);
  assert.match(descriptor.template.content,/v-else/);
  assert.match(descriptor.scriptSetup.content,/resolveCreditAccountCard\(props\.cards, account\)/);
  assert.doesNotMatch(descriptor.scriptSetup.content,/creditAccountCards\.find\(card => card\.name === account\)\?\.id/);
});


async function entryDialogHarness() {
  const source = await readFile(new URL('./components/EntryDialog.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const compiled = compileScript(descriptor, { id: 'entry-dialog-behavior' });
  const code = compiled.content
    .replaceAll("from 'vue'", 'from ' + JSON.stringify(import.meta.resolve('vue')))
    .replaceAll("from '../ledger'", 'from ' + JSON.stringify(new URL('./ledger.js', import.meta.url).href));
  const { default: component } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const cards = [
    { id: 'selected-card', name: 'Selected account' },
    { id: 'credit-huabei', name: '花呗' },
    { id: 'legacy-baitiao', name: '白条' }
  ];
  const events = [];
  const state = component.setup({ cards, t: value => value }, {
    expose() {},
    emit: (...event) => events.push(event)
  });
  state.dialog.value = { close() {} };
  return { state, events };
}

for (const type of ['expense', 'income']) {
  test(type + ' keeps the selected account when its description matches a credit account', async () => {
    const { state, events } = await entryDialogHarness();
    for (const description of ['花呗', '白条']) {
      Object.assign(state.form, { type, description, card: 'selected-card', amount: 100, category: 'Other', date: '2026-09-10' });
      state.save();
      assert.equal(events.at(-1)?.[0], 'save');
      assert.equal(events.at(-1)?.[1].card, 'selected-card');
    }
    assert.equal(events.length, 2);
  });
}

test('credit entries still resolve current and migrated account IDs', async () => {
  const { state, events } = await entryDialogHarness();
  for (const [description, expectedCard] of [['花呗', 'credit-huabei'], ['白条', 'legacy-baitiao']]) {
    Object.assign(state.form, { type: 'credit', description, card: 'selected-card', amount: 100, category: 'Credit limit', date: '2026-09-10' });
    state.save();
    assert.equal(events.at(-1)?.[1].card, expectedCard);
  }
  assert.equal(events.length, 2);
});
