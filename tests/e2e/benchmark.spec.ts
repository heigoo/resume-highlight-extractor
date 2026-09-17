import { expect, test } from '@playwright/test'
import { MOCK_RECORDS, mockAi, seedSettings } from './mock'

const RECORDS_PLACEHOLDER = '把 git 提交日志'

// 代理指标基准：核心任务 = 粘贴记录 → 一键提炼 → 复制导出。
// 记录端到端耗时与交互动作数（3 次输入动作），作为体验优化的回归基准。
test('核心任务基准：粘贴→提炼→复制', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  const startedAt = Date.now()

  await page.goto('/')
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS) // 动作 1
  await page.getByRole('button', { name: /一键提炼/ }).click() // 动作 2
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()
  await page.getByRole('button', { name: '一键复制' }).click() // 动作 3
  await expect(page.getByText(/已复制到剪贴板/)).toBeVisible()

  const elapsed = Date.now() - startedAt
  // 交互动作 3 次（含 mock 即时响应）；页面渲染+断言余量留足
  console.log(`[benchmark] 核心任务端到端 ${elapsed}ms / 交互动作 3 次`)
  expect(elapsed).toBeLessThan(20_000)
})

test('首访引导：三步指引 + 一键示例 + 只出现一次', async ({ page }) => {
  await page.goto('/')

  const guide = page.getByRole('note', { name: '新手上手引导' })
  await expect(guide).toBeVisible()

  // 一键示例：记录区立即有内容，引导关闭
  await page.getByRole('button', { name: '填入示例试一试' }).click()
  await expect(page.getByPlaceholder(RECORDS_PLACEHOLDER)).not.toHaveValue('')
  await expect(guide).toBeHidden()

  // 刷新后不再出现
  await page.reload()
  await expect(page.getByRole('note', { name: '新手上手引导' })).toBeHidden()
})

test('失败反馈：错误条 + 一键重试成功', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { status: 401 })
  await page.goto('/')
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)
  await page.getByRole('button', { name: /一键提炼/ }).click()

  const errorBox = page.getByRole('alert')
  await expect(errorBox).toContainText('密钥（Key）不正确')
  await expect(errorBox.getByRole('button', { name: /重试提炼/ })).toBeVisible()

  // 修复上游后重试（重新注册无错误的路由，LIFO 生效）
  await mockAi(page)
  await errorBox.getByRole('button', { name: /重试提炼/ }).click()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()
  await expect(page.getByRole('alert')).toBeHidden()
})

test('流式实时预览：等待期有即时反馈，完成后实时内容落位', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { delayMs: 2500 })
  await page.goto('/')
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)
  await page.getByRole('button', { name: /一键提炼/ }).click()

  // 等待期：结果区即时显示提炼中状态（消除空白盲等），确定性无竞态
  await expect(page.getByText('正在提炼，生成内容将实时出现在这里…')).toBeVisible()

  // 完成后：实时内容落位为正式结果，等待态消失
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('heading', { name: /新增能力|优化提升|问题修复/ }).first()).toBeVisible()
  await expect(page.getByText('正在提炼，生成内容将实时出现在这里…')).toBeHidden()
})
