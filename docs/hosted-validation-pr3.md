# PR3 托管验证交接清单（T3.5）

日期：2026-09-13 · 分支：feat/cloud-pr3-cloud-ledger · 对应 Issue：#57–#61

按 [hosted-validation-d2.md](hosted-validation-d2.md) 的分工方式：**浏览器操作由维护者执行，
脚本对比由工具执行**；本文件列步骤与判定标准，执行后请把结果与脱敏输出补进本文（格式参考 d2 记录）。
所有验证只用造出来的数据（探针标记），不承载真实账单；输出不得包含真实 user id 原文、Cookie、token。

## 0. 部署

1. 合并本 PR 后在 Sites 平台以新源码发布测试站（沿用 d2 的站点创建/发布方式）。
2. 构建产物自带 `dist/.openai/hosting.json`（`{"d1":"DB"}`）与 `dist/.openai/drizzle/0000_*.sql`
   （`ledger_documents` 表）；d2 已验证平台会在发布时创建绑定并应用 drizzle 迁移。
   发布后先执行下面第 1 步确认表可用。
3. 若平台迁移未自动生效（写账本 500），用平台数据库通道手工执行
   `drizzle/0000_tense_meggan.sql`（与 `migrations/0002_ledger_documents.sql` 等价）后再试。

## 1. 游客（未登录）回归

| # | 步骤 | 判定 |
| --- | --- | --- |
| 1.1 | 未登录打开测试站 | 首页/记账/报表正常（本地模式），页头出现「Sign in with ChatGPT」链接与本地 QY 头像 |
| 1.2 | 控制台执行 `Object.keys(localStorage)` 后记一笔账、刷新 | 交易落在原 key（`cascade-transactions-v1` 等），无任何 `cloud-cache-` 键；刷新后仍在 |
| 1.3 | 控制台：`await fetch('/api/whoami').then(r=>r.status)` 与 `await fetch('/api/ledger',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({data:{transactions:[],cards:[],hiddenBuiltInCardIds:[]},baseVersion:0})}).then(r=>r.status)` | 两者均 401（JSON，非重定向） |

## 2. 登录模式（账号 A）

| # | 步骤 | 判定 |
| --- | --- | --- |
| 2.1 | 顶层导航点击登录（ChatGPT SIWC）→ 返回站点 | 页头出现云端账户菜单（user id 掩码），登录前那批游客原 key 数据不再出现在界面（账户隔离命名空间生效，本地原 key 数据原样保留） |
| 2.2 | 新增一条交易（说明填标记串如 `pr3-manual-A-<日期>`）、编辑、删除各一次 | 操作即时生效；Network 面板在 ~1.2s 防抖后出现 `PUT /api/ledger` 200 |
| 2.3 | 刷新页面 | 刚才的交易仍在（`GET /api/ledger` 与界面一致）；localStorage 出现 `cloud-cache-<hash>-cascade-transactions-v1` 等三个键 |
| 2.4 | 控制台执行 [scripts/hosted-isolation-pr3.mjs](../scripts/hosted-isolation-pr3.mjs) 全文，然后 `await pr3WriteMark('A')` | 返回 `pass:true`（含脱敏 userIdMask、baseVersion/newVersion、myMark） |

## 3. 隔离（账号 A/B 互不可见互不可改）

1. 退出 A（账户菜单 → Sign out）→ 登录账号 B → 控制台重新粘贴脚本 → `await pr3WriteMark('B')` → 记下返回的 `myMark`。
2. 回到账号 A（重新粘贴脚本）→ `await pr3CheckIsolation('A','B')` → 判定 `pass:true`
   （ownMarkVisible=true 且 otherMarkVisible=false）。
3. 在 B 下执行 `await pr3CheckIsolation('B','A')` 做反向检查 → `pass:true`。
4. 附加确认：A/B 的界面交易列表互不出现对方的标记交易（GET 结果断言以脚本输出为准）。

## 4. 409 冲突（两个会话同 baseVersion）

1. 浏览器 1 与浏览器 2（或普通/无痕窗口）分别登录**同一**账号 A，都停在首页。
2. 浏览器 1 新增一笔交易，等 PUT 200 完成（Network 面板确认）。
3. 浏览器 2（尚未刷新，本地 baseVersion 已过期）新增另一笔交易，等待其 PUT。
4. 判定：浏览器 2 的 PUT 返回 **409**；界面出现冲突 toast（「同步冲突——已重新加载云端数据…」）；
   缓存被云端版本覆盖但**页面内存中的修改不丢失**（本 PR 语义：用户再次修改即以最新状态重新保存）；
   云端数据未被静默覆盖（D1 里只有浏览器 1 的那笔 + 浏览器 2 刷新后的状态）。

## 5. 断网失败反馈

1. 登录态下 DevTools → Network → Offline。
2. 修改（增/删一笔交易）→ 界面即时更新（写本地缓存），约 1.2s 后出现「Save failed / 保存失败」toast。
3. 恢复网络（Offline 取消）→ 数据仍显示（缓存）；**不刷新**的前提下再修改一次 → PUT 200，全部变更落云。
4. 直接刷新页面：界面回到云端当前版本（本 PR 无重试队列，未同步成功的修改以云端为准——PR4 重试队列解决）。

## 6. 重部署持久化

1. 记录当前 A/B 各自的探针标记（第 3 节输出里的 myMark）。
2. 在 Sites 平台重新发布同一源码（触发重部署）。
3. 登录 A → `await pr3CheckIsolation('A','B')` → `pass:true`（记录仍在）；B 同理。
4. 可选：平台数据库通道只读查询 `SELECT user_id, version, updated_at FROM ledger_documents`（不要导出 data 原文进记录）。

## 7. 伪造认证头（不采信客户端身份）

1. 登录 A 的页面上，控制台执行：
   `await fetch('/api/ledger',{method:'PUT',headers:{'content-type':'application/json','oai-authenticated-user-id':'forged-user','oai-authenticated-user-email':'forged@test.invalid'},body:JSON.stringify({data:{transactions:[],cards:[],hiddenBuiltInCardIds:[]},baseVersion:9999})}).then(r=>r.json())`
2. 判定：返回 409 且 `currentVersion` 等于 A 自己的真实版本（写入定位到 A 的真实行——服务端只用平台注入的身份头，伪造头不产生新归属）。whoami 不受影响。
3. 匿名（无会话）带同样伪造头请求 → 401。**边界注记（沿用 d2）**：匿名 401 可能来自平台访问控制层而非应用层；
   本应用层只声明「以平台注入头为准」，不据此宣称所有入口均经应用校验。

## 8. 结果回填

把每步结果按 d2 格式补全为表格（验证项/结果/证据来源与范围），并注明：
本次未自动合并 PR、未关闭 Issue；托管验证全部通过后由维护者关闭 #57–#61。
