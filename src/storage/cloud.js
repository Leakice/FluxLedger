// 云端账本会话（PR3）：登录态检测、账户隔离缓存与防抖同步。
//
// 架构（本 PR 既定决策，勿在此更改）：
// - 云端是持久源；本地 localStorage 的 cloud-cache-<uidHash>-<原 key> 命名空间是
//   账户隔离的同步缓存（=工作副本），App.vue 的同步读写代码与 UI 不感知云端；
// - 同步语义三句话：进入页面时读取、修改时保存、回到页面时刷新。
//
// 可靠性规则（review 修复后的语义，勿回退）：
// - 云端 data:null / 首次进入必须显式初始化空文档，绝不允许回落到 seed 演示数据；
// - 用户一旦修改过工作副本（draft 标记存在），任何 GET 都不得覆盖它；
//   草稿只在两处被取代：PUT 成功（已同步）、409 冲突（显式重载云端并通知 UI）；
// - whoami 网络失败 ≠ 游客：重试后仍未知则进入 unknown 模式（游客界面 + 明确提示），
//   绝不静默把云账户用户的修改写进游客原 key；
// - 每次写/读云端前用 whoami 核对身份：会话已切换账号（旧标签页）→ session-changed，
//   身份无法核实 → 拒绝写入（fail closed），绝不把 A 的工作副本写进 B 的名下。
import { uidHash } from './uidHash.js';
import { buildLedgerDocument, validateLedgerDocument } from '../../app/ledger-document.js';
import { KEYS, setSessionBackend } from './local.js';

const CACHE_PREFIX = 'cloud-cache-';
const DRAFT_KEY = 'draft-meta'; // 命名空间内：存在即「工作副本可能领先云端」
const DEFAULT_DEBOUNCE_MS = 1200;
const IDENTITY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 800;
const DATA_KEYS = () => [KEYS.transactions, KEYS.cards, KEYS.hiddenBuiltInCardIds];

const session = { mode: 'guest', userId: null, uidHash: null, version: null };

let cloudFetch = (url, options) => globalThis.fetch(url, options);
let debounceMs = DEFAULT_DEBOUNCE_MS;
let retryDelayMs = DEFAULT_RETRY_DELAY_MS;
let cloudBackend = null;
let hydrating = false;
let saveTimer = null;
let flushing = false;
let flushQueued = false;
let activeFlush = null;
let listeners = [];

const emit = event => {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* 单个监听器异常不影响其他反馈 */ }
  }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function currentSession() {
  return session;
}

// 订阅云端事件：'save-failed' | 'conflict' | 'session-changed' | 'offline-boot' | 'session-unknown'。
// 返回取消订阅函数。文案与 UI 反应（toast/重载工作副本/整页刷新）留在 App.vue。
export function onCloudEvent(listener) {
  listeners.push(listener);
  return () => { listeners = listeners.filter(item => item !== listener); };
}

// 以原 key 语义包装 localStorage 的命名空间后端；用户写入会标记草稿并防抖 PUT。
// draft-meta 是元数据键：直接写它不触发 markDirty（避免递归）。
function createCloudBackend(prefix) {
  const storage = () => globalThis.localStorage;
  const scoped = key => prefix + key;
  return {
    getItem: key => storage().getItem(scoped(key)),
    setItem: (key, value) => {
      storage().setItem(scoped(key), value);
      if (key !== DRAFT_KEY) markDirty();
    },
    removeItem: key => {
      storage().removeItem(scoped(key));
      if (key !== DRAFT_KEY) markDirty();
    },
  };
}

const cacheRaw = key => {
  try { return globalThis.localStorage.getItem(CACHE_PREFIX + session.uidHash + '-' + key); }
  catch { return null; }
};

function readCacheDocument() {
  const read = key => {
    try { return JSON.parse(cacheRaw(key)) ?? []; }
    catch { return []; }
  };
  return buildLedgerDocument(read(KEYS.transactions), read(KEYS.cards), read(KEYS.hiddenBuiltInCardIds));
}

function markDraft() {
  if (!cloudBackend) return;
  try { cloudBackend.setItem(DRAFT_KEY, JSON.stringify({ at: new Date().toISOString() })); }
  catch { /* 存储不可写时由 flush 的失败路径兜底提示 */ }
}

function clearDraft() {
  if (!cloudBackend) return;
  try { cloudBackend.removeItem(DRAFT_KEY); } catch { /* 忽略 */ }
}

// 「工作副本可能领先云端」的标记；退出前保护与重进页面保留草稿都依赖它。
export function hasPendingDraft() {
  return session.mode === 'cloud' && Boolean(cloudBackend) && cloudBackend.getItem(DRAFT_KEY) !== null;
}

function markDirty() {
  if (hydrating || session.mode !== 'cloud') return;
  markDraft();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null; // 定时器已触发：清空句柄，flush 成功与否的判断才准确
    runFlush();
  }, debounceMs);
}

