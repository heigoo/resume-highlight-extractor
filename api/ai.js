// 同源转发：浏览器 → /api/ai → 上游 /chat/completions
// 上游地址由前端通过 X-Upstream-Url 头提供，API Key 经 Authorization 头透传，
// 本函数不做任何存储，仅转发请求与响应。

// http 明文仅允许回环地址（本机 Ollama 等本地模型）：流量不出本机，
// Key 不会被跨网明文传输；远程地址一律要求 https
function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(host)
  )
}

export async function POST(request) {
  const upstream = request.headers.get('x-upstream-url') ?? ''
  let target
  try {
    target = new URL(upstream)
  } catch {
    return Response.json({ error: { message: 'X-Upstream-Url 不是合法地址' } }, { status: 400 })
  }
  const httpsOk = target.protocol === 'https:'
  const httpLoopbackOk = target.protocol === 'http:' && isLoopbackHost(target.hostname)
  if (!httpsOk && !httpLoopbackOk) {
    return Response.json(
      { error: { message: '仅支持 https 上游地址；http 仅限本地回环地址（localhost / 127.x）' } },
      { status: 400 },
    )
  }

  const auth = request.headers.get('authorization') ?? ''
  let res
  try {
    res = await fetch(target.origin + target.pathname + target.search, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth !== '' ? { Authorization: auth } : {}),
      },
      body: await request.text(),
    })
  } catch (e) {
    return Response.json(
      { error: { message: `转发失败：${e instanceof Error ? e.message : '未知错误'}` } },
      { status: 502 },
    )
  }

  // 直接转发字节流：上游 SSE 流式响应与普通 JSON 都原样透传，
  // 不做缓冲，保证前端流式渲染不被代理阻断。
  // 响应头按白名单只回传 Content-Type：fetch 已自动解压响应体，带上
  // content-encoding / content-length 等上游实体头会让浏览器按错误编码解码；
  // 更重要的是透传 Set-Cookie 会让（恶意或被入侵的）上游借本代理向
  // 用户浏览器注入 Cookie（Cookie 固定 / 会话劫持），安全默认是一律丢弃
  const headers = {
    'Content-Type': res.headers.get('content-type') ?? 'application/json',
    'Cache-Control': 'no-cache',
  }
  if (res.body) {
    return new Response(res.body, { status: res.status, headers })
  }
  return new Response(await res.text(), { status: res.status, headers })
}
