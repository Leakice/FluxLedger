# FluxLedger 本地记账

Vue 3 + Vite 构建的本地记账面板。

## 启动

首次运行 `npm install`，然后运行 `npm run dev`，打开 http://127.0.0.1:4173 。

`npm run build` 生成生产构建，`npm run preview` 预览构建。

## 功能

- 桑基资金流、分类图、月度余额与收支报表。
- 时间、银行卡、分类筛选。
- 交易新增、搜索、删除与撤销、完整历史、CSV 导出。
- 并列的 EN/ZH 与日夜模式切换，自动记忆设置。
- 浏览器 localStorage 保存数据，无后端，无运行时外部资源。

初始数据为演示账目，默认月份 2026 年 9 月。货币沿用参考图的美元。清除网站数据会清除保存记录，可以先导出 CSV。

## 结构

- src/App.vue：Vue 响应式状态和页面组件。
- src/charts.js：SVG 资金流。
- src/locales.js：翻译词典。
- src/seed.js：演示交易。
- style.css：主题与响应式布局。
