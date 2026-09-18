// 云端账本会话（PR3）：登录态检测、账户隔离缓存与防抖同步。
//
// 架构（本 PR 既定决策，勿在此更改）：
// - 云端是持久源。localStorage 的 cloud-cache-<uidHash>-<原 key> 是「按账户共享的
//   已同步基础」；sessionStorage 的 fluxledger-draft-* 是「按标签页隔离的工作副本」。
//   local.js 的同步读写经后端路由：草稿优先、无草稿回落共享——App.vue 不感知云端；
// - 标签页草稿存 sessionStorage：同账户多标签页互不覆盖各自的未保存修改；
//   刷新后保留（浏览器按标签页存续），关闭标签页自动清理；
// - 同步语义三句话：进入页面时读取、修改时保存、回到页面时刷新。
//
// 可靠性规则（多轮 review 后的语义，勿回退）：
// - 云端 data:null / 首次进入必须显式初始化空文档，绝不允许回落到 seed 演示数据；
// - draft-meta 记录草稿基版本。带草稿启动不做启动 GET；上传永远用原基，由服务端
//   乐观锁仲裁。查询到的远端版本与草稿基版本严格分离：未知基草稿只有在确认云端
//   为空时才允许新建，否则走冲突保护；保护性查询绝不改写 session.version，
//   备份失败后保护保持（不会以远端版本重试上传）；
// - 冲突备份是多份列表（append-only，上限 5 份）：先取云端（不落盘）→ 严格备份
//   本标签页完整最新工作副本（setItem 异常透传 + 读回校验）→ 确认成功才用云端
//   覆盖共享基础并清本页草稿。任何一步失败都保留原草稿；
// - flush 以快照时编辑序号界定保存范围：PUT 期间到达的编辑保持草稿并排队补跑；
// - PUT 成功才把工作副本提升为共享基础（writeSharedDocument 直写，绕过草稿路由）；
// - whoami 网络失败 ≠ 游客：unknown 模式（boot 旗标 + App 挂载后提示）；
// - 身份绑定双保险：每次云端访问前 whoami 核对；PUT 携带 expectedUserId、GET 响应
//   携带服务端身份回显，均在同一请求内核对，不匹配的数据绝不落盘。
import { uidHash } from './uidHash.js';
import { buildLedgerDocument, validateLedgerDocument } from '../../app/ledger-document.js';
import { KEYS, setSessionBackend } from './local.js';

const CACHE_PREFIX = 'cloud-cache-';          // localStorage：按账户共享的已同步基础
const SYNCED_KEY = 'synced-meta';             // 共享命名空间内：最近一次与云端确认一致的版本
const DRAFT_PREFIX = 'fluxledger-draft-';     // sessionStorage：本标签页的工作副本（按 data key）
const DRAFT_META_KEY = 'fluxledger-draft-meta';
const CONFLICT_KEY = 'fluxledger-conflict-docs'; // sessionStorage：本标签页的冲突备份列表
const MAX_CONFLICT_BACKUPS = 5;
const DEFAULT_DEBOUNCE_MS = 1200;
const IDENTITY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 800;
const DATA_KEYS = [KEYS.transactions, KEYS.cards, KEYS.hiddenBuiltInCardIds];

const session = { mode: 'guest', userId: null, uidHash: null, version: null, boot: null };

let cloudFetch = (url, options) => globalThis.fetch(url, options);
let debounceMs = DEFAULT_DEBOUNCE_MS;
let retryDelayMs = DEFAULT_RETRY_DELAY_MS;
let cloudBackend = null;
let saveTimer = null;
let activeFlush = null;
let flushQueued = false;
let editSeq = 0; // 工作副本变更序号：界定一次 flush 的保存范围
let identityChanged = false; // 会话已判定失效：停止后续写入尝试，等待整页刷新重新引导
let listeners = [];

const emit = event => {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* 单个监听器异常不影响其他反馈 */ }
  }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 会话失效只通告一次：App 收到后整页刷新，重复事件与重试没有意义。
