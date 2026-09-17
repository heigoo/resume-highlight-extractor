import { expect, test } from '@playwright/test'
import { MOCK_RECORDS, mockAi, seedSettings } from './mock'

const RECORDS_PLACEHOLDER = '把 git 提交日志'

async function generate(page: import('@playwright/test').Page): Promise<void> {
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)
  await page.getByRole('button', { name: /一键提炼/ }).click()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()
}

// 说明书的产品内入口：页头 / 页脚可打开精简手册，Esc 与按钮均可关闭
test('使用说明：页头打开精简手册，Esc / 关闭按钮可关，页脚也可直达', async ({ page }) => {
  await page.goto('/')

  await page.locator('header').first().getByRole('button', { name: '使用说明' }).click()
  const dialog = page.getByRole('dialog', { name: '使用说明' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('三步上手')
  await expect(dialog).toContainText('走备用路径')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.locator('footer').getByRole('button', { name: '使用说明' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /关闭/ }).click()
  await expect(dialog).toBeHidden()
})

// 主流程失败分支的出口：不依赖转发服务，一键转手动提炼
test('提炼失败：错误条可「改用备用路径」，自动展开备用区并生成指令', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { status: 401 })
  await page.goto('/')
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)
  await page.getByRole('button', { name: /一键提炼/ }).click()

  const errorBox = page.getByRole('alert')
  await expect(errorBox).toContainText('密钥（Key）不正确')
  await errorBox.getByRole('button', { name: /改用备用路径/ }).click()

  // 备用区自动展开：指令已生成（含岗位规则特征文案），复制按钮就位
  const promptBox = page.getByLabel('提炼指令内容')
  await expect(promptBox).toBeVisible()
  await expect(promptBox).toHaveValue(/弱动词/)
  await expect(page.getByRole('button', { name: '复制指令' })).toBeFocused()
})

// 说明书写明「导出只含勾选条目」：全不勾时给提示并禁用复制，避免点了没反应
test('导出空态：全部取消勾选时提示并禁用复制，全选后恢复', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  // 有勾选时：评分为准、无「满分」误导
  await expect(page.getByRole('button', { name: /评分/ })).toBeVisible()

  const boxes = page.getByRole('checkbox', { name: /纳入导出：/ })
  const total = await boxes.count()
  expect(total).toBeGreaterThan(0)
  for (let i = 0; i < total; i += 1) await boxes.nth(i).uncheck()

  const hint = page.getByRole('status').filter({ hasText: '当前一条都没勾选' })
  await expect(hint).toBeVisible()
  await expect(page.getByRole('button', { name: '一键复制' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '复制带格式' })).toBeDisabled()
  // 空勾选状态下「评分 / 无弱动词」都是对空内容的误导性结论，应一并隐藏
  await expect(page.getByRole('button', { name: /评分/ })).toBeHidden()
  await expect(page.getByText('无弱动词 · 无待补')).toBeHidden()

  await hint.getByRole('button', { name: '全选' }).click()
  await expect(hint).toBeHidden()
  await expect(page.getByRole('button', { name: '一键复制' })).toBeEnabled()
  await expect(page.getByRole('button', { name: /评分/ })).toBeVisible()
})

// 未配置 AI 的首访：提示必须指向页头常驻按钮（引导条会被点「填入示例」关掉）
test('首访未配置：填入示例后的提示指向页头「连接 AI」', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '填入示例试一试' }).click()

  await expect(page.getByText(/示例已填入：先点页头「连接 AI」完成设置/)).toBeVisible()
  await expect(page.locator('header').first().getByRole('button', { name: '连接 AI' })).toBeVisible()
})

// 提示条不能吞掉落在它上面的点击（含出现动画期间），否则会出现「按钮点了没反应」的静默失败
test('提示条不吞点击：整条仅操作按钮可点', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: '删除', exact: true }).first().click()
  const toast = page.locator('[role="status"] div').filter({ hasText: '已删除该条' }).first()
  await expect(toast).toBeVisible()
  expect(await toast.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')

  const undo = page.getByRole('button', { name: '撤销', exact: true })
  expect(await undo.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto')
  await undo.click()
  await expect(page.getByText(/已撤销上一步改动/)).toBeVisible()
})