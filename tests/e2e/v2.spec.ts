import { expect, test } from '@playwright/test'
import {
  MOCK_DETAIL_FILL,
  MOCK_JD,
  MOCK_RECORDS,
  MOCK_TRANSLATE,
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

async function generateWithJd(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: '展开' }).first().click()
  await page.getByPlaceholder(JD_PLACEHOLDER).fill(MOCK_JD)
  await generate(page)
}

test('F1 JD 对标：匹配度总览 + 缺口分组 + 关键词定位', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generateWithJd(page)

  // 匹配度百分比与缺口总览
  await expect(page.getByText(/JD 对标：匹配度 \d+%/)).toBeVisible()
  await expect(page.getByText(/个缺口待补|全部关键词已覆盖/)).toBeVisible()

  // 缺口清单按硬技能 / 软能力分组（MOCK_JD 的 TypeScript 未覆盖 → 硬技能缺口）
  const resultCard = page.locator('section', { hasText: 'JD 对标：匹配度' }).first()
  await expect(resultCard.getByText('硬技能缺口')).toBeVisible()
  await expect(resultCard.getByText('typescript', { exact: true })).toBeVisible()

  // 命中关键词 chips 点击 → 结果区对应条目闪烁定位
  await resultCard.getByRole('button', { name: '性能优化', exact: true }).click()
  await expect(page.locator('.hl-pulse').first()).toBeVisible()
})

test('F1/I1 缺口动作：在记录中找素材 / 定向补充提炼', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generateWithJd(page)

  const resultCard = page.locator('section', { hasText: 'JD 对标：匹配度' }).first()
  // 「在记录中找素材」展开原始记录近似行（TypeScript 在记录里没有近似内容 → 诚实提示）
  await resultCard.getByRole('button', { name: '在记录中找素材' }).first().click()
  await expect(
    resultCard.getByText(/原始记录里没有相近内容|^\[\d+\]/).first(),
  ).toBeVisible()

  // 单缺口「✦ 补充提炼」走补充流程（mock 返回多条件查询能力）
  await resultCard.getByRole('button', { name: '✦ 补充提炼' }).first().click()
  await expect(page.getByText(/为列表筛选补充多条件组合查询与筛选记忆能力/).first()).toBeVisible()
})

test('F2 评分行动化：扣分项点击定位 + 改法可复制', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: /评分/ }).click()
  const sourceDetail = page.getByRole('button', { name: /无原始记录依据/ })
  await expect(sourceDetail).toContainText('影响')
  await sourceDetail.click()
  await expect(page.locator('.hl-pulse').first()).toBeVisible()

  // 改法建议可复制（附在每条扣分项下）
  await expect(page.getByText(/改法：/).first()).toBeVisible()
  await page.getByRole('button', { name: '复制改法' }).first().click()
  await expect(page.getByText(/改法已复制/)).toBeVisible()
})

test('F3 导出前核查：清单聚合、勾选与待确认徽标', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const verifySection = page.getByRole('region', { name: '导出前核查' })
  await expect(verifySection.getByText(/还有 \d+ 项待确认/)).toBeVisible()
  // 导出按钮旁的徽标
  await expect(page.getByText(/核查待确认 \d+ 项/)).toBeVisible()

  // 展开清单：三类核查与出处引用都在
  await verifySection.getByRole('button', { name: '展开', exact: true }).click()
  await expect(verifySection.getByText(/数字核对（\d+ 项）/)).toBeVisible()
  await expect(verifySection.getByText(/出处（\d+ 项）/)).toBeVisible()

  // 全部确认后：徽标切换为「可以放心导出 / 核查完成」
  await verifySection.getByRole('button', { name: '全部确认' }).click()
  await expect(verifySection.getByText('可以放心导出')).toBeVisible()
  await expect(page.getByText('核查完成 ✓')).toBeVisible()
})

