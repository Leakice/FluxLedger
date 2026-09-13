-- FluxLedger 正式云端账本 schema（PR3，issue #57）
--
-- 文档式单表：账本统计全由原始记录在前端计算（ledger.js 不动），
-- 云端只保存整本文档 JSON，结构与 PR2 本地结构零转换
-- （{transactions, cards, hiddenBuiltInCardIds}，见 app/ledger-document.js）。
-- version 用于乐观锁：PUT 携带 baseVersion，与库存 version 不一致返回 409。
-- 注意：created_at/updated_at 使用 datetime('now') 生成 UTC 时间戳
--（本仓库约定：不用 datetime('true') 之类的占位写法，SQLite 会静默求值为 NULL）。
--
-- 同一 schema 的 Sites 平台迁移形态在 drizzle/（由 db/schema.ts 经
-- `npm run db:generate` 生成，构建时随 dist/.openai/drizzle 发布）；本文件为
-- wrangler d1 migrations 工具链（PR1 形态）的同一 schema 原始 SQL。
-- PR1 的 spike_notes 临时表保留不清理（保留验证记录）。

CREATE TABLE IF NOT EXISTS ledger_documents (
    user_id    TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
