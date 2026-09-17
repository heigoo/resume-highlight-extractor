// 文章配图生成：对真实运行的界面走一遍提炼流程（/api/ai 走本地 mock，无需 Key），
// 输出到 article/screenshots/。
// 用法：先 `npm run dev -- --port 5173 --strictPort`，再 `node scripts/capture-article-shots.mjs`
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'article', 'screenshots')

// 演示用（假）连接信息：与文章里「连接 AI → 填服务地址 / Key / 模型」的叙述对应
const SETTINGS = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-demo-1234567890abcdef',
  model: 'deepseek-chat',
}

const RECORDS = `2026-09-01 修复回放组件黑屏，排查到取流地址拼接错误
2026-09-02 参与接口传参规范改造：9 个接口、32 处调用点统一换成新字段
2026-09-03 清理项目里积压的类型检查报错，从 93 个降到 0
2026-09-04 优化地图渲染性能，高密度点位场景卡顿改善了
2026-09-08 给回放加了倍速快切，抽查了几个常用场景
2026-09-09 参与代码评审，处理了几条遗留意见
2026-09-10 整理部署脚本，把对接参数抽到环境变量里`

const JD = `岗位职责：
1. 负责核心业务的前端开发，覆盖视频回放、地图渲染等可视化模块；
2. 参与性能优化专项，推动性能监测与线上问题排查落地。
任职要求：
1. 熟悉 TypeScript，有组件化与工程化实践；
2. 有地图渲染与数据可视化项目经验，了解视频回放场景者优先；
3. 具备跨团队沟通协作能力，能推动问题闭环。`

// AI 回复（提炼结果）：含「源N」出处、弱动词、【待补】、面试展开点，与文章示例一一对应
const REPLY = `## 新增能力

- 为视频回放模块新增倍速快切能力，覆盖巡检常用场景并逐项抽查验证 「源5」
- 面试展开点：倍速档位是按真实巡检场景取舍的，可展开讲参数是怎么定的

## 优化提升

- 推动接口传参规范统一改造，覆盖 9 个接口、32 处调用点，消除取流失败隐患 「源2」
- 系统性清零项目类型检查告警（93 项 → 0），为后续重构与多人协作建立类型基线 「源3」
- 优化高密度点位场景下的地图渲染性能【待补：优化前后的帧率或首屏耗时对比】 「源4」
- 负责代码评审遗留问题的集中清理，推动多项表达式与命名问题修复 「源6」

## 问题修复

- 修复回放组件黑屏问题，恢复全部录像点位的回放可用性 「源1」
- 参与线上偶发问题的排查复盘，输出排查结论【待补：影响范围与最终结论】`

const INTERVIEW = `1. 倍速快切的档位是怎么定的？覆盖了哪些巡检场景？（关联：第1条）
2. 「推动接口传参规范统一改造」具体推动了哪些环节？（关联：第2条）
3. 类型检查告警从 93 清到 0，之后怎么防止回涨？（关联：第3条）
4. 地图渲染优化的前后对比数据是多少？（关联：第4条）
5. 回放黑屏这类偶发问题，后来加了什么排查手段？（关联：第6条）`

function sseBody(text) {
  const chunks = text.match(/[\s\S]{1,8}/g) ?? []
  return chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
}

async function mockAi(page) {
  await page.route('**/api/ai', async (route) => {
    const body = route.request().postDataJSON()
    const prompt = body?.messages?.[0]?.content ?? ''
    const reply = prompt.includes('面试官最可能追问的问题') ? INTERVIEW : REPLY
    if (body?.stream) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody(reply) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: reply } }] }),
    })
  })
}

async function clearToasts(page) {
  for (let i = 0; i < 20; i += 1) {
    const close = page.getByRole('button', { name: '关闭提示' })
    const n = await close.count()
    if (n === 0) return
    for (let j = 0; j < n; j += 1) await close.nth(j).click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(150)
  }
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  colorScheme: 'light',
})
const page = await context.newPage()
await mkdir(OUT, { recursive: true })

// 预置：已连接 AI、已看过引导（截图里不出现一次性提示）
await page.addInitScript((settings) => {
  localStorage.setItem('rhe.ai.settings', JSON.stringify(settings))
  localStorage.setItem('rhe.onboarded', '1')
  localStorage.setItem('rhe.resultGuide.v1', '1')
  localStorage.setItem('rhe.theme', 'light')
}, SETTINGS)
await mockAi(page)
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready) // 等 Web 字体就位，避免截图落到回退字体
await page.waitForTimeout(900) // 等入场动画收尾

