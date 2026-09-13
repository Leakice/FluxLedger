// Real-browser regression for the PR2 storage refactor. Drives the built
// production bundle over HTTP with trusted browser events: dialog clicks,
// file-input injection, download capture, filters, and reloads. Records the
// five storage keys' raw strings plus page side effects after every checkpoint
// so a PR run and a baseline run can be compared byte for byte.
//
// Usage (from the control-browser skill's node REPL, after bootstrap):
//   const { runScenario } = await import('file:///D:/2/记账/scripts/browser-replay/run-scenario.mjs');
//   await runScenario(browser, { url: 'http://localhost:4173/', outDir: '.../pr', label: 'pr' });
// Differences from the happy-dom replay: the OS file picker itself cannot be
// automated in the in-app browser, so the file is handed to the real
// <input type=file> via DataTransfer and the app's own change handler,
// preview, and confirm button run for real.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEYS = [
  'cascade-transactions-v1',
  'fluxledger-cards-v1',
  'fluxledger-hidden-built-in-cards-v1',
  'cascade-language',
  'cascade-theme',
];

const FIXTURE = {
  'cascade-transactions-v1': JSON.stringify([
    { id: 301, type: 'income', card: '4329', amount: 90, date: '2026-09-01', category: 'Salary', description: 'Payday' },
    { id: 302, type: 'expense', card: '4329', amount: 12, date: '2026-09-03', category: 'Food & Drinks', description: 'Lunch' },
  ]),
  'fluxledger-cards-v1': JSON.stringify([
    { id: '4329', name: 'Everyday card', last4: '1001', network: 'Visa', accountType: 'Savings card', color: '#f4cf35' },
    { id: '8851', name: 'Lifestyle card', last4: '1002', network: 'Mastercard', accountType: 'Savings card', color: '#2784f7' },
  ]),
};

const JSON_IMPORT = JSON.stringify({
  app: 'FluxLedger', version: 1, exportedAt: '2026-01-01T00:00:00.000Z',
  transactions: [{ id: 501, type: 'expense', card: '1001', amount: 9, date: '2026-08-15', category: 'Food & Drinks', description: 'Imported snack' }],
  cards: [{ id: '1001', name: 'Imported card', last4: '', noLast4: true, network: 'Other', accountType: 'Alipay', color: '#123456' }],
  hiddenBuiltInCardIds: ['online-alipay'],
});

const CSV_IMPORT = 'Description,Type,Category,Date,Account,Amount\nCoffee,expense,Food & Drinks,2026-09-06,Everyday card · 1001,3.5';

const PIN_CLOCK = `(() => {
  const FIXED = Date.parse('2026-09-13T12:00:00.000Z');
  const Real = Date;
  window.Date = class extends Real {
    constructor(...args) { args.length ? super(...args) : super(FIXED); }
    static now() { return FIXED; }
  };
  return 'clock pinned';
})()`;

const armBlobCapture = `(() => {
  const original = URL.createObjectURL.bind(URL);
  window.__capBlobs = [];
  URL.createObjectURL = blob => { window.__capBlobs.push(blob); return original(blob); };
  return 'armed';
})()`;

const snapshotFn = `(() => {
  const keys = {};
  for (const key of ${JSON.stringify(KEYS)}) keys[key] = localStorage.getItem(key);
  return { keys, page: { lang: document.documentElement.lang, title: document.title, bodyClass: document.body.className } };
})()`;

async function feedFile(tab, text, fileName) {
  return tab.playwright.evaluate(`(async () => {
    const file = new File([${JSON.stringify(text)}], ${JSON.stringify(fileName)}, {
      type: ${JSON.stringify(fileName.endsWith('.json' ? 'application/json' : 'text/csv'))},
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('.data-file-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(done => setTimeout(done, 150));
    return document.querySelector('.data-import-preview') ? 'preview rendered' : 'NO PREVIEW';
  })()`);
}