test('F4 面试追问：生成 5 问、关联条目定位、并发禁用', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { interviewDelayMs: 1500 })
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: '🎯 面试追问', exact: true }).click()
  // 生成期间：其他 AI 入口被禁用（互斥守卫）
  await expect(page.getByRole('button', { name: '⟳ 换个说法' }).first()).toBeDisabled()

  // 问题文本已剥离序号与「关联」标注，关联以「第N条」芯片呈现
  await expect(
    page.getByText('分片上传覆盖的调用点是怎么统计出来的？'),
  ).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/点「第N条」可定位到对应亮点/)).toBeVisible()

  // 关联条目「第1条」点击 → 定位闪烁
  await page.getByRole('button', { name: '第1条' }).first().click()
  await expect(page.locator('.hl-pulse').first()).toBeVisible()

  // 换一批：重新生成后清单仍可复制（等第二轮问题落位）
  await page.getByRole('button', { name: '换一批' }).click()
  await expect(
    page.getByText('分片上传覆盖的调用点是怎么统计出来的？'),
  ).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '复制清单', exact: true }).click()
  await expect(page.getByText(/追问清单已复制/)).toBeVisible()
})

test('F5 追问补细节：先问、回答后改写并保留出处', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: '＋ 追问细节' }).first().click()
  const dialog = page.getByRole('dialog', { name: '追问细节' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/分片上传的具体规模是多少/)).toBeVisible()

  await dialog.getByLabel('追问细节的回答').fill('分片大小 2MB，覆盖 10 个接口')
  await dialog.getByRole('button', { name: '生成补充描述并替换' }).click()
  await expect(page.getByText(/已按你的回答改写该条/)).toBeVisible()
  await expect(page.getByText(MOCK_DETAIL_FILL).first()).toBeVisible()
  await expect(dialog).toBeHidden()

  // 出处保持不变
  await expect(page.getByRole('button', { name: /源 08 · 10/ })).toBeVisible()
})

test('F5 防编造：回答里没有的数字自动标【待补】', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page, { detailFillReply: '主导上传模块重构，性能提升 45%' })
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: '＋ 追问细节' }).first().click()
  const dialog = page.getByRole('dialog', { name: '追问细节' })
  await dialog.getByLabel('追问细节的回答').fill('分片大小 2MB')
  await dialog.getByRole('button', { name: '生成补充描述并替换' }).click()

  await expect(page.getByText(/新数字未经原始记录核实/)).toBeVisible()
  await expect(page.getByText(/【待补：核实数字 45%】/).first()).toBeVisible()
})

test('F6 多岗位版本：岗位标签、按岗位筛选与并排对照', async ({ page }) => {
  test.setTimeout(60_000)
  await seedSettings(page)
  await mockAi(page)
  page.on('dialog', (d) => void d.accept())
  await page.goto('/')
  await generate(page)

  const versionSection = page.locator('section', { hasText: '版本库' }).first()
  // 两个岗位各存一份
  for (const role of ['前端技术岗', '产品经理']) {
    await versionSection.getByRole('button', { name: '存为版本' }).click()
    await page.getByLabel('版本名称').fill(`版本-${role}`)
    await page.getByLabel('目标岗位').fill(role)
    await versionSection.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(new RegExp(`已存为版本「版本-${role}」`)).first()).toBeVisible()
  }

  await versionSection.getByRole('button', { name: '展开' }).click()
  // 岗位筛选 chips
  await expect(versionSection.getByRole('button', { name: '全部（2）' })).toBeVisible()
  await versionSection.getByRole('button', { name: '产品经理（1）' }).click()
  await expect(versionSection.getByRole('button', { name: '版本-产品经理' })).toBeVisible()
  await expect(versionSection.getByRole('button', { name: '版本-前端技术岗' })).toBeHidden()
  await versionSection.getByRole('button', { name: '全部（2）' }).click()

  // 并排对照
  await versionSection.getByRole('button', { name: '对比' }).first().click()
  const dialog = page.getByRole('dialog', { name: '版本对照' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('选择对照版本')).toBeVisible()
  await expect(dialog.getByText('· 为上传模块新增大文件分片上传与失败自动重试能力').first()).toBeVisible()
})

