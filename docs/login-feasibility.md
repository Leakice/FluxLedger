# Sign in with ChatGPT 接入可行性调查（T2.0）

- **核查日期**：2026-09-13
- **调查对象**：FluxLedger（Cloudflare Pages 形态）能否正式接入 Sign in with ChatGPT 作为登录方式
- **结论**：**当前受阻——OpenAI 未对独立第三方网站提供可用的客户端注册入口**。本调查不构成登录实现，登录实现（#49/#50）保持开放并等待解除阻塞。
- **性质声明**：本文档是可行性调查记录，不是登录实现 PR 的组成部分。

## 1. 已证实事实（含核查日期与来源）

| # | 事实 | 来源（核查于 2026-09-13） |
| --- | --- | --- |
| 1 | OpenAI 运营 `https://auth.openai.com` OIDC 提供方：issuer/授权端点/token 端点/userinfo/JWKS/revocation 均真实存在；grant 支持 `authorization_code`+`refresh_token`；PKCE 仅 `S256`；ID token 签名 `RS256`；token 端点认证支持 `client_secret_basic`/`client_secret_post`/`none`；scope 含 `openid`/`profile`/`email`/`offline_access`；响应模式仅 `query` | [discovery 文档](https://auth.openai.com/.well-known/openid-configuration)（公开端点实测） |
| 2 | discovery 中**没有 `registration_endpoint`**，也无 `end_session_endpoint`——不存在动态客户端注册 | 同上 |
| 3 | 官方 Release Notes（2026-07-23 条目）："We're beginning to roll out Sign in with ChatGPT across **select plugins and partner sites**, starting with Airtable, GitLab, HubSpot, Notion, Supabase, and Vercel"，登录时仅向对方共享姓名/邮箱/头像 | [ChatGPT Release Notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) |
| 4 | 曾有的开发者意向表单 `https://openai.com/form/sign-in-with-chatgpt/` 现在 **404**（下线或关闭） | 实测（2026-09-13） |
| 5 | 面向身份的 Sign in with ChatGPT 目前以 **Codex Sites 平台功能**形态提供：平台托管路径 `/signin-with-chatgpt`、`/signout-with-chatgpt`，登录后通过请求头 `oai-authenticated-user-email` / `oai-authenticated-user-full-name` 转发身份；无 client 注册、无 redirect URI 配置、无 ID token 校验环节，全部由平台托管 | [Codex Sites 文档](https://developers.openai.com/codex/sites)（`.md` 版实测） |
| 6 | Codex 体系内的 Sign in with ChatGPT 是 **OpenAI 第一方客户端**（Codex 桌面端/CLI/IDE）的订阅登录方式，localhost 回调，不属于对第三方开放的程序 | [Codex Authentication 文档](https://developers.openai.com/codex/auth) |

## 2. 文档未说明 / 项目尚未取得权限

**文档未说明**（公开渠道找不到对应说明，按 2026-09-13 核查）：

- 独立第三方网站自助注册 OAuth client 的入口、准入条件或审核流程；
- 第三方 client 的 redirect URI 匹配规则（localhost/HTTPS/preview 域名限制）；
- 第三方场景下稳定用户标识（`sub`）的作用域与长期语义；
- 费用、配额、审核或账号限制。

**项目尚未取得权限**：

- FluxLedger 没有、也暂无法申请属于自己的 client_id；
- 不能复用 Codex 产品或社区 SDK 内置的 client_id（如 `openai-oauth` SDK 默认硬编码的 `app_EMoamEEZ73f0CkXaXp7hrann`）——那是其他产品的凭据，且其定位是"用 ChatGPT 账号跑 AI"，不是身份登录。

**关键区分**：`auth.openai.com` 端点存在 ≠ FluxLedger 已获准作为第三方身份登录接入；Codex Sites 支持登录 ≠ 任意 Cloudflare Pages 网站可以接入。

## 3. 阻塞原因与解除条件

**阻塞原因**：身份登录所需的"属于 FluxLedger 的 OAuth client"无法按官方流程取得——意向表单已下线（事实 4），官方文档只呈现合作伙伴分批开放（事实 3）与平台内建能力（事实 5），无任何公开的自助注册路径。

**解除条件（满足任一即可重启）**：

1. OpenAI 恢复/开放面向第三方开发者的注册入口，并发布客户端契约文档（redirect URI 规则、client 认证方式、`sub` 语义、费用）；
2. FluxLedger 收到 OpenAI 的 waitlist/partner 准入通知；
3. 维护者决定改走 Codex Sites 平台登录（需接受托管平台迁移，与既定 Cloudflare 形态冲突，属架构级决策）。

## 4. 备选 OIDC 提供商对比（仅分析，未实施）

| 维度 | Google Identity Services（Sign in with Google） | GitHub OAuth Apps | Auth0（Okta） |
| --- | --- | --- | --- |
| 接入要求 | Google Cloud 项目 + OAuth consent screen + 自助创建 OAuth client；完整 OIDC，支持 PKCE、`sub` 稳定标识 | 在 GitHub Developer settings 自助注册 OAuth App，配置回调 URL 即得 client id/secret；无标准 OIDC 发现文档，身份经 `/user` API 获取（非 ID token） | 注册即得租户；托管登录页 + 完整 OIDC；redirect URI 自助配置 |
| 当前免费额度与收费 | 登录本身免费（[官方文档](https://developers.google.com/identity/openid-connect/openid-connect)未列收费项；配额面向 API 调用而非登录数） | 免费（[官方文档](https://docs.github.com/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)明确可免费创建注册） | [官方定价页](https://auth0.com/pricing)（2026-09-13 核实）：Free 档 25,000 MAU / $0；B2C Essentials 起 $35/月（500 MAU）、Professional 起 $240/月，按 MAU 阶梯计费 |
| 实现成本 | 低：标准 OIDC 授权码 + PKCE，与本次预研的端点/会话设计完全兼容 | 低：授权码流程 + 一次 API 调用取身份；无标准 ID token，`sub` 需用 `user.id` 字段自建映射 | 最低：把 OIDC 细节外包给 Auth0，但引入外部依赖与账户体系 |
| 维护成本 | 低（Google 托管登录页与轮换） | 低（回调配置极少变动）；用户群与代码仓库同生态（GitHub） | 中：依赖第三方 SaaS 的策略与价格变动 |
| 隐私影响 | 共享 Google 账号 profile（name/email/picture，scope 可控） | 共享 GitHub 身份（scope 可控至 `read:user`）；开发者用户接受度高 | 身份数据经 Auth0 处理与存储（境外 SaaS），合规面最大 |

> 说明：上表价格为 2026-09-13 从各官方来源核实，仅代表当日数据。

## 5. 保留 ChatGPT 登录方案的后续动作

1. 定期复查 [ChatGPT Release Notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) 与 `https://openai.com/form/sign-in-with-chatgpt/`（是否恢复上线）；
2. 若等待名单重新开放：以 FluxLedger 名义提交申请（需要维护者本人的 OpenAI/ChatGPT 账号操作），登记回调 `https://<preview-host>/auth/callback` 与生产回调；
3. 本调查预研的端点与契约（discovery 实测数据见 §1.1）在获得 client 后可直接复用，`functions/auth/*` 设计不受影响；
4. 维护者决策前，备选方案仅停留在本对比，不实施。
