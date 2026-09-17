import { expect, test } from '@playwright/test'
import { Document, Packer, Paragraph } from 'docx'
import {
  MOCK_JD,
  MOCK_RECORDS,
  MOCK_REWRITE,
  mockAi,
  seedSettings,
} from './mock'

const RECORDS_PLACEHOLDER = '把 git 提交日志'
const JD_PLACEHOLDER = '把目标岗位的 JD'

async function generate(page: import('@playwright/test').Page): Promise<void> {
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)
  await page.getByRole('button', { name: /一键提炼/ }).click()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()
}

test('量化评分：评分章可见且可展开扣分明细', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const scoreChip = page.getByRole('button', { name: /评分/ })
  await expect(scoreChip).toContainText('/100')
  await scoreChip.click()
  // 扣分明细面板展开（MOCK_REPLY 含无出处条目与缺数字条目，必有明细）
  await expect(page.getByText(/弱动词|待补数据|缺量化数字|无原始记录依据/).first()).toBeVisible()
})

test('行内编辑：修改单条亮点并同步导出内容', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: '✎ 编辑' }).first().click()
  const editBox = page.getByLabel('编辑亮点')
  await editBox.fill('手工微调后的亮点条目，覆盖 32 处调用点')
  await page.getByRole('button', { name: '保存', exact: true }).click()

  // 结果区条目文本（核查清单也会列出同一条，取结果区第一个）
  await expect(page.getByText('手工微调后的亮点条目，覆盖 32 处调用点').first()).toBeVisible()
})

test('换个说法：单条重写替换原文，出处保留', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: '⟳ 换个说法' }).first().click()
  await expect(page.getByText(MOCK_REWRITE).first()).toBeVisible()
  await expect(page.getByText(/已换一种说法/)).toBeVisible()
})

test('版本库：存为版本后可载入，刷新后仍存在（IndexedDB）', async ({ page }) => {
  test.setTimeout(60_000)
  await seedSettings(page)
  await mockAi(page)
  // window.confirm 默认会被 Playwright 取消，统一改为接受
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto('/')
  await generate(page)

  const versionSection = page.locator('section', { hasText: '版本库' }).first()
  await versionSection.getByRole('button', { name: '存为版本' }).click()
  await page.getByLabel('版本名称').fill('测试岗位-A卷')
  await versionSection.getByRole('button', { name: '保存', exact: true }).click()
  // 保存完成的 toast 在页面根部（ToastHost），不在版本库面板内
  await expect(page.getByText(/已存为版本/)).toBeVisible()

  // 展开版本库列表后按名称载入（收起态内容 aria-hidden，getByRole 不可见）
  await versionSection.getByRole('button', { name: '展开' }).click()
  await expect(versionSection.getByRole('button', { name: '测试岗位-A卷' })).toBeVisible()

  // 修改当前输入，载入版本应还原
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill('被覆盖的内容')
  await versionSection.getByRole('button', { name: '测试岗位-A卷' }).click()
  await expect(page.getByPlaceholder(RECORDS_PLACEHOLDER)).toHaveValue(/09-01 日报/)

  // 刷新后版本仍在（IndexedDB 持久化）
  await page.reload()
  const reloadedSection = page.locator('section', { hasText: '版本库' }).first()
  await reloadedSection.getByRole('button', { name: '展开' }).click()
  await expect(reloadedSection.getByRole('button', { name: '测试岗位-A卷' })).toBeVisible()
})