test('F7 导出增强：ATS 提示 + 富文本复制 + ATS 版式 Word', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  // 纯文本格式下的网申提示
  await page.getByRole('button', { name: '简历纯文本' }).click()
  await expect(page.getByText(/网申小提示：建议用纯文字版/)).toBeVisible()

  // 带格式复制
  await page.getByRole('button', { name: '复制带格式' }).click()
  await expect(page.getByText(/已复制（带格式）/)).toBeVisible()

  // Word ATS 友好版式
  await page.getByLabel('Word 用 ATS 友好版式').check()
  const docxDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 Word' }).click()
  expect((await docxDownload).suggestedFilename()).toMatch(/^简历亮点-.+\.docx$/)
  await expect(page.getByText('Word（ATS 友好版式）已生成，无水印')).toBeVisible()
})

test('F8 人群场景预设：注入指令并随草稿恢复', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '转行', exact: true }).click()
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)

  const backupSection = page.locator('section', { hasText: '备用：手动提炼' }).first()
  await backupSection.getByRole('button', { name: '展开' }).click()
  await backupSection.getByRole('button', { name: '生成提炼指令' }).click()
  await expect(page.getByLabel('提炼指令内容')).toHaveValue(/人群场景/)
  await expect(page.getByLabel('提炼指令内容')).toHaveValue(/可迁移能力/)

  // 刷新后草稿恢复人群选择（等防抖写盘后再刷新，避免竞态）
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('rhe.draft.v1')?.includes('"scenario":"switch"')),
    )
    .toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: '转行', exact: true })).toHaveClass(/text-seal-deep/)
})

test('F9 中英翻译：生成英文译文、可编辑复制、可关闭', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: '译成英文' }).click()
  // 折叠收起的内容 aria-hidden，隐藏断言用 role 查询（getByLabel 会命中被裁剪的子盒）
  const translated = page.getByRole('textbox', { name: '英文译文' })
  await expect(translated).toHaveValue(/New capabilities/)
  await expect(page.getByText(/翻译完成：术语与数字建议人工校对/)).toBeVisible()

  await translated.fill(`${MOCK_TRANSLATE}\n- Edited manually`)
  await page.getByRole('button', { name: '复制译文' }).click()
  await expect(page.getByText(/译文已复制（建议人工校对后再投递）/)).toBeVisible()

  await page.getByRole('button', { name: '关闭', exact: true }).last().click()
  await expect(translated).toBeHidden()
})

test('F10 规则导入导出：下载 JSON 再导入等值', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '自定义规则' }).click()
  const rulesBox = page.getByRole('textbox', { name: '提炼规则编辑' })
  const before = await rulesBox.inputValue()
  expect(before).toContain('只基于我给的材料')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出规则' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^提炼规则-.+\.json$/)
  const path = await file.path()
  expect(path).toBeTruthy()

  await page.getByLabel('选择规则文件').setInputFiles(path!)
  await expect(page.getByText(/规则已导入/)).toBeVisible()
  await expect(rulesBox).toHaveValue(before)
})

test('F10 统计展示：提炼后设置面板与页脚显示本机统计', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await expect(page.getByText(/近 7 天 1 次/)).toBeVisible()
  await page.getByRole('button', { name: /AI 已连接/ }).click()
  await expect(page.getByText(/本机统计：提炼 1 次/)).toBeVisible()
  await expect(page.getByText(/近 7 天 1 次/).first()).toBeVisible()
})

