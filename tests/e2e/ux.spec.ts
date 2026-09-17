import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  MOCK_JD,
  MOCK_RECORDS,
  MOCK_REWRITE,
  MOCK_SUPPLEMENT,
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

test('条目勾选：取消勾选后导出不再包含，勾回恢复', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const preview = page.getByLabel('导出内容预览')
  const firstItemText = '为上传模块新增大文件分片上传与失败自动重试能力'
  await expect(preview).toHaveValue(new RegExp(firstItemText))

  // 取消勾选第一条：结果区保留（半透明）但导出排除
  await page.getByLabel(`纳入导出：${firstItemText}`).uncheck()
  await expect(page.getByText(/已选 7\/8 条/)).toBeVisible()
  await expect(preview).not.toHaveValue(new RegExp(firstItemText))

  // 勾回恢复
  await page.getByLabel(`纳入导出：${firstItemText}`).check()
  await expect(preview).toHaveValue(new RegExp(firstItemText))
})

test('条目删除：从结果与导出中移除', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const firstItemText = '为上传模块新增大文件分片上传与失败自动重试能力'
  await page.getByRole('button', { name: '删除', exact: true }).first().click()
  await expect(page.getByText(firstItemText)).toBeHidden()
  await expect(page.getByLabel('导出内容预览')).not.toHaveValue(new RegExp(firstItemText))
})

test('条目排序：下移后导出顺序随之变化', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const preview = page.getByLabel('导出内容预览')
  // includeNotes=false 时首条下移会让附注（原被排除）转为首条普通条目进入导出
  const before = await preview.inputValue()
  expect(before).not.toContain('面试展开点')

  await page.getByRole('button', { name: '↓', exact: true }).first().click()
  const after = await preview.inputValue()
  const noteIdx = after.indexOf('面试展开点')
  const itemIdx = after.indexOf('为上传模块')
  expect(noteIdx).toBeGreaterThanOrEqual(0)
  expect(noteIdx).toBeLessThan(itemIdx)
})

test('自动快照：再次提炼前自动保存，可一键清理', async ({ page }) => {
  test.setTimeout(60_000)
  await seedSettings(page)
  await mockAi(page)
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto('/')
  await generate(page)
  // 第二次提炼前，未存档的结果自动快照
  await page.getByRole('button', { name: /一键提炼/ }).click()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()

  const versionSection = page.locator('section', { hasText: '版本库' }).first()
  await versionSection.getByRole('button', { name: '展开' }).click()
  await expect(versionSection.getByText(/自动快照-/).first()).toBeVisible()

  // 一键清理快照，手动命名的版本不受影响（此处只有快照）
  await versionSection.getByRole('button', { name: /清理快照/ }).click()
  await expect(versionSection.getByText(/自动快照-/)).toBeHidden()
})

test('服务商预设：一键填充地址与模型，附获取 Key 链接', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /连接 AI/ }).click()

  await page.getByRole('button', { name: 'DeepSeek', exact: true }).click()
  await expect(page.getByPlaceholder('https://api.deepseek.com')).toHaveValue('https://api.deepseek.com')
  await expect(page.getByLabel('模型名')).toHaveValue('deepseek-chat')
  await expect(page.getByRole('link', { name: /去申请/ })).toBeVisible()

  await page.getByRole('button', { name: 'Kimi', exact: true }).click()
  await expect(page.getByPlaceholder('https://api.deepseek.com')).toHaveValue('https://api.moonshot.cn/v1')

  // 本地 Ollama：不用 Key，给出模型名填写提示
  await page.getByRole('button', { name: '本地 Ollama' }).click()
  await expect(page.getByPlaceholder('https://api.deepseek.com')).toHaveValue('http://localhost:11434/v1')
  await expect(page.getByText(/本地模型不用 Key/)).toBeVisible()
  await expect(page.getByRole('link', { name: /去申请/ })).toBeHidden()
})

