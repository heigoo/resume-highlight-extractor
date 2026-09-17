import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'zh-CN',
    colorScheme: 'light',
    viewport: { width: 1280, height: 900 },
    // 外网字体在 E2E 环境可能解析超时，拖住 load 事件造成 goto 假失败：
    // 解析到本机让它立即失败（测试不依赖 Web 字体，走系统字体回退）
    launchOptions: {
      args: ['--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1,MAP fonts.gstatic.com 127.0.0.1'],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