const emitSessionChanged = () => {
  if (identityChanged) return;
  identityChanged = true;
  emit('session-changed');
};

// 标签页草稿存储：sessionStorage（浏览器按标签页隔离、刷新保留、关页自动清理）。
// 不可用时降级为 localStorage（退化为共享语义，功能仍可用）。
function tabStore() {
  try {
    if (globalThis.sessionStorage) return globalThis.sessionStorage;
  } catch { /* 某些环境禁用 sessionStorage */
  }
  return globalThis.localStorage;
}

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

// 会话后端：数据键读取「本页草稿优先、无草稿回落共享基础」，写入进本页草稿并
// 防抖同步。语言/主题不走此后端（local.js 仅对三个数据键启用会话后端）。
// 草稿键带账户前缀：sessionStorage 正常时浏览器已按标签页隔离；降级到 localStorage
// 时仍按账户隔离，不会把 A 的草稿影子进 B 的读取。
function createCloudBackend(prefix) {
  const shared = () => globalThis.localStorage;
  const tab = tabStore;
  const draftKey = key => DRAFT_PREFIX + session.uidHash + '-' + key;
  return {
    getItem(key) {
      const shadowed = tab().getItem(draftKey(key));
      if (shadowed !== null) return shadowed;
      return shared().getItem(prefix + key);
    },
    setItem(key, value) {
      tab().setItem(draftKey(key), value);
      markDirty();
    },
    removeItem(key) {
      tab().removeItem(draftKey(key));
    },
  };
}

const draftMetaKey = () => DRAFT_META_KEY + '-' + session.uidHash;
const conflictKey = () => CONFLICT_KEY + '-' + session.uidHash;

const sharedRaw = key => {
  if (!session.uidHash) return null;
  try { return globalThis.localStorage.getItem(CACHE_PREFIX + session.uidHash + '-' + key); }
  catch { return null; }
};

const readCacheDocument = () => {
  if (!cloudBackend) return buildLedgerDocument([], [], []);
  const read = key => {
    try { return JSON.parse(cloudBackend.getItem(key)) ?? []; }
    catch { return []; }
  };
  return buildLedgerDocument(read(KEYS.transactions), read(KEYS.cards), read(KEYS.hiddenBuiltInCardIds));
};

function markDraft() {
  const baseVersion = Number.isSafeInteger(session.version) && session.version >= 0
    ? session.version
    : (syncedVersion() ?? null);
  try {
    tabStore().setItem(draftMetaKey(), JSON.stringify({ baseVersion, at: new Date().toISOString() }));
  } catch { /* 存储不可写时由 flush 的失败路径兜底提示 */ }
}

function clearTabDraft() {
  try {
    const tab = tabStore();
    tab.removeItem(draftMetaKey());
    for (const key of DATA_KEYS) tab.removeItem(DRAFT_PREFIX + session.uidHash + '-' + key);
  } catch { /* 忽略 */ }
}

// 「本页工作副本可能领先云端」；draft-meta.baseVersion 是编辑时已知的云端版本（可能为 null）。
export function hasPendingDraft() {
  if (session.mode !== 'cloud' || !cloudBackend) return false;
  const tab = tabStore();
  if (tab.getItem(draftMetaKey()) !== null) return true;
  return DATA_KEYS.some(key => tab.getItem(DRAFT_PREFIX + session.uidHash + '-' + key) !== null);
}

// 确保本页草稿是完整的三键文档：缺哪键就用「当前生效值」（无草稿的键读共享基础）
// 补齐。这样首次编辑即冻结与基版本对应的完整快照，后续读取绝不与其他标签页
// 推进的共享基础拼接（否则未修改的键会拼进他页的新数据，冲突备份也会残缺）。
function ensureCompleteTabDraft() {
  if (session.mode !== 'cloud' || !session.uidHash) return;
  const tab = tabStore();
  for (const key of DATA_KEYS) {
    const draftKey = DRAFT_PREFIX + session.uidHash + '-' + key;
    if (tab.getItem(draftKey) !== null) continue;
    const value = cloudBackend ? cloudBackend.getItem(key) : null;
    try { tab.setItem(draftKey, value === null ? '[]' : value); } catch { /* 由 flush 兜底 */ }
  }
}

