# Sites 平台登录与 D1 最小验证（A 路径·既定路线）

本文是云端账本登录路线的**现行权威口径**：Sites 平台托管 ChatGPT 登录（A 路径）为既定路线；
独立 Cloudflare Pages + 自申 OpenAI OAuth client（B 路径，见 docs/login-feasibility.md，PR #73）
为历史探索记录，其"受阻"结论**仅适用于 B 路径**，不阻塞本路线。

## 一、口径纠正（2026-09-13）

1. `oai-authenticated-user-id` **存在**且有官方稳定性语义：同一用户在同一 Site 内稳定，跨 Site 不同
   （来源：Sites 官方技能 authentication.md；此前调查依据的 learn.chatgpt.com/docs/sites 公开页未列此头，
   属文档不完整，详见技能文件 sites-building/references/authentication.md）。
2. `oai-authenticated-user-email` / `full-name` 仅用于展示或联系；**数据归属与隔离判断只使用同一 Site 内稳定的 user id**，不得使用邮箱（email 可变更且语义为展示）。full-name 需按 encoding 头解码且不可拆分依赖。
3. 登录、退出与回调路由由 **Sites 平台拥有**（/signin-with-chatgpt、/signout-with-chatgpt、/callback），
   应用不得自行实现这三个路由；登录入口必须是顶层导航链接，不能用 fetch/客户端路由预取。
4. D1 由 **Sites 平台管理**：`.openai/hosting.json` 声明绑定（`{"d1":"DB","r2":null}`），
   服务端经 `cloudflare:workers` 的 `env.DB` 访问，配合 drizzle 使用。
5. 公开站点允许匿名访问（游客模式即匿名态）；身份头仅登录后出现。
6. API 未认证返回 401 JSON，不得把 API 请求重定向为登录页；数据归属只取服务端认证身份，
   不信任客户端提交的 user_id。

## 二、最小验证实现（本仓库 sites-verify/）

基于官方 vinext-starter 模板（Sites 受支持运行时，构建产物为 Worker）：
`sites-verify/`，仅新增最小验证面，不承载真实账单。

- `app/page.tsx`：匿名显示游客说明与平台登录链接（顶层导航）；
  登录后显示服务端读取的 user id / email（不回传认证头）。
- `app/api/whoami/route.ts`：未认证 401 JSON；认证返回 `{userId, email, displayName}`。
- `app/api/d1-test/route.ts`：按认证身份向 D1 `verify_records` 表写入/读取测试记录（归属过滤）。
- `db/schema.ts` + `drizzle/0000_*.sql`：最小测试表 `verify_records(user_id, note, created_at)`。
- `.openai/hosting.json`：`{"d1": "DB", "r2": null}`。

## 三、本地验证结果（vinext dev 模拟身份 local_seedy，2026-09-13）

| # | 验证项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 匿名访问：页面可看，`/api/whoami` 返回 401 JSON（非重定向） | ✅ 通过 | curl 实录 `{"authenticated":false,"error":"unauthenticated"}` |
| 2 | 平台登录路由跳转-返回：`/signin-with-chatgpt?return_to=/` 302 回站，会话建立 | ✅ 通过（本地模拟身份） | whoami 返回 `{"userId":"local_seedy","email":"seedy@sites.test"}` |
| 3 | 服务端按稳定 user id 向 D1 写入并读取测试记录 | ✅ 通过 | POST 201 `{id:1,userId:"local_seedy"}`；GET 返回按 user_id 过滤的记录 |
| 4 | 退出后恢复匿名（游客本地模式不受影响） | ✅ 通过 | `/signout-with-chatgpt` 后 whoami 401 |
| 5 | 重新部署（全新进程）后 D1 测试记录仍在 | ✅ 通过（本地 .wrangler/state） | 杀进程重启后 GET 返回原 2 条记录 |
| 6 | 双账号数据隔离 | ⏳ 待托管环境 | 本地模拟只有单一身份 local_seedy，无法构造第二真实账号 |
| 7 | 真实 ChatGPT 登录（真实 user id / email 头） | ⏳ 待托管环境 | 本地仅模拟身份 |
| 8 | 生产/托管部署后的持久化与认证头注入 | ⏳ 待托管环境 | 由维护者在 Sites 平台执行 |

## 四、待维护者在 Sites 环境执行的交接清单

1. 在 Sites 平台为测试站点启用 D1（hosting.json 已声明 `d1: "DB"`），确认测试部署与生产数据隔离。
2. 部署 `sites-verify/` 到测试 Site，记录托管后 URL。
3. 用两个真实 ChatGPT 账号分别登录：各自 POST /api/d1-test 写入、GET 读取，确认互不可见（验证 #6）。
4. 在 Sites 控制台重部署一次，复查记录仍在（验证 #8 的平台侧持久化）。
5. 记录真实 `oai-authenticated-user-id` 样值格式（脱敏后贴回 Issue），供归属键定型。
6. **伪造认证头验证**：从平台受信任入口之外直接向托管 API 发送带伪造 `oai-authenticated-user-id` / `oai-authenticated-user-email` 头的请求（自建脚本），确认服务端不采信伪造值（未登录仍 401、登录用户身份不被冒充）。认证头的可信性以 Sites 平台注入为前提，此验证必须在托管环境完成。

## 四-B、进入真实多用户写入的门槛

以下四项**全部通过**后才允许接入真实多用户数据写入（此前仅限测试数据）：

1. 真实 ChatGPT 登录与平台身份头注入（验证 #7）；
2. 双账号数据隔离（验证 #6）；
3. 托管部署后的持久化（验证 #8，区别于本地进程重启）；
4. 伪造认证头无法冒充其他用户（交接清单 #6）。

## 五、与 Cloudflare 产出的关系

PR #72 的 Cloudflare Pages 产出（wrangler.toml、functions/api/spike/note.js、fluxledger-d1）为历史探索记录：
其中 D1 使用模式（binding `DB` + drizzle）在 Sites 路径下同样适用，spike 端点暂保留但不再作为登录与数据主路线。
产出去留待维护者决策；本路线不依赖其存在。