// 注水/冲突重载写缓存：内容来自云端，不标记草稿、不触发 PUT。
function writeDocumentToCache(data) {
  hydrating = true;
  try {
    cloudBackend.setItem(KEYS.transactions, JSON.stringify(data.transactions));
    cloudBackend.setItem(KEYS.cards, JSON.stringify(data.cards));
    cloudBackend.setItem(KEYS.hiddenBuiltInCardIds, JSON.stringify(data.hiddenBuiltInCardIds));
  } finally {
    hydrating = false;
  }
}

function initEmptyDocument() {
  writeDocumentToCache(buildLedgerDocument([], [], []));
  clearDraft();
}

const toVersion = value => {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
};

// whoami 探测。返回 'ok' | 'changed'（匿名或另一账号）| 'unknown'（网络/服务不可判定）。
async function confirmIdentity() {
  for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt += 1) {
    try {
      const response = await cloudFetch('/api/whoami', { headers: { accept: 'application/json' } });
      if (response.status === 401) return 'changed';
      if (response.ok) {
        const who = await response.json().catch(() => null);
        if (who && who.authenticated === true && who.userId === session.userId) return 'ok';
        return 'changed';
      }
      // 5xx 与其他状态：视为暂不可判定，重试
    } catch { /* 网络失败：重试 */ }
    if (attempt + 1 < IDENTITY_ATTEMPTS) await sleep(retryDelayMs);
  }
  return 'unknown';
}

async function detectIdentity() {
  for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt += 1) {
    try {
      const response = await cloudFetch('/api/whoami', { headers: { accept: 'application/json' } });
      if (response.status === 401) return { status: 'anonymous' };
      if (response.ok) {
        const who = await response.json().catch(() => null);
        if (who && who.authenticated === true && typeof who.userId === 'string' && who.userId) {
          return { status: 'authenticated', who };
        }
        return { status: 'anonymous' };
      }
    } catch { /* 网络失败：重试 */ }
    if (attempt + 1 < IDENTITY_ATTEMPTS) await sleep(retryDelayMs);
  }
  return { status: 'unknown' };
}

// 重读云端并覆盖工作副本。只在 409 冲突处理（用户已被告知云端版本将取代本地）时调用。
// 返回 'ok' | 'changed' | 'failed'。
async function refreshFromCloud() {
  const identity = await confirmIdentity();
  if (identity !== 'ok') return identity;
  try {
    const response = await cloudFetch('/api/ledger', { headers: { accept: 'application/json' } });
    if (!response.ok) return 'failed';
    const body = await response.json().catch(() => null);
    session.version = toVersion(body && body.version);
    if (body && body.data && validateLedgerDocument(body.data)) writeDocumentToCache(body.data);
    else initEmptyDocument();
    return 'ok';
  } catch {
    return 'failed';
  }
}

// 版本未知时建立基线版本。绝不写工作副本（草稿与用户状态不可被 GET 丢弃）。
// 返回 'ok' | 'changed' | 'failed'。
async function establishVersion() {
  const identity = await confirmIdentity();
  if (identity !== 'ok') return identity;
  try {
    const response = await cloudFetch('/api/ledger', { headers: { accept: 'application/json' } });
    if (!response.ok) return 'failed';
    const body = await response.json().catch(() => null);
    session.version = toVersion(body && body.version);
    return 'ok';
  } catch {
    return 'failed';
  }
}

async function flushCloudSave() {
  if (session.mode !== 'cloud') return;
  const payload = readCacheDocument();
  if (!validateLedgerDocument(payload)) {
    emit('save-failed');
    return;
  }
  const identity = await confirmIdentity();
  if (identity === 'changed') {
    // 浏览器会话已换成别的账号（或已登出）：旧页面的工作副本绝不能再提交。
    emit('session-changed');
    return;
  }
  if (identity === 'unknown') {
    // 身份无法核实：拒绝写入（fail closed），草稿保留。
    emit('save-failed');
    return;
  }
  if (session.version !== null) {
    try {
      const response = await cloudFetch('/api/ledger', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: payload, baseVersion: session.version }),
      });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        const version = Number(body && body.version);
        if (Number.isSafeInteger(version) && version > 0) session.version = version;
        if (saveTimer === null) clearDraft();
        else markDraft(); // flush 期间又有编辑入队：保持草稿标记，由排队的下一次 flush 同步
        return;
      }
      if (response.status === 409) {
        // 乐观锁冲突：云端有更新的版本。重读云端覆盖工作副本并通知 UI 重载内存状态，
        // 否则旧页面下一次编辑会用新版本号把过期集合推回云端、覆盖另一设备的数据。
        const refreshed = await refreshFromCloud();
        if (refreshed === 'ok') {
          clearDraft();
          emit('conflict');
        } else if (refreshed === 'changed') {
          emit('session-changed');
        } else {
          emit('save-failed');
        }
        return;
      }
      emit('save-failed');
    } catch {
      emit('save-failed');
    }
    return;
  }
  // 版本未知（离线启动或带草稿启动）：先建立基线版本；本次修改保留在本地，
  // 由用户下一次修改（或退出前的 flushNow）携带新版本上传。绝不静默覆盖云端。
  const established = await establishVersion();
  if (established === 'ok') {
    emit('save-failed');
    return;
  }
  if (established === 'changed') {
    emit('session-changed');
    return;
  }
  emit('save-failed');
}