test('补充提炼：未命中关键词可定向补充', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await page.getByRole('button', { name: '展开' }).first().click()
  await page.getByPlaceholder(JD_PLACEHOLDER).fill(MOCK_JD)
  await generate(page)

  await page.getByRole('button', { name: /按缺失关键词补充提炼/ }).click()
  await expect(page.getByText(/为列表筛选补充多条件组合查询与筛选记忆能力/)).toBeVisible()
})

test('补充提炼：找不到素材时明说，不编造', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { supplementReply: '无相关素材' })
  await page.goto('/')
  await page.getByRole('button', { name: '展开' }).first().click()
  await page.getByPlaceholder(JD_PLACEHOLDER).fill(MOCK_JD)
  await generate(page)

  await page.getByRole('button', { name: /按缺失关键词补充提炼/ }).click()
  await expect(page.getByText(/没有与缺失关键词相关的素材/)).toBeVisible()
})

test('规则编辑区：默认折叠，点「自定义规则」展开', async ({ page }) => {
  await page.goto('/')
  // 折叠时内容带 aria-hidden，role 查询不可见
  const rulesBox = page.getByRole('textbox', { name: '提炼规则编辑' })
  await expect(rulesBox).toBeHidden()
  await page.getByRole('button', { name: '自定义规则' }).click()
  await expect(rulesBox).toBeVisible()
})

test('记录过少提示：少于 3 行时提前提醒', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill('只写了一行')
  await expect(page.getByText(/记录只有 1 行，提炼效果可能有限/)).toBeVisible()
})

test('超长记录预警：超过 8000 字提示分段提炼', async ({ page }) => {
  await page.goto('/')
  const long = Array.from({ length: 600 }, (_, i) => `- 第 ${i} 条工作记录：接口改造与联调`).join('\n')
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(long)
  await expect(page.getByText(/记录较长（\d+ 字）/)).toBeVisible()
  await expect(page.getByText(/建议按项目拆开/)).toBeVisible()
})

test('多段记录：按 --- 识别段数并提示归属', async ({ page }) => {
  await page.goto('/')
  await page
    .getByPlaceholder(RECORDS_PLACEHOLDER)
    .fill('项目 A\n- 做了 X\n- 做了 Y\n\n---\n\n项目 B\n- 做了 Z')
  await expect(page.getByText(/已按「---」认出 2 段记录/)).toBeVisible()
})

test('组合透明化：显示当前组合，可预览最终指令', async ({ page }) => {
  await page.goto('/')
  const combo = page.getByRole('note', { name: '当前提炼组合' })
  await expect(combo).toContainText('前端技术岗')

  await page.getByRole('button', { name: '后端技术岗' }).click()
  await expect(combo).toContainText('后端技术岗')

  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)
  await combo.getByRole('button', { name: '预览最终指令' }).click()
  // 备用区出现完整指令：含后端规则特征文案
  await expect(page.getByLabel('提炼指令内容')).toHaveValue(/性能与稳定性/)
  // 点完必须真的看得见：备用区自动展开并聚焦「复制指令」（收起时 inert，无法聚焦）
  await expect(page.getByRole('button', { name: '复制指令' })).toBeFocused()
})

test('预览最终指令：记录为空时给出提示，不静默无响应', async ({ page }) => {
  await page.goto('/')
  const combo = page.getByRole('note', { name: '当前提炼组合' })
  await combo.getByRole('button', { name: '预览最终指令' }).click()
  await expect(page.getByText('先粘贴工作记录，再生成提炼指令')).toBeVisible()
})

test('条目撤销：删除后点提示里的「撤销」恢复该条', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const firstItemText = '为上传模块新增大文件分片上传与失败自动重试能力'
  await page.getByRole('button', { name: '删除', exact: true }).first().click()
  await expect(page.getByText(firstItemText)).toBeHidden()

  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByText(firstItemText).first()).toBeVisible()
  await expect(page.getByLabel('导出内容预览')).toHaveValue(new RegExp(firstItemText))
})

test('条目撤销：Ctrl+Z 回退行内编辑', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const firstItemText = '为上传模块新增大文件分片上传与失败自动重试能力'
  await page.getByRole('button', { name: '✎ 编辑' }).first().click()
  await page.getByLabel('编辑亮点').fill('手工微调后的亮点条目，覆盖 32 处调用点')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByLabel('导出内容预览')).toHaveValue(/手工微调后的亮点条目/)

  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('导出内容预览')).toHaveValue(new RegExp(firstItemText))
})

