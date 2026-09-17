export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  }
}

// 复制富文本：同时写入 HTML 与纯文本两种口味，粘贴进 Word / 在线编辑器保留加粗与列表；
// 浏览器不支持 ClipboardItem 时退回纯文本
export async function copyRichHtml(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined') return copyText(text)
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ])
    return true
  } catch {
    return copyText(text)
  }
}