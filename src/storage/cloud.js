// 云端账本会话（PR3）：登录态检测、账户隔离缓存与防抖同步。
//
// 架构（本 PR 既定决策，勿在此更改）：
// - 云端是持久源；本地 localStorage 的 cloud-cache-<uidHash>-<原 key> 命名空间是
//   账户隔离的同步缓存（=工作副本），App.vue 的同步读写代码与 UI 不感知云端；
// - 同步语义三句话：进入页面时读取、修改时保存、回到页面时刷新。
//
// 可靠性规则（两轮 review 后的语义，勿回退）：
// - 云端 data:null / 首次进入必须显式初始化空文档，绝不允许回落到 seed 演示数据；
// - draft-meta 携带草稿的基版本（编辑时已知的云端版本）。带草稿启动不做启动 GET、
//   不把旧草稿 rebase 到新版本：PUT 直接用原基版本，让服务端乐观锁仲裁（可能 409）；
//   未知基（离线启动就编辑）只在云端为空（version 0）时新建，否则走冲突保护；
// - 用户一旦修改过工作副本（draft 标记存在），任何 GET 都不得覆盖它。草稿只有
//   三种归宿：PUT 成功（已同步）、409 冲突（工作副本先备份为可恢复的 conflict-doc，
//   再转云端状态并通知 UI）、用户显式恢复；
// - flush 以快照时的编辑序号界定保存范围：PUT 期间到达的编辑保持草稿标记并立即
//   补跑一次 flush，绝不出现「最新修改未上云但标记已清」；
// - whoami 网络失败 ≠ 游客：重试后仍未知则进入 unknown 模式（boot 状态旗标 +
//   App 挂载后提示），绝不静默把云账户用户的修改写进游客原 key；
// - 每次写/读云端前用 whoami 核对身份；PUT 还携带 expectedUserId 供服务端在
//   同一请求内做一致性校验（归属仍只由认证头决定），关闭 whoami 与 PUT 之间的切换竞态。
import { uidHash } from './uidHash.js';
import { buildLedgerDocument, validateLedgerDocument } from '../../app/ledger-document.js';
import { KEYS, setSessionBackend } from './local.js';

const CACHE_PREFIX = 'cloud-cache-';
const DRAFT_KEY = 'draft-meta';       // 命名空间内：存在即「工作副本可能领先云端」，记录基版本
const CONFLICT_KEY = 'conflict-doc';  // 命名空间内：409 时被云端版本取代前的工作副本备份
const SYNCED_KEY = 'synced-meta';     // 命名空间内：最近一次与云端确认一致的版本
const DEFAULT_DEBOUNCE_MS = 1200;
const IDENTITY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 800;
const META_KEYS = [DRAFT_KEY, CONFLICT_KEY, SYNCED_KEY];
const DATA_KEYS = [KEYS.transactions, KEYS.cards, KEYS.hiddenBuiltInCardIds];

const session = { mode: 'guest', userId: null, uidHash: null, version: null, boot: null };

let cloudFetch = (url, options) => globalThis.fetch(url, options);
let debounceMs = DEFAULT_DEBOUNCE_MS;
let retryDelayMs = DEFAULT_RETRY_DELAY_MS;
let cloudBackend = null;
let hydrating = false;
let saveTimer = null;
let activeFlush = null;
let flushQueued = false;
let editSeq = 0; // 工作副本变更序号：界定一次 flush 的保存范围
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

// 订阅云端事件：'save-failed' | 'conflict' | 'session-changed'。
// 启动期状态（离线/身份未知）不发光事件（订阅者尚未挂载），走 session.boot 旗标，
// 由 App.vue 挂载后读取并提示。返回取消订阅函数。
export function onCloudEvent(listener) {
  listeners.push(listener);
  return () => { listeners = listeners.filter(item => item !== listener); };
}

// 以原 key 语义包装 localStorage 的命名空间后端；用户写入会标记草稿并防抖 PUT。
// 元数据键（draft/conflict/synced）不触发 markDirty，由对应流程显式管理。
function createCloudBackend(prefix) {
  const storage = () => globalThis.localStorage;
  const scoped = key => prefix + key;
  return {
    getItem: key => storage().getItem(scoped(key)),
    setItem: (key, value) => {
      storage().setItem(scoped(key), value);
      if (!META_KEYS.includes(key)) markDirty();
    },
    removeItem: key => {
      storage().removeItem(scoped(key));
      if (!META_KEYS.includes(key)) markDirty();
    },
  };
}

const readMeta = key => {
  if (!cloudBackend) return null;
  try {
    const parsed = JSON.parse(cloudBackend.getItem(key));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const writeMeta = (key, value) => {
  if (!cloudBackend) return;
  try { cloudBackend.setItem(key, JSON.stringify(value)); } catch { /* 存储不可写时由 flush 兜底 */ }
};

const removeMeta = key => {
  if (!cloudBackend) return;
  try { cloudBackend.removeItem(key); } catch { /* 忽略 */ }
};

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
  const baseVersion = Number.isSafeInteger(session.version) && session.version >= 0
    ? session.version
    : (readMeta(SYNCED_KEY)?.version ?? null);
  writeMeta(DRAFT_KEY, { baseVersion, at: new Date().toISOString() });
}

function clearDraft() {
  removeMeta(DRAFT_KEY);
}

// 「工作副本可能领先云端」；draft-meta.baseVersion 是编辑时已知的云端版本（可能为 null）。
export function hasPendingDraft() {
  return session.mode === 'cloud' && Boolean(cloudBackend) && cloudBackend.getItem(DRAFT_KEY) !== null;
}

function markDirty() {
  if (hydrating || session.mode !== 'cloud') return;
  editSeq += 1;
  markDraft();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null; // 定时器已触发：清空句柄，成功路径的「快照后是否有新编辑」判断才准确
    runFlush();
  }, debounceMs);
}

// 云端数据落盘（注水/冲突重载）：内容来自云端，不标记草稿、不触发 PUT。
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

function touchSyncedMeta(version) {
  if (Number.isSafeInteger(version) && version >= 0) writeMeta(SYNCED_KEY, { version, at: new Date().toISOString() });
}

const syncedVersion = () => {
  const version = Number(readMeta(SYNCED_KEY)?.version);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
};

const draftBaseVersion = () => {
  const raw = readMeta(DRAFT_KEY)?.baseVersion;
  if (raw === null || raw === undefined) return null;
  const version = Number(raw);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
};

const toVersion = value => {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
};

// whoami 探测。返回 'ok' | 'changed'（匿名、另一账号或会话结束）| 'unknown'。
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

// 重读云端并覆盖工作副本。只在 409 冲突/未知基保护（用户会收到可恢复备份的明确提示）时调用。
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
    touchSyncedMeta(session.version);
    return 'ok';
  } catch {
    return 'failed';
  }
}

// 建立基线版本。绝不写工作副本（草稿与用户状态不可被 GET 丢弃）。
// 返回 'ok' | 'changed' | 'failed'；版本写入 session.version。
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

// 409/未知基保护：被云端版本取代前，把工作副本备份为可恢复副本（不静默丢弃唯一未保存副本）。
function backupConflictedCopy(payload, attemptedBaseVersion) {
  writeMeta(CONFLICT_KEY, { doc: payload, baseVersion: attemptedBaseVersion, at: new Date().toISOString() });
}

export function hasConflictBackup() {
  return session.mode === 'cloud' && Boolean(cloudBackend) && cloudBackend.getItem(CONFLICT_KEY) !== null;
}

export function getConflictBackup() {
  if (!cloudBackend) return null;
  const meta = readMeta(CONFLICT_KEY);
  return meta && validateLedgerDocument(meta.doc) ? meta : null;
}

// 用户显式恢复：把冲突备份写回工作副本并标记草稿（基版本 = 当前云端版本，随下一次 flush 上传）。
export function restoreConflictBackup() {
  const backup = getConflictBackup();
  if (!backup) return false;
  writeDocumentToCache(backup.doc);
  removeMeta(CONFLICT_KEY);
  markDirty();
  return true;
}

async function flushCloudSave() {
  if (session.mode !== 'cloud') return;
  const seqAtSnapshot = editSeq;
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

  if (session.version === null) {
    // 基线未知（离线启动且无同步记录，或未知基草稿）：先取云端基线。
    const established = await establishVersion();
    if (established === 'changed') { emit('session-changed'); return; }
    if (established === 'failed') { emit('save-failed'); return; }
    const draftBase = draftBaseVersion();
    if (draftBase !== null) {
      // 草稿有自己的基版本：用原基上传，由服务端乐观锁仲裁（云端已前进则 409 走冲突保护），
      // 绝不把旧草稿 rebase 到最新版本。
      session.version = draftBase;
    } else if (session.version > 0) {
      // 未知基草稿 + 云端已有数据：无法判定草稿是否基于旧数据，按冲突保护处理。
      const refreshed = await refreshFromCloud();
      if (refreshed === 'ok') {
        backupConflictedCopy(payload, null);
        clearDraft();
        emit('conflict');
      } else if (refreshed === 'changed') {
        emit('session-changed');
      } else {
        emit('save-failed');
      }
      return;
    }
    // session.version === 0：云端为空，草稿以新建身份上传。
  }

  try {
    const response = await cloudFetch('/api/ledger', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      // expectedUserId 只做一致性检查（服务端与认证身份比对），不决定归属；
      // 关闭 whoami 通过后、PUT 落库前会话切换到另一账号的竞态。
      body: JSON.stringify({ data: payload, baseVersion: session.version, expectedUserId: session.userId }),
    });
    if (response.ok) {
      const body = await response.json().catch(() => null);
      const version = Number(body && body.version);
      if (Number.isSafeInteger(version) && version > 0) {
        session.version = version;
        touchSyncedMeta(version);
      }
      if (seqAtSnapshot === editSeq) clearDraft();
      else markDraft(); // 快照之后又有编辑：保持草稿标记，由排队的补跑 flush 继续
      return;
    }
    if (response.status === 409) {
      // 乐观锁冲突：云端有更新的版本。工作副本先备份为可恢复副本（不丢弃唯一未保存副本），
      // 再重读云端覆盖缓存并通知 UI 重载内存状态——旧页面不得借新版本号回写过期集合。
      const attemptedBaseVersion = session.version;
      const refreshed = await refreshFromCloud();
      if (refreshed === 'ok') {
        backupConflictedCopy(payload, attemptedBaseVersion);
        clearDraft();
        emit('conflict');
      } else if (refreshed === 'changed') {
        emit('session-changed');
      } else {
        emit('save-failed'); // 重读失败：草稿原样保留
      }
      return;
    }
    if (response.status === 403) {
      // 服务端同一请求内的身份一致性校验未通过（whoami 与 PUT 之间发生了账号切换）。
      emit('session-changed');
      return;
    }
    emit('save-failed');
  } catch {
    emit('save-failed');
  }
}

