// 真机全流程验证：真实 UI + 真实 AI 服务（经 /api/ai 同源代理）
// 用法（Key 走环境变量，不写入本文件）：
//   $env:VERIFY_BASE_URL='https://xxx/v1'; $env:VERIFY_KEY='tp-xxx'; node scripts/verify-real-flow.mjs
// 前置：iga pages dev 已在本机 3000 端口运行
import { chromium } from '@playwright/test'

const BASE = process.env.VERIFY_BASE_URL ?? ''
const KEY = process.env.VERIFY_KEY ?? ''
const MODEL = process.env.VERIFY_MODEL ?? 'mimo-v2.5-pro'
const APP = process.env.VERIFY_APP ?? 'http://localhost:3000'

if (!BASE || !KEY) {
  console.error('缺少 VERIFY_BASE_URL / VERIFY_KEY 环境变量')
  process.exit(1)
}

const stages = []
const log = (name, detail = '') => {
  const line = `[verify] ${name}${detail ? ' — ' + detail : ''}`
  console.log(line)
  stages.push({ name, detail })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const JD = `岗位职责：
1. 负责核心业务前端开发，推动性能优化与体验提升；
2. 深入理解 TypeScript，推动工程化规范落地；
3. 与后端协作完成接口字段规范治理。
任职要求：熟悉性能优化方法论，有大型项目协作经验优先。`

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, locale: 'zh-CN' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

const t0 = Date.now()
try {
  // 注入连接设置（等价于用户在设置面板保存 BYOK）
  await page.addInitScript(
    ([settings]) => localStorage.setItem('rhe.ai.settings', JSON.stringify(settings)),
    [{ baseUrl: BASE, apiKey: KEY, model: MODEL }],
  )
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  log('打开应用', APP)

  // ---- 1. 设置面板：测试连接（429 时等待重试） ----
  await page.getByRole('button', { name: /AI 已连接|连接 AI/ }).click()
  const baseUrlInput = page.getByPlaceholder('https://api.deepseek.com')
  await expectValue(baseUrlInput, BASE)
  await expectValue(page.getByLabel('模型名'), MODEL)

  let connected = false
  for (let attempt = 1; attempt <= 3 && !connected; attempt += 1) {
    await page.getByRole('button', { name: '测试连接' }).click()
    const result = page.locator('span[role="status"]')
    await result.waitFor({ state: 'visible', timeout: 60_000 })
    const text = (await result.textContent()) ?? ''
    if (text.includes('✓')) {
      connected = true
      log('测试连接', text.trim())
    } else if (/429|频率/.test(text)) {
      log(`测试连接第 ${attempt} 次被限流，等待 30s 重试`, text.trim())
      await sleep(30_000)
    } else {
      throw new Error(`测试连接失败：${text.trim()}`)
    }
  }
  if (!connected) throw new Error('测试连接多次限流，放弃')
  await page.getByRole('button', { name: '关闭' }).click()

  // ---- 2. 输入：首访引导一键示例（或直接填示例）+ 粘贴 JD ----
  const onboardingButton = page.getByRole('button', { name: '填入示例试一试' })
  if (await onboardingButton.isVisible().catch(() => false)) {
    await onboardingButton.click()
    await onboardingButton.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  } else {
    await page.getByRole('button', { name: '填入示例' }).first().click()
  }
  await page.getByRole('button', { name: '展开' }).first().click()
  await page.getByPlaceholder('把目标岗位的 JD').fill(JD)
  await expectVisible(page.getByText('性能优化', { exact: true }))
  log('输入就绪', '示例记录 + JD 关键词本地提取')

  // ---- 3. 一键提炼（流式 + 推理模型长思考，含 429 自动重试） ----
  let extracted = false
  for (let attempt = 1; attempt <= 3 && !extracted; attempt += 1) {
    await page.getByRole('button', { name: /^一键提炼/ }).click()
    await sleep(1500) // 等状态先切到「提炼中」，避免用旧结果误判终态
    // 等待终态：主按钮退出「点击停止」态且结果区已出条目 / 错误条出现
    // 注意 waitForFunction 的签名是 (fn, arg, options)，options 必须放第三位
    await page.waitForFunction(
      () => {
        const buttons = [...document.querySelectorAll('button')]
        const busy = buttons.some((b) => (b.textContent ?? '').includes('点击停止'))
        const items = document.querySelectorAll('li[data-hl]').length
        const alert = document.querySelector('[role="alert"]')
        const alertVisible =
          alert !== null && (alert.textContent ?? '').trim() !== '' && alert.offsetParent !== null
        return (!busy && items > 0) || alertVisible
      },
      null,
      { timeout: 300_000, polling: 500 },
    )
    const alert = page.locator('[role="alert"]')
    if (await alert.isVisible().catch(() => false)) {
      const msg = ((await alert.textContent()) ?? '').trim()
      if (/429|频率/.test(msg)) {
        log(`提炼第 ${attempt} 次被限流，通过「重试提炼」前等待 30s`, msg)
        await sleep(30_000)
        await alert.getByRole('button', { name: /重试提炼/ }).click()
        continue
      }
      throw new Error(`提炼失败：${msg}`)
    }
    extracted = true
  }
  if (!extracted) throw new Error('提炼多次限流，放弃')
  await expectVisible(page.getByRole('heading', { name: '提炼结果' }))
  await expectVisible(page.getByRole('button', { name: /评分/ }))
  log('一键提炼完成', `耗时 ${Math.round((Date.now() - t0) / 1000)}s（累计）`)

  // ---- 4. 结果质量断言：分组 / 出处 / 评分明细 ----
  await expectVisible(page.getByRole('button', { name: /源 \d/ }).first())
  await page.getByRole('button', { name: /评分/ }).click()
  log('结果断言', '分组、出处芯片、评分扣分明细可见')

  // ---- 5. 行内编辑 + 勾选取舍 ----
  await page.getByRole('button', { name: '✎ 编辑' }).first().click()
  const editBox = page.getByLabel('编辑亮点')
  await editBox.fill('（真机验证）手工微调这条亮点表达')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expectVisible(page.getByText('（真机验证）手工微调这条亮点表达'))

  const checkboxes = page.getByLabel(/纳入导出：/)
  const total = await checkboxes.count()
  await checkboxes.nth(total - 1).uncheck()
  log('行内编辑与勾选', `共 ${total} 条，取消最后一条导出`)

  // ---- 6. 导出（复制 + Word 下载） ----
  await page.getByRole('button', { name: '一键复制' }).click()
  await expectVisible(page.getByText(/已复制到剪贴板/))
  const docxDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 Word' }).click()
  const download = await docxDownload
  log('导出', `复制成功 + Word（${download.suggestedFilename()}）`)

  // ---- 7. 存为版本 ----
  const versionSection = page.locator('section', { hasText: '版本库' }).first()
  await versionSection.getByRole('button', { name: '存为版本' }).click()
  await page.getByLabel('版本名称').fill('MiMo真机验证')
  await versionSection.getByRole('button', { name: '保存', exact: true }).click()
  await expectVisible(page.getByText(/已存为版本「MiMo真机验证」/))
  // 展开列表按角色断言条目（收起态内容 aria-hidden，role 查询看不到）
  await versionSection.getByRole('button', { name: '展开' }).click()
  await expectVisible(versionSection.getByRole('button', { name: 'MiMo真机验证' }))
  log('版本库', '已存为「MiMo真机验证」')

  // ---- 截图留档 ----
  await page.screenshot({ path: 'test-results/real-flow/final.png', fullPage: true })
  log('截图', 'test-results/real-flow/final.png')
} catch (e) {
  await page.screenshot({ path: 'test-results/real-flow/failure.png', fullPage: true }).catch(() => {})
  console.error('[verify] 失败：', e instanceof Error ? e.message : e)
  if (pageErrors.length) console.error('[verify] 页面 JS 错误：', pageErrors)
  process.exitCode = 1
} finally {
  console.log(`[verify] 总耗时 ${Math.round((Date.now() - t0) / 1000)}s`)
  if (pageErrors.length) console.error('[verify] 收集到的页面错误：', pageErrors)
  await browser.close()
}

async function expectVisible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 30_000 })
}
async function expectValue(locator, value) {
  await locator.waitFor({ state: 'visible', timeout: 10_000 })
  const actual = await locator.inputValue()
  if (actual !== value) throw new Error(`输入框值不符：期望 ${value}，实际 ${actual}`)
}
