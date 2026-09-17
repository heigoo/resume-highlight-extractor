// AI 直连：调用 OpenAI 兼容的 /chat/completions 接口

export interface AiSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export const STORAGE_KEY = 'rhe.ai.settings'

export function loadAiSettings(): AiSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AiSettings>
    const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
    if (filled(parsed.baseUrl) && filled(parsed.apiKey) && filled(parsed.model)) {
      return { baseUrl: parsed.baseUrl, apiKey: parsed.apiKey, model: parsed.model }
    }
    return null
  } catch {
    return null
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

// 统一成纯 base 地址：去首尾空格、结尾斜杠与 /chat/completions 后缀
export function normalizeBaseUrl(url: string): string {
  let base = url.trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  if (base.endsWith('/chat/completions')) {
    base = base.slice(0, -'/chat/completions'.length)
    while (base.endsWith('/')) base = base.slice(0, -1)
  }
  return base
}

export class AiHttpError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(`HTTP ${status}`)
    this.name = 'AiHttpError'
    this.status = status
    this.detail = detail
  }
}

function endpoint(settings: AiSettings): string {
  return `${normalizeBaseUrl(settings.baseUrl)}/chat/completions`
}

// 从错误响应体里取 error.message，取不到就返回空字符串
async function errorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: unknown } }
    const msg = data?.error?.message
    if (typeof msg === 'string' && msg.trim() !== '') return msg.trim()
  } catch {
    // 响应体不是 JSON 时忽略
  }
  return ''
}

// 浏览器不直连上游（多数服务商禁止 CORS），统一走同源代理 /api/ai，
// 上游真实地址放在请求头里由代理转发
const PROXY_URL = '/api/ai'

// 单次请求的整体超时（含流式接收阶段）：推理型模型长思考可接受，但网关挂起要能收场
export const AI_TIMEOUT_MS = 240_000

export class AiTimeoutError extends Error {
  constructor() {
    const minutes = Math.round(AI_TIMEOUT_MS / 60_000)
    super(`AI 太久没回应（超过 ${minutes} 分钟）：请再点一次「重新提炼」，或到设置里换个模型`)
    this.name = 'AiTimeoutError'
  }
}

// 把外部 signal 与超时合并成一个 signal（不用 AbortSignal.any，兼容面更广）
function withTimeout(signal?: AbortSignal): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = (): void => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort)
  }
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, AI_TIMEOUT_MS)
  return {
    signal: controller.signal,
    done: () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
    timedOut: () => timedOut,
  }
}

export async function callAi(
  settings: AiSettings,
  prompt: string,
  signal?: AbortSignal,
  onDelta?: (chunk: string) => void,
): Promise<string> {
  const stream = typeof onDelta === 'function'
  const timeout = withTimeout(signal)
  let res: Response
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upstream-Url': endpoint(settings),
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: prompt }],
        stream,
        max_tokens: 4096,
      }),
      signal: timeout.signal,
    })
  } catch (e) {
    timeout.done()
    if (timeout.timedOut()) throw new AiTimeoutError()
    throw e
  }
  if (!res.ok) {
    const detail = await errorDetail(res)
    timeout.done()
    throw new AiHttpError(res.status, detail)
  }

  try {
    if (!stream) return extractJsonContent(await res.text())
    return await readSseStream(res, onDelta)
  } catch (e) {
    if (timeout.timedOut()) throw new AiTimeoutError()
    throw e
  } finally {
    timeout.done()
  }
}

// AI 空回复的统一提示：给用户下一步动作，响应原文片段改走 console 便于排查
const EMPTY_REPLY_HINT = 'AI 没返回内容：请再点一次「重新提炼」；多次如此就到设置里换个模型'

// 非流式：从响应 JSON 里取 message.content
function extractJsonContent(raw: string): string {
  let content: unknown
  try {
    const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> }
    content = data?.choices?.[0]?.message?.content
  } catch {
    content = undefined
  }
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error(EMPTY_REPLY_HINT)
  }
  return content.trim()
}

export interface SseContent {
  /** delta 增量片段（标准流式响应） */
  delta: string
  /** 整段内容（个别兼容端点忽略 stream:true，一次性返回 message.content） */
  message: string
}