function runFlush() {
  if (activeFlush) {
    // 在途 flush 的快照不含期间的编辑：排队补跑，保证最新修改一定上传。
    flushQueued = true;
    return activeFlush;
  }
  activeFlush = (async () => {
    try {
      await flushCloudSave();
    } finally {
      activeFlush = null;
      if (flushQueued) {
        flushQueued = false;
        runFlush();
      }
    }
  })();
  return activeFlush;
}

// 立即同步（退出登录前的草稿保护）。有草稿时最多尝试 3 轮；失败由调用方决定去留。
export async function flushNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  for (let attempt = 0; attempt < 3 && hasPendingDraft(); attempt += 1) {
    await runFlush();
  }
}

// 页面进入时调用一次（src/main.js）。任何失败都收敛到安全模式，绝不阻塞应用挂载：
// - 明确匿名（401/anonymous）→ 游客模式（原 key，行为零改动）；
// - 身份未知（网络/服务失败，重试后仍失败）→ unknown 模式：不安装命名空间、不读写云端，
//   session.boot='unknown' 由 App 挂载后明确提示（启动期不发事件，避免订阅者缺位）。
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
    session.boot = 'unknown';
    return session;
  }

  session.mode = 'cloud';
  session.userId = identity.who.userId;
  session.uidHash = uidHash(identity.who.userId);
  cloudBackend = createCloudBackend(CACHE_PREFIX + session.uidHash + '-');
  setSessionBackend(cloudBackend);

  const draft = readMeta(DRAFT_KEY);
  if (draft && draft.baseVersion !== undefined) {
    // 离线草稿优先：保留工作副本；版本 = 草稿基版本（服务端会仲裁），不做启动 GET。
    session.version = toVersion(draft.baseVersion);
    session.boot = 'ok';
    return session;
  }
  // 空账户/首次进入：显式初始化空文档。绝不允许 App 回落到 seed 演示数据。
  if (DATA_KEYS.every(key => cacheRaw(key) === null)) initEmptyDocument();
  try {
    const response = await cloudFetch('/api/ledger', { headers: { accept: 'application/json' } });
    if (response.status === 401) {
      resetToGuest();
      return session;
    }
    if (!response.ok) {
      // 离线启动：无草稿时工作副本即上次同步状态，可沿用其版本作为基线。
      session.version = syncedVersion();
      session.boot = 'offline';
      return session;
    }
    const body = await response.json().catch(() => null);
    session.version = toVersion(body && body.version);
    if (body && body.data && validateLedgerDocument(body.data)) {
      writeDocumentToCache(body.data);
    } else {
      initEmptyDocument(); // data:null → 空账本（云端是持久源，不从 seed 起步）
    }
    touchSyncedMeta(session.version);
    clearDraft();
    session.boot = 'ok';
  } catch {
    session.version = syncedVersion();
    session.boot = 'offline';
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
  session.boot = null;
}

// 退出登录（App.vue 的退出链接点击时调用）：清账户命名空间缓存（含草稿/冲突副本），
// 云端数据不动；平台 /signout-with-chatgpt 路由随后整页跳转回游客模式。
// App.vue 会在有未同步草稿或未恢复冲突副本时保留命名空间，绝不静默丢弃未保存内容。
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
  activeFlush = null;
  flushQueued = false;
  hydrating = false;
  editSeq = 0;
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
  session.boot = null;
}

function defaultFetch(url, options) {
  return globalThis.fetch(url, options);
}