// ---- 走一遍真实流程：填记录 + 填 JD → 一键提炼 ----
await page.locator('textarea[placeholder^="把 git 提交日志"]').fill(RECORDS)
const jdSection = page.locator('section', { has: page.getByRole('heading', { name: '对标岗位 JD' }) })
await jdSection.getByRole('button', { name: '展开' }).click()
await page.locator('textarea[placeholder^="把目标岗位的 JD"]').fill(JD)
await page.getByRole('button', { name: /一键提炼/ }).click()
await page.getByText(/提炼完成：共/).waitFor({ timeout: 20000 })
await clearToasts(page)
await page.waitForTimeout(600)

// ---- 01 工具界面总览（AI 已连接 + 连接设置展开，整页截图） ----
await page.getByRole('button', { name: /AI 已连接/ }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(OUT, '01-工具界面.png'), fullPage: true })
await page.getByRole('button', { name: /AI 已连接/ }).click()
await page.waitForTimeout(400)

// ---- 02 提炼规则：岗位预设 / 风格 / 人群 / AI 定制 ----
const rulesSection = page.locator('section', { has: page.getByRole('heading', { name: '提炼规则' }) })
await rulesSection.getByRole('button', { name: '自定义规则' }).click()
await page.waitForTimeout(400)
await rulesSection.screenshot({ path: path.join(OUT, '02-多预设与AI定制.png') })
await rulesSection.getByRole('button', { name: '收起编辑' }).click()
await page.waitForTimeout(300)

// ---- 03 提炼前后对比：左记录 / 右结果同屏 ----
const mainTop = await page.locator('main').evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), Math.max(0, mainTop - 12))
await page.waitForTimeout(400)
await shot(page, '03-提炼前后对比.png')

// ---- 04 折叠与导出：全部分组折叠后的结果区 ----
const resultSection = page.locator('section', { has: page.getByRole('heading', { name: '提炼结果' }) })
await page.getByRole('button', { name: '全部折叠' }).click()
await page.waitForTimeout(400)
await resultSection.screenshot({ path: path.join(OUT, '04-折叠与导出.png') })

// ---- 05 评分与 JD 对标：评分明细展开 + 缺口清单就地找素材（JD 明细默认即展开） ----
await page.locator('button.score-chip').click()
await page.getByRole('button', { name: '在记录中找素材' }).first().click()
await page.waitForTimeout(400)
const clip = await page.evaluate(() => {
  const chip = document.querySelector('button.score-chip')
  const ring = document.querySelector('[role="img"][aria-label^="JD 匹配度"]')
  const card = ring?.closest('div.rounded-lg')
  const col = chip?.closest('main > div')
  if (!chip || !card || !col) return null
  const c = chip.getBoundingClientRect()
  const k = card.getBoundingClientRect()
  const colRect = col.getBoundingClientRect()
  const top = c.top + window.scrollY - 46
  const bottom = k.bottom + window.scrollY + 16
  return { x: colRect.left + window.scrollX, y: top, width: colRect.width, height: bottom - top }
})
if (!clip) throw new Error('未定位到评分 / JD 卡片区域')
await page.screenshot({ path: path.join(OUT, '05-评分与JD对标.png'), fullPage: true, clip })

// ---- 06 版本库：按岗位各存一份 ----
const versionSection = page.locator('section', { has: page.getByRole('heading', { name: '版本库' }) })
for (const [name, role] of [
  ['前端技术岗 · 首版', '前端技术岗'],
  ['偏业务方向 · 二卷', '偏业务方向'],
]) {
  await versionSection.getByRole('button', { name: '存为版本' }).click()
  await page.locator('input[aria-label="版本名称"]').fill(name)
  await page.locator('input[aria-label="目标岗位"]').fill(role)
  await versionSection.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(500)
  await clearToasts(page)
}
await versionSection.getByRole('button', { name: '展开' }).click()
await page.waitForTimeout(400)
await versionSection.screenshot({ path: path.join(OUT, '06-版本库.png') })

// ---- 07 面试追问清单 ----
await page.getByRole('button', { name: /面试追问/ }).click()
const interviewHeader = page.getByText('🎯 面试追问清单')
await interviewHeader.waitFor({ timeout: 15000 })
await clearToasts(page)
await page.waitForTimeout(400)
const interviewCard = interviewHeader.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
await interviewCard.screenshot({ path: path.join(OUT, '07-面试追问.png') })

await browser.close()
console.log('截图已输出到', OUT)