import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// 云端账本文档表（PR3，issue #57）。
// 结构约定见 migrations/0002_ledger_documents.sql 与 app/ledger-document.js：
// 文档式单表，data 为整本账本 JSON，version 用于 PUT 乐观锁。
export const ledgerDocuments = sqliteTable("ledger_documents", {
  userId: text("user_id").primaryKey(),
  data: text("data").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
