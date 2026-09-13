// 云端会话数据层的行为测试：登录态检测（含身份未知）、账户隔离命名空间、
// 草稿保护（GET 不得丢弃工作副本）、防抖 PUT、乐观锁冲突、身份切换保护与退出清理。
// 跑在 test-setup.mjs 的 happy-dom 环境里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { uidHash } from './uidHash.js';
import {
  KEYS, loadTransactions, saveTransactions, loadCards, saveCards,
  loadHiddenBuiltInCardIds, saveHiddenBuiltInCardIds, loadLanguage, saveLanguage,
} from './local.js';
import {
  bootstrapCloud, currentSession, onCloudEvent, hasPendingDraft, flushNow,
  signOutLocalCleanup, __resetForTest,
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

// 路由式假 API：whoami/ledger 各自可按调用次序返回不同结果；返回 null/undefined 表示网络失败。
function fakeApi({ whoami, ledger } = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/whoami') {
      const response = typeof whoami === 'function' ? whoami(calls.filter(c => c.url === '/api/whoami').length) : whoami;
      if (!response) throw new Error('whoami network failure (simulated)');
      return pack(response);
    }
    if (url === '/api/ledger') {
      const response = typeof ledger === 'function' ? ledger(calls.filter(c => c.url === '/api/ledger').length, options) : ledger;
      if (!response) throw new Error('ledger network failure (simulated)');
      return pack(response);
    }
    throw new Error('unexpected fetch: ' + url);
  };
  const count = url => calls.filter(call => call.url === url).length;
  return { fetch, calls, whoamiCalls: () => count('/api/whoami'), ledgerCalls: () => count('/api/ledger') };
}

const asUser = userId => ({ status: 200, body: { authenticated: true, userId } });
const cloudDocument = transactions => ({
  transactions, cards: [{ id: 'c9', name: 'Cloud card' }], hiddenBuiltInCardIds: ['online-alipay'],
});

test.beforeEach(() => { __resetForTest(); });
test.afterEach(() => { __resetForTest(); });

test('guest bootstrap keeps every read and write on the original keys', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({ whoami: { status: 401, body: { authenticated: false, error: 'unauthenticated' } } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'guest');
  saveTransactions([{ id: 't1' }]);
  assert.deepEqual(loadTransactions(), [{ id: 't1' }]);
  assert.ok(storage.getItem(KEYS.transactions), 'original transactions key written');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')), 'no namespaced keys in guest mode');
});

test('an undetectable identity is unknown mode, never a silent guest fallback', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const api = fakeApi({ whoami: null }); // 网络失败 ×3（重试用尽）
  const events = [];
  onCloudEvent(event => events.push(event));

  const session = await bootstrapCloud({ fetch: api.fetch, retryDelay: 1 });

  assert.equal(session.mode, 'unknown');
  assert.deepEqual(events, ['session-unknown']);
  assert.equal(api.ledgerCalls(), 0, 'unknown identity never touches cloud data');
  saveTransactions([{ id: 'local-edit' }]);
  assert.deepEqual(loadTransactions(), [{ id: 'local-edit' }]);
  assert.ok(storage.getItem(KEYS.transactions), 'degraded to original keys, explicitly announced');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')));
});

test('signed-in bootstrap hydrates the account namespace and leaves original keys alone', async () => {
  const storage = mapStorage({ [KEYS.transactions]: '[{"id":"guest-note"}]' });
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({ whoami: asUser(USER_A), ledger: { body: { data: cloudDocument([{ id: 'cloud-t1' }]), version: 3 } } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'cloud');
  assert.equal(session.userId, USER_A);
  assert.equal(session.version, 3);
  assert.deepEqual(loadTransactions(), [{ id: 'cloud-t1' }], 'cloud document served through the namespace');
  assert.equal(JSON.parse(storage.getItem(nsKey(USER_A, KEYS.transactions)))[0].id, 'cloud-t1');
  assert.equal(storage.getItem(KEYS.transactions), '[{"id":"guest-note"}]', 'guest key untouched');
  saveCards([{ id: 'c1' }]);
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

test('data changes mark a draft immediately and debounce into one PUT with the current baseVersion', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count, options) => (count === 1
      ? { body: { data: cloudDocument([{ id: 'cloud-t1' }]), version: 3 } }
      : { body: { version: 4 } }),
  });
  await bootstrapCloud({ fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([{ id: 'local-t1' }]);
  assert.equal(hasPendingDraft(), true, 'the draft marker is set before any network round-trip');
  saveCards([{ id: 'c1' }, { id: 'c2' }]);
  await sleep(30);

  const put = calls.find(call => call.options.method === 'PUT');
  assert.ok(put, 'a PUT was issued');
  const payload = JSON.parse(put.options.body);
  assert.equal(payload.baseVersion, 3);
  assert.deepEqual(payload.data.transactions, [{ id: 'local-t1' }]);
  assert.deepEqual(payload.data.hiddenBuiltInCardIds, ['online-alipay']);
  assert.equal(currentSession().version, 4, 'version tracks the server response');
  assert.equal(hasPendingDraft(), false, 'a successful save clears the draft marker');
  assert.deepEqual(events, [], 'successful save is silent');
  assert.deepEqual(loadTransactions(), [{ id: 'local-t1' }]);
});

test('a 409 reloads the cloud document, emits conflict and never overwrites the cloud', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count) => (count === 1
      ? { body: { data: cloudDocument([]), version: 3 } }
      : count === 2
        ? { status: 409, body: { error: 'version conflict', currentVersion: 9, currentData: cloudDocument([{ id: 'cloud-newer' }]) } }
        : { body: { data: cloudDocument([{ id: 'cloud-newer' }]), version: 9 } }),
  });
  await bootstrapCloud({ fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([{ id: 'my-unsaved' }]);
  await sleep(30);

  const put = calls.find(call => call.options.method === 'PUT');
  assert.equal(JSON.parse(put.options.body).baseVersion, 3);
  const refresh = calls[calls.length - 1];
  assert.equal(refresh.options.method, undefined, 'conflict triggers a GET refresh, not a retry PUT');
  assert.deepEqual(loadTransactions(), [{ id: 'cloud-newer' }], 'working copy now mirrors the cloud');
  assert.equal(currentSession().version, 9);
  assert.equal(hasPendingDraft(), false, 'conflict resolution supersedes the draft explicitly');
  assert.deepEqual(events, ['conflict']);
});

