// 账本文档（ledger_documents.data / PUT body 的 data）的结构约定。
// 纯 JS 模块：服务端 route.ts 与前端 src/storage/cloud.js、单元测试共用同一份
// 校验与组装逻辑，保证三端对「整本文档」的理解一致。
// 文档 = { transactions, cards, hiddenBuiltInCardIds }，三键、数组类型；与 PR2
// 本地结构（src/storage/local.js 的三个数据键）零转换对应。

export const LEDGER_DOCUMENT_KEYS = ['transactions', 'cards', 'hiddenBuiltInCardIds'];

// 严格校验：必须是恰好三键的普通对象，且每键均为数组。
// 未知键一律拒绝（fail closed），防止 schema 静默漂移。
export function validateLedgerDocument(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== LEDGER_DOCUMENT_KEYS.length) return false;
  return LEDGER_DOCUMENT_KEYS.every(key => Array.isArray(value[key]));
}

export function buildLedgerDocument(transactions, cards, hiddenBuiltInCardIds) {
  return { transactions, cards, hiddenBuiltInCardIds };
}

// baseVersion 规则：非负整数；0 表示「云端尚无我的记录」（新建）。
export function validateBaseVersion(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
