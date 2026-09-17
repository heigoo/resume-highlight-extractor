// E2E mock：拦截 /api/ai，按请求特征返回 SSE 流式 / JSON / JD 关键词响应
import type { Page, Route } from '@playwright/test'

export const MOCK_SETTINGS = {
  baseUrl: 'https://mock-ai.local/v1',
  apiKey: 'sk-e2e-test',
  model: 'mock-model',
}

// 与 MOCK_RECORDS 对应：出处编号指向真实非空行号
export const MOCK_REPLY = `## 新增能力

- 为上传模块新增大文件分片上传与失败自动重试能力 「源8,10」
- 面试展开点：分片大小是按弱网实测取舍的

## 优化提升

- 推动接口字段规范统一改造，覆盖 9 个接口、32 处调用点 「源5」
- 推动长列表性能优化，引入虚拟滚动 「源11」
- 系统性清零项目类型检查告警（93 项 → 0），建立类型基线 「源3」
- 重构部署脚本，环境参数抽离到环境变量 「源13」

## 问题修复

- 修复详情页偶发白屏问题，恢复正常可用 「源2」
- 排查线上偶发报错问题`

export const MOCK_JD_KEYWORDS = ['接口规范', '性能优化', 'TypeScript']

// 「换个说法」的重写结果
export const MOCK_REWRITE = '主导上传模块分片方案落地，弱网场景失败自动重试，可用性提升'

// 「按缺失关键词补充提炼」的结果
export const MOCK_SUPPLEMENT = `## 新增能力

- 为列表筛选补充多条件组合查询与筛选记忆能力 「源7」`

// 「找不到素材」的诚实回复
export const MOCK_NO_MATERIAL = '无相关素材'

// 面试追问（F4）：5 个问题，前两条带「关联：第N条」标注
export const MOCK_INTERVIEW = `1. 分片上传覆盖的调用点是怎么统计出来的？（关联：第1条）
2. 弱网场景下失败自动重试的成功率有数据吗？（关联：第1条）
3. 这个改造里你个人负责哪一部分？（关联：第2条）
4. 接口字段规范统一改造最大的阻力是什么？
5. 如果重做一次，你会先做什么？`

// 追问细节（F5）第一步：2-3 个补强问题
export const MOCK_DETAIL_ASK = `1. 分片上传的具体规模是多少（接口数 / 调用点数量）？
2. 有没有量化结果（成功率、耗时、覆盖率）？
3. 这块方案里你个人的分工边界是什么？`

// 追问细节（F5）第二步：结合回答改写的单条亮点（数字均在回答里给出）
export const MOCK_DETAIL_FILL =
  '主导上传模块分片上传能力落地，分片大小按弱网实测定稿，失败自动重试覆盖 10 个接口'

// 中英翻译（F9）
export const MOCK_TRANSLATE = `## New capabilities

- Built chunked upload with automatic retry for large files`

// 面试模拟点评（流式）：4 行结构化反驳/补充建议
export const MOCK_PRACTICE = `· 答到点上：说清了分片大小按弱网实测定的，覆盖了「数字来源」
· 与亮点一致：2MB 与条目里的数字一致，没有夸大
· 还缺：失败自动重试的覆盖率与联调方分工边界
· 建议表达：结论先行——「分片大小 2MB 是按弱网实测定的，我主导方案与实现」`

export const MOCK_RECORDS = `09-01 日报
- 修复详情页偶发白屏：接口报错没兜底，补上错误处理后恢复
- 类型清理：积压的 TS 报错从 93 个清到 0

09-03
接口字段规范改造收尾，9 个接口、32 处调用点全部切到新字段

09-05 git log
a3f92c1 feat(list): 列表筛选支持多条件组合
7d21e08 feat(upload): 大文件分片上传，失败自动重试

09-08 待办
[x] 分片大小定稿：按弱网场景实测取 2MB
[ ] 长列表优化前后性能对比补测

09-12
- 部署脚本整理：环境参数抽到环境变量`

export const MOCK_JD = `岗位职责：负责核心业务前端开发，推动接口字段规范与性能优化落地。
任职要求：熟悉 TypeScript，了解性能优化方法，有大型项目经验优先。`

