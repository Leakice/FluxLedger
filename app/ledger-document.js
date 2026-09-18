// 账本文档（ledger_documents.data / PUT body 的 data）的结构约定。
// 纯 JS 模块：服务端 route.ts 与前端 src/storage/cloud.js、单元测试共用同一份
// 校验与组装逻辑，保证三端对「整本文档」的理解一致。
// 文档 = { transactions, cards, hiddenBuiltInCardIds }，三键、数组类型、元素必须是
// 普通对象（数组里混入 null/标量会让前端统计计算抛 TypeError，一律拒绝）；
// 与 PR2 本地结构（src/storage/local.js 的三个数据键）零转换对应。

export const LEDGER_DOCUMENT_KEYS = ['transactions', 'cards', 'hiddenBuiltInCardIds'];

// 序列化字节数上限（贴近 D1 单行限额，防止异常客户端撑爆存储；超限返回 413）。
export const LEDGER_DOCUMENT_MAX_BYTES = 1000000;

const isPlainObject = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const TRANSACTION_TYPES = ['expense', 'income', 'repayment', 'credit'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 前端无条件下必读的字段（渲染与统计计算直接 .startsWith/.toLocaleString 等），
// 缺失或类型不对会让整个账本页崩溃，必须在文档入口拒绝：
// 交易记录：id/type/amount/date/card/category/description；账户记录：id/name/color/network/accountType。
const isValidTransactionRecord = item =>
  isPlainObject(item)
  && ((typeof item.id === 'string' && item.id.length > 0) || typeof item.id === 'number')
  && TRANSACTION_TYPES.includes(item.type)
  && typeof item.amount === 'number' && Number.isFinite(item.amount)
  && typeof item.date === 'string' && DATE_PATTERN.test(item.date)
  && typeof item.card === 'string' && item.card.length > 0
  && typeof item.category === 'string' && item.category.length > 0
  && typeof item.description === 'string';

const isValidCardRecord = item =>
  isPlainObject(item)
  && typeof item.id === 'string' && item.id.length > 0
  && typeof item.name === 'string' && item.name.length > 0
  && typeof item.color === 'string'
  && typeof item.network === 'string' && item.network.length > 0
  && typeof item.accountType === 'string' && item.accountType.length > 0;

const isValidIdList = value =>
  Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);

// 严格校验：恰好三键的普通对象；transactions/cards 为上述记录形状的数组，
// hiddenBuiltInCardIds 是非空字符串 id 表。未知键与非法元素一律拒绝（fail closed），
// 防止 schema 静默漂移或前端崩溃。
export function validateLedgerDocument(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== LEDGER_DOCUMENT_KEYS.length) return false;
  return Array.isArray(value.transactions) && value.transactions.every(isValidTransactionRecord)
    && Array.isArray(value.cards) && value.cards.every(isValidCardRecord)
    && isValidIdList(value.hiddenBuiltInCardIds);
}

export function buildLedgerDocument(transactions, cards, hiddenBuiltInCardIds) {
  return { transactions, cards, hiddenBuiltInCardIds };
}

// baseVersion 规则：非负整数；0 表示「云端尚无我的记录」（新建）。
export function validateBaseVersion(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// 序列化字节数（UTF-8）。无 TextEncoder 的环境退化为字符数近似（仅测试环境会走到）。
export function documentByteSize(value) {
  const json = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
  return json.length;
}
