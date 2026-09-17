// 核心流程 GIF 生成：对真实运行的界面走一遍「粘记录 → 一键提炼 → 流式结果 → 出处/评分」，
// 逐帧截图后用 gifenc 合成 GIF（无需 ffmpeg）。
// 用法：node scripts/make-core-gif.mjs
// 与 capture-article-shots.mjs 的差别：起本地「滴流」SSE 服务器并经 vite 代理转发，
// 让流式提炼以真实打字机节奏逐字出现（page.route 的整包 fulfill 无法呈现渐进渲染）。
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { PNG } from 'pngjs'
import gifenc from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = gifenc
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'article', 'screenshots')
const OUT_FILE = path.join(OUT, '09-核心流程.gif')
const PORT = 5199
const DRIP_PORT = 8791
const DRIP_MS = 140 // 突发间隔：需大于应用内 120ms 流式解析防抖，实时预览才会逐段上屏

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

// AI 回复（提炼结果）：与文章「成果展示」三组示例一一对应
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 本地滴流 SSE 服务器：冒充同源代理 /api/ai 的上游响应 ----
function startDripServer() {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let parsed = {}
      try {
        parsed = JSON.parse(body)
      } catch {}
      if (!parsed?.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: REPLY } }] }))
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      })
      res.flushHeaders()
      // 突发式滴流：每 140ms 一段（段间隔 > 应用内 120ms 的流式解析防抖，
      // 实时预览才能逐段上屏；也贴近真实服务商「突发 + 间歇」的出词节奏）
      const chunks = REPLY.match(/[\s\S]{1,18}/g) ?? []
      let i = 0
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          res.write('data: [DONE]\n\n')
          res.end()
          clearInterval(timer)
          return
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`)
      }, DRIP_MS)
      // 客户端断开时停止滴流（注意：req 的 close 在请求体读完即触发，不能用它清理）
      res.on('close', () => clearInterval(timer))
    })
  })
  return new Promise((resolve) => server.listen(DRIP_PORT, '127.0.0.1', () => resolve(server)))
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const drip = await startDripServer()
  const vite = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: {
      port: PORT,
      strictPort: true,
      proxy: { '/api/ai': `http://127.0.0.1:${DRIP_PORT}` },
    },
  })
  await vite.listen()

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1024, height: 720 }, // lg 双栏下限；DSF=1 + 适中尺寸控制 GIF 体积
    locale: 'zh-CN',
    colorScheme: 'light',
  })
  const page = await context.newPage()
  const consoleLogs = []
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/ai')) consoleLogs.push(`[net] ${r.status()} ${r.url()} ${r.headers()['content-type'] ?? ''}`)
  })

  // 预置：已连接 AI、已看过引导（画面里不出现一次性提示）
  await page.addInitScript((settings) => {
    localStorage.setItem('rhe.ai.settings', JSON.stringify(settings))
    localStorage.setItem('rhe.onboarded', '1')
    localStorage.setItem('rhe.resultGuide.v1', '1')
    localStorage.setItem('rhe.theme', 'light')
  }, SETTINGS)
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1200) // 等入场动画收尾

  // ---- CDP screencast 抓帧：只在画面变化时给帧并带时间戳，不占用操作通道 ----
  const rawFrames = [] // { data, ts(ms) }
  const cdp = await context.newCDPSession(page)
  await cdp.send('Page.enable')
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    rawFrames.push({ data, ts: metadata.timestamp * 1000 })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'png',
    everyNthFrame: 1,
    maxWidth: 1024,
    maxHeight: 720,
  })
  await page.screenshot({ timeout: 8000 }) // 强制一帧，确保开场画面入镜

  const mainTop = async () =>
    page.evaluate(() => {
      const el = document.querySelector('main')
      return el.getBoundingClientRect().top + window.scrollY
    })

  // ---- 走一遍核心流程 ----
  await sleep(700)
  // 滚到主区域，让输入框与结果区同框
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), await mainTop())
  await sleep(400)
  // ① 粘：一次性粘贴原始记录（与产品叙事一致）
  await page.locator('textarea[placeholder^="把 git 提交日志"]').fill(RECORDS)
  await sleep(600)
  // ② 贰：粘贴目标岗位 JD（关键词芯片即时出现）
  const jdSection = page.locator('section', { has: page.getByRole('heading', { name: '对标岗位 JD' }) })
  await jdSection.getByRole('button', { name: '展开' }).click()
  await page.locator('textarea[placeholder^="把目标岗位的 JD"]').fill(JD)
  await sleep(700)
  // ③ 炼：点主按钮，滚回双栏顶部让流式过程入镜
  await page.getByRole('button', { name: /一键提炼/ }).click()
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), await mainTop())
  await sleep(300)
  try {
    await page.getByText(/提炼完成：共/).waitFor({ timeout: 30000 })
  } catch (e) {
    await page.screenshot({ path: path.join(ROOT, 'scripts', 'gif-debug.png'), fullPage: true })
    console.error('=== 调试信息 ===\n' + consoleLogs.join('\n'))
    throw e
  }
  await sleep(1600) // 结果 + 完成提示同框
  // ④ 出处对照：点开「源5」芯片，展开原始记录引用
  await page.getByRole('button', { name: /源 05/ }).first().click()
  await sleep(1800)
  // ⑤ 评分明细：展开扣分明细
  await page.locator('button.score-chip').click()
  await sleep(1600)
  // ⑥ 滚动看分组与【待补】，再回到顶部收尾
  await page.mouse.wheel(0, 420)
  await sleep(1500)
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), await mainTop())
  await sleep(1000)

  await cdp.send('Page.stopScreencast')
  if (rawFrames.length === 0) throw new Error('screencast 未产出任何帧')

  // ---- 帧整理：8fps 降采样 → 时长计算 → 长静止合并（≤2s） ----
  rawFrames.sort((a, b) => a.ts - b.ts)
  const kept = []
  for (const f of rawFrames) {
    if (kept.length === 0 || f.ts - kept[kept.length - 1].ts >= 125) kept.push(f)
  }
  const tEnd = rawFrames[rawFrames.length - 1].ts + 400
  const split = []
  for (let i = 0; i < kept.length; i += 1) {
    let d = (i + 1 < kept.length ? kept[i + 1].ts : tEnd) - kept[i].ts
    while (d > 0) {
      const step = Math.min(1000, d)
      split.push({ data: kept[i].data, dt: step })
      d -= step
    }
  }
  const frames = []
  for (const f of split) {
    const last = frames[frames.length - 1]
    if (last && last.data === f.data && last.dt + f.dt <= 2000) last.dt += f.dt
    else frames.push({ ...f })
  }

  await browser.close()
  await vite.close()
  drip.close()

  // ---- 合成 GIF：全局调色板（采样 3 帧合并）+ 每帧 LZW ----
  const pngs = frames.map((f) => ({ png: PNG.sync.read(Buffer.from(f.data, 'base64')), dt: f.dt }))
  const sampleIdx = [0, Math.floor(pngs.length / 2), pngs.length - 1]
  const mergedLen = sampleIdx.reduce((n, i) => n + pngs[i].png.data.length, 0)
  const merged = new Uint8Array(mergedLen)
  let off = 0
  for (const i of sampleIdx) {
    merged.set(pngs[i].png.data, off)
    off += pngs[i].png.data.length
  }
  const palette = quantize(merged, 160, { format: 'rgb565' })
  const gif = GIFEncoder()
  for (const { png, dt } of pngs) {
    const index = applyPalette(png.data, palette, 'rgb565')
    gif.writeFrame(index, png.width, png.height, {
      palette,
      delay: Math.max(30, Math.round(dt / 10) * 10),
    })
  }
  gif.finish()
  await writeFile(OUT_FILE, gif.bytes())

  // 调试：导出关键帧 PNG 目检（DEBUG_FRAMES=1 时）
  if (process.env.DEBUG_FRAMES) {
    const dbgDir = path.join(ROOT, 'scripts', 'gif-frames')
    await mkdir(dbgDir, { recursive: true })
    const stride = Math.max(1, Math.floor(pngs.length / 16))
    for (let i = 0; i < pngs.length; i += stride) {
      await writeFile(path.join(dbgDir, `frame-${String(i).padStart(3, '0')}.png`), PNG.sync.write(pngs[i].png))
    }
  }

  const durationMs = pngs.reduce((n, f) => n + f.dt, 0)
  const sizeMB = (gif.bytes().length / 1024 / 1024).toFixed(2)
  console.log(
    `GIF 已生成: ${OUT_FILE}\n帧数 ${pngs.length} · 时长 ${(durationMs / 1000).toFixed(1)}s · ` +
      `平均帧率 ${(pngs.length / (durationMs / 1000)).toFixed(1)}fps · 体积 ${sizeMB}MB · 尺寸 ${pngs[0].png.width}x${pngs[0].png.height}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
