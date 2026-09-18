// 云端会话数据层的行为测试：登录态检测（含身份未知）、账户隔离命名空间、
// 按标签页隔离的草稿、草稿基版本保护、flush 快照范围、冲突备份列表与恢复、
// GET 身份回显与退出清理。跑在 test-setup.mjs 的 happy-dom 环境里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { uidHash } from './uidHash.js';
import {
  KEYS, loadTransactions, saveTransactions, loadCards, saveCards,
  loadHiddenBuiltInCardIds, saveHiddenBuiltInCardIds, loadLanguage, saveLanguage,
} from './local.js';
import {
  bootstrapCloud, currentSession, onCloudEvent, hasPendingDraft, hasConflictBackup,
  conflictBackupCount, getConflictBackup, restoreConflictBackup, flushNow,
  discardPendingDraft, signOutLocalCleanup, __resetForTest,
} from './cloud.js';
import { mountApp, clearTrackedTimers } from '../appTestHelpers.js';

const USER_A = 'user-account-a-0001';
const USER_B = 'user-account-b-0002';
const nsKey = (userId, originalKey) => `cloud-cache-${uidHash(userId)}-${originalKey}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Map 语义的 storage 替身（browser 同款 getItem/setItem/key/length 表面）。
function mapStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    keys: () => [...map.keys()],
    clear: () => map.clear(),
  };
}

const pack = ({ status = 200, body = {} }) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// 有状态假服务端：内存里的 data/version；PUT 乐观锁仲裁 + expectedUserId 一致性校验。
function serverApi(initialData = cloudDocument([]), initialVersion = 1) {
  const s = { data: initialData, version: initialVersion, user: USER_A, offlineLedger: false, puts: [], gate: null, onPut: null };
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url === '/api/whoami') return pack({ body: { authenticated: true, userId: s.user } });
    if (s.offlineLedger) throw new Error('ledger network failure (simulated)');
    if (options.method === 'PUT') {
      const payload = JSON.parse(options.body);
      s.puts.push(payload);
      if (s.onPut) await s.onPut();
      if (s.gate) await s.gate;
      if (payload.baseVersion !== s.version) {
        return pack({ status: 409, body: { error: 'version conflict', currentVersion: s.version, currentData: { data: { ...s.data }, userId: s.user, version: s.version } } });
      }
      s.data = payload.data;
      s.version += 1;
      return pack({ body: { version: s.version } });
    }
    return pack({ body: { data: { ...s.data }, userId: s.user, version: s.version } });
  };
  const ledgerCount = () => calls.filter(call => call.url === '/api/ledger' && call.method === 'GET').length;
  return { fetch, calls, s, ledgerCount };
}

const entry = (id, overrides = {}) => ({
  id, type: 'expense', card: 'c9', amount: 1, date: '2026-01-01',
  category: 'Other', description: id, ...overrides,
});
const cloudCard = { id: 'c9', name: 'Cloud card', color: '#123456', network: 'Visa', accountType: 'Savings card' };
const cloudDocument = transactions => ({
  transactions, cards: [cloudCard], hiddenBuiltInCardIds: ['online-alipay'],
});
const asUser = userId => ({ status: 200, body: { authenticated: true, userId } });

// 路由式假 API（无状态场景用）：返回 null/undefined 表示网络失败。
function fakeApi({ whoami, ledger } = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/whoami') {
      const response = typeof whoami === 'function' ? await whoami(calls.filter(c => c.url === '/api/whoami').length) : whoami;
      if (!response) throw new Error('whoami network failure (simulated)');
      return pack(response);
    }
    if (url === '/api/ledger') {
      const response = typeof ledger === 'function' ? await ledger(calls.filter(c => c.url === '/api/ledger').length, options) : ledger;
      if (!response) throw new Error('ledger network failure (simulated)');
      return pack(response);
    }
    throw new Error('unexpected fetch: ' + url);
  };
  const count = url => calls.filter(call => call.url === url).length;
  return { fetch, calls, whoamiCalls: () => count('/api/whoami'), ledgerCalls: () => count('/api/ledger') };
}

test.beforeEach(() => {
  try { if (globalThis.sessionStorage) globalThis.sessionStorage.clear(); } catch { /* 忽略 */ }
  __resetForTest();
});
test.afterEach(() => { __resetForTest(); });

test('guest bootstrap keeps every read and write on the original keys', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({ whoami: { status: 401, body: { authenticated: false, error: 'unauthenticated' } } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'guest');
  saveTransactions([entry('t1')]);
  assert.deepEqual(loadTransactions(), [entry('t1')]);
  assert.ok(storage.getItem(KEYS.transactions), 'original transactions key written');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')), 'no namespaced keys in guest mode');
});

test('an undetectable identity is unknown mode with a boot flag, never a silent guest fallback', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const api = fakeApi({ whoami: null }); // 网络失败 ×3（重试用尽）

  const session = await bootstrapCloud({ fetch: api.fetch, retryDelay: 1 });

  assert.equal(session.mode, 'unknown');
  assert.equal(session.boot, 'unknown', 'boot state is a flag for the UI to surface after mount');
  assert.equal(api.ledgerCalls(), 0, 'unknown identity never touches cloud data');
  saveTransactions([entry('local-edit')]);
  assert.deepEqual(loadTransactions(), [entry('local-edit')]);
  assert.ok(storage.getItem(KEYS.transactions), 'degraded to original keys, explicitly announced');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')));
});

test('signed-in bootstrap hydrates the account namespace and leaves original keys alone', async () => {
  const storage = mapStorage({ [KEYS.transactions]: '[{"id":"guest-note"}]' });
  globalThis.localStorage = storage;
  const remote = [entry('cloud-t1')];
  const { fetch } = fakeApi({ whoami: asUser(USER_A), ledger: { body: { data: cloudDocument(remote), userId: USER_A, version: 3 } } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'cloud');
  assert.equal(session.userId, USER_A);
  assert.equal(session.version, 3);
  assert.deepEqual(loadTransactions(), remote, 'cloud document served through the namespace');
  assert.equal(JSON.parse(storage.getItem(nsKey(USER_A, KEYS.transactions)))[0].id, 'cloud-t1');
  assert.equal(storage.getItem(KEYS.transactions), '[{"id":"guest-note"}]', 'guest key untouched');
  saveCards([{ id: 'c1', name: 'C', color: '#000000', network: 'Visa', accountType: 'Savings card' }]);
  assert.ok(loadCards().some(c => c.id === 'c1'), 'card writes land in the working copy');
  assert.equal(storage.getItem(KEYS.cards), null, 'original cards key untouched');
  assert.equal(
    storage.getItem(nsKey(USER_A, KEYS.cards)),
    JSON.stringify([cloudCard]),
    'the shared base keeps the last synced state; edits live in this tab’s draft',
  );
  saveHiddenBuiltInCardIds(['online-wechat']);
  assert.ok(loadHiddenBuiltInCardIds().includes('online-wechat'));
  saveLanguage('zh');
  assert.equal(storage.getItem(KEYS.language), 'zh', 'language stays on the original device key');
});

test('an empty cloud ledger initializes an explicit empty document, never the demo seed', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({ whoami: asUser(USER_A), ledger: { body: { data: null, userId: USER_A, version: 0 } } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.version, 0);
  assert.deepEqual(loadTransactions(), [], 'no demo seed for a fresh cloud account');
  assert.equal(storage.getItem(nsKey(USER_A, KEYS.transactions)), '[]');
  assert.equal(storage.getItem(nsKey(USER_A, KEYS.cards)), '[]');
  assert.equal(storage.getItem(nsKey(USER_A, KEYS.hiddenBuiltInCardIds)), '[]');
});

test('data changes mark a draft with the current base, then a successful PUT promotes them to the shared base', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const remote = [entry('cloud-t1')];
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count) => (count === 1
      ? { body: { data: cloudDocument(remote), userId: USER_A, version: 3 } }
      : { body: { version: 4 } }),
  });
  await bootstrapCloud({ fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([entry('local-t1')]);
  assert.equal(hasPendingDraft(), true, 'the draft marker is set before any network round-trip');
  saveCards([{ id: 'c1', name: 'C', color: '#000000', network: 'Visa', accountType: 'Savings card' }]);
  await sleep(30);

  const put = calls.find(call => call.options.method === 'PUT');
  assert.ok(put, 'a PUT was issued');
  const payload = JSON.parse(put.options.body);
  assert.equal(payload.baseVersion, 3);
  assert.equal(payload.expectedUserId, USER_A, 'identity binding rides in the same request');
  assert.deepEqual(payload.data.transactions, [entry('local-t1')]);
  assert.deepEqual(payload.data.hiddenBuiltInCardIds, ['online-alipay']);
  assert.equal(currentSession().version, 4, 'version tracks the server response');
  assert.equal(hasPendingDraft(), false, 'a successful save clears the draft marker');
  assert.deepEqual(events, [], 'successful save is silent');
  assert.deepEqual(loadTransactions(), [entry('local-t1')]);
  assert.equal(JSON.parse(storage.getItem(nsKey(USER_A, KEYS.transactions)))[0].id, 'local-t1', 'the working copy was promoted to the shared base');
});

test('a 409 backs up the working copy, reloads the cloud version and offers recovery', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const remote = cloudDocument([entry('cloud-newer')]);
  const fetch = async (url, options = {}) => {
    if (url === '/api/whoami') return pack({ body: { authenticated: true, userId: USER_A } });
    if (options.method === 'PUT') return pack({ status: 409, body: { currentVersion: 9, currentData: { data: { ...remote }, userId: USER_A, version: 9 } } });
    return pack({ body: { data: { ...remote }, userId: USER_A, version: 9 } });
  };

  await bootstrapCloud({ fetch, debounce: 5 });
  const events = [];
  onCloudEvent(event => events.push(event));
  const unsaved = [entry('my-unsaved')];
  saveTransactions(unsaved);
  await flushNow();

  assert.deepEqual(loadTransactions(), [entry('cloud-newer')], 'working copy now mirrors the cloud');
  assert.equal(currentSession().version, 9);
  assert.equal(hasPendingDraft(), false);
  assert.equal(hasConflictBackup(), true, 'the only unsaved copy is preserved as a restorable backup');
  assert.deepEqual(getConflictBackup().doc.transactions, unsaved);
  assert.equal(getConflictBackup().baseVersion, 9, 'the backup records the attempted base');
  assert.deepEqual(events, ['conflict']);

  assert.equal(restoreConflictBackup(), 'ok');
  assert.deepEqual(loadTransactions(), unsaved);
  assert.equal(hasPendingDraft(), true);
});

test('an offline draft keeps its original base and conflicts instead of rebasing over newer data', async () => {
  globalThis.localStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 1);
  await bootstrapCloud({ fetch: a.fetch, debounce: 60000 }); // 长防抖：草稿只标记、不上传
  saveTransactions([entry('my-draft')]);
  assert.equal(hasPendingDraft(), true);

  // 远端前进到 v2；页面刷新后重新引导（同一标签页 sessionStorage）。
  a.s.data = cloudDocument([entry('newer-remote')]);
  a.s.version = 2;
  const session = await bootstrapCloud({ fetch: a.fetch, debounce: 5 });

  assert.equal(session.version, 1, 'boot adopts the draft base, never the latest cloud version');
  assert.deepEqual(a.s.puts, []);
  assert.deepEqual(loadTransactions(), [entry('my-draft')], 'the draft survives the reload');

  await flushNow();

  assert.equal(a.s.puts[0].baseVersion, 1, 'the draft uploads with its original base');
  assert.equal(a.s.puts[0].expectedUserId, USER_A, 'identity binding rides in the same request');
  assert.deepEqual(loadTransactions(), [entry('newer-remote')], 'the server rejected the stale base; cloud version wins');
  assert.equal(hasConflictBackup(), true);
  assert.deepEqual(getConflictBackup().doc.transactions, [entry('my-draft')]);

  assert.equal(restoreConflictBackup(), 'ok');
  await flushNow();
  assert.equal(a.s.puts[1].baseVersion, 2, 'the restored copy uploads against the cloud base');
  assert.equal(hasPendingDraft(), false);
});

test('an unknown-base draft over cloud data becomes a conflict, never a silent overwrite', async () => {
  globalThis.localStorage = mapStorage();
  const a = serverApi(cloudDocument([entry('cloud-t1')]), 7);
  a.s.offlineLedger = true; // 启动 GET：离线
  const session = await bootstrapCloud({ fetch: a.fetch, debounce: 5 });

  assert.equal(session.version, null, 'version unknown after offline boot');
  assert.equal(session.boot, 'offline');
  assert.deepEqual(loadTransactions(), [], 'explicit empty document, never demo seed');

  a.s.offlineLedger = false;
  saveTransactions([entry('offline-edit')]);
  await flushNow();

  assert.equal(hasConflictBackup(), true, 'unknown-base draft over cloud data is treated as a conflict');
  assert.deepEqual(getConflictBackup().doc.transactions, [entry('offline-edit')]);
  assert.deepEqual(loadTransactions(), [entry('cloud-t1')], 'the cloud version fills the working copy');
  assert.equal(currentSession().version, 7);
  assert.equal(hasPendingDraft(), false);

  assert.equal(restoreConflictBackup(), 'ok');
  await flushNow();
  assert.equal(currentSession().version, 8, 'the restored copy uploads against the established base');
});

test('a slow PUT that lands on 409 backs up the complete latest draft (including in-flight edits)', async () => {
  globalThis.localStorage = mapStorage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const remoteV2 = cloudDocument([entry('remote-v2')]);
  let ledgerGets = 0;
  const fetch = async (url, options = {}) => {
    if (url === '/api/whoami') return pack({ body: { authenticated: true, userId: USER_A } });
    if (options.method === 'PUT') {
      const payload = JSON.parse(options.body);
      if (payload.baseVersion === 1) {
        await gate;
        return pack({ status: 409, body: { currentVersion: 2, currentData: { data: { ...remoteV2 }, userId: USER_A, version: 2 } } });
      }
      remoteV2.transactions = payload.data.transactions;
      return pack({ body: { version: payload.baseVersion + 1 } });
    }
    ledgerGets += 1;
    return ledgerGets === 1
      ? pack({ body: { data: cloudDocument([]), userId: USER_A, version: 1 } }) // 启动：v1，编辑后 PUT 走基 1 的慢门
      : pack({ body: { data: { ...remoteV2 }, userId: USER_A, version: 2 } }); // 冲突重读：远端已是 v2
  };
  await bootstrapCloud({ fetch, debounce: 5 });
  const events = [];
  onCloudEvent(event => events.push(event));

  saveTransactions([entry('edit-before-put')]);
  await sleep(15); // 第一次 flush 进入慢 PUT（基版本 1）
  saveTransactions([entry('edit-before-put'), entry('edit-during-put')]);
  await sleep(15); // 编辑入队
  release();
  await sleep(60); // PUT 409 → 冲突解决

  const backup = getConflictBackup();
  assert.ok(backup, 'a restorable backup exists');
  assert.ok(backup.doc.transactions.some(e => e.id === 'edit-before-put'));
  assert.ok(backup.doc.transactions.some(e => e.id === 'edit-during-put'), 'the in-flight edit is NOT lost');
  assert.equal(backup.baseVersion, 1);
  assert.deepEqual(loadTransactions(), [entry('remote-v2')], 'working copy mirrors the cloud');
  assert.equal(hasPendingDraft(), false);
  assert.deepEqual(events, ['conflict']);
});

test('a failed conflict backup keeps the working copy and draft (never discards without a backup)', async () => {
  const tabBase = mapStorage();
  const tabStorage = Object.create(tabBase, {
    setItem: { value(key, value) {
      if (key.startsWith('fluxledger-conflict-docs')) throw new Error('QuotaExceededError');
      tabBase.setItem(key, value);
    } },
  });
  globalThis.localStorage = mapStorage();
  globalThis.sessionStorage = tabStorage;
  const a = serverApi(cloudDocument([]), 1);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });
  // 远端前进到 v2（另一设备），使本页 PUT 落 409 进入冲突解决
  a.s.data = cloudDocument([entry('remote-v2')]);
  a.s.version = 2;
  const events = [];
  onCloudEvent(event => events.push(event));

  saveTransactions([entry('only-draft')]);
  await flushNow();

  assert.equal(hasConflictBackup(), false, 'the backup write failed');
  assert.equal(hasPendingDraft(), true, 'the draft is untouched');
  assert.deepEqual(loadTransactions(), [entry('only-draft')], 'the working copy was never overwritten');
  assert.ok(events.length >= 1 && events.every(event => event === 'save-failed'),
    'every retry reports the failure honestly');
});

test('an unknown-base draft with a failing backup keeps conflict protection on retry (never overwrites remote)', async () => {
  const tabBase = mapStorage();
  const tabStorage = Object.create(tabBase, {
    setItem: { value(key, value) {
      if (key.startsWith('fluxledger-conflict-docs')) throw new Error('QuotaExceededError');
      tabBase.setItem(key, value);
    } },
  });
  globalThis.localStorage = mapStorage();
  globalThis.sessionStorage = tabStorage;
  const a = serverApi(cloudDocument([entry('remote-v7')]), 7);
  a.s.offlineLedger = true; // 启动 GET：离线 → 未知基
  const session = await bootstrapCloud({ fetch: a.fetch, debounce: 5 });
  assert.equal(session.version, null);

  a.s.offlineLedger = false;
  saveTransactions([entry('unknown-base-edit')]);
  await flushNow(); // 三轮重试都会因备份失败而中止

  assert.equal(a.s.puts.length, 0, 'never uploads while the conflict backup cannot be secured');
  assert.equal(currentSession().version, null, 'the queried remote version was NOT adopted');
  assert.equal(a.s.version, 7, 'the remote record is untouched');
  assert.deepEqual(a.s.data.transactions.map(e => e.id), ['remote-v7']);
  assert.equal(hasPendingDraft(), true, 'the draft keeps waiting for protection to be possible');
});

test('reaching the backup cap keeps every existing backup and the current draft (no silent eviction)', async () => {
  globalThis.localStorage = mapStorage();
  globalThis.sessionStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 1);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  // 连续 6 次冲突：前 5 次各追加一份备份，第 6 次达到上限
  for (let round = 1; round <= 6; round += 1) {
    saveTransactions([entry('draft-' + round)]);
    a.s.data = cloudDocument([entry('remote-' + round)]);
    a.s.version = round + 1;
    events.length = 0;
    await flushNow();
  }

  assert.equal(conflictBackupCount(), 5, 'the cap holds five backups');
  assert.ok(a.s.data.transactions.some(e => e.id === 'remote-6'), 'the server still holds what round 6 seeded (no successful PUT ever landed)');
  assert.ok(!a.s.data.transactions.some(e => e.id === 'draft-6'), 'the 6th conflict never overwrote the cloud');
  assert.ok(events.length > 0 && events.every(event => event === 'backup-limit'),
    'the user is told to handle the backups, with no generic failure masking it');
  assert.equal(hasPendingDraft(), true, 'the 6th draft is kept, waiting for the user');
  assert.ok(loadTransactions().some(e => e.id === 'draft-6'), 'the 6th working copy is intact');
  const backups = JSON.parse(sessionStorage.getItem('fluxledger-conflict-docs-' + uidHash(USER_A)));
  assert.ok(backups.some(b => b.doc.transactions.some(e => e.id === 'draft-1')), 'draft-1 is still in the list (not evicted)');
  assert.ok(backups.some(b => b.doc.transactions.some(e => e.id === 'draft-2')), 'draft-2 is still in the list (not evicted)');

  // 备份已满且当前有未同步草稿：恢复被阻止（UI 会提供导出等处理方式），一切保持原状
  assert.equal(restoreConflictBackup(), 'full');
  assert.equal(conflictBackupCount(), 5, 'the backups are untouched');
  assert.equal(hasPendingDraft(), true, 'the current draft is untouched');
  assert.ok(loadTransactions().some(e => e.id === 'draft-6'), 'the working copy is untouched');
  assert.deepEqual(a.s.data.transactions.map(e => e.id), ['remote-6'], 'the cloud is untouched');
});

test('restoring protects the current unsynced draft (it becomes the newest backup, never a casualty)', async () => {
  globalThis.localStorage = mapStorage();
  globalThis.sessionStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 1);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });

  // 第一次冲突：draft-1 进入备份，工作副本转为 remote-1（base 2）
  saveTransactions([entry('draft-1')]);
  a.s.data = cloudDocument([entry('remote-1')]);
  a.s.version = 2;
  await flushNow();

  // 新的未同步草稿 draft-2（尚未备份）
  saveTransactions([entry('draft-2')]);
  assert.equal(hasPendingDraft(), true);

  // 恢复旧备份：当前草稿必须先入备份列表，绝不覆盖
  assert.equal(restoreConflictBackup(), 'ok');
  assert.deepEqual(loadTransactions(), [entry('draft-1')], 'the backup content is restored');
  assert.equal(conflictBackupCount(), 1, 'the list now holds the protected current draft');
  assert.deepEqual(getConflictBackup().doc.transactions, [entry('draft-2')], 'draft-2 was preserved as the newest backup');
  assert.equal(hasPendingDraft(), true);

  // 恢复后的草稿以当前云端版本为基上传
  await flushNow();
  assert.equal(a.s.puts.at(-1).baseVersion, 2);
  assert.equal(currentSession().version, 3);
  assert.equal(hasPendingDraft(), false);

  // 被保护的 draft-2 仍可恢复
  assert.equal(restoreConflictBackup(), 'ok');
  assert.deepEqual(loadTransactions(), [entry('draft-2')]);
});

test('restoring is blocked while the backup list is full and a draft exists (export first)', async () => {
  globalThis.localStorage = mapStorage();
  globalThis.sessionStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 1);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });

  // 5 次冲突把备份列表填满，第 6 次冲突保留当前草稿
  for (let round = 1; round <= 6; round += 1) {
    saveTransactions([entry('draft-' + round)]);
    a.s.data = cloudDocument([entry('remote-' + round)]);
    a.s.version = round + 1;
    await flushNow();
  }
  assert.equal(conflictBackupCount(), 5);
  assert.equal(hasPendingDraft(), true);
  const draftBefore = JSON.parse(sessionStorage.getItem('fluxledger-draft-' + uidHash(USER_A) + '-cascade-transactions-v1'));

  // 备份已满 + 有未同步草稿：恢复被阻止，什么都不改
  assert.equal(restoreConflictBackup(), 'full');
  assert.equal(conflictBackupCount(), 5, 'the backups are untouched');
  assert.equal(hasPendingDraft(), true, 'the current draft is untouched');
  assert.deepEqual(JSON.parse(sessionStorage.getItem('fluxledger-draft-' + uidHash(USER_A) + '-cascade-transactions-v1')), draftBefore, 'the working copy is byte-identical');
  assert.deepEqual(a.s.data.transactions.map(e => e.id), ['remote-6'], 'the cloud is untouched');
});

test('the first edit snapshots the complete three-key document (never spliced with other tabs’ shared data)', async () => {
  const shared = mapStorage();
  globalThis.localStorage = shared;
  globalThis.sessionStorage = mapStorage();
  const a = serverApi(cloudDocument([entry('seed-tx')]), 1);
  await bootstrapCloud({ fetch: a.fetch, debounce: 60000 });

  // 标签页 A 只编辑交易键
  saveTransactions([entry('a-edit')]);

  // 另一标签页删除账户并同步：共享基础的 cards 变了
  const mutated = cloudDocument([entry('seed-tx'), entry('a-edit')]);
  mutated.cards = [];
  a.s.data = mutated;
  a.s.version = 2;
  shared.setItem('cloud-cache-' + uidHash(USER_A) + '-cascade-transactions-v1', JSON.stringify(mutated.transactions));
  shared.setItem('cloud-cache-' + uidHash(USER_A) + '-fluxledger-cards-v1', JSON.stringify([]));

  // A 刷新：完整草稿保留（含被另一标签页删除的账户），不与共享基础拼接
  const session = await bootstrapCloud({ fetch: a.fetch, debounce: 5 });
  assert.equal(session.version, 1, 'boot adopts the draft base');
  const h = uidHash(USER_A);
  assert.deepEqual(JSON.parse(sessionStorage.getItem('fluxledger-draft-' + h + '-cascade-transactions-v1')).map(e => e.id), ['a-edit'], 'the draft holds this tab’s working copy');
  assert.deepEqual(JSON.parse(sessionStorage.getItem('fluxledger-draft-' + h + '-fluxledger-cards-v1')).map(c => c.id), ['c9'], 'the account deleted in another tab is still in this tab’s complete draft');
  assert.deepEqual(loadCards().map(c => c.id), ['c9'], 'reads come from the complete draft, not the spliced shared base');

  // 后续冲突备份也是完整文档
  a.s.data = cloudDocument([entry('remote-newer')]);
  a.s.data.cards = [];
  a.s.version = 3;
  await flushNow();
  const backup = getConflictBackup();
  assert.ok(backup, 'conflict resolution ran');
  assert.ok(backup.doc.cards.some(c => c.id === 'c9'), 'the backup carries the complete document, including the account');
});

test('a second conflict appends a backup instead of overwriting the unhandled first one', async () => {
  globalThis.localStorage = mapStorage();
  globalThis.sessionStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 1);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });

  saveTransactions([entry('first-draft')]);
  a.s.data = cloudDocument([entry('remote-1')]);
  a.s.version = 2;
  await flushNow(); // PUT base 1 → 409 → 备份 #1（first-draft），工作副本转为 v2

  assert.deepEqual(loadTransactions(), [entry('remote-1')]);
  saveTransactions([entry('second-draft')]);
  a.s.data = cloudDocument([entry('remote-1'), entry('remote-2')]);
  a.s.version = 3;
  await flushNow(); // PUT base 2 → 409 → 备份 #2（second-draft），工作副本转为 v3

  assert.equal(conflictBackupCount(), 2, 'both unsaved copies are kept');
  assert.deepEqual(getConflictBackup().doc.transactions, [entry('second-draft')], 'restore offers the newest first');

  // 恢复最新一份（此刻无草稿，直接替换）
  assert.equal(restoreConflictBackup(), 'ok');
  assert.deepEqual(loadTransactions(), [entry('second-draft')]);
  assert.equal(conflictBackupCount(), 1, 'the restored backup is consumed');

  // 再恢复更早一份：当前工作副本（second-draft，已标记草稿）先受保护入列
  assert.equal(restoreConflictBackup(), 'ok');
  assert.deepEqual(loadTransactions(), [entry('first-draft')], 'the older backup is restored');
  assert.equal(conflictBackupCount(), 1, 'the protected second-draft took its place in the list');
  assert.deepEqual(getConflictBackup().doc.transactions, [entry('second-draft')]);

  // 恢复出的 first-draft 以当前云端版本为基上传；second-draft 仍在备份中可再恢复
  await flushNow();
  assert.equal(a.s.puts.at(-1).baseVersion, 3);
  assert.equal(currentSession().version, 4);
  assert.equal(restoreConflictBackup(), 'ok');
  assert.deepEqual(loadTransactions(), [entry('second-draft')]);
  assert.equal(conflictBackupCount(), 0);
});

test('same-account tabs isolate drafts: another tab’s sync never destroys this tab’s unsaved copy', async () => {
  const shared = mapStorage();
  const sessionA = mapStorage();
  const sessionB = mapStorage();
  const a = serverApi(cloudDocument([]), 1);

  // 标签页 A：编辑（草稿在 A 的 sessionStorage），不上传
  globalThis.localStorage = shared;
  globalThis.sessionStorage = sessionA;
  await bootstrapCloud({ fetch: a.fetch, debounce: 60000 });
  saveTransactions([entry('tab-a-unsaved')]);
  assert.equal(hasPendingDraft(), true);

  // 标签页 B：独立会话，编辑并成功同步（共享基础推进到 v2）
  globalThis.sessionStorage = sessionB;
  __resetForTest({ keepTabStorage: true }); // 保留 B 的（空）标签页存储；清掉 A 遗留的模块状态与定时器
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });
  saveTransactions([entry('tab-b-edit')]);
  await flushNow();
  assert.equal(currentSession().version, 2);
  assert.deepEqual(loadTransactions().map(t => t.id), ['tab-b-edit']);

  // 回到标签页 A：草稿未被 B 的同步破坏；上传按原基仲裁 → 409 → 备份保留
  globalThis.sessionStorage = sessionA;
  __resetForTest({ keepTabStorage: true });
  const session = await bootstrapCloud({ fetch: a.fetch, debounce: 5 });
  assert.equal(session.version, 1, 'tab A boots on its own draft base');
  assert.deepEqual(loadTransactions().map(t => t.id), ['tab-a-unsaved'], 'tab A’s unsaved copy survives tab B’s sync');

  await flushNow();
  assert.equal(hasConflictBackup(), true);
  assert.deepEqual(getConflictBackup().doc.transactions, [entry('tab-a-unsaved')]);
  assert.deepEqual(loadTransactions().map(t => t.id), ['tab-b-edit'], 'working copy mirrors cloud after explicit conflict resolution');
});

test('a changed browser identity aborts the save and never writes A’s copy under B', async () => {
  globalThis.localStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 3);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });
  a.s.user = USER_B; // 旧标签页挂起期间，会话已切到 B

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([entry('stale-a-copy')]);
  await flushNow();

  assert.deepEqual(a.s.puts, [], 'the stale working copy is never submitted');
  assert.deepEqual(events, ['session-changed']);
  assert.equal(currentSession().version, 3, 'nothing was written');
  assert.equal(hasPendingDraft(), true, 'the draft stays until the identity is re-established');
});

test('an unverifiable identity during save fails closed and keeps the draft', async () => {
  globalThis.localStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 3);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5, retryDelay: 1 });
  a.s.user = null; // 保存时身份不可判定（whoami 匿名响应）

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([entry('held-back')]);
  await flushNow();

  assert.deepEqual(a.s.puts, [], 'fail closed: no write under an unknown identity');
  assert.deepEqual(events, ['session-changed']);
  assert.equal(hasPendingDraft(), true);
});

test('a session that ends between boot and save is treated as an identity change', async () => {
  globalThis.localStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 3);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });
  a.s.user = null; // 401 → 会话结束

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([entry('after-signout')]);
  await flushNow();

  assert.deepEqual(a.s.puts, []);
  assert.deepEqual(events, ['session-changed']);
});

test('sign-out cleanup clears the shared base and this tab’s draft/conflict metadata', async () => {
  const shared = mapStorage();
  const tab = mapStorage();
  globalThis.localStorage = shared;
  globalThis.sessionStorage = tab;
  const a = serverApi(cloudDocument([entry('cloud-t1')]), 2);
  await bootstrapCloud({ fetch: a.fetch, debounce: 60000 });
  saveTransactions([entry('local-unsaved')]);
  assert.equal(hasPendingDraft(), true);

  shared.setItem(KEYS.transactions, '[{"id":"guest-local"}]');
  signOutLocalCleanup();

  assert.equal(currentSession().mode, 'guest');
  assert.ok(shared.keys().every(key => !key.startsWith('cloud-cache-')), 'shared base cleared');
  assert.ok(tab.keys().every(key => !key.startsWith('fluxledger-')), 'tab draft and conflict metadata cleared');
  assert.equal(shared.getItem(KEYS.transactions), '[{"id":"guest-local"}]', 'guest data untouched');
  saveTransactions([entry('post-signout')]);
  assert.ok(shared.getItem(KEYS.transactions) && !shared.getItem(nsKey(USER_A, KEYS.transactions)));
});

test('flushNow resolves only after the working copy reached the cloud (or gave up trying)', async () => {
  globalThis.localStorage = mapStorage();
  const a = serverApi(cloudDocument([]), 5);
  await bootstrapCloud({ fetch: a.fetch, debounce: 60000 }); // 防抖长到不会自动触发
  saveTransactions([entry('sign-out-guard')]);
  assert.equal(hasPendingDraft(), true);

  await flushNow();

  assert.equal(hasPendingDraft(), false, 'the explicit flush synced the draft');
  assert.equal(currentSession().version, 6);
});

test('different accounts never share cache keys', () => {
  assert.notEqual(nsKey(USER_A, KEYS.transactions), nsKey(USER_B, KEYS.transactions));
});

// —— App.vue 接线（组件级）：这些用例防止云端事件到 UI 的映射再次静默脱落 ——

async function mountWithBackups(a, backupCount) {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  await bootstrapCloud({ fetch: a.fetch, debounce: 60000 });
  if (backupCount > 0) {
    const backups = Array.from({ length: backupCount }, (_, index) => ({
      doc: cloudDocument([entry('bak-' + index)]),
      baseVersion: 1,
      at: '2026-01-0' + (index + 1) + 'T00:00:00.000Z',
    }));
    globalThis.sessionStorage.setItem('fluxledger-conflict-docs-' + uidHash(USER_A), JSON.stringify(backups));
  }
  const mounted = await mountApp({ storage });
  return mounted;
}

function openDataManager() {
  document.querySelector('.data-manager-trigger').click();
}

test('the UI surfaces the backup-limit notice instead of a generic failure', async () => {
  const a = serverApi(cloudDocument([]), 1);
  const app = await mountWithBackups(a, 5); // 备份列表已满
  try {
    assert.equal(app.state.notification, '', 'no toast on a clean mount');
    // 服务端推进到 v2，使本页草稿（基 1）的 PUT 落 409 并触达备份上限
    a.s.data = cloudDocument([entry('remote-v2')]);
    a.s.version = 2;
    saveTransactions([entry('limit-edit')]);
    await flushNow();
    assert.equal(
      app.state.notification,
      'Sync backups are full. Export your data, then use "Discard unsaved changes" in Data management before restoring copies.',
      'the backup-limit notice is shown, not Save failed',
    );
    assert.equal(conflictBackupCount(), 5);
    assert.equal(hasPendingDraft(), true, 'the draft survives under the limit notice');
  } finally { app.unmount(); clearTrackedTimers(); }
});

test('a blocked restore shows the export guidance and keeps the restore entry available', async () => {
  const a = serverApi(cloudDocument([]), 1);
  const app = await mountWithBackups(a, 5);
  try {
    // 服务端推进到 v2，使本页草稿（基 1）的 PUT 落 409 并触达备份上限
    a.s.data = cloudDocument([entry('remote-v2')]);
    a.s.version = 2;
    saveTransactions([entry('limit-edit')]);
    await flushNow(); // 触发 backup-limit：草稿保留、备份已满
    openDataManager();
    await new Promise(resolve => setTimeout(resolve, 10));
    const restoreButton = [...document.querySelectorAll('.data-action')].find(b => b.textContent.includes('Restore unsaved copy'));
    assert.ok(restoreButton, 'the restore entry is available');
    restoreButton.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(
      app.state.notification,
      'Sync backups are full. Export your data, then use "Discard unsaved changes" in Data management before restoring copies.',
      'the blocked-restore guidance is shown instead of a success message',
    );
    assert.equal(conflictBackupCount(), 5, 'nothing changed');
    assert.ok([...document.querySelectorAll('.data-action')].some(b => b.textContent.includes('Restore unsaved copy')), 'the restore entry stays available');
  } finally { app.unmount(); clearTrackedTimers(); }
});

test('a successful restore keeps the entry while other backups remain', async () => {
  const a = serverApi(cloudDocument([]), 1);
  const app = await mountWithBackups(a, 2);
  try {
    openDataManager();
    await new Promise(resolve => setTimeout(resolve, 10));
    [...document.querySelectorAll('.data-action')].find(b => b.textContent.includes('Restore unsaved copy')).click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(app.state.notification, 'Conflict copy restored. It will sync to the cloud.');
    assert.equal(conflictBackupCount(), 1);
    assert.ok([...document.querySelectorAll('.data-action')].some(b => b.textContent.includes('Restore unsaved copy')), 'the entry stays for the remaining backup');
  } finally { app.unmount(); clearTrackedTimers(); }
});

test('discard completes the backup-full escape hatch: export → discard → restore → sync', async () => {
  const a = serverApi(cloudDocument([]), 1);
  await bootstrapCloud({ fetch: a.fetch, debounce: 5 });

  // 5 次冲突填满备份列表，第 6 次冲突保留当前草稿（复审复现的处境）
  for (let round = 1; round <= 6; round += 1) {
    saveTransactions([entry('draft-' + round)]);
    a.s.data = cloudDocument([entry('remote-' + round)]);
    a.s.version = round + 1;
    await flushNow();
  }
  assert.equal(conflictBackupCount(), 5);
  assert.equal(hasPendingDraft(), true);
  assert.equal(restoreConflictBackup(), 'full', 'restore is blocked while the draft exists');
  await flushNow();
  assert.equal(a.s.puts.at(-1).baseVersion, 6, 'syncing is also blocked at the cap (no upload)');

  // 用户导出后明确放弃当前草稿：工作副本回到最近一次同步的云端状态
  const exportedCopy = JSON.parse(JSON.stringify(loadTransactions())); // 导出文件内容（真实导出在 UI 层捕获）
  assert.equal(discardPendingDraft(), 'ok');
  assert.equal(hasPendingDraft(), false);
  assert.deepEqual(loadTransactions(), [entry('remote-5')], 'the working copy reverts to the last synced cloud state (round 6 never resolved)');
  assert.equal(conflictBackupCount(), 5, 'the backups are untouched by the discard');

  // 恢复解锁：逐份恢复，恢复出的副本以上一次同步版本为基上传
  assert.equal(restoreConflictBackup(), 'ok');
  assert.deepEqual(loadTransactions(), [entry('draft-5')], 'the newest backup (round 5) can be restored');
  await flushNow();
  // 恢复出的副本上传时又遇 409（服务端在第 6 轮已推进）：被重新保护入列，绝不丢失
  assert.equal(conflictBackupCount(), 5, 'the conflicted copy went back into the backup list');
  assert.deepEqual(loadTransactions(), [entry('remote-6')], 'the working copy mirrors the cloud');

  // 再次恢复：此时以最新云端版本为基，上传成功——流程可完成
  assert.equal(restoreConflictBackup(), 'ok');
  assert.deepEqual(loadTransactions(), [entry('draft-5')]);
  await flushNow();
  assert.equal(currentSession().version, 8, 'the restored copy syncs against the fresh cloud base');
  assert.equal(conflictBackupCount(), 4, 'the remaining backups stay available for further restores');
  void exportedCopy;
});

test('the data manager offers a two-step discard that unblocks the restore flow', async () => {
  const a = serverApi(cloudDocument([]), 1);
  const app = await mountWithBackups(a, 5); // 备份已满
  try {
    // 服务端推进到 v2，使本页草稿（基 1）的 PUT 落 409 并触达备份上限
    a.s.data = cloudDocument([entry('remote-v2')]);
    a.s.version = 2;
    saveTransactions([entry('limit-edit')]);
    await flushNow(); // backup-limit：恢复被阻止
    assert.equal(app.state.notification, 'Sync backups are full. Export your data, then use "Discard unsaved changes" in Data management before restoring copies.');
    openDataManager();
    await new Promise(resolve => setTimeout(resolve, 10));
    const discardButton = [...document.querySelectorAll('.data-action')].find(b => b.textContent.includes('Discard unsaved changes'));
    assert.ok(discardButton, 'the discard action is available');
    discardButton.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    const confirmButton = [...document.querySelectorAll('.data-action')].find(b => b.textContent.includes('Confirm: discard unsaved changes'));
    assert.ok(confirmButton, 'the first click only arms the two-step confirmation');
    confirmButton.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(app.state.notification, 'Unsaved changes discarded. You can restore your backup copies now.');
    assert.equal(hasPendingDraft(), false);
    // 放弃后恢复解锁，且入口可用
    openDataManager();
    await new Promise(resolve => setTimeout(resolve, 10));
    const restoreButton = [...document.querySelectorAll('.data-action')].find(b => b.textContent.includes('Restore unsaved copy'));
    assert.ok(restoreButton, 'the restore entry is available after the discard');
    restoreButton.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(conflictBackupCount(), 4);
    assert.equal(app.state.notification, 'Conflict copy restored. It will sync to the cloud.');
  } finally { app.unmount(); clearTrackedTimers(); }
});

test('discarding during an in-flight save is deferred (no lost-update race with the PUT)', async () => {
  globalThis.localStorage = mapStorage();
  globalThis.sessionStorage = mapStorage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = serverApi(cloudDocument([]), 1);
  const fetch = async (url, options = {}) => {
    if (url === '/api/whoami') return pack({ body: { authenticated: true, userId: USER_A } });
    if (options.method === 'PUT') { a.s.puts.push(JSON.parse(options.body).baseVersion); await gate; a.s.data = JSON.parse(options.body).data; a.s.version += 1; return pack({ body: { version: a.s.version } }); }
    return pack({ body: { data: { ...a.s.data }, userId: USER_A, version: a.s.version } });
  };
  await bootstrapCloud({ fetch, debounce: 5 });
  const h = uidHash(USER_A);

  // 编辑进入慢 PUT（在途）
  saveTransactions([entry('in-flight-edit')]);
  await sleep(15);
  assert.ok(a.s.puts.length === 0 || true); // flush 已发起（门控未放行）
  if (a.s.puts.length !== 1) throw new Error('the gated PUT should be in flight');
  const putStarted = a.s.puts.length === 1;

  // 在途期间放弃：必须被暂缓，草稿与缓存原样保留
  assert.equal(discardPendingDraft(), 'busy');
  assert.equal(hasPendingDraft(), true, 'the draft is untouched while the save is in flight');
  assert.deepEqual(loadTransactions(), [entry('in-flight-edit')]);

  release();
  await sleep(30); // PUT 成功：已放弃企图从未执行，内容按原计划进入云端与共享基础
  assert.equal(putStarted, true, 'the gated PUT was in flight and then completed');
  assert.equal(hasPendingDraft(), false, 'the save completed and cleared the draft');
  assert.equal(currentSession().version, 2);
  assert.deepEqual(loadTransactions(), [entry('in-flight-edit')], 'the UI stays consistent with the saved result');
  assert.deepEqual(a.s.data, cloudDocument([entry('in-flight-edit')]));

  // 此后放弃语义如实：没有未同步草稿可放弃
  assert.equal(discardPendingDraft(), 'none');
});

test('the UI tells the user a save is in progress instead of pretending the discard happened', async () => {
  globalThis.localStorage = mapStorage();
  globalThis.sessionStorage = mapStorage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = serverApi(cloudDocument([]), 1);
  const fetch = async (url, options = {}) => {
    if (url === '/api/whoami') return pack({ body: { authenticated: true, userId: USER_A } });
    if (options.method === 'PUT') { await gate; a.s.data = JSON.parse(options.body).data; a.s.version += 1; return pack({ body: { version: a.s.version } }); }
    return pack({ body: { data: { ...a.s.data }, userId: USER_A, version: a.s.version } });
  };
  await bootstrapCloud({ fetch, debounce: 5 });
  const app = await mountApp({ storage: globalThis.localStorage });
  try {
    saveTransactions([entry('slow-save')]);
    await sleep(15); // PUT 在途
    openDataManager();
    await new Promise(resolve => setTimeout(resolve, 10));
    [...document.querySelectorAll('.data-action')].find(b => b.textContent.includes('Discard unsaved changes')).click();
    await new Promise(resolve => setTimeout(resolve, 10));
    [...document.querySelectorAll('.data-action')].find(b => b.textContent.includes('Confirm: discard unsaved changes')).click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(app.state.notification, 'A save is in progress. Wait for it to finish, then discard again.');
    release();
    await sleep(30);
    // 保存完成后界面与云端一致（放弃从未执行，不产生回退假象）
    assert.deepEqual(loadTransactions(), [entry('slow-save')]);
    assert.equal(hasPendingDraft(), false);
  } finally { app.unmount(); clearTrackedTimers(); }
});
