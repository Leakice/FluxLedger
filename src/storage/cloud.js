// 云端账本会话（PR3）：登录态检测、账户隔离缓存与防抖同步。
//
// 架构（本 PR 既定决策，勿在此更改）：
// - 云端是持久源；本地 localStorage 的 cloud-cache-<uidHash>-<原 key> 命名空间是
//   账户隔离的同步缓存，App.vue 的同步读写代码与 UI 不感知云端；
// - 同步语义三句话：进入页面时读取（bootstrapCloud 里 GET → 覆盖缓存）、
//   修改时保存（缓存写入触发防抖 PUT）、回到页面时刷新（下次进入重复第一步）；
// - 语言/主题是设备偏好，永远走本地原 key（local.js 只对三个数据键启用会话后端）；
// - 游客模式零改动：bootstrapCloud 未成功前一切读写走原 key。
//
// 第一版边界（PR4 会补齐）：无重试队列；断网时的修改只在本地缓存与页面内存中，
// 恢复后需用户再次修改（或刷新后重做）才会同步；PUT 409 时重新 GET 覆盖缓存并
// 提示冲突，绝不静默覆盖云端。
import { uidHash } from './uidHash.js';
import { buildLedgerDocument, validateLedgerDocument } from '../../app/ledger-document.js';
import { KEYS, setSessionBackend } from './local.js';

const CACHE_PREFIX = 'cloud-cache-';
const DEFAULT_DEBOUNCE_MS = 1200;

const session = { mode: 'guest', userId: null, uidHash: null, version: null };

let cloudFetch = (url, options) => globalThis.fetch(url, options);
let debounceMs = DEFAULT_DEBOUNCE_MS;
let cloudBackend = null;
let hydrating = false;
let saveTimer = null;
let flushing = false;
let flushQueued = false;
let listeners = [];

const emit = event => {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* 单个监听器异常不影响其他反馈 */ }
  }
};

export function currentSession() {
  return session;
}

// 订阅云端事件（'save-failed' | 'conflict'）；返回取消订阅函数。App.vue 用它桥接 toast。
export function onCloudEvent(listener) {
  listeners.push(listener);
  return () => { listeners = listeners.filter(item => item !== listener); };
}

// 以原 key 语义包装 localStorage 的命名空间后端；任何写入都会标记脏并防抖 PUT。
function createCloudBackend(prefix) {
  const storage = () => globalThis.localStorage;
  const scoped = key => prefix + key;
  return {
    getItem: key => storage().getItem(scoped(key)),
    setItem: (key, value) => {
      storage().setItem(scoped(key), value);
      markDirty();
    },
    removeItem: key => {
      storage().removeItem(scoped(key));
      markDirty();
    },
  };
}

function readCacheDocument() {
  const storage = () => globalThis.localStorage;
  const read = key => {
    try { return JSON.parse(storage().getItem(CACHE_PREFIX + session.uidHash + '-' + key)) ?? []; }
    catch { return []; }
  };
  return buildLedgerDocument(read(KEYS.transactions), read(KEYS.cards), read(KEYS.hiddenBuiltInCardIds));
}

function clearNamespacedCache() {
  if (!session.uidHash) return;
  const storage = () => globalThis.localStorage;
  const prefix = CACHE_PREFIX + session.uidHash + '-';
  const doomed = [];
  for (let index = 0; index < storage().length; index += 1) {
    const key = storage().key(index);
    if (key !== null && key.startsWith(prefix)) doomed.push(key);
  }
  for (const key of doomed) storage().removeItem(key);
}

function markDirty() {
  if (hydrating || session.mode !== 'cloud') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flushCloudSave(); }, debounceMs);
}

function applyCloudDocument(body) {
  const version = Number(body?.version);
  session.version = Number.isSafeInteger(version) && version >= 0 ? version : null;
  const data = body?.data;
  if (!data || !validateLedgerDocument(data) || !cloudBackend) return;
  // 启动注水写入不触发 PUT（数据本就来自云端）。
  hydrating = true;
  try {
    cloudBackend.setItem(KEYS.transactions, JSON.stringify(data.transactions));
    cloudBackend.setItem(KEYS.cards, JSON.stringify(data.cards));
    cloudBackend.setItem(KEYS.hiddenBuiltInCardIds, JSON.stringify(data.hiddenBuiltInCardIds));
  } finally {
    hydrating = false;
  }
}

