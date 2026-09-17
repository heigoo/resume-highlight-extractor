import { describe, expect, it } from 'vitest'
import {
  AiHttpError,
  describeAiError,
  isAbortError,
  normalizeBaseUrl,
  parseSseDataLine,
  type AiSettings,
} from '../../src/lib/ai'

describe('normalizeBaseUrl', () => {
  it('去尾部斜杠', () => {
    expect(normalizeBaseUrl('https://api.test.com/')).toBe('https://api.test.com')
  })

  it('剥离 /chat/completions 后缀', () => {
    expect(normalizeBaseUrl('https://api.test.com/v1/chat/completions')).toBe(
      'https://api.test.com/v1',
    )
  })

  it('去首尾空格', () => {
    expect(normalizeBaseUrl('  https://api.test.com  ')).toBe('https://api.test.com')
  })
})

describe('parseSseDataLine', () => {
  it('解析标准 delta 增量', () => {
    const line = 'data: {"choices":[{"delta":{"content":"你好"}}]}'
    expect(parseSseDataLine(line)).toEqual({ delta: '你好', message: '' })
  })

  it('忽略 [DONE] 与非 data 行', () => {
    expect(parseSseDataLine('data: [DONE]')).toBeNull()
    expect(parseSseDataLine(': keep-alive')).toBeNull()
    expect(parseSseDataLine('event: message')).toBeNull()
    expect(parseSseDataLine('')).toBeNull()
  })

  it('兼容忽略 stream:true 的端点（message.content 整段返回）', () => {
    const line = 'data: {"choices":[{"message":{"content":"整段内容"}}]}'
    expect(parseSseDataLine(line)).toEqual({ delta: '', message: '整段内容' })
  })

  it('JSON 分片（跨块截断）返回 null 而不抛错', () => {
    expect(parseSseDataLine('data: {"choices":[{"delta":{"cont')).toBeNull()
  })

  it('空内容 delta 返回 null', () => {
    expect(parseSseDataLine('data: {"choices":[{"delta":{}}]}')).toBeNull()
    expect(parseSseDataLine('data: {"choices":[{"delta":{"content":""}}]}')).toBeNull()
  })

  it('兼容裸 JSON 行（Ollama 原生 / 部分网关的 NDJSON 流）', () => {
    expect(parseSseDataLine('{"choices":[{"delta":{"content":"你好"}}]}')).toEqual({
      delta: '你好',
      message: '',
    })
    expect(parseSseDataLine('  {"choices":[{"message":{"content":"整段"}}]}  ')).toEqual({
      delta: '',
      message: '整段',
    })
  })

  it('reasoning_content 增量不算内容', () => {
    expect(
      parseSseDataLine('data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}'),
    ).toBeNull()
  })
})

describe('describeAiError', () => {
  it('401/403 提示密钥不对，并给出去设置里改的动作', () => {
    expect(describeAiError(new AiHttpError(401, ''))).toContain('密钥（Key）不正确')
    expect(describeAiError(new AiHttpError(403, ''))).toContain('密钥（Key）不正确')
  })

  it('429 提示请求太频繁', () => {
    expect(describeAiError(new AiHttpError(429, ''))).toContain('请求太频繁')
  })

  it('其他状态码带 detail', () => {
    expect(describeAiError(new AiHttpError(500, 'boom'))).toContain('boom')
  })

  it('AbortError 提示已停止', () => {
    const e = new DOMException('aborted', 'AbortError')
    expect(describeAiError(e)).toContain('已停止')
  })

  it('业务错误透出真实原因，不再误报连接故障', () => {
    expect(describeAiError(new Error('AI 没返回内容'))).toBe('AI 没返回内容')
  })

  it('网络层 TypeError 指向连不上服务，并给出可选出路', () => {
    const message = describeAiError(new TypeError('Failed to fetch'))
    expect(message).toContain('连不上 AI 服务')
    expect(message).toContain('备用')
  })
})

describe('isAbortError', () => {
  it('识别 AbortError', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})

// 供类型使用的空设置（仅保证类型导出可用）
describe('AiSettings type', () => {
  it('字段完整', () => {
    const s: AiSettings = { baseUrl: 'https://a.b', apiKey: 'sk-x', model: 'm' }
    expect(s.baseUrl).toBe('https://a.b')
  })
})