function markDirty() {
  if (session.mode !== 'cloud') return;
  editSeq += 1;
  ensureCompleteTabDraft();
  markDraft();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null; // 定时器已触发：清空句柄，成功路径的「快照后是否有新编辑」判断才准确
    runFlush();
  }, debounceMs);
}

// 把文档写入「按账户共享的已同步基础」（绕过草稿路由；不触发 markDirty）。
function writeSharedDocument(data) {
  if (!session.uidHash) return;
  const shared = () => globalThis.localStorage;
  shared().setItem(CACHE_PREFIX + session.uidHash + '-' + KEYS.transactions, JSON.stringify(data.transactions));
  shared().setItem(CACHE_PREFIX + session.uidHash + '-' + KEYS.cards, JSON.stringify(data.cards));
  shared().setItem(CACHE_PREFIX + session.uidHash + '-' + KEYS.hiddenBuiltInCardIds, JSON.stringify(data.hiddenBuiltInCardIds));
}

const toVersion = value => {
  if (value === null || value === undefined) return null; // Number(null) 是 0：未知绝不能变成「基版本 0」
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

const syncedVersion = () => {
  if (!session.uidHash) return null;
  let meta = null;
  try { meta = JSON.parse(sharedRaw(SYNCED_KEY)); } catch { return null; }
  return toVersion(meta && meta.version);
};

const draftBaseVersion = () => {
  let meta = null;
  try { meta = JSON.parse(tabStore().getItem(draftMetaKey())); } catch { return null; }
  const raw = meta ? meta.baseVersion : null;
  if (raw === null || raw === undefined) return null;
  const version = Number(raw);
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

// 拉取云端文档（含身份门 + 响应身份核对）。返回 'ok'(含 body) | 'changed' | 'failed'。
// GET 响应带服务端认证身份（userId 回显）：whoami 通过后、GET 返回前会话切换的竞态
// 由同请求回显识别——不符的数据绝不写入当前命名空间。
async function fetchCloudDocument() {
  const identity = await confirmIdentity();
  if (identity !== 'ok') return identity;
  try {
    const response = await cloudFetch('/api/ledger', { headers: { accept: 'application/json' } });
    if (!response.ok) return 'failed';
    const body = await response.json().catch(() => null);
    if (!body) return 'failed';
    if (typeof body.userId === 'string' && body.userId !== session.userId) return 'changed';
    return { status: 'ok', body };
  } catch {
    return 'failed';
  }
}

// 建立基线版本：只查询、不采纳。session.version 只能来自「草稿基版本」「云端为空(0)」
// 或「冲突解决成功后的云端版本」，否则未知基保护会被意外解除。
// 返回 'ok'(含 version) | 'changed' | 'failed'。
async function establishVersion() {
  const fetched = await fetchCloudDocument();
  if (fetched === 'changed' || fetched === 'failed') return fetched;
  return { status: 'ok', version: toVersion(fetched.body.version) };
}

// 冲突备份：多份 append-only 列表（上限 MAX_CONFLICT_BACKUPS；达上限不淘汰，
// 严格写入（异常透传）+ 读回校验，成功才算数。
// 返回 'ok'（写入成功）| 'full'（已达上限，不做任何写入）| 'error'（配额/IO 失败）。
// 达到上限绝不自动淘汰最旧备份——那些是尚未被用户处理的唯一副本。
function appendConflictBackupStrict(doc, baseVersion) {
  const tab = tabStore();
  let existing = [];
  try {
    const parsed = JSON.parse(tab.getItem(conflictKey()));
    if (Array.isArray(parsed)) existing = parsed;
  } catch { /* 损坏视为空列表 */ }
  if (existing.length >= MAX_CONFLICT_BACKUPS) return 'full';
  existing.push({ doc, baseVersion, at: new Date().toISOString() });
  try {
    const value = JSON.stringify(existing);
    tab.setItem(conflictKey(), value);            // 配额/IO 异常必须就地消化
    return tab.getItem(conflictKey()) === value ? 'ok' : 'error';  // 写后读回校验
  } catch {
    return 'error';
  }
}

const readConflictBackups = () => {
  try {
    const parsed = JSON.parse(tabStore().getItem(conflictKey()));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export function hasConflictBackup() {
  return session.mode === 'cloud' && readConflictBackups().length > 0;
}

export function conflictBackupCount() {
  return session.mode === 'cloud' ? readConflictBackups().length : 0;
}

export function getConflictBackup() {
  const backups = readConflictBackups();
  const latest = backups[backups.length - 1];
  return latest && validateLedgerDocument(latest.doc) ? latest : null;
}

// 409 / 未知基的冲突解决。顺序不可变：先取云端（不落盘）→ 严格备份本页完整最新
// 工作副本（含慢 PUT 期间的新编辑，写成功才算）→ 确认成功才用云端覆盖共享基础、
// 清本页草稿并通知 UI 重载。备份失败/达上限：共享基础与本页草稿都原样保留，
// session.version 不被改动，未知基保护在下一次重试时继续保持。
// 返回 'ok'（已发 conflict 事件）| 'limit'（备份已满，已发 backup-limit）| 'changed' | 'failed'。
async function resolveConflict(attemptedBaseVersion, fetched = null) {
  if (!fetched) {
    fetched = await fetchCloudDocument();
    if (fetched === 'changed' || fetched === 'failed') return fetched;
  }
  const latest = readCacheDocument();
  if (!validateLedgerDocument(latest)) return 'failed';
  const backupOutcome = appendConflictBackupStrict(latest, attemptedBaseVersion);
  if (backupOutcome === 'full') {
    // 备份列表已满：保留现有全部备份与当前草稿，云端保持不动，提示用户先处理。
    // 返回 'limit'：调用方不再叠加通用失败提示（backup-limit 已经是明确的用户指引）。
    emit('backup-limit');
    return 'limit';
  }
  if (backupOutcome !== 'ok') return 'failed';
  session.version = toVersion(fetched.body.version); // 仅在备份确认成功后采纳云端版本
  if (fetched.body.data && validateLedgerDocument(fetched.body.data)) writeSharedDocument(fetched.body.data);
  else writeSharedDocument(buildLedgerDocument([], [], []));
  touchSyncedMeta(session.version);
  clearTabDraft();
  emit('conflict');
  return 'ok';
}

// 用户显式恢复最近一份备份写回工作副本。恢复前必须保护当前未同步副本：
// 有草稿时先把当前工作副本追加进备份列表（容量不足返回 'full' 且什么都不改，
// 由 UI 提供导出等处理方式；绝不静默覆盖未备份草稿），再用目标备份替换工作
// 副本并从列表消费该份。返回 'ok'（已恢复）| 'full'（容量不足被阻止）| 'none'。
export function restoreConflictBackup() {
  if (!cloudBackend) return 'none';
  const backups = readConflictBackups();
  if (!backups.length) return 'none';
  const target = backups[backups.length - 1];
  if (!target || !validateLedgerDocument(target.doc)) return 'none';
  const pending = hasPendingDraft();
  if (pending) {
    const current = readCacheDocument();
    if (!validateLedgerDocument(current)) return 'none';
    const protectedOutcome = appendConflictBackupStrict(current, draftBaseVersion());
    if (protectedOutcome === 'full') return 'full';
    if (protectedOutcome !== 'ok') return 'none'; // 配额/IO 失败：什么都不动，绝不丢副本
  }
  cloudBackend.setItem(KEYS.transactions, JSON.stringify(target.doc.transactions));
  cloudBackend.setItem(KEYS.cards, JSON.stringify(target.doc.cards));
  cloudBackend.setItem(KEYS.hiddenBuiltInCardIds, JSON.stringify(target.doc.hiddenBuiltInCardIds));
  const list = readConflictBackups();
  const targetIndex = pending ? list.length - 2 : list.length - 1; // 追加保护副本后，目标在倒数第二位
  const remaining = list.filter((_, index) => index !== targetIndex);
  try { tabStore().setItem(conflictKey(), JSON.stringify(remaining)); } catch { /* 忽略 */ }
  return 'ok';
}

async function flushCloudSave() {
  if (session.mode !== 'cloud' || identityChanged) return;
  const seqAtSnapshot = editSeq;
  const payload = readCacheDocument();
  if (!validateLedgerDocument(payload)) {
    emit('save-failed');
    return;
  }
  const identity = await confirmIdentity();
  if (identity === 'changed') {
    // 浏览器会话已换成别的账号（或已登出）：旧页面的工作副本绝不能再提交。
    emitSessionChanged();
    return;
  }
  if (identity === 'unknown') {
    // 身份无法核实：拒绝写入（fail closed），草稿保留。
    emit('save-failed');
    return;
  }

  if (session.version === null) {
    // 基线未知（离线启动且无同步记录，或未知基草稿）：只查询远端版本，不采纳。
    const fetched = await fetchCloudDocument();
    if (fetched === 'changed') { emitSessionChanged(); return; }
    if (fetched === 'failed') { emit('save-failed'); return; }
    const remoteVersion = toVersion(fetched.body.version);
    const draftBase = draftBaseVersion();
    if (draftBase !== null) {
      // 草稿有自己的基版本：用原基上传，由服务端乐观锁仲裁（云端已前进则 409 走冲突保护），
      // 绝不把旧草稿 rebase 到最新版本。
      session.version = draftBase;
    } else if (remoteVersion > 0) {
      // 未知基草稿 + 云端已有数据：无法判定草稿是否基于旧数据，按冲突保护处理。
      // 备份失败时 session.version 保持 null，下一次重试继续走本保护分支。
      const outcome = await resolveConflict(null, fetched);
      if (outcome === 'changed') emitSessionChanged();
      else if (outcome === 'failed') emit('save-failed');
      return;
    } else {
      session.version = 0; // 云端为空：草稿以新建身份上传
    }
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
      if (seqAtSnapshot === editSeq) {
        // 快照后没有新编辑：工作副本提升为共享基础，清本页草稿。
        writeSharedDocument(payload);
        clearTabDraft();
      } else {
        markDraft(); // 快照之后又有编辑：保持草稿标记，由排队的补跑 flush 继续
      }
      return;
    }
    if (response.status === 409) {
      // 乐观锁冲突：云端有更新的版本。解决顺序（不可变）：
      // 取云端（不落盘）→ 备份本页完整最新工作副本（含慢 PUT 期间的新编辑，写成功才算）
      // → 才用云端覆盖共享基础并通知 UI 重载。备份失败则草稿原样保留、绝不覆盖。
      const outcome = await resolveConflict(session.version);
      if (outcome === 'changed') emitSessionChanged();
      else if (outcome === 'failed') emit('save-failed');
      // 'limit'：backup-limit 已发出且草稿保留，不再叠加通用失败提示
      return;
    }
    if (response.status === 403) {
      // 服务端同一请求内的身份一致性校验未通过（whoami 与 PUT 之间发生了账号切换）。
      emitSessionChanged();
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

// 用户显式放弃当前未同步草稿（UI 必须先提供导出并取得明确确认）：
// 仅清本页草稿，工作副本回到共享基础（最近一次与云端确认的状态）；
// 备份列表与云端数据不动。用于备份上限的死锁解脱：导出 → 放弃 → 逐份恢复。
// 返回 'ok'（已放弃）| 'busy'（保存请求在途：暂缓放弃——否则在途 PUT 成功会把
// 已放弃内容写回云端与缓存，造成界面与实际保存结果不一致）| 'none'（无未同步草稿）。
export function discardPendingDraft() {
  if (session.mode !== 'cloud') return 'none';
  if (activeFlush) return 'busy';
  if (!hasPendingDraft()) return 'none';
  clearTimeout(saveTimer);
  saveTimer = null;
  clearTabDraft();
  return 'ok';
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
  identityChanged = false;
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

  if (hasPendingDraft()) {
    // 本页离线草稿优先：工作副本（sessionStorage 草稿）保留，不做启动 GET；
    // 版本 = 草稿基版本（服务端会仲裁），绝不以远端最新版本 rebase 旧草稿。
    session.version = draftBaseVersion();
    session.boot = 'ok';
    return session;
  }
  // 空账户/首次进入：显式初始化空文档。绝不允许 App 回落到 seed 演示数据。
  if (DATA_KEYS.every(key => sharedRaw(key) === null)) {
    writeSharedDocument(buildLedgerDocument([], [], []));
  }
  const fetched = await fetchCloudDocument(); // 含 whoami 门 + 响应身份回显核对
  if (fetched === 'changed') {
    // whoami 与 GET 之间会话已切换：云端数据属于另一账号，绝不写入本命名空间。
    // 工作副本保持本地状态、版本沿用上次同步记录；下一次保存的身份门会收敛。
    session.version = syncedVersion();
    session.boot = 'offline';
    return session;
  }
  if (fetched === 'failed') {
    // 离线启动：无草稿时共享基础即上次同步状态，可沿用其版本作为基线。
    session.version = syncedVersion();
    session.boot = 'offline';
    return session;
  }
  session.version = toVersion(fetched.body.version);
  if (fetched.body.data && validateLedgerDocument(fetched.body.data)) {
    writeSharedDocument(fetched.body.data);
  } else {
    writeSharedDocument(buildLedgerDocument([], [], [])); // data:null → 空账本（不从 seed 起步）
  }
  touchSyncedMeta(session.version);
  clearTabDraft();
  session.boot = 'ok';
  return session;
}

function touchSyncedMeta(version) {
  if (!session.uidHash) return;
  if (Number.isSafeInteger(version) && version >= 0) {
    try {
      globalThis.localStorage.setItem(CACHE_PREFIX + session.uidHash + '-' + SYNCED_KEY, JSON.stringify({ version, at: new Date().toISOString() }));
    } catch { /* 忽略 */ }
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
  session.boot = null;
}

// 退出登录（App.vue 的退出链接点击时调用）：清共享基础（按账户）与本页草稿/冲突备份
// （sessionStorage），云端数据不动；平台 /signout-with-chatgpt 路由随后整页跳转回游客
// 模式。其他标签页的草稿在其自身会话里，不受影响。App.vue 会在有未同步草稿或未恢复
// 冲突备份时保留命名空间，绝不静默丢弃未保存内容。
export function signOutLocalCleanup() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const prefix = CACHE_PREFIX + session.uidHash + '-';
  if (session.uidHash) {
    const shared = () => globalThis.localStorage;
    const doomed = [];
    for (let index = 0; index < shared().length; index += 1) {
      const key = shared().key(index);
      if (key !== null && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) shared().removeItem(key);
  }
  try {
    const tab = tabStore();
    tab.removeItem(draftMetaKey());
    tab.removeItem(conflictKey());
    for (const key of DATA_KEYS) tab.removeItem(DRAFT_PREFIX + session.uidHash + '-' + key);
  } catch { /* 忽略 */ }
  resetToGuest();
}

// 仅测试用：恢复模块级会话状态，避免用例间串扰。
export function __resetForTest({ keepTabStorage = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = null;
  activeFlush = null;
  flushQueued = false;
  editSeq = 0;
  identityChanged = false;
  listeners = [];
  // 清本会话在标签页存储里的草稿/备份（多标签页用例可用 keepTabStorage 保留现场）。
  if (!keepTabStorage && session.uidHash) {
    try {
      const tab = tabStore();
      tab.removeItem(draftMetaKey());
      tab.removeItem(conflictKey());
      for (const key of DATA_KEYS) tab.removeItem(DRAFT_PREFIX + session.uidHash + '-' + key);
    } catch { /* 忽略 */ }
  }
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