test('失败保护：再次提炼失败时保留上一次的结果', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)
  const firstItem = '为上传模块新增大文件分片上传与失败自动重试能力'
  await expect(page.getByText(new RegExp(firstItem)).first()).toBeVisible()

  // 第二次提炼失败（401）：结果区不应被清空
  await mockAi(page, { status: 401 })
  await page.getByRole('button', { name: /一键提炼/ }).click()
  await expect(page.getByRole('alert')).toContainText('密钥（Key）不正确')
  await expect(page.getByText(/已保留上一次的结果/)).toBeVisible()
  await expect(page.getByText(new RegExp(firstItem)).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /评分/ })).toBeVisible()
})

test('印章定位：点「弱动词 × N」「待补数据 × N」跳到对应条目', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: /待补数据 × \d+/ }).click()
  await expect(page.locator('.hl-pulse').first()).toBeVisible()
})

test('出处核对：AI 数错行号时核查清单给出可疑项与建议行号，可一键改用', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await page.getByPlaceholder(RECORDS_PLACEHOLDER).fill(MOCK_RECORDS)
  // 「大文件分片上传」那条记录实际在第 8 行，这里故意让 AI 标成 源1（09-01 日报）
  await mockAi(page, {
    reply: '## 新增能力\n\n- 为大文件分片上传与失败自动重试能力补齐弱网策略 「源1」',
  })
  await page.getByRole('button', { name: /一键提炼/ }).click()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()

  const verify = page.getByRole('region', { name: '导出前核查' })
  await verify.getByRole('button', { name: '展开', exact: true }).click()
  await expect(verify.getByText('出处核对（1 项）')).toBeVisible()
  await expect(verify.getByText(/现引用 源 1/)).toBeVisible()
  await expect(verify.getByText(/建议 源 8/)).toBeVisible()

  await verify.getByRole('button', { name: '改用建议出处' }).click()
  await expect(page.getByText(/已改用 源8/)).toBeVisible()
  await expect(page.getByRole('button', { name: /源 08/ })).toBeVisible()
  // 修正后该可疑项消失
  await expect(verify.getByText('出处核对（1 项）')).toBeHidden()
})

test('结果区一次性引导：首次显示，关闭后（含刷新）不再出现', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  const guide = page.getByRole('note', { name: '结果区使用引导' })
  await expect(guide).toBeVisible()
  await guide.getByRole('button', { name: '知道了' }).click()
  await expect(guide).toBeHidden()

  // 等草稿落盘后刷新：结果恢复，引导不再出现
  await expect
    .poll(() =>
      page.evaluate(() => (JSON.parse(localStorage.getItem('rhe.draft.v1') ?? '{}').aiRaw ?? '').length > 10),
    )
    .toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '提炼结果' })).toBeVisible()
  await expect(page.getByRole('note', { name: '结果区使用引导' })).toBeHidden()
})

test('追问清单与英文译文随草稿保留；条目修改后译文提示过期', async ({ page }) => {
  await seedSettings(page)
  await mockAi(page)
  await page.goto('/')
  await generate(page)

  await page.getByRole('button', { name: '🎯 面试追问', exact: true }).click()
  await expect(page.getByText('分片上传覆盖的调用点是怎么统计出来的？')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '译成英文' }).click()
  await expect(page.getByRole('textbox', { name: '英文译文' })).toHaveValue(/New capabilities/)

  // 等追问与译文都落进草稿再刷新
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('rhe.draft.v1') ?? '{}') as Record<string, string>
        return (d.interview ?? '').length > 10 && (d.translatedSource ?? '').length > 10
      }),
    )
    .toBe(true)
  await page.reload()

  // 追问面板自动展开、清单仍在；译文仍在且未过期
  await expect(page.getByText('分片上传覆盖的调用点是怎么统计出来的？')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '英文译文' })).toHaveValue(/New capabilities/)
  await expect(page.getByText(/译文可能已过期/)).toBeHidden()

  // 编辑条目 → 译文过期提示出现
  await page.getByRole('button', { name: '✎ 编辑' }).first().click()
  await page.getByLabel('编辑亮点').fill('手工修改后的条目内容，覆盖 32 处调用点')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText(/译文可能已过期/)).toBeVisible()
})