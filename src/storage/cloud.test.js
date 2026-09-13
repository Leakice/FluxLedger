// 云端会话数据层的行为测试：登录态检测、账户隔离命名空间、防抖 PUT、
// 乐观锁冲突、断网反馈与游客零改动。跑在 test-setup.mjs 的 happy-dom 环境里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { uidHash } from './uidHash.js';
import {
  KEYS, loadTransactions, saveTransactions, loadCards, saveCards,
  loadHiddenBuiltInCardIds, saveHiddenBuiltInCardIds, loadLanguage, saveLanguage,
} from './local.js';
import {
  bootstrapCloud, currentSession, onCloudEvent, signOutLocalCleanup, __resetForTest,
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

function fakeFetch() {
  const calls = [];
  const queue = [];
  const enqueue = response => queue.push(response);
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (!queue.length) throw new Error(`unexpected fetch: ${options.method ?? 'GET'} ${url}`);
    const { status = 200, body = {} } = queue.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, calls, enqueue };
}

const cloudDocument = transactions => ({
  transactions, cards: [{ id: 'c9', name: 'Cloud card' }], hiddenBuiltInCardIds: ['online-alipay'],
});

test.beforeEach(() => { __resetForTest(); });
test.afterEach(() => { __resetForTest(); });

test('guest bootstrap keeps every read and write on the original keys', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch, calls, enqueue } = fakeFetch();
  enqueue({ status: 401, body: { authenticated: false, error: 'unauthenticated' } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'guest');
  assert.deepEqual(calls.map(call => call.url), ['/api/whoami']);
  saveTransactions([{ id: 't1' }]);
  assert.deepEqual(loadTransactions(), [{ id: 't1' }]);
  assert.ok(storage.getItem(KEYS.transactions), 'original transactions key written');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')), 'no namespaced keys in guest mode');
});