async function exportOnce(tab, name, exportsCaptured, checkpoints, outDir) {
  await tab.playwright.evaluate(armBlobCapture);
  let download = 'not observed';
  const downloadPromise = tab.playwright.waitForEvent('download', { timeoutMs: 8000 }).then(
    () => 'download event fired',
    error => `download event error: ${String(error).slice(0, 120)}`,
  );
  const trigger = tab.playwright.locator('.data-manager-trigger');
  if ((await trigger.count()) !== 1) throw new Error('data manager trigger not unique');
  await trigger.click();
  const exportButton = tab.playwright.getByRole('button', { name: /Export data|导出数据/ });
  if ((await exportButton.count()) !== 1) throw new Error('export button not unique');
  await exportButton.click();
  download = await downloadPromise;
  await tab.playwright.waitForTimeout(200);
  const backup = await tab.playwright.evaluate(`window.__capBlobs.length ? window.__capBlobs[window.__capBlobs.length - 1].text() : Promise.resolve(null)`);
  exportsCaptured.push({ name, download, backup });
  writeFileSync(join(outDir, 'exports.json'), JSON.stringify(exportsCaptured, null, 1));
  // dialog stays open; close it via its own close button for the next step
  await tab.playwright.locator('.data-dialog button.icon').first().click();
  return backup;
}

const reseed = tab => tab.playwright.evaluate(fixture => {
  localStorage.clear();
  for (const [key, value] of Object.entries(fixture)) localStorage.setItem(key, value);
  return 'reseeded';
}, FIXTURE);

async function reload(tab) {
  await tab.reload();
  await tab.playwright.waitForLoadState({ state: 'domcontentloaded' });
  await tab.playwright.evaluate(PIN_CLOCK);
  await tab.playwright.waitForTimeout(300);
}

