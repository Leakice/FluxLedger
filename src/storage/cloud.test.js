// 云端会话数据层的行为测试：登录态检测（含身份未知）、账户隔离命名空间、
// 草稿基版本保护（不 rebase、不被 GET 丢弃）、flush 快照范围、乐观锁冲突备份与恢复、
// 身份切换保护与退出清理。跑在 test-setup.mjs 的 happy-dom 环境里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { uidHash } from './uidHash.js';
import {
  KEYS, loadTransactions, saveTransactions, loadCards, saveCards,
  loadHiddenBuiltInCardIds, saveHiddenBuiltInCardIds, loadLanguage, saveLanguage,
} from './local.js';
import {
  bootstrapCloud, currentSession, onCloudEvent, hasPendingDraft, hasConflictBackup,
  getConflictBackup, restoreConflictBackup, flushNow, signOutLocalCleanup, __resetForTest,
} from './cloud.js';

const USER_A = 'user-account-a-0001';
const USER_B = 'user-account-b-0002';
const nsKey = (userId, originalKey) => `cloud-cache-${uidHash(userId)}-${originalKey}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Map 语义的 localStorage 替身（browser 同款 getItem/setItem/key/length 表面）。
function mapStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    keys: () => [...map.keys()],
  };
}

const pack = ({ status = 200, body = {} }) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});

// 路由式假 API：whoami/ledger 各自可按调用次序返回不同结果（handler 可为 async，
// 用于门控慢响应）；返回 null/undefined 表示网络失败。
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

// 符合文档校验的完整交易记录（生产中由录入对话框产出这些字段）。
const entry = (id, overrides = {}) => ({
  id, type: 'expense', card: 'c9', amount: 1, date: '2026-01-01',
  category: 'Other', description: id, ...overrides,
});
const cloudCard = { id: 'c9', name: 'Cloud card', color: '#123456', network: 'Visa', accountType: 'Savings card' };
const cloudDocument = transactions => ({
  transactions, cards: [cloudCard], hiddenBuiltInCardIds: ['online-alipay'],
});
const asUser = userId => ({ status: 200, body: { authenticated: true, userId } });

test.beforeEach(() => { __resetForTest(); });
test.afterEach(() => { __resetForTest(); });

test('guest bootstrap keeps every read and write on the original keys', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({ whoami: { status: 401, body: { authenticated: false, error: 'unauthenticated' } } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'guest');
  saveTransactions([{ ...entry('t1') }]);
  assert.deepEqual(loadTransactions(), [{ ...entry('t1') }]);
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
  saveTransactions([{ ...entry('local-edit') }]);
  assert.deepEqual(loadTransactions(), [{ ...entry('local-edit') }]);
  assert.ok(storage.getItem(KEYS.transactions), 'degraded to original keys, explicitly announced');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')));
});

test('signed-in bootstrap hydrates the account namespace and leaves original keys alone', async () => {
  const storage = mapStorage({ [KEYS.transactions]: '[{"id":"guest-note"}]' });
  globalThis.localStorage = storage;
  const remote = [entry('cloud-t1')];
  const { fetch } = fakeApi({ whoami: asUser(USER_A), ledger: { body: { data: cloudDocument(remote), version: 3 } } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'cloud');
  assert.equal(session.userId, USER_A);
  assert.equal(session.version, 3);
  assert.deepEqual(loadTransactions(), remote, 'cloud document served through the namespace');
  assert.equal(JSON.parse(storage.getItem(nsKey(USER_A, KEYS.transactions)))[0].id, 'cloud-t1');
  assert.equal(storage.getItem(KEYS.transactions), '[{"id":"guest-note"}]', 'guest key untouched');
  saveCards([{ id: 'c1', name: 'C', color: '#000000', network: 'Visa', accountType: 'Savings card' }]);
  assert.ok(storage.getItem(nsKey(USER_A, KEYS.cards)), 'card writes go to the namespace');
  assert.equal(storage.getItem(KEYS.cards), null, 'original cards key untouched');
  saveHiddenBuiltInCardIds(['online-wechat']);
  assert.ok(storage.getItem(nsKey(USER_A, KEYS.hiddenBuiltInCardIds)));
  saveLanguage('zh');
  assert.equal(storage.getItem(KEYS.language), 'zh', 'language stays on the original device key');
  assert.equal(storage.getItem(nsKey(USER_A, KEYS.language)), null, 'language never enters the namespace');
});

test('an empty cloud ledger initializes an explicit empty document, never the demo seed', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({ whoami: asUser(USER_A), ledger: { body: { data: null, version: 0 } } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.version, 0);
  assert.deepEqual(loadTransactions(), [], 'no demo seed for a fresh cloud account');
  assert.equal(storage.getItem(nsKey(USER_A, KEYS.transactions)), '[]');
  assert.equal(storage.getItem(nsKey(USER_A, KEYS.cards)), '[]');
  assert.equal(storage.getItem(nsKey(USER_A, KEYS.hiddenBuiltInCardIds)), '[]');
});

test('data changes mark a draft with the current base and debounce into one PUT', async () => {
  globalThis.localStorage = mapStorage();
  const remote = [entry('cloud-t1')];
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count) => (count === 1
      ? { body: { data: cloudDocument(remote), version: 3 } }
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
  assert.equal(payload.expectedUserId, USER_A, 'the server can verify identity within the same request');
  assert.deepEqual(payload.data.transactions, [entry('local-t1')]);
  assert.deepEqual(payload.data.hiddenBuiltInCardIds, ['online-alipay']);
  assert.equal(currentSession().version, 4, 'version tracks the server response');
  assert.equal(hasPendingDraft(), false, 'a successful save clears the draft marker');
  assert.deepEqual(events, [], 'successful save is silent');
  assert.deepEqual(loadTransactions(), [entry('local-t1')]);
});

test('a 409 backs up the working copy, reloads the cloud version and offers recovery', async () => {
  globalThis.localStorage = mapStorage();
  const remote = [entry('cloud-t1')];
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count) => (count === 1
      ? { body: { data: cloudDocument([]), version: 3 } }
      : count === 2
        ? { status: 409, body: { error: 'version conflict', currentVersion: 9, currentData: cloudDocument([entry('cloud-newer')]) } }
        : { body: { data: cloudDocument([entry('cloud-newer')]), version: 9 } }),
  });
  await bootstrapCloud({ fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  const unsaved = [entry('my-unsaved')];
  saveTransactions(unsaved);
  await sleep(30);

  const put = calls.find(call => call.options.method === 'PUT');
  assert.equal(JSON.parse(put.options.body).baseVersion, 3);
  const refresh = calls[calls.length - 1];
  assert.equal(refresh.options.method, undefined, 'conflict triggers a GET refresh, not a retry PUT');
  assert.deepEqual(loadTransactions(), [entry('cloud-newer')], 'working copy now mirrors the cloud');
  assert.equal(currentSession().version, 9);
  assert.equal(hasPendingDraft(), false);
  assert.equal(hasConflictBackup(), true, 'the only unsaved copy is preserved as a restorable backup');
  assert.deepEqual(getConflictBackup().doc.transactions, unsaved);
  assert.equal(getConflictBackup().baseVersion, 3);
  assert.deepEqual(events, ['conflict']);

  // 显式恢复：备份写回工作副本（基版本=云端当前版本），下一次 flush 上传。
  assert.equal(restoreConflictBackup(), true);
  assert.deepEqual(loadTransactions(), unsaved);
  assert.equal(hasPendingDraft(), true);
});

test('an offline draft keeps its original base and conflicts instead of rebasing over newer data', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch } = fakeApi({
    whoami: asUser(USER_A),
    ledger: { body: { data: cloudDocument([]), version: 1 } },
  });
  await bootstrapCloud({ fetch, debounce: 60000 }); // 长防抖：草稿只标记、不上传
  saveTransactions([entry('my-draft')]);
  assert.equal(hasPendingDraft(), true);

  // 远端前进到 v2；页面刷新后重新引导。
  const api2 = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count, options) => (options.method === 'PUT'
      ? (JSON.parse(options.body).baseVersion === 1
        ? { status: 409, body: { currentVersion: 2, currentData: cloudDocument([entry('newer-remote')]) } }
        : { body: { version: 3 } })
      : { body: { data: cloudDocument([entry('newer-remote')]), version: 2 } }),
  });
  const session = await bootstrapCloud({ fetch: api2.fetch, debounce: 5 });

  assert.equal(session.version, 1, 'boot adopts the draft base, never the latest cloud version');
  assert.equal(api2.ledgerCalls(), 0, 'no boot GET when a draft exists');
  assert.deepEqual(loadTransactions(), [entry('my-draft')], 'the draft survives the reload');

  await flushNow();

  const put = api2.calls.find(call => call.options.method === 'PUT');
  assert.equal(JSON.parse(put.options.body).baseVersion, 1, 'the draft uploads with its original base');
  assert.deepEqual(loadTransactions(), [entry('newer-remote')], 'the server rejected the stale base; cloud version wins');
  assert.equal(hasConflictBackup(), true);
  assert.deepEqual(getConflictBackup().doc.transactions, [entry('my-draft')]);

  assert.equal(restoreConflictBackup(), true);
  await flushNow();
  const puts = api2.calls.filter(call => call.options.method === 'PUT');
  assert.equal(JSON.parse(puts[1].options.body).baseVersion, 2, 'the restored copy uploads against the cloud base');
  assert.equal(hasPendingDraft(), false);
});

test('an unknown-base draft over cloud data becomes a conflict, never a silent overwrite', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count, options) => {
      if (count === 1) return null; // 启动 GET：离线
      if (count === 2) return { body: { data: cloudDocument([entry('cloud-t1')]), version: 7 } }; // 建立基线
      if (options.method === 'PUT') return { body: { version: 8 } }; // 恢复后的上传
      return { body: { data: cloudDocument([entry('cloud-t1')]), version: 7 } }; // 冲突重读
    },
  });

  const session = await bootstrapCloud({ fetch, debounce: 5 });

  assert.equal(session.version, null, 'version unknown after offline boot');
  assert.equal(session.boot, 'offline');
  assert.deepEqual(loadTransactions(), [], 'explicit empty document, never demo seed');

  saveTransactions([entry('offline-edit')]);
  await flushNow();

  assert.equal(hasConflictBackup(), true, 'unknown-base draft over cloud data is treated as a conflict');
  assert.deepEqual(getConflictBackup().doc.transactions, [entry('offline-edit')]);
  assert.deepEqual(loadTransactions(), [entry('cloud-t1')], 'the cloud version fills the working copy');
  assert.equal(currentSession().version, 7);
  assert.equal(hasPendingDraft(), false);

  assert.equal(restoreConflictBackup(), true);
  await flushNow();
  assert.equal(currentSession().version, 8, 'the restored copy uploads against the established base');
});

test('an edit during a slow PUT is uploaded by a follow-up flush and keeps its draft until synced', async () => {
  globalThis.localStorage = mapStorage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count, options) => {
      if (count === 1) return { body: { data: cloudDocument([]), version: 3 } };
      if (options.method !== 'PUT') return { body: { data: cloudDocument([]), version: 3 } };
      if (count === 2) return gate.then(() => ({ body: { version: 4 } })); // 慢 PUT
      return { body: { version: 5 } };
    },
  });
  await bootstrapCloud({ fetch, debounce: 5 });

  saveTransactions([entry('first-edit')]);
  await sleep(15); // 第一次 flush 进入慢 PUT
  saveTransactions([entry('first-edit'), entry('edit-during-put')]);
  await sleep(15); // 第二个定时器在在途期间触发 → 排队补跑
  release();
  await sleep(40);

  const puts = calls.filter(call => call.options.method === 'PUT');
  assert.equal(puts.length, 2, 'the follow-up flush uploads the late edit');
  assert.deepEqual(JSON.parse(puts[1].options.body).data.transactions, [entry('first-edit'), entry('edit-during-put')]);
  assert.equal(JSON.parse(puts[1].options.body).baseVersion, 4);
  assert.equal(hasPendingDraft(), false, 'the marker clears only after the latest edits reached the cloud');
  assert.deepEqual(loadTransactions(), [entry('first-edit'), entry('edit-during-put')]);
});

test('a changed browser identity aborts the save and never writes A’s copy under B', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls } = fakeApi({
    whoami: count => (count === 1 ? asUser(USER_A) : asUser(USER_B)), // 旧标签页挂起期间，会话已切到 B
    ledger: { body: { data: cloudDocument([]), version: 3 } },
  });
  await bootstrapCloud({ fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([entry('stale-a-copy')]);
  await sleep(40);

  assert.ok(!calls.some(call => call.options.method === 'PUT'), 'the stale working copy is never submitted');
  assert.deepEqual(events, ['session-changed']);
  assert.equal(currentSession().version, 3, 'nothing was written');
  assert.equal(hasPendingDraft(), true, 'the draft stays until the identity is re-established');
});

test('an unverifiable identity during save fails closed and keeps the draft', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls } = fakeApi({
    whoami: count => (count === 1 ? asUser(USER_A) : null), // 保存时身份不可判定
    ledger: { body: { data: cloudDocument([]), version: 3 } },
  });
  await bootstrapCloud({ fetch, debounce: 5, retryDelay: 1 });

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([entry('held-back')]);
  await sleep(60);

  assert.ok(!calls.some(call => call.options.method === 'PUT'), 'fail closed: no write under an unknown identity');
  assert.deepEqual(events, ['save-failed']);
  assert.equal(hasPendingDraft(), true);
});

test('a session that ends between boot and save is treated as an identity change', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls } = fakeApi({
    whoami: count => (count === 1 ? asUser(USER_A) : { status: 401, body: { authenticated: false } }),
    ledger: { body: { data: cloudDocument([]), version: 3 } },
  });
  await bootstrapCloud({ fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([entry('after-signout')]);
  await sleep(40);

  assert.ok(!calls.some(call => call.options.method === 'PUT'));
  assert.deepEqual(events, ['session-changed']);
});

test('sign-out cleanup clears the account namespace including draft and conflict metadata', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({
    whoami: asUser(USER_A),
    ledger: { body: { data: cloudDocument([entry('cloud-t1')]), version: 2 } },
  });
  await bootstrapCloud({ fetch });
  saveTransactions([entry('local-unsaved')]);
  assert.equal(hasPendingDraft(), true);

  storage.setItem(KEYS.transactions, '[{"id":"guest-local"}]');
  signOutLocalCleanup();

  assert.equal(currentSession().mode, 'guest');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')), 'namespace cache and metadata cleared');
  assert.equal(storage.getItem(KEYS.transactions), '[{"id":"guest-local"}]', 'guest data untouched');
  saveTransactions([entry('post-signout')]);
  assert.ok(storage.getItem(KEYS.transactions) && !storage.getItem(nsKey(USER_A, KEYS.transactions)));
});

test('flushNow resolves only after the working copy reached the cloud (or gave up trying)', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count, options) => (count === 1
      ? { body: { data: cloudDocument([]), version: 5 } }
      : options.method === 'PUT' ? { body: { version: 6 } } : { body: { data: cloudDocument([]), version: 5 } }),
  });
  await bootstrapCloud({ fetch, debounce: 60000 }); // 防抖长到不会自动触发
  saveTransactions([entry('sign-out-guard')]);
  assert.equal(hasPendingDraft(), true);

  await flushNow();

  assert.equal(hasPendingDraft(), false, 'the explicit flush synced the draft');
  assert.equal(currentSession().version, 6);
});

test('different accounts never share cache keys', () => {
  assert.notEqual(nsKey(USER_A, KEYS.transactions), nsKey(USER_B, KEYS.transactions));
});

test('a slow PUT that lands on 409 backs up the complete latest draft (including in-flight edits)', async () => {
  globalThis.localStorage = mapStorage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const remoteV2 = { data: cloudDocument([entry('remote-v2')]), userId: USER_A, version: 2 };
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count, options) => {
      if (count === 1) return { body: { data: cloudDocument([]), userId: USER_A, version: 1 } };
      if (options.method !== 'PUT') return { body: { ...remoteV2 } };
      if (count === 2) return gate.then(() => ({ status: 409, body: { currentVersion: 2, currentData: remoteV2.data } }));
      return { body: { version: 3 } };
    },
  });
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
  assert.equal(currentSession().version, 3, 'the queued follow-up flush echoes the mirrored cloud state back');
  assert.equal(hasPendingDraft(), false);
  assert.deepEqual(events, ['conflict']);
});

test('a failed conflict backup keeps the working copy and draft (never discards without a backup)', async () => {
  const base = mapStorage();
  const storage = Object.create(base, {
    setItem: { value(key, value) {
      if (key.endsWith('-conflict-doc')) throw new Error('QuotaExceededError');
      base.setItem(key, value);
    } },
  });
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count, options) => (count === 1
      ? { body: { data: cloudDocument([]), userId: USER_A, version: 1 } }
      : options.method === 'PUT'
        ? { status: 409, body: { currentVersion: 2, currentData: { data: cloudDocument([entry('remote-v2')]), userId: USER_A, version: 2 } } }
        : { body: { data: cloudDocument([entry('remote-v2')]), userId: USER_A, version: 2 } }),
  });
  await bootstrapCloud({ fetch, debounce: 5 });
  const events = [];
  onCloudEvent(event => events.push(event));

  saveTransactions([entry('only-draft')]);
  await flushNow();

  assert.equal(hasConflictBackup(), false, 'the backup write failed');
  assert.equal(hasPendingDraft(), true, 'the draft is untouched');
  assert.deepEqual(loadTransactions(), [entry('only-draft')], 'the working copy was never overwritten');
  assert.ok(events.length >= 1 && events.every(event => event === 'save-failed'),
    'every retry reports the failure honestly (flushNow retries while a draft remains)');
});

test('a boot GET whose identity echo belongs to another account never enters the namespace', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count) => (count === 1
      ? { body: { data: cloudDocument([entry('b-private')]), userId: USER_B, version: 2 } } // 启动 GET 前会话已切换：响应身份回显是 B
      : { body: { data: cloudDocument([]), userId: USER_A, version: 1 } }),
  });

  const session = await bootstrapCloud({ fetch });

  assert.deepEqual(loadTransactions(), [], 'B’s data never enters A’s namespace');
  assert.equal(session.boot, 'offline', 'boot converges safely; the next identity gate resolves the session');
  assert.equal(session.version, null);
  saveTransactions([entry('local-a-edit')]);
  assert.ok(storage.getItem(nsKey(USER_A, KEYS.transactions)), 'edits keep landing in A’s own namespace');
});

test('a conflict refresh with another account’s echo aborts as session-changed without touching the draft', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count, options) => {
      if (count === 1) return { body: { data: cloudDocument([]), userId: USER_A, version: 1 } };
      if (options.method === 'PUT') return { status: 409, body: { currentVersion: 2, currentData: { data: cloudDocument([entry('b-private')]), userId: USER_B, version: 2 } } };
      return { body: { data: cloudDocument([entry('b-private')]), userId: USER_B, version: 2 } }; // 冲突重读时身份已是 B
    },
  });
  await bootstrapCloud({ fetch, debounce: 5 });
  const events = [];
  onCloudEvent(event => events.push(event));

  const draft = [entry('my-draft')];
  saveTransactions(draft);
  await flushNow();

  assert.deepEqual(events, ['session-changed']);
  assert.equal(hasConflictBackup(), false, 'another account’s data is never backed up into A’s namespace');
  assert.deepEqual(loadTransactions(), draft, 'the working copy is untouched');
  assert.equal(hasPendingDraft(), true);
});
