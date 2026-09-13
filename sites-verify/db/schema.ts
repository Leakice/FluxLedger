import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 最小验证用表（Sites 平台登录与 D1 持久化验证）。
// 正式账单 schema 在云端账本 PR 中另行设计，勿在此扩展。
export const verifyRecords = sqliteTable("verify_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