export async function runScenario(browser, { url, outDir, label }) {
  mkdirSync(outDir, { recursive: true });
  const checkpoints = [];
  const exportsCaptured = [];
  const cp = async (tab, name) => {
    const snap = await tab.playwright.evaluate(snapshotFn);
    checkpoints.push({ name, ...snap });
    writeFileSync(join(outDir, 'checkpoints.json'), JSON.stringify(checkpoints, null, 1));
    return snap;
  };

  const tab = await browser.tabs.new();
  await tab.setViewportSize({ width: 1440, height: 900 });
  await tab.goto(url);
  await tab.playwright.waitForLoadState({ state: 'domcontentloaded' });
  // Seed this origin's localStorage with the shared fixture, then reload so
  // the app boots from it exactly like a returning user's browser.
  await reseed(tab);
  await reload(tab);
  const openSnap = await cp(tab, 'open');
  if (openSnap.keys['cascade-language'] !== 'en' || openSnap.keys['cascade-theme'] !== 'light') {
    throw new Error('immediate language/theme writes missing on first open');
  }
  if (openSnap.keys['cascade-transactions-v1'] !== FIXTURE['cascade-transactions-v1']) {
    throw new Error('startup rewrote the transactions key');
  }

  // --- export the seeded ledger through the real dialog + download ---
  const seededBackup = await exportOnce(tab, 'export-seeded', exportsCaptured, checkpoints, outDir);
  await cp(tab, 'after-export');
  if (JSON.parse(seededBackup).transactions.length !== 2) throw new Error('seeded export content mismatch');

  // --- JSON import: real file input, preview, confirm button ---
  await tab.playwright.locator('.data-manager-trigger').click();
  const feedInfo = await feedFile(tab, JSON_IMPORT, 'backup.json');
  if (feedInfo !== 'preview rendered') throw new Error('JSON import preview did not render');
  const previewText = await tab.playwright.locator('.data-import-preview').innerText();
  if (!previewText.includes('backup.json') || !previewText.includes('Import and replace')) {
    throw new Error('JSON import preview content mismatch: ' + previewText.slice(0, 120));
  }
  await tab.playwright.locator('.data-import-preview .primary.submit').click();
  await cp(tab, 'imported-json');
  await reload(tab);
  await cp(tab, 'reload-json');
  const afterJson = JSON.parse((await tab.playwright.evaluate(snapshotFn)).keys['cascade-transactions-v1']);
  if (afterJson.length !== 1 || afterJson[0].id !== 501 || afterJson[0].onCredit !== false) {
    throw new Error('JSON import persisted state mismatch');
  }

  // --- legacy CSV import through the same dialog chain ---
  // Restore the shared fixture first: the JSON import above replaced the
  // account list, and the CSV references an account from the seeded state.
  await reseed(tab);
  await reload(tab);
  await cp(tab, 'csv-fixture-reload');
  await tab.playwright.locator('.data-manager-trigger').click();
  const csvInfo = await feedFile(tab, CSV_IMPORT, 'legacy.csv');
  if (csvInfo !== 'preview rendered') throw new Error('CSV import preview did not render');
  await tab.playwright.locator('.data-import-preview .primary.submit').click();
  await cp(tab, 'imported-csv');
  await reload(tab);
  await cp(tab, 'reload-csv');

  // --- filters through real controls; the five keys must not move ---
  // Restore the seeded fixture again: the CSV import left a single expense,
  // and the flow chart only renders account nodes for accounts with capacity.
  await reseed(tab);
  await reload(tab);
  const filtersBefore = await cp(tab, 'filters-before');
  await tab.playwright.getByRole('checkbox', { name: 'Filter account Lifestyle card' }).uncheck();
  await cp(tab, 'filter-one-account');
  const chartNode = tab.playwright.locator('#flow-chart [data-flow-id^="account:"]');
  if ((await chartNode.count()) !== 1) throw new Error('expected exactly one clickable account node');
  await chartNode.click();
  await cp(tab, 'chart-jump-filter');
  await tab.playwright.getByRole('button', { name: 'Dashboard' }).click();
  await cp(tab, 'back-to-dashboard-resets');
  await tab.playwright.locator('button[title="Reset filters"]').click();
  const filtersAfter = await cp(tab, 'after-reset-button');
  for (const key of KEYS) {
    if (filtersBefore.keys[key] !== filtersAfter.keys[key]) {
      throw new Error('filter interaction wrote storage key ' + key);
    }
  }

  // --- delete a built-in account through the real card dialog (EN labels) ---
  await tab.playwright.locator('[aria-label="Edit account 零钱通余额"]').click();
  await tab.playwright.locator('button[aria-label="Delete account"]').click();
  await cp(tab, 'delete-built-in');
  await reload(tab);
  const afterDelete = await cp(tab, 'reload-after-delete');
  if (afterDelete.keys['fluxledger-hidden-built-in-cards-v1'] !== '["online-lingqiantong"]') {
    throw new Error('hidden id not persisted: ' + afterDelete.keys['fluxledger-hidden-built-in-cards-v1']);
  }

  // --- language and theme through real buttons, then a reload ---
  await tab.playwright.getByRole('button', { name: 'ZH' }).click();
  await cp(tab, 'switch-zh');
  await tab.playwright.locator('.theme-switch button').first().click();
  const darkSnap = await cp(tab, 'dark-theme');
  if (!darkSnap.page.bodyClass.includes('dark')) throw new Error('dark class missing after toggle');
  await reload(tab);
  const prefsSnap = await cp(tab, 'reload-prefs');
  if (prefsSnap.page.lang !== 'zh-CN' || !prefsSnap.page.bodyClass.includes('dark')) {
    throw new Error('language/theme did not survive reload');
  }

  // --- final export in the zh/dark state ---
  await exportOnce(tab, 'export-final', exportsCaptured, checkpoints, outDir);
  await cp(tab, 'after-final-export');

  writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ label, url, finishedAt: 'wall-clock run' }, null, 1));
  await tab.markDeliverable();
  return { label, checkpoints: checkpoints.length, exports: exportsCaptured.map(e => e.name) };
}
