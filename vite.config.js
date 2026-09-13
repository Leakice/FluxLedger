import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vinext from 'vinext';

export default defineConfig(async () => {
  // 与 sites-verify 相同的工具默认值：本地 Miniflare 元数据占位、wrangler 状态留在仓库内。
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
  process.env.WRANGLER_SEND_METRICS ??= 'false';
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.WRANGLER_REGISTRY_PATH ??= '.wrangler/dev-registry';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  const { cloudflare } = await import('@cloudflare/vite-plugin');
  const { sites } = await import('./build/sites-vite-plugin.ts');

  return {
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    plugins: [
      vinext(),
      vue(),
      sites({ mockAuth: true }),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        inspectorPort: false,
        // 显式指向 Sites Worker 专用配置；缺省会自动发现根 wrangler.toml（PR1 Pages
        // 历史配置），其同名 DB 绑定会污染 dist 产物或与之重复。
        configPath: 'wrangler.worker.jsonc',
      }),
    ],
  };
});