test('暗色模式：三态循环（跟随系统→暗→亮），刷新保持', async ({ page }) => {
  await page.goto('/')
  // colorScheme 配置为 light：auto 态下应为亮色
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await page.getByRole('button', { name: '切换到暗色模式' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await page.getByRole('button', { name: '切换到亮色模式' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await page.getByRole('button', { name: '切换到跟随系统' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  // 刷新后保持手动选择（回到 light 存档后再切 dark 验证持久化）
  await page.getByRole('button', { name: '切换到暗色模式' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('提炼进行中：版本保存被禁用，结果区切换为等待态，停止后恢复', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  // 再次提炼（路由延迟 5s）：开始即切换等待态，版本保存禁用
  await mockAi(page, { delayMs: 5000 })
  await page.getByRole('button', { name: /一键提炼/ }).click()
  const versionSection = page.locator('section', { hasText: '版本库' }).first()
  await expect(versionSection.getByRole('button', { name: '存为版本' })).toBeDisabled()
  await expect(page.getByText('正在提炼，生成内容将实时出现在这里…')).toBeVisible()

  // 停止提炼后恢复可用
  await page.getByRole('button', { name: /提炼中/ }).click()
  await expect(page.getByText('已停止本次提炼')).toBeVisible()
  await expect(versionSection.getByRole('button', { name: '存为版本' })).toBeEnabled()
})

test('换条互斥：改写中其他条目的「换个说法」被禁用', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { rewriteDelayMs: 3000 })
  await page.goto('/')
  await generate(page)

  const rewriteButtons = page.getByRole('button', { name: '⟳ 换个说法' })
  await rewriteButtons.first().click()
  await expect(page.getByRole('button', { name: '⟳ 改写中…' })).toBeVisible()
  // 改写中的按钮已改名，剩余匹配到的都是其他条目，应全部禁用
  await expect(rewriteButtons.first()).toBeDisabled()

  // 改写完成后恢复
  await expect(page.getByText(MOCK_REWRITE).first()).toBeVisible()
  await expect(rewriteButtons.first()).toBeEnabled()
})

test('文件导入：TXT 与 DOCX 纯本地解析进记录区', async ({ page }) => {
  await page.goto('/')

  const fileInput = page.locator('input[accept=".pdf,.docx,.txt,.md"]')

  // TXT
  await fileInput.setInputFiles({
    name: '记录.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('2026-09-01 修复白屏问题\n2026-09-02 接口改造收尾', 'utf8'),
  })
  await expect(page.getByText(/已导入 记录\.txt/)).toBeVisible()
  await expect(page.getByPlaceholder(RECORDS_PLACEHOLDER)).toHaveValue(/修复白屏问题/)

  // DOCX：用 docx 库在 Node 侧生成真实文档
  const doc = new Document({
    sections: [{ children: [new Paragraph('部署脚本重构，新环境接入从半天缩到 10 分钟')] }],
  })
  const docxBuffer = await Packer.toBuffer(doc)
  await fileInput.setInputFiles({
    name: '周报.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(docxBuffer),
  })
  await expect(page.getByText(/已导入 周报\.docx/)).toBeVisible()
  await expect(page.getByPlaceholder(RECORDS_PLACEHOLDER)).toHaveValue(/部署脚本重构/)
})

test('风格库：选择 STAR 后提炼指令带上表达风格段', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'STAR 叙事' }).click()
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)

  // 展开备用区生成指令
  const backupSection = page.locator('section', { hasText: '备用：手动提炼' }).first()
  await backupSection.getByRole('button', { name: '展开' }).click()
  await backupSection.getByRole('button', { name: '生成提炼指令' }).click()
  await expect(page.getByLabel('提炼指令内容')).toHaveValue(/表达风格/)
  await expect(page.getByLabel('提炼指令内容')).toHaveValue(/情境-任务-行动-结果/)
})

test('JD 对标与评分联动：JD 命中反映在扣分明细', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  // JD 面板默认收起：先展开再填（与 P0 用例一致）
  await page.getByRole('button', { name: '展开' }).first().click()
  await page.getByPlaceholder(JD_PLACEHOLDER).fill(MOCK_JD)
  await generate(page)

  await expect(page.getByText(/JD 对标命中/)).toBeVisible()
  await page.getByRole('button', { name: /评分/ }).click()
  await expect(page.getByText(/JD 关键词未覆盖/)).toBeVisible()
})
