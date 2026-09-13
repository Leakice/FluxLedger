# D2 托管验证执行记录

日期：2026-09-13
源实现：eb5d359
测试站：https://fluxledger-d2-verify.leakice.chatgpt.site
Site：appgprj_6aa687564fd08191acb123c750baad15
发布源码：870261e9e773305a423a667a7499363855a34ea9
版本：appgprj_6aa687564fd08191acb123c750baad15~appgver_ab70c32d95988191a92f0bf2fa19a3a6
首次部署：appgdep_6aa6889faa9c8191b464f473d4331dd9（succeeded）
重部署：appgdep_6aa68a7a87548191bb33eb3da5f00924（succeeded）

## 最终结论

四项托管验证在本次测试范围内通过。D2 的托管可行性门槛已满足，可以进入 PR2 数据访问层开发；这不等于正式账本功能已实现或已批准生产上线。

| 验证项 | 结果 | 证据来源与范围 |
| --- | --- | --- |
| 真实 ChatGPT 登录与身份头注入 | 通过 | 用户提供已登录页面截图及浏览器脚本 JSON：whoami=200、realIdentityPresent=true、no-store；未使用模拟身份或绕过令牌 |
| 双账号数据隔离 | 通过（用户实测确认） | 使用全新 d2-isolation-round2- 标记，真实账号 A→B→A 执行；用户确认全部符合预期：ownRecordVisible=true、otherRecordVisible=false。最终三次原始 JSON 未另行回传，不记为代理自动复现 |
| 托管重部署后持久化 | 通过 | 代理重部署前后通过平台只读查询确认同一记录完整保留；用户随后以仅 GET 脚本确认 accountARecordStillPresent=true，无补写 |
| 伪造认证头防冒充 | 通过（已测请求） | 代理无 Cookie 伪造身份头请求=401；用户登录状态下伪造请求=200 且 forgedIdentityUnchanged=true。匿名401可能来自平台访问控制层，不据此宣称所有入口均经过应用层校验 |

## 账号 A 原始脱敏结果

accountLabel=A；whoamiStatus=200；realIdentityPresent=true；cacheControl=no-store；writeStatus=201；ownRecordVisible=true；otherRecordVisible=false；allReturnedRecordsOwned=true；forgedStatus=200；forgedIdentityUnchanged=true。

## 持久化证据

Sites 实际创建 DB 绑定及 verify_records 表。
重部署前存在 id=1、note=d2-hosted-20260913-A、created_at=2026-09-13 11:34:28。
同一已保存版本重部署成功后，平台只读查询的完整行（含归属键、id、note、created_at）与部署前一致。真实归属键不保存到报告。
随后用户确认 HTTP 只读复查符合预期。原 hosted-check.js 具有自动补写行为，未用其替代这次持久化只读验证。

## 双账号测试纠正记录

第二账号首次执行时仍使用 accountLabel=A，产生相同文本标记；这不是身份归属键，也不能据此判断串号。
最终采用新前缀 d2-isolation-round2-，依次以账号 A、B、A 执行，标签分别为 A、B、A。用户最终回复“全部执行，符合预期”。以这轮结果作为隔离验收证据，旧标记不参与判断。

## 访问与证据边界

测试站由代理创建时为仅所有者访问，代理未修改测试站受众或正式 FluxLedger 站点。后续双账号访问由用户自行完成，本记录不推断最终访问策略。
真实浏览器操作由用户执行；代理浏览器运行时启动失败，未自动复现登录。平台部署与数据库只读比较由代理工具执行。
本文件不包含真实邮箱、userId、Cookie、授权码、token、密码或验证码。
本次仅更新本地证据记录，未自动合并 PR 或关闭 Issue。