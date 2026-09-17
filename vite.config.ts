/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  test: {
    // 单测只跑 tests/unit，E2E 交给 Playwright（npm run test:e2e）
    include: ['tests/unit/**/*.spec.ts'],
  },
})