test('改写对照：换个说法后可查看修改前的原句', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const firstItemText = '为上传模块新增大文件分片上传与失败自动重试能力'
  await page.getByRole('button', { name: '⟳ 换个说法' }).first().click()
  await expect(page.getByText(MOCK_REWRITE).first()).toBeVisible()

  await page.getByRole('button', { name: '对比修改前' }).first().click()
  await expect(page.getByText('修改前', { exact: true })).toBeVisible()
  await expect(page.getByText(firstItemText).first()).toBeVisible()
})

test('无 JD 引导：结果区提示并可一键展开聚焦 JD 输入', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const card = page.getByRole('note', { name: '未填 JD 引导' })
  await expect(card).toBeVisible()

  await card.getByRole('button', { name: '去填 JD' }).click()
  const jdBox = page.getByPlaceholder(JD_PLACEHOLDER)
  await expect(jdBox).toBeVisible()
  await expect(jdBox).toBeFocused()

  await jdBox.fill(MOCK_JD)
  await expect(card).toBeHidden()
})

test('下一步动线：显示待核查项并可跳到导出', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const nextStep = page.getByRole('note', { name: '下一步' })
  await expect(nextStep).toBeVisible()
  await expect(nextStep.getByRole('button', { name: /去核对 \d+ 项/ })).toBeVisible()

  await nextStep.getByRole('button', { name: '跳到导出 ↓' }).click()
  await expect(page.getByRole('heading', { name: '导出使用' })).toBeInViewport()
})

test('面试模拟：逐题作答后展示 AI 点评', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: /面试追问/ }).click()
  await expect(page.getByText(/分片上传覆盖的调用点是怎么统计出来的/)).toBeVisible()

  await page.getByRole('button', { name: '练一练' }).first().click()
  await page.getByLabel('模拟面试作答').fill('2MB 是按弱网实测定的，这块我主导方案与实现')
  await page.getByRole('button', { name: '请 AI 点评' }).click()
  await expect(page.getByLabel('AI 点评')).toContainText('答到点上')
})

test('整页简历：下载 HTML 包含抬头与勾选条目', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const resume = page.getByRole('group', { name: '整页简历' })
  await resume.getByRole('button', { name: '展开' }).click()
  await page.getByLabel('简历姓名').fill('张三')
  await page.getByLabel('简历联系方式').fill('138****0000')

  const downloadPromise = page.waitForEvent('download')
  await resume.getByRole('button', { name: '下载 HTML' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^简历-\d{8}-\d{4}\.html$/)

  const html = readFileSync((await download.path())!, 'utf8')
  expect(html).toContain('<h1>张三</h1>')
  expect(html).toContain('138****0000')
  expect(html).toContain('为上传模块新增大文件分片上传与失败自动重试能力')
})

test('版本对照：展示两侧 JD 匹配度与缺口差异', async ({ page }) => {
  test.setTimeout(60_000)
  await seedSettings(page)
  await mockAi(page)
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '展开' }).first().click()
  await page.getByPlaceholder(JD_PLACEHOLDER).fill(MOCK_JD)
  await generate(page)

  const versionSection = page.locator('section', { hasText: '版本库' }).first()
  for (const name of ['A 卷', 'B 卷']) {
    await versionSection.getByRole('button', { name: '存为版本' }).click()
    await page.getByLabel('版本名称').fill(name)
    await versionSection.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(new RegExp(`已存为版本「${name}」`))).toBeVisible()
  }

  await versionSection.getByRole('button', { name: '展开' }).click()
  const compareDialog = page.getByRole('dialog', { name: '版本对照' })
  await versionSection.getByRole('button', { name: '对比' }).first().click()
  await expect(compareDialog).toBeVisible()
  await expect(compareDialog.getByText(/JD 匹配度 \d+%/).first()).toBeVisible()
  await expect(compareDialog.getByText('JD 缺口对照')).toBeVisible()
})