test('signed-in bootstrap hydrates the account namespace and leaves original keys alone', async () => {
  const storage = mapStorage({ [KEYS.transactions]: '[{"id":"guest-note"}]' });
  globalThis.localStorage = storage;
  const { fetch, calls, enqueue } = fakeFetch();
  enqueue({ body: { authenticated: true, userId: USER_A } });
  enqueue({ body: { data: cloudDocument([{ id: 'cloud-t1' }]), version: 3 } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'cloud');
  assert.equal(session.userId, USER_A);
  assert.equal(session.version, 3);
  assert.deepEqual(calls.map(call => call.url), ['/api/whoami', '/api/ledger']);
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

test('data changes debounce into a single PUT carrying the current baseVersion', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls, enqueue } = fakeFetch();
  enqueue({ body: { authenticated: true, userId: USER_A } });
  enqueue({ body: { data: cloudDocument([{ id: 'cloud-t1' }]), version: 3 } });
  enqueue({ body: { version: 4 } });
  await bootstrapCloud({ fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([{ id: 'local-t1' }]);
  saveCards([{ id: 'c1' }, { id: 'c2' }]);
  await sleep(30);

  const put = calls.find(call => call.options.method === 'PUT');
  assert.ok(put, 'a PUT was issued');
  assert.equal(put.url, '/api/ledger');
  const payload = JSON.parse(put.options.body);
  assert.equal(payload.baseVersion, 3);
  assert.deepEqual(payload.data.transactions, [{ id: 'local-t1' }]);
  assert.equal(payload.data.cards.length, 2);
  assert.deepEqual(payload.data.hiddenBuiltInCardIds, ['online-alipay']);
  assert.equal(currentSession().version, 4, 'version tracks the server response');
  assert.deepEqual(events, [], 'successful save is silent');
  assert.deepEqual(loadTransactions(), [{ id: 'local-t1' }]);
});

test('a 409 reloads the cloud document, emits conflict and never overwrites the cloud', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, calls, enqueue } = fakeFetch();
  enqueue({ body: { authenticated: true, userId: USER_A } });
  enqueue({ body: { data: cloudDocument([]), version: 3 } });
  enqueue({ status: 409, body: { error: 'version conflict', currentVersion: 9, currentData: cloudDocument([{ id: 'cloud-newer' }]) } });
  enqueue({ body: { data: cloudDocument([{ id: 'cloud-newer' }]), version: 9 } });
  await bootstrapCloud({ fetch, debounce: 5 });

  const events = [];
  onCloudEvent(event => events.push(event));
  saveTransactions([{ id: 'my-unsaved' }]);
  await sleep(30);

  const put = calls.find(call => call.options.method === 'PUT');
  assert.equal(JSON.parse(put.options.body).baseVersion, 3);
  const refresh = calls[calls.length - 1];
  assert.equal(refresh.options.method, undefined, 'conflict triggers a GET refresh, not a retry PUT');
  assert.deepEqual(loadTransactions(), [{ id: 'cloud-newer' }], 'cache now mirrors the cloud');
  assert.equal(currentSession().version, 9);
  assert.deepEqual(events, ['conflict']);
});

test('offline boot keeps the cache; recovery establishes the version without a blind PUT', async () => {
  globalThis.localStorage = mapStorage();
  const calls = [];
  let ledgerCalls = 0;
  const flakyFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/whoami') {
      return { ok: true, status: 200, json: async () => ({ authenticated: true, userId: USER_A }) };
    }
    ledgerCalls += 1;
    if (ledgerCalls === 1) throw new Error('network down');
    return {
      ok: true, status: 200,
      json: async () => ({ data: cloudDocument([{ id: 'cloud-t1' }]), version: 7 }),
    };
  };

  const session = await bootstrapCloud({ fetch: flakyFetch, debounce: 5 });

  assert.equal(session.mode, 'cloud');
  assert.equal(session.version, null, 'version unknown after offline boot');
  const events = [];
  onCloudEvent(event => events.push(event));

  saveTransactions([{ id: 'offline-edit' }]);
  await sleep(30);

  assert.deepEqual(events, ['save-failed'], 'the unsynced modification reports failure, not success');
  assert.ok(!calls.some(call => call.options.method === 'PUT'), 'never PUT without a known baseVersion');
  assert.deepEqual(loadTransactions(), [{ id: 'cloud-t1' }], 'flush-time refresh mirrors the cloud into the cache');
  assert.equal(currentSession().version, 7, 'version established for the next real modification');
  assert.equal(calls.filter(call => call.url === '/api/ledger').length, 2, 'boot GET + flush-time GET');
});

test('an unauthenticated ledger response mid-boot falls back to the guest namespace', async () => {
  globalThis.localStorage = mapStorage();
  const { fetch, enqueue } = fakeFetch();
  enqueue({ body: { authenticated: true, userId: USER_A } });
  enqueue({ status: 401, body: { authenticated: false, error: 'unauthenticated' } });

  const session = await bootstrapCloud({ fetch });

  assert.equal(session.mode, 'guest', 'expired session converges to guest mode');
  saveTransactions([{ id: 'guest-again' }]);
  assert.deepEqual(loadTransactions(), [{ id: 'guest-again' }]);
});

test('sign-out cleanup clears the account namespace and returns to guest keys', async () => {
  const storage = mapStorage();
  globalThis.localStorage = storage;
  const { fetch, enqueue } = fakeFetch();
  enqueue({ body: { authenticated: true, userId: USER_A } });
  enqueue({ body: { data: cloudDocument([{ id: 'cloud-t1' }]), version: 2 } });
  await bootstrapCloud({ fetch });

  storage.setItem(KEYS.transactions, '[{"id":"guest-local"}]');
  signOutLocalCleanup();

  assert.equal(currentSession().mode, 'guest');
  assert.ok(storage.keys().every(key => !key.startsWith('cloud-cache-')), 'namespace cache cleared');
  assert.equal(storage.getItem(KEYS.transactions), '[{"id":"guest-local"}]', 'guest data untouched');
  saveTransactions([{ id: 'post-signout' }]);
  assert.ok(storage.getItem(KEYS.transactions) && !storage.getItem(nsKey(USER_A, KEYS.transactions)));
});

test('different accounts never share cache keys', () => {
  assert.notEqual(nsKey(USER_A, KEYS.transactions), nsKey(USER_B, KEYS.transactions));
});
