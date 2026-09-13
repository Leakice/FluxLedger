import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "./chatgpt-auth";

// 身份随请求头变化，必须按请求动态渲染。
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 font-sans text-zinc-900">
      <h1 className="text-2xl font-semibold">FluxLedger · Sites 登录与 D1 最小验证</h1>

      {user ? (
        <section className="mt-8 space-y-3">
          <h2 className="text-lg font-medium">已登录</h2>
          <p className="text-sm text-zinc-700">
            服务端读取的平台身份（认证头不回传浏览器）：
          </p>
          <ul className="space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
            <li>
              user id：<code className="rounded bg-zinc-200 px-1">{user.userId}</code>
              <span className="ml-2 text-xs text-zinc-500">（同一用户在同一 Site 内稳定，跨 Site 不同）</span>
            </li>
            <li>
              email：<code className="rounded bg-zinc-200 px-1">{user.email}</code>
            </li>
            <li>显示名：{user.displayName}</li>
          </ul>
          <div className="flex flex-wrap gap-3 text-sm">
            <a className="rounded-lg border border-zinc-300 px-3 py-2" href="/api/whoami">
              GET /api/whoami
            </a>
            <a className="rounded-lg border border-zinc-300 px-3 py-2" href="/api/d1-test">
              GET /api/d1-test（读取本人记录）
            </a>
            <a
              className="rounded-lg border border-zinc-300 px-3 py-2"
              href={chatGPTSignOutPath("/")}
            >
              退出登录（恢复游客）
            </a>
          </div>
          <p className="text-xs text-zinc-500">
            写入测试记录：<code>POST /api/d1-test</code>（可用任意 HTTP 工具，正文 {"{"}&quot;note&quot;: &quot;…&quot;{"}"}）。
          </p>
        </section>
      ) : (
        <section className="mt-8 space-y-3">
          <h2 className="text-lg font-medium">游客模式（匿名访问正常）</h2>
          <p className="text-sm text-zinc-700">
            当前未登录。游客本地记账不受影响；登录由 Sites 平台托管的
            <code className="mx-1 rounded bg-zinc-200 px-1">/signin-with-chatgpt</code>
            路由处理，本应用不实现登录回调。
          </p>
          {/* SIWC 必须以顶层导航发起：不用 fetch/客户端路由预取 */}
          <a
            className="inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white"
            href={chatGPTSignInPath("/")}
            target="_top"
          >
            使用 ChatGPT 登录
          </a>
        </section>
      )}

      <footer className="mt-12 border-t border-zinc-200 pt-4 text-xs text-zinc-500">
        <p>登录/退出路由由 Sites 平台拥有（/signin-with-chatgpt、/signout-with-chatgpt、/callback）。</p>
        <p>本站点仅用于最小验证：测试数据与隔离环境，不承载真实账单。</p>
      </footer>
    </main>
  );
}
