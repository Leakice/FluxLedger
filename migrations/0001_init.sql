-- FluxLedger D1 初始迁移（PR1 spike）
--
-- spike_notes 是纯冒烟用表，仅用于验证 D1 绑定与迁移工具链；
-- 正式业务 schema 在 PR3 中设计，届时会另行迁移（届时评估是否清理本表）。
-- 注意：created_at 使用 datetime('now') 生成 UTC 时间戳。

CREATE TABLE IF NOT EXISTS spike_notes (
    id         TEXT PRIMARY KEY,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