async function refreshFromCloud() {
  try {
    const response = await cloudFetch('/api/ledger', { headers: { accept: 'application/json' } });
    if (!response.ok) return false;
    applyCloudDocument(await response.json());
    return true;
  } catch {
    return false;
  }
}

function resetToGuest() {
  clearTimeout(saveTimer);
  saveTimer = null;
  setSessionBackend(null);
  cloudBackend = null;
  session.mode = 'guest';
  session.userId = null;
  session.uidHash = null;
  session.version = null;
}

async function flushCloudSave() {
  if (session.mode !== 'cloud') return;
  if (flushing) { flushQueued = true; return; }
  flushing = true;
  try {
    const payload = readCacheDocument();
    if (!validateLedgerDocument(payload)) {
      emit('save-failed');
      return;
    }
    if (session.version === null) {
      // 进入页面时离线导致版本未知：先 GET 建立版本（云端数据覆盖缓存，页面内存中的
      // 修改保留）。本次修改不自动重发——无重试队列是第一版边界，避免静默覆盖云端。
      await refreshFromCloud();
      emit('save-failed');
      return;
    }
    try {
      const response = await cloudFetch('/api/ledger', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: payload, baseVersion: session.version }),
      });
      if (response.ok) {
        const body = await response.json();
        const version = Number(body?.version);
        if (Number.isSafeInteger(version) && version > 0) session.version = version;
        return;
      }
      if (response.status === 409) {
        // 乐观锁冲突：重新 GET 覆盖缓存 + 提示；页面内存中未保存的修改保留，由用户
        // 决定是否再次提交。绝不静默覆盖云端。
        const refreshed = await refreshFromCloud();
        emit(refreshed ? 'conflict' : 'save-failed');
        return;
      }
      emit('save-failed');
    } catch {
      emit('save-failed');
    }
  } finally {
    flushing = false;
    if (flushQueued) { flushQueued = false; markDirty(); }
  }
}

// 页面进入时调用一次（src/main.js）：检测登录态；已登录则 GET /api/ledger 注水缓存。
// 任何失败都收敛到游客模式（fail closed），绝不阻塞应用挂载。
export async function bootstrapCloud({ fetch = defaultFetch, debounce: debounceOverride } = {}) {
  if (debounceOverride !== undefined) debounceMs = debounceOverride;
  cloudFetch = fetch;
  let who;
  try {
    const response = await fetch('/api/whoami', { headers: { accept: 'application/json' } });
    if (!response.ok) return session;
    who = await response.json();
  } catch {
    return session;
  }
  if (!who || who.authenticated !== true || typeof who.userId !== 'string' || !who.userId) return session;

  session.mode = 'cloud';
  session.userId = who.userId;
  session.uidHash = uidHash(who.userId);
  cloudBackend = createCloudBackend(CACHE_PREFIX + session.uidHash + '-');
  setSessionBackend(cloudBackend);

  try {
    const response = await fetch('/api/ledger', { headers: { accept: 'application/json' } });
    if (response.ok) {
      applyCloudDocument(await response.json());
    } else if (response.status === 401) {
      resetToGuest();
    }
  } catch {
    // 离线进入：保留账户缓存，version 未知，首次保存前会先尝试建立版本。
  }
  return session;
}

// 退出登录（App.vue 的退出链接点击时调用）：清账户命名空间缓存，云端数据不动；
// 平台 /signout-with-chatgpt 路由随后整页跳转回游客模式。
export function signOutLocalCleanup() {
  clearTimeout(saveTimer);
  saveTimer = null;
  clearNamespacedCache();
  resetToGuest();
}

// 仅测试用：恢复模块级会话状态，避免用例间串扰。
export function __resetForTest() {
  clearTimeout(saveTimer);
  saveTimer = null;
  flushing = false;
  flushQueued = false;
  hydrating = false;
  listeners = [];
  setSessionBackend(null);
  cloudBackend = null;
  cloudFetch = (url, options) => globalThis.fetch(url, options);
  debounceMs = DEFAULT_DEBOUNCE_MS;
  session.mode = 'guest';
  session.userId = null;
  session.uidHash = null;
  session.version = null;
}

function defaultFetch(url, options) {
  return globalThis.fetch(url, options);
}