function runFlush() {
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    flushing = true;
    try {
      await flushCloudSave();
    } finally {
      flushing = false;
      activeFlush = null;
      if (flushQueued) {
        flushQueued = false;
        markDirty();
      }
    }
  })();
  return activeFlush;
}

// 立即同步（退出登录前的草稿保护）。有草稿时最多尝试 3 轮；失败由调用方决定去留。
export async function flushNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (flushQueued) { flushQueued = false; }
  for (let attempt = 0; attempt < 3 && hasPendingDraft(); attempt += 1) {
    await runFlush();
  }
}

// 页面进入时调用一次（src/main.js）。任何失败都收敛到安全模式，绝不阻塞应用挂载：
// - 明确匿名（401/anonymous）→ 游客模式（原 key，行为零改动）；
// - 身份未知（网络/服务失败，重试后仍失败）→ unknown 模式（游客界面 + 'session-unknown' 提示），
//   不安装命名空间、不读写云端，后续修改留在本地原 key 且用户已被明确告知。
export async function bootstrapCloud({ fetch = defaultFetch, debounce: debounceOverride, retryDelay } = {}) {
  if (debounceOverride !== undefined) debounceMs = debounceOverride;
  if (retryDelay !== undefined) retryDelayMs = retryDelay;
  cloudFetch = fetch;
  const identity = await detectIdentity();
  if (identity.status === 'anonymous') {
    resetToGuest();
    return session;
  }
  if (identity.status === 'unknown') {
    session.mode = 'unknown';
    emit('session-unknown');
    return session;
  }

  session.mode = 'cloud';
  session.userId = identity.who.userId;
  session.uidHash = uidHash(identity.who.userId);
  cloudBackend = createCloudBackend(CACHE_PREFIX + session.uidHash + '-');
  setSessionBackend(cloudBackend);

  if (hasPendingDraft()) {
    // 离线草稿优先：保留工作副本与草稿标记，版本留空，等下一次保存建立基线。
    session.version = null;
    return session;
  }
  // 空账户/首次进入：显式初始化空文档。绝不允许 App 回落到 seed 演示数据。
  if (DATA_KEYS().every(key => cacheRaw(key) === null)) initEmptyDocument();
  try {
    const response = await cloudFetch('/api/ledger', { headers: { accept: 'application/json' } });
    if (response.status === 401) {
      resetToGuest();
      return session;
    }
    if (!response.ok) {
      session.version = null;
      emit('offline-boot');
      return session;
    }
    const body = await response.json().catch(() => null);
    session.version = toVersion(body && body.version);
    if (body && body.data && validateLedgerDocument(body.data)) {
      writeDocumentToCache(body.data);
      clearDraft();
    } else {
      initEmptyDocument(); // data:null → 空账本（云端是持久源，不从 seed 起步）
    }
  } catch {
    session.version = null;
    emit('offline-boot');
  }
  return session;
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

// 退出登录（App.vue 的退出链接点击时调用）：清账户命名空间缓存（含草稿标记），
// 云端数据不动；平台 /signout-with-chatgpt 路由随后整页跳转回游客模式。
// App.vue 会在有未同步草稿时先 flushNow 再决定是否清理。
export function signOutLocalCleanup() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const prefix = CACHE_PREFIX + session.uidHash + '-';
  if (session.uidHash) {
    const storage = () => globalThis.localStorage;
    const doomed = [];
    for (let index = 0; index < storage().length; index += 1) {
      const key = storage().key(index);
      if (key !== null && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) storage().removeItem(key);
  }
  resetToGuest();
}

// 仅测试用：恢复模块级会话状态，避免用例间串扰。
export function __resetForTest() {
  clearTimeout(saveTimer);
  saveTimer = null;
  flushing = false;
  flushQueued = false;
  activeFlush = null;
  hydrating = false;
  listeners = [];
  setSessionBackend(null);
  cloudBackend = null;
  cloudFetch = (url, options) => globalThis.fetch(url, options);
  debounceMs = DEFAULT_DEBOUNCE_MS;
  retryDelayMs = DEFAULT_RETRY_DELAY_MS;
  session.mode = 'guest';
  session.userId = null;
  session.uidHash = null;
  session.version = null;
}

function defaultFetch(url, options) {
  return globalThis.fetch(url, options);
}
