import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { nextTick, effectScope, createRenderer, onScopeDispose, createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { accountLast4, withBuiltInAccountCards, buildFlowModel } from './ledger.js';
import { createDataBackup, parseDataFile } from './dataTransfer.js';
import { flowChart } from './charts.js';

async function harness(file, props = {}, scope) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const compiled = compileScript(descriptor, { id: file });
  const template = compileTemplate({ source: descriptor.template.content, filename: file, id: file, compilerOptions: { bindingMetadata: compiled.bindings } });
  assert.deepEqual(template.errors, []);
  const code = compiled.content.replace(/import (\w+) from ['"].*?\.vue['"];?/g, 'const $1 = { render() { return null; } };')
    .replace(/from ['"](.*?)['"]/g, (_, specifier) => {
      const url = specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier + '.js', new URL(file, import.meta.url)).href;
      return 'from ' + JSON.stringify(url);
    });
  const { default: component } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const events = [];
  const setup = () => component.setup({ t: value => value, ...props }, { expose() {}, emit: (...args) => events.push(args) });
  let state;
  if (scope) {
    scope.run(() => {
      const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
      const app = renderer.createApp({ setup() { state = setup(); return () => null; } });
      app.mount({});
      onScopeDispose(() => app.unmount());
    });
  } else state = setup();
  if (state.dialog) state.dialog.value = { close() {}, showModal() {} };
  const templateCode = template.code.replace(/from ["']vue["']/g, 'from ' + JSON.stringify(import.meta.resolve('vue')));
  const { render } = await import('data:text/javascript;base64,' + Buffer.from(templateCode).toString('base64'));
  return { state, events, source, html: () => renderToString(createSSRApp({ ...component, setup: () => state, render }, { ...(component.props?.t ? { t: value => value } : {}), ...props })) };
}

test('ordinary bank and credit cards retain last-four validation and editing', async () => {
  const { state, events } = await harness('./components/CardDialog.vue');
  for (const accountType of ['Savings card', 'Credit card']) {
    state.open(); Object.assign(state.form, { name: ' Bank ', accountType, last4: '123' });
    state.save(); assert.equal(events.length, 0);
    state.form.last4 = '1234'; state.save();
    assert.equal(events[0][1].last4, '1234'); assert.equal(events[0][1].name, 'Bank');
    const saved = { ...events[0][1], id: 'legacy-bank' };
    events.length = 0; state.open(saved); state.form.name = 'Renamed'; state.save();
    assert.equal(events[0][1].id, saved.id); assert.equal(events[0][1].network, 'Visa');
    state.removeCard(); assert.deepEqual(events[1], ['remove', saved.id]); events.length = 0;
  }
});

for (const accountType of ['Alipay', 'WeChat Pay', 'Online banking', 'Other']) {
  test(accountType + ' saves without a last4 and removes stale bank details', async () => {
    const { state, events, source, html } = await harness('./components/CardDialog.vue');
    state.open(); Object.assign(state.form, { name: accountType, accountType }); state.save();
    assert.equal(events[0][1].last4, ''); assert.equal(events[0][1].noLast4, true);
    assert.equal(events[0][1].network, accountType);
    const rendered = await html();
    assert.doesNotMatch(rendered, /inputmode="numeric"|••••|0000/);
    state.open({ ...events[0][1], id: 'wallet', last4: '9876' }); state.save();
    assert.equal(events[1][1].last4, ''); assert.equal(accountLast4(events[1][1]), '');
    assert.doesNotMatch(source, /0000/);
    assert.match(source, /v-if="bankAccount"/);
    state.form.accountType = 'Savings card'; state.selectAccountType();
    assert.equal(state.form.noLast4, false); assert.equal(state.form.network, accountType === 'Other' ? 'Other' : 'Visa');
    state.open({ id: 'loan', name: 'Borrower', loanBorrower: 'Alice', noLast4: true });
    state.open(); assert.equal(state.form.loanBorrower, undefined);
  });
}

test('v1 localStorage accounts, new transactions, deletion and reload work together', async t => {
  let timestamp = Date.now();
  t.mock.method(Date, 'now', () => ++timestamp);
  const legacy = { id: 'old-bank', name: 'Old bank', last4: '4321', network: 'Visa', color: '#2784f7' };
  const storage = new Map([['fluxledger-cards-v1', JSON.stringify([legacy])], ['cascade-transactions-v1', '[]']]);
  const previous = Object.fromEntries(['localStorage', 'document', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) };
  globalThis.document = { documentElement: {}, body: { classList: { toggle() {} } } };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const scope = effectScope();
  try {
    // Start setup inside a scope so all persistence watchers can be stopped.
    const appModule = await harness('./App.vue', {}, scope);
    const app = appModule.state;
    assert.deepEqual({ ...app.bankCards.value.find(card => card.id === legacy.id) }, legacy);
    for (const [index, accountType] of ['Alipay', 'WeChat Pay'].entries()) {
      const { state: dialog, events } = await harness('./components/CardDialog.vue');
      dialog.open(); Object.assign(dialog.form, { name: accountType, accountType }); dialog.save();
      app.saveCard(events[0][1]); await nextTick();
      const wallet = app.bankCards.value.find(card => card.accountType === accountType);
      assert.ok(app.cards.value.includes(wallet.id));
      assert.equal(JSON.parse(storage.get('fluxledger-cards-v1')).find(card => card.id === wallet.id).last4, '');
      const { state: entry, events: recorded } = await harness('./components/EntryDialog.vue', { cards: app.bankCards.value });
      for (const [offset, type, amount] of [[0, 'income', 100], [1, 'expense', 30]]) {
        entry.open(type, '2026-09-10');
        Object.assign(entry.form, { id: 100 + index * 2 + offset, card: wallet.id, description: 'Transfer', category: 'Transfer', amount });
        entry.save(); app.saveEntry(recorded.at(-1)[1]);
      }
      await nextTick();
      assert.equal(app.rows.value.filter(row => row.card === wallet.id).length, 1);
      app.removeCard(wallet.id);
      assert.ok(app.bankCards.value.some(card => card.id === wallet.id));
      assert.equal(app.notification.value, 'Delete linked entries first');
      const loadedCards = withBuiltInAccountCards(JSON.parse(storage.get('fluxledger-cards-v1')));
      const loadedEntries = JSON.parse(storage.get('cascade-transactions-v1'));
      const model = buildFlowModel(loadedEntries, loadedEntries, loadedCards, '2026-09-30');
      const node = model.cards.find(card => card.id === wallet.id);
      assert.equal(node.income, 100); assert.equal(node.spent, 30);
      assert.equal(app.net.value, 70);
      const svg = flowChart(model, 'Sankey diagram', value => value);
      assert.ok(svg.includes(accountType)); assert.doesNotMatch(svg, /0000|NaN|Infinity/);
      const backup = parseDataFile(createDataBackup(loadedEntries, loadedCards));
      assert.deepEqual(backup.entries, loadedEntries);
      assert.equal(backup.cards.find(card => card.id === wallet.id).accountType, accountType);
      app.entries.value.filter(row => row.card === wallet.id).forEach(row => app.remove(row));
      app.removeCard(wallet.id); await nextTick();
      assert.ok(!JSON.parse(storage.get('fluxledger-cards-v1')).some(card => card.id === wallet.id));
    }
    assert.deepEqual(JSON.parse(storage.get('fluxledger-cards-v1')).find(card => card.id === legacy.id), legacy);
    let openedType;
    app.entryDialog.value = { open(type) { openedType = type; } };
    app.saveCard({ name: 'Custom lender', accountType: 'Online loan', network: 'Other', last4: '', noLast4: true, color: '#8659e7' });
    assert.equal(openedType, 'credit');
    const loan = app.bankCards.value.find(card => card.name === 'Custom lender');
    const previousCount = app.entries.value.length;
    app.saveEntry({ type: 'income', card: loan.id, amount: 100, date: '2026-09-10', description: 'Funding', category: 'Income' });
    assert.equal(app.entries.value.length, previousCount);
    app.saveEntry({ type: 'credit', card: loan.id, amount: 100, date: '2026-09-10', description: loan.name, category: 'Credit limit' });
    assert.equal(app.flowModel.value.credit, 100);
    assert.equal(app.income.value, 0);
    app.toast('');
  } finally {
    scope.stop();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});


test('online loan provider presets save without card numbers and explain credit funding', async () => {
  const { state, events, html } = await harness('./components/CardDialog.vue');
  for (const provider of ['白条', '花呗', '美团月付', '抖音月付']) {
    state.open(); state.form.accountType = 'Online loan'; state.selectAccountType();
    state.form.network = provider; state.selectLoanProvider();
    const rendered = await html();
    assert.match(rendered, /Loan provider/);
    assert.match(rendered, /Online loan funding uses credit limits, not income/);
    assert.doesNotMatch(rendered, /inputmode="numeric"|••••/);
    state.save(); const account = events.at(-1)[1];
    assert.equal(account.name, provider); assert.equal(account.network, provider);
    assert.equal(account.accountType, 'Online loan'); assert.equal(account.last4, '');
    assert.equal(account.noLast4, true);
    const loaded = parseDataFile(createDataBackup([], [{ ...account, id: 'new-loan' }]));
    assert.equal(loaded.cards[0].accountType, 'Online loan');
  }
});
