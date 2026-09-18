# develop 环境部署文档

> **⚠️ 状态注记（2026-09-13，PR3 起）**：主工程构建形态已切换为 Sites 运行时
> （vinext Worker，见 [sites-runtime-integration.md](sites-runtime-integration.md)）：
> `npm run build` 产物为 `dist/client` + `dist/server` + `dist/.openai`（无单页
> `index.html`），`npm run preview` 已由 `npm run start`（wrangler 本地预览）取代。
> 本文描述的「纯静态目录 + SPA fallback」部署形态自 PR3 起不再适用；develop 环境
> 的托管迁移（或恢复纯 SPA 出口）待维护者决策。npm test 与游客本地模式行为不受影响。

本文用于将 FluxLedger 部署到 `develop` 环境。项目是纯前端 Vue 3 + Vite 应用，不需要后端服务或数据库。

## 部署前提

- Node.js `20.19.0` 及以上的 20.x 版本，或 `22.12.0` 及以上版本（与 Vite 8 的运行时要求一致）。可在执行安装前通过 `node --version` 确认。
- 已安装 npm。
- 部署机可以访问项目 Git 仓库和 npm registry。
- 静态服务器支持将前端路由回退到 `index.html`。

## 标准部署流程

在部署机执行：

```bash
git fetch origin
git checkout develop
git pull --ff-only origin develop

npm ci
npm test
npm run build
```

构建成功后，将项目根目录下的 `dist/` 目录发布到 develop 环境的静态资源目录。`dist/` 是构建产物，不应提交到 Git。

## 静态服务器配置

静态服务器的站点根目录应指向 `dist/`，并配置未知路径回退到 `index.html`。以 Nginx 为例：

```nginx
server {
    listen 80;
    server_name develop.example.com;

    root /srv/fluxledger/develop/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

如果使用 CDN 或对象存储，也需要开启同等的 SPA fallback；否则直接访问非首页路径时可能返回 404。

## 本地验证构建产物

部署前可以在部署机上启动 Vite 预览服务：

```bash
npm run preview
```

默认仅监听 `127.0.0.1:4173`，因此需要在部署机本机访问，或先建立 SSH 端口转发。如果确实需要从受信任的内网远程验证，可显式运行 `npm run preview -- --host 0.0.0.0`，并在验证后立即停止预览服务。确认页面加载、语言和主题切换、交易编辑以及数据导入导出正常后，再切换静态服务器到新的 `dist/` 目录。

## 发布检查清单

- `npm ci`、`npm test` 和 `npm run build` 均成功。
- 页面可以正常加载，浏览器控制台没有资源 404 或 JavaScript 错误。
- 直接刷新页面和访问非首页路径不会返回 404。
- 新增、编辑、删除、撤销交易，以及 JSON 导入导出功能正常。
- 确认 `dist/` 中未包含密钥、`.env` 文件或其他敏感信息。
- 确认静态资源缓存策略已更新；若使用 CDN，必要时执行缓存刷新。

## 数据说明

应用数据保存在当前浏览器的 `localStorage` 中，没有服务端持久化。不同浏览器、设备或域名之间不会自动共享数据；清理站点数据会删除本地记录。升级或切换环境前，应通过页面中的“数据管理”功能导出 JSON 备份。

## 回滚

保留上一个可用版本的 `dist/` 目录。发生异常时，将静态服务器根目录切回该目录并刷新 CDN 缓存，然后记录故障版本和回滚原因。
