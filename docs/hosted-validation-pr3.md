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
4. 判定：浏览器 2 的 PUT 返回 **409**；随后自动 GET 云端版本，界面出现冲突 toast
   （「同步冲突——已重新加载云端数据；您未同步的修改已保留为本地备份，可恢复」），
   **工作副本（内存与缓存）重载为云端状态**：浏览器 1 的交易出现在浏览器 2 界面上，
   云端数据不被静默覆盖。
5. **恢复入口（两条）**：冲突 toast 上的「恢复我的修改」按钮（约 4 秒内）；
   或「数据管理 → 恢复未同步副本」（持久入口）。冲突备份为**多份列表**（上限 5 份；
   达到上限后保留现有全部备份与当前草稿并明确提示，**绝不自动淘汰**——每份都是
   尚未被用户处理的副本）：连续多次冲突时每次的未同步副本都独立保留，恢复自最新
   一份起逐份进行，恢复后腾出空间可继续备份。恢复以云端当前版本为基上传（恢复是用户显式选择，将按最新状态覆盖云端）。
6. 附加保护（单测锁定，托管可抽查）：
   - 草稿携带基版本：带草稿刷新后以**原基版本**上传，云端已前进则 409 走上述冲突保护，
     绝不把旧草稿 rebase 到最新版本覆盖另一设备的数据；
   - 冲突解决顺序不可变：取云端（不落盘）→ 备份本页**完整三键文档**（写成功并读回
     校验）→ 才用云端覆盖。备份失败（配额不足或达到上限）时草稿原样保留、绝不覆盖，
     且未知基草稿的保护在下一次重试时继续保持；
   - **完整草稿快照**：首次编辑即把与基版本对应的完整三键文档快照进本页草稿，
     草稿生命周期内的读取不与其他标签页推进的共享基础拼接——另一标签页删除账户后，
     本页的未保存修改与后续冲突备份仍包含该账户；
   - 保存前后经 `/api/whoami` 核对身份，且 PUT 携带 `expectedUserId`、GET 响应携带
     `userId` 回显，均在同一请求内核对——旧标签页在账号切换后无法读写另一账号的数据；
   - **同账户多标签页**：未保存草稿与冲突备份按标签页隔离（sessionStorage），一个
     标签页的同步不破坏另一标签页的未保存修改（各自的草稿按原基上传、由乐观锁仲裁）；
   - 身份无法核实（网络失败重试后仍失败）时拒绝写入（fail closed），草稿保留。

## 5. 断网失败反馈与草稿保护

1. 登录态下 DevTools → Network → Offline。
2. 修改（增/删一笔交易）→ 界面即时更新（写本地缓存并标记草稿），约 1.2s 后出现「Save failed / 保存失败」toast。
3. **保持断网刷新页面**：草稿保留（修改仍在界面，启动 GET 不覆盖工作副本，无演示数据回落）。
4. 恢复网络（Offline 取消）→ **再次修改** → PUT 200，全部变更落云（第一版无重试队列：
   草稿由下一次显式修改或退出前的同步补传，不做后台自动重试）。
5. 带草稿直接点退出：先尝试同步；失败则保留该账户命名空间缓存（云端数据不动），不静默丢弃未保存内容。
6. 空云端账号（首次登录）：界面为空账本，**不出现演示数据**；首次修改上传的只有用户自己的记录。

## 5-B. 登录态功能边界

- 云端账户下「数据管理」仅提供导出：导入按钮隐藏并显示说明（本机数据导入在 PR4 重新设计）。
- 游客模式导入/导出行为不变。

## 6. 重部署持久化

1. 记录当前 A/B 各自的探针标记（第 3 节输出里的 myMark）。
2. 在 Sites 平台重新发布同一源码（触发重部署）。
3. 登录 A → `await pr3CheckIsolation('A','B')` → `pass:true`（记录仍在）；B 同理。
4. 可选：平台数据库通道只读查询 `SELECT user_id, version, updated_at FROM ledger_documents`（不要导出 data 原文进记录）。

## 7. 伪造认证头（不采信客户端身份）

1. 登录 A 的页面上，控制台执行：
   `await fetch('/api/ledger',{method:'PUT',headers:{'content-type':'application/json','oai-authenticated-user-id':'forged-user','oai-authenticated-user-email':'forged@test.invalid'},body:JSON.stringify({data:{transactions:[],cards:[],hiddenBuiltInCardIds:[]},baseVersion:9999,expectedUserId:'forged-user'})}).then(r=>r.json())`
2. 判定：返回 **403 identity mismatch**——伪造的 `expectedUserId` 与平台认证身份不一致，
   服务端在同一请求内拒绝写入（归属只取认证头，`expectedUserId` 仅做一致性检查）。
   `expectedUserId` 缺失或非字符串 → 400；whoami 不受伪造头影响。
3. 匿名（无会话）带同样伪造头请求 → 401。**边界注记（沿用 d2）**：匿名 401 可能来自平台访问控制层而非应用层；
   本应用层只声明「以平台注入头为准」，不据此宣称所有入口均经应用校验。
4. GET 响应带 `userId` 回显（同请求认证身份）：客户端核对数据出处与当前会话一致才落缓存，
   两请求窗口内的账号切换不会把另一账号的数据装入当前缓存（单测锁定）。

## 8. 结果回填

把每步结果按 d2 格式补全为表格（验证项/结果/证据来源与范围），并注明：
本次未自动合并 PR、未关闭 Issue；托管验证全部通过后由维护者关闭 #57–#61。
