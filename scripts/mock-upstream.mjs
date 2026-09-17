// 本地 mock OpenAI 兼容上游：用于无需真实 Key 验证流式链路
// 用法：node scripts/mock-upstream.mjs  →  http://127.0.0.1:8787/v1/chat/completions
// 然后在工具设置里填 服务地址 http://127.0.0.1:8787/v1、Key 任意、模型 mock-model
import http from 'node:http'

const REPLY = '## 新增能力\n\n- 为上传模块新增大文件分片上传能力，弱网场景可用 「源8」\n\n## 问题修复\n\n- 修复详情页偶发白屏问题 「源2」'

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let parsed = {}
      try {
        parsed = JSON.parse(body || '{}')
      } catch {
        // 忽略非法 JSON
      }
      const stream = parsed.stream === true
      if (!stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: REPLY } }] }))
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      })
      const parts = REPLY.match(/[\s\S]{1,6}/g) ?? []
      let i = 0
      const timer = setInterval(() => {
        if (i < parts.length) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`)
        } else {
          res.write('data: [DONE]\n\n')
          res.end()
          clearInterval(timer)
        }
      }, 200)
    })
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'not found' } }))
})

server.listen(8787, '127.0.0.1', () => {
  console.log('mock upstream: http://127.0.0.1:8787/v1/chat/completions')
})
