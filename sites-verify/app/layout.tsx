import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FluxLedger · Sites 登录与 D1 最小验证",
  description: "Sites 平台登录与 D1 持久化的最小验证站点（测试数据与隔离环境）。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