export async function seedSettings(page: Page): Promise<void> {
  await page.addInitScript((settings) => {
    localStorage.setItem('rhe.ai.settings', JSON.stringify(settings))
  }, MOCK_SETTINGS)
}

function sseBody(text: string): string {
  const chunks = text.match(/[\s\S]{1,8}/g) ?? []
  const events = chunks.map(
    (c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`,
  )
  return events.join('') + 'data: [DONE]\n\n'
}

export interface MockAiOptions {
  /** 非流式响应内容（同时用于流式拆包） */
  reply?: string
  /** 「换个说法」单条重写的响应内容 */
  rewriteReply?: string
  /** 「按缺失关键词补充提炼」的响应内容 */
  supplementReply?: string
  /** 面试追问（F4）的响应内容 */
  interviewReply?: string
  /** 追问细节第一步（F5 提问）的响应内容 */
  detailAskReply?: string
  /** 追问细节第二步（F5 改写，非流式）的响应内容 */
  detailFillReply?: string
  /** 中英翻译（F9）的响应内容 */
  translateReply?: string
  /** 面试模拟点评的响应内容 */
  practiceReply?: string
  /** 返回该 HTTP 状态码（模拟 401 等） */
  status?: number
  /** 响应前延迟（ms），用于测试停止/中止 */
  delayMs?: number
  /** 仅重写分支的响应延迟（ms），用于测试改写互斥 */
  rewriteDelayMs?: number
  /** 仅面试追问分支的响应延迟（ms），用于测试并发禁用 */
  interviewDelayMs?: number
}

export async function mockAi(page: Page, options: MockAiOptions = {}): Promise<void> {
  await page.route('**/api/ai', async (route: Route) => {
    const body = route.request().postDataJSON() as {
      stream?: boolean
      messages?: Array<{ content: string }>
    }
    const prompt = body?.messages?.[0]?.content ?? ''
    const isRewrite = prompt.includes('只改表达，不改事实')
    const isSupplement = prompt.includes('还没有被覆盖')
    const isInterview = prompt.includes('面试官最可能追问的问题')
    const isDetailAsk = prompt.includes('请提出 2-3 个问题帮我补全')
    const isDetailFill = prompt.includes('只能使用原始记录与我的回答里出现过的事实与数字')
    const isTranslate = prompt.includes('简历翻译专家')
    const isPractice = prompt.includes('候选人准备把下面的亮点写进简历')
    if (isRewrite && options.rewriteDelayMs) {
      await new Promise((r) => setTimeout(r, options.rewriteDelayMs))
    } else if (isInterview && options.interviewDelayMs) {
      await new Promise((r) => setTimeout(r, options.interviewDelayMs))
    } else if (options.delayMs) {
      await new Promise((r) => setTimeout(r, options.delayMs))
    }
    if (options.status !== undefined) {
      await route.fulfill({
        status: options.status,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Invalid API key' } }),
      })
      return
    }
    if (body?.stream) {
      const reply = isInterview
        ? (options.interviewReply ?? MOCK_INTERVIEW)
        : isDetailAsk
          ? (options.detailAskReply ?? MOCK_DETAIL_ASK)
          : isTranslate
            ? (options.translateReply ?? MOCK_TRANSLATE)
            : isPractice
              ? (options.practiceReply ?? MOCK_PRACTICE)
              : (options.reply ?? MOCK_REPLY)
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody(reply),
      })
      return
    }
    // 单条重写：识别重写指令的特征文案
    if (isRewrite) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: options.rewriteReply ?? MOCK_REWRITE } }],
        }),
      })
      return
    }
    // 追问细节第二步：识别「只用原记录与我的回答」特征文案
    if (isDetailFill) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: options.detailFillReply ?? MOCK_DETAIL_FILL } }],
        }),
      })
      return
    }
    // 补充提炼：识别「还没有被覆盖」特征文案
    if (isSupplement) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: options.supplementReply ?? MOCK_SUPPLEMENT } }],
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: options.reply ?? MOCK_REPLY } }],
      }),
    })
  })
}
