import { expect, test } from '@playwright/test'
import {
  MOCK_JD,
  MOCK_RECORDS,
  mockAi,
  seedSettings,
} from './mock'

const RECORDS_PLACEHOLDER = '把 git 提交日志'
const JD_PLACEHOLDER = '把目标岗位的 JD'

async function fillRecords(page: import('@playwright/test').Page): Promise<void> {
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)
}

test('流式提炼：结果分组、出处芯片与无出处待补标记', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await fillRecords(page)
  await page.getByRole('button', { name: /一键提炼/ }).click()

  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '新增能力' })).toBeVisible()

  // 出处芯片：点击展开原始记录引用
  const sourceChip = page.getByRole('button', { name: /源 08 · 10/ })
  await expect(sourceChip).toBeVisible()
  await sourceChip.click()
  await expect(page.getByText('7d21e08 feat(upload): 大文件分片上传，失败自动重试')).toBeVisible()

  // 无出处的条目被强制标记【待补】（核查清单里也会聚合展示，取结果区第一个）
  await expect(page.getByText('【待补：无原始记录依据】').first()).toBeVisible()

  // 完成提示
  await expect(page.getByText(/提炼完成/)).toBeVisible()
})

test('未配置 AI：单一路径引导完成连接设置', async ({ page }) => {
  await page.goto('/')
  // 首访引导直接给出「配置 AI 连接」入口，不必先撞一次失败
  await expect(page.getByRole('button', { name: '配置 AI 连接' })).toBeVisible()
  await fillRecords(page)
  await page.getByRole('button', { name: /一键提炼/ }).click()

  await expect(page.getByText(/先完成 AI 连接设置/).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '连接 AI 设置' })).toBeVisible()
})

test('Key 无效：提示 401 错误', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { status: 401 })
  await page.goto('/')
  await fillRecords(page)
  await page.getByRole('button', { name: /一键提炼/ }).click()

  // 错误同时出现在 toast 与按钮下方错误条（role=alert），断言错误条
  await expect(page.getByRole('alert')).toContainText('密钥（Key）不正确')
})

test('提炼中点击停止：中断并提示', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { delayMs: 5000 })
  await page.goto('/')
  await fillRecords(page)
  await page.getByRole('button', { name: /一键提炼/ }).click()

  const stopButton = page.getByRole('button', { name: /提炼中/ })
  await expect(stopButton).toBeVisible()
  await stopButton.click()
  await expect(page.getByText('已停止本次提炼')).toBeVisible()
})

test('JD 对标：关键词芯片、命中统计与高亮', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await fillRecords(page)
  // JD 面板默认收起：第一个「展开」按钮即 JD 面板（先于左栏「备用」区与版本库）
  await page.getByRole('button', { name: '展开' }).first().click()
  await page.getByPlaceholder(JD_PLACEHOLDER).fill(MOCK_JD)

  // 关键词芯片即时可见（纯本地提取）
  await expect(page.getByText('性能优化', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /一键提炼/ }).click()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()
  await expect(page.getByText(/JD 对标命中/)).toBeVisible()
  await expect(page.locator('mark.mark-hit').first()).toBeVisible()
})

test('导出：下载 .md 与 Word 文件', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await fillRecords(page)
  await page.getByRole('button', { name: /一键提炼/ }).click()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()

  const mdDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 .md' }).click()
  expect((await mdDownload).suggestedFilename()).toMatch(/^简历亮点-.+\.md$/)

  const docxDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 Word' }).click()
  expect((await docxDownload).suggestedFilename()).toMatch(/^简历亮点-.+\.docx$/)
})

test('手动粘贴路径：备用区回填示例、格式化后保留出处', async ({ page }) => {
  await page.goto('/')
  // 原始记录示例（左栏「原始记录」区）
  await page.getByRole('button', { name: '填入示例' }).first().click()
  // AI 结果示例（左栏「备用」区）：点击即展开备用区并填入
  await page.getByRole('button', { name: '填入示例结果' }).click()
  // 等示例内容真正写入再格式化，避免竞态
  await expect(page.getByPlaceholder('把 AI 回答的内容整段粘到这里')).toHaveValue(/新增能力/)
  await page.getByRole('button', { name: '格式化并检查' }).click()

  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()
  const sourceChip = page.getByRole('button', { name: /源 08 · 12/ })
  await expect(sourceChip).toBeVisible()
  await sourceChip.click()
  await expect(page.getByText('7d21e08 feat(upload): 大文件分片上传，失败自动重试')).toBeVisible()
})

test('提炼进行中：结果区也能一键停止', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { delayMs: 5000 })
  await page.goto('/')
  await fillRecords(page)
  await page.getByRole('button', { name: /一键提炼/ }).click()

  // 等待卡的停止入口：小屏滚到结果区后主按钮已不在视口内
  await page.getByRole('button', { name: /停止提炼/ }).first().click()
  await expect(page.getByText('已停止本次提炼')).toBeVisible()
})

test('查看原始返回：结果区跳回左栏「备用」区原文编辑', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await fillRecords(page)
  await page.getByRole('button', { name: /一键提炼/ }).click()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()

  await page.getByRole('button', { name: '查看 AI 回复原文' }).click()
  const rawBox = page.getByLabel('手动粘贴结果')
  await expect(rawBox).toBeVisible()
  await expect(rawBox).toHaveValue(/新增能力/)
})
