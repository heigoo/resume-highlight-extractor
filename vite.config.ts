/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // GitHub Pages 项目站点挂在子路径下；本地开发与 e2e 不受影响（不设该环境变量）
  base: process.env.GITHUB_PAGES ? '/resume-highlight-extractor/' : '/',
  test: {
    // 单测只跑 tests/unit，E2E 交给 Playwright（npm run test:e2e）
    include: ['tests/unit/**/*.spec.ts'],
  },
})
