import type { Metadata } from "next";

// 壳层只负责 <html>/<body> 与站点元信息；全部界面由 Vue bundle 在客户端渲染。
export const metadata: Metadata = {
  title: "FluxLedger — In tune with every money movement.",
  description: "FluxLedger — In tune with every money movement.",
  icons: {
    icon: "/assets/sankey-diagram-alt-svgrepo-com.svg",
    shortcut: "/assets/sankey-diagram-alt-svgrepo-com.svg",
  },
  other: {
    "theme-color": "#f0f3f3",
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