test('offline boot initializes an empty ledger, keeps edits, and syncs them on a later save', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls } = fakeApi({
    whoami: asUser(USER_A),
    ledger: (count) => (count === 1
      ? null // 启动 GET：离线
      : count === 2
        ? { body: { data: cloudDocument([{ id: 'cloud-t1' }]), version: 7 } } // 建立版本
        : { body: { version: 8 } }), // 草稿上传
  });
  const events = [];
  onCloudEvent(event => events.push(event));

  const session = await bootstrapCloud({ fetch, debounce: 5 });

  assert.equal(session.version, null, 'version unknown after offline boot');
  assert.deepEqual(loadTransactions(), [], 'explicit empty document, never demo seed');
  assert.deepEqual(events, ['offline-boot']);

  saveTransactions([{ id: 'offline-edit' }]);
  await sleep(30);

  assert.ok(events.includes('save-failed'), 'the unsynced modification reports failure, not success');
  assert.ok(!calls.some(call => call.options.method === 'PUT'), 'never PUT without a known baseVersion');
  assert.deepEqual(loadTransactions(), [{ id: 'offline-edit' }], 'establishing the version must not discard the working copy');
  assert.equal(currentSession().version, 7);

  saveTransactions([{ id: 'offline-edit-2' }]);
  await sleep(30);
  const put = calls.find(call => call.options.method === 'PUT');
  assert.ok(put, 'the next explicit save uploads the kept working copy');
  assert.equal(JSON.parse(put.options.body).baseVersion, 7);
  assert.equal(currentSession().version, 8);
  assert.equal(hasPendingDraft(), false);
});

test('an unsynced draft survives a page reload (boot keeps the working copy, no blind GET overwrite)', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls } = fakeApi({
    whoami: () => asUser(USER_A),
    ledger: (count, options) => (options.method === 'PUT' ? null : { body: { data: cloudDocument([]), version: 3 } }),
  });
  await bootstrapCloud({ fetch, debounce: 5 });
  saveTransactions([{ id: 'my-draft' }]);
  await sleep(30);
  assert.equal(hasPendingDraft(), true, 'failed PUT keeps the draft marker');

  // 模拟整页刷新后的重新引导（同一存储、同一身份）。
  const api2 = fakeApi({ whoami: asUser(USER_A), ledger: { body: { data: cloudDocument([]), version: 99 } } });
  const session = await bootstrapCloud({ fetch: api2.fetch, debounce: 5 });

  assert.equal(session.mode, 'cloud');
  assert.equal(session.version, null, 'draft exists: the version stays unknown until the next save');
  assert.deepEqual(loadTransactions(), [{ id: 'my-draft' }], 'the draft is not replaced by the cloud document');
  assert.equal(api2.ledgerCalls(), 0, 'no boot GET when a draft exists');
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
  saveTransactions([{ id: 'stale-a-copy' }]);
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
  saveTransactions([{ id: 'held-back' }]);
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
  saveTransactions([{ id: 'after-signout' }]);
  await sleep(40);

  assert.ok(!calls.some(call => call.options.method === 'PUT'));
  assert.deepEqual(events, ['session-changed']);
});

test('sign-out cleanup clears the account namespace including the draft marker', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch } = fakeApi({
    whoami: asUser(USER_A),
    ledger: { body: { data: cloudDocument([{ id: 'cloud-t1' }]), version: 2 } },
  });
  await bootstrapCloud({ fetch });
  saveTransactions([{ id: 'local-unsaved' }]);
  assert.equal(hasPendingDraft(), true);

  storage.setItem(KEYS.transactions, '[{"id":"guest-local"}]');
  signOutLocalCleanup();

  assert.equal(currentSession().mode, 'guest');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')), 'namespace cache and draft marker cleared');
  assert.equal(storage.getItem(KEYS.transactions), '[{"id":"guest-local"}]', 'guest data untouched');
  saveTransactions([{ id: 'post-signout' }]);
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
  saveTransactions([{ id: 'sign-out-guard' }]);
  assert.equal(hasPendingDraft(), true);

  await flushNow();

  assert.equal(hasPendingDraft(), false, 'the explicit flush synced the draft');
  assert.equal(currentSession().version, 6);
});

test('different accounts never share cache keys', () => {
  assert.notEqual(nsKey(USER_A, KEYS.transactions), nsKey(USER_B, KEYS.transactions));
});