// 从流式响应的一行文本提取内容；无法解析返回 null。
// 兼容三种行格式：
// 1. 标准 SSE：data: {"choices":[{"delta":{"content":"…"}}]}
// 2. [DONE] 结束标记 → null
// 3. 裸 JSON 行（Ollama 原生 /api/chat 及部分网关的 NDJSON 流）：{"choices":[…]}
export function parseSseDataLine(line: string): SseContent | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let payload: string
  if (trimmed.startsWith('data:')) {
    payload = trimmed.slice(5).trim()
  } else if (trimmed.startsWith('{')) {
    payload = trimmed
  } else {
    return null
  }
  if (!payload || payload === '[DONE]') return null
  try {
    const data = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>
    }
    const choice = data?.choices?.[0]
    const delta = choice?.delta?.content
    if (typeof delta === 'string' && delta !== '') return { delta, message: '' }
    const message = choice?.message?.content
    if (typeof message === 'string' && message !== '') return { delta: '', message }
    return null
  } catch {
    return null
  }
}

// 流式读取：逐块解码 SSE，解析出的增量通过 onDelta 回调逐字上屏
async function readSseStream(res: Response, onDelta: (chunk: string) => void): Promise<string> {
  if (!res.body) throw new Error(EMPTY_REPLY_HINT)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let jsonFallback = ''
  let full = ''

  const handleLine = (line: string) => {
    const content = parseSseDataLine(line)
    if (!content) return
    if (content.delta !== '') {
      full += content.delta
      onDelta(content.delta)
    } else if (content.message !== '' && full === '') {
      full = content.message
      onDelta(content.message)
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    jsonFallback += chunk
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, nl).replace(/\r$/, ''))
      buffer = buffer.slice(nl + 1)
    }
  }
  handleLine(buffer.replace(/\r$/, ''))

  if (full.trim() === '') {
    // 上游忽略 stream:true 直接回了整体 JSON：按非流式解析兜底
    try {
      const data = JSON.parse(jsonFallback) as { choices?: Array<{ message?: { content?: unknown } }> }
      const content = data?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.trim() !== '') return content.trim()
    } catch {
      // 既没有流式增量也不是整体 JSON
    }
  }
  if (full.trim() === '') {
    // 响应原文只写进控制台便于排查（格式不匹配等），界面提示说人话
    const snippet = jsonFallback.trim().replace(/\s+/g, ' ').slice(0, 120)
    if (snippet !== '') console.warn('[rhe] AI 空响应，返回内容开头：', snippet)
    throw new Error(EMPTY_REPLY_HINT)
  }
  return full.trim()
}

export async function testConnection(settings: AiSettings): Promise<{ ok: boolean; message: string }> {
  const timeout = withTimeout()
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upstream-Url': endpoint(settings),
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: timeout.signal,
    })
    if (!res.ok) return { ok: false, message: describeAiError(new AiHttpError(res.status, await errorDetail(res))) }
    return { ok: true, message: '连接正常' }
  } catch (e) {
    return { ok: false, message: timeout.timedOut() ? new AiTimeoutError().message : describeAiError(e) }
  } finally {
    timeout.done()
  }
}

export function describeAiError(e: unknown): string {
  if (e instanceof AiHttpError) {
    if (e.status === 401 || e.status === 403)
      return '密钥（Key）不正确或没有权限：请到设置里重新粘贴一次 Key，再点「测试连接」'
    if (e.status === 429) return '请求太频繁了：等几秒再点「重新提炼」'
    const detail = e.detail.length > 120 ? e.detail.slice(0, 120) : e.detail
    return detail === ''
      ? `AI 服务出错（HTTP ${e.status}）：稍后重试；一直失败就到设置里换个服务网址或 Key`
      : `AI 服务出错（HTTP ${e.status}）：${detail}`
  }
  if (isAbortError(e)) return '已停止本次提炼'
  // 网络层失败（fetch 抛 TypeError）才指向连接问题；业务错误要透出真实原因，
  // 否则「AI 没返回内容」这类问题会被误报成连不上服务
  if (e instanceof TypeError) {
    return '连不上 AI 服务：请检查网络，并到设置里确认服务网址与 Key；也可以改用左栏「备用」区手动提炼'
  }
  if (e instanceof Error && e.message.trim() !== '') return e.message
  return '提炼失败：请再点一次「重新提炼」'
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}
