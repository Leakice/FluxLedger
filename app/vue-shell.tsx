"use client";

import { useEffect } from "react";

// React 仅提供挂载壳：现有 Vue bundle（src/main.js）作为客户端资源加载，
// #app 内的一切由 Vue 渲染。React 不再触碰该容器的子节点。
export default function VueShell() {
  useEffect(() => {
    let cancelled = false;
    import("../src/main.js").catch((error) => {
      if (!cancelled) console.error("fluxledger vue bundle failed to load", error);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return <div id="app" />;
}
