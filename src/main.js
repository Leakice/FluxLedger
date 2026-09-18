import { createApp } from 'vue';
import App from './App.vue';
import { bootstrapCloud } from './storage/cloud.js';
import '../style.css';

// 登录态检测与云端注水（whoami → GET /api/ledger → 命名空间缓存）先于首次挂载，
// 保证 App.vue 读到的第一笔数据就是当前账户的数据；失败收敛为游客模式，不阻塞挂载。
bootstrapCloud().finally(() => {
  createApp(App).mount('#app');
});

import './responsive.css';

import './reports.css';
