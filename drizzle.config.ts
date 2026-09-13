import { defineConfig } from "drizzle-kit";

// 仅用于本地生成 Sites 平台迁移（npm run db:generate → drizzle/）。
export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "sqlite",
});
