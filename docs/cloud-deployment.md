# FluxLedger 云端部署文档（Cloudflare）

> **⚠️ 状态注记（2026-09-13）**：既定方案已确认为主线——**Codex Sites 托管网站与服务端，使用平台托管的 ChatGPT 登录与 Sites 管理的 D1**（见 [sites-login-verification.md](sites-login-verification.md) 及 Issue #46）。本文所述 Cloudflare Pages / wrangler / functions/ 产出为 PR #72 的**历史探索记录**：其中 D1 访问模式（binding `DB` + drizzle）在 Sites 路径下仍然适用；Pages 项目（fluxledger.pages.dev）与 `fluxledger-d1` 数据库的去留待维护者决策，当前不含真实数据。本文中"选定形态：Cloudflare Pages"的表述仅为当时 spike 结论，**不构成对既定托管方案的修订**。

本文记录 FluxLedger 云端化的站点形态结论、Cloudflare 资源布局、Functions 目录约定与 D1 工具链，是后续云端化 PR（OAuth 登录、正式 schema）的基础设施依据。结论确立于 PR1（D1 持久化打通 spike，对应 issue #47/#48/#51）。

## 1. 站点形态结论

| 项目 | 结论 |
| --- | --- |
| 现有线上站点 | [leakice.cn](http://leakice.cn)，托管于 **OpenAI Codex Sites**（chatgpt.site），部署方式为平台直传，不经过 Git，也不经过 Cloudflare Pages/Workers |
| Cloudflare 侧现状 | 域名 `leakice.cn` 的 DNS 托管在 Cloudflare（响应头 `Server: cloudflare`，代理生效）；Cloudflare 账号内原本**没有任何 Pages 项目或 Workers 脚本**（`wrangler pages project list` / `wrangler d1 list` 均为空） |
| 本次选定形态 | **Cloudflare Pages**（Direct Upload）：`dist/` 为 SPA 静态资源，`functions/` 目录提供 API，SPA fallback 由 Pages 默认提供 |
| 生产域名 | 现阶段仍是 leakice.cn（Codex Sites）；Cloudflare 侧新域名 `fluxledger.pages.dev`（生产）+ `<branch>.fluxledger.pages.dev`（分支 preview），切换生产域名是后续 PR 的决策，本 PR 不动 leakice.cn |
| D1 数据库 | `fluxledger-d1`（region APAC，ID 见 `wrangler.toml`），通过 binding `DB` 供 Functions 访问 |

### 形态取舍说明

在 Pages 与 Workers Static Assets 之间选择了 Pages：

- 任务约定与既有讨论围绕「Functions 目录约定」展开，Pages 的 `functions/` 文件路由最直观；
- SPA fallback（404 → `index.html`）在 Pages 是默认行为，无需额外配置；
- 分支部署自动获得稳定的 `<branch>.fluxledger.pages.dev` preview 别名，便于持续验证；
- D1 绑定、migrations、secret 管理在两种形态下完全一致，未来若迁移到 Workers Static Assets，Functions 代码可以平移（`onRequest*` 导出改为 `fetch` handler 内分发），迁移成本可控。

## 2. 部署方式

当前所有 Cloudflare 侧部署均为 **wrangler Direct Upload**（与现有 Codex Sites 的直传习惯一致，不依赖 Git 集成）：

```bash
npm ci
npm test
npm run build

# 部署当前分支为 preview（推荐日常验证用）
npx wrangler pages deploy dist --branch $(git branch --show-current)

# 部署为生产（首次切换生产域名时使用，本 PR 未执行）
npx wrangler pages deploy dist --branch main
```

- 分支 preview 地址形如 `https://<branch-slug>.fluxledger.pages.dev`，始终指向该分支最新一次部署；
- 单次部署地址形如 `https://<8位hash>.fluxledger.pages.dev`，指向固定部署，适合回归对比；
- 部署前确认 `wrangler.toml` 中的 `database_id` 与远端一致。

## 3. Functions 目录约定

- 后端代码统一放在仓库根目录 `functions/`，按 Pages Functions 文件路由映射 URL：
  - `functions/api/spike/note.js` → `/api/spike/note`
  - 新增端点按 `functions/api/<资源>/<操作>.js` 展开，公共逻辑放 `functions/api/_middleware.js` 或 `functions/lib/`（后续 PR 引入）；
- D1 通过 `env.DB` 访问（binding 定义在 `wrangler.toml`），不要在代码里硬编码 database_id；
- 现有 `functions/api/spike/note.js` 是 PR1 的冒烟端点（GET/POST），仅用于验证链路，正式 API（鉴权、业务表、统一错误码）在后续 PR 重建，届时会删除 spike 端点与 `spike_notes` 表；
- **spike 端点不是公开接口**：请求必须携带 `x-spike-token` 头且等于 `SPIKE_TOKEN` secret（远端经 `wrangler pages secret put SPIKE_TOKEN --project-name fluxledger` 注入，本地放 `.dev.vars`，均已 gitignore）；`note` 长度上限 512 字符；`spike_notes` 超过 200 行后写入返回 429（防止 D1 被刷爆）。secret 未配置的环境整体关闭（404，fail closed）；
- OAuth 等 secret 一律通过 `wrangler pages secret put`（或 Dashboard 环境变量）注入，以 `env.<NAME>` 读取；**任何凭据不得进仓库**。

## 4. D1 工具链

- 配置：`wrangler.toml`（Pages 形态，`pages_build_output_dir = "dist"`）；
- 迁移文件：`migrations/*.sql`，按编号顺序执行，**已应用的迁移不可修改**，schema 变更加新文件；
- 常用命令：

```bash
# 本地（写入 .wrangler/state，已 gitignore）
npx wrangler d1 migrations apply fluxledger-d1 --local

# 远端（生产数据，执行前确认）
npx wrangler d1 migrations apply fluxledger-d1 --remote

# 本地起 Pages（静态资源 + Functions + 本地 D1）
npx wrangler pages dev

# 查询远端数据
npx wrangler d1 execute fluxledger-d1 --remote --command "SELECT * FROM spike_notes LIMIT 10"
```

## 5. PR1 冒烟验证记录（2026-09-13）

| 验证项 | 结果 |
| --- | --- |
| `wrangler d1 migrations apply fluxledger-d1 --local` | ✅ `0001_init.sql` 应用成功 |
| `wrangler d1 migrations apply fluxledger-d1 --remote` | ✅ `0001_init.sql` 应用成功（远端库 `f1be9272-87bd-41df-a5d3-85e8286696c0`） |
| 本地 `wrangler pages dev` 读写 | ✅ POST `/api/spike/note` 写入返回完整行，GET 读回一致；缺 `note` 返回 400 |
| 部署 #1（`280d857a`）写入读回 | ✅ POST 写入 `remote-smoke-2026-09-13-before-redeploy`，GET 读回一致 |
| **重新部署后持久化** | ✅ 部署 #2（`1cafadb9`）与分支别名域名 GET 均读回同一行（同 id、同 `created_at`），D1 数据跨部署持久成立 |
| 匿名游客回归 | ✅ `npm test` 75 项全绿、`npm run build` 通过；浏览器实测记账 → 刷新保留 → 导出 → 导入恢复，localStorage 行为无任何变化 |
| spike 端点防护（review P1 修复后复验） | ✅ 本地与 preview 部署上：无 token / 错 token 均返回 401，公开 GET 不再返回数据；带 token 读写正常；超 512 字符返回 413；首次部署写入的旧数据在新部署仍可读（持久化保持） |

## 6. 已知坑与注意事项

- **`*.pages.dev` 在国内网络被 SNI 阻断**：默认代理分流规则通常将 `pages.dev` 走直连，导致 TLS 握手被重置。验证 preview 前需在代理软件中为 `*.fluxledger.pages.dev` 添加代理规则（或临时切全局模式）。`api.cloudflare.com` 与 `leakice.cn` 不受影响，wrangler 全程可用。
- **`wrangler pages secret put` 只对 production 环境生效**：输出会标注 "(production)"，preview 部署读不到该 secret（表现为 fail closed 返回 404）。需要 preview 也生效时，用 API 把 secret 合入 `deployment_configs.preview.env_vars`（PATCH `/accounts/{account}/pages/projects/{project}`；注意 `fail_open` 等属性必须两个环境一起传且值一致，否则报 8000066），PATCH 后需重新部署才生效。
- **本地 `wrangler pages dev` 的进程树在 Windows 上杀不干净**：TaskStop/关闭终端可能只杀掉 npx 包装层，残留的 workerd/代理进程会继续占用 8788 端口并热重载新代码，但环境变量仍是启动时的快照（`.dev.vars` 仅在启动时读取），造成「代码生效、secret 失效」的假象。重启前用 `netstat -ano | findstr :8788` 找 PID 全部结束。
- **迁移文件中不要用 `datetime('true')`** 之类的占位写法：SQLite 会静默求值为 NULL。本仓库统一用 `datetime('now')`（UTC）。
- **测试数量基线**：任务早期文档写「npm test 61 项」，随着 PR #43–#45 合入，当前基线为 **75 项**，后续回归以此类推取当前主干实际数量。
- **`spike_notes` 是临时表**：PR3 设计正式 schema 时会通过新迁移清理（DROP 或归档），不作为业务表复用。
