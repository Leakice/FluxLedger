import { env } from "cloudflare:workers";

// Sites 托管形态：D1 绑定名由 .openai/hosting.json 声明（当前为 DB），
// 由平台在部署时注入真实绑定；本地由 wrangler.worker.jsonc 的占位配置模拟。
export function getD1() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let the platform inject the real binding before using the ledger API."
    );
  }
  return env.DB;
}
