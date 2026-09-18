// 导出落地：文件下载（.md/.txt/.docx）与打印存 PDF。
// 全部在浏览器端完成，不产生任何网络上传。
import { isNoteLine, type Parsed } from './parse'

// 文件名：简历亮点-YYYYMMDD-HHmm.md
export function exportFilename(ext: string): string {
  return `简历亮点-${timestamp()}.${ext}`
}

// 整页简历文件名：简历-YYYYMMDD-HHmm.html
export function resumeFilename(ext: string): string {
  return `简历-${timestamp()}.${ext}`
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }))
}

// DOCX 生成：docx 库按需动态加载，不拖累首屏体积。
// atsFriendly=true 时输出 ATS 友好版式：单栏、无表格、无列表编号定义、标准小节标题
export async function downloadDocx(
  parsed: Parsed,
  filename: string,
  includeNotes: boolean,
  atsFriendly = false,
): Promise<void> {
  const { Document, Packer, Paragraph, HeadingLevel } = await import('docx')
  type ParagraphNode = InstanceType<typeof Paragraph>
  const children: ParagraphNode[] = []
  for (const group of parsed.groups) {
    children.push(
      new Paragraph({
        text: group.title,
        heading: atsFriendly ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      }),
    )
    let hasNormal = false
    for (const item of group.items) {
      const note = isNoteLine(item.text)
      if (note && hasNormal) {
        if (!includeNotes) continue
        children.push(
          atsFriendly
            ? new Paragraph({ text: item.text, indent: { left: 360 } })
            : new Paragraph({ text: item.text, bullet: { level: 1 } }),
        )
        continue
      }
      // ATS 友好版不加列表编号定义，用文本符号保持单栏纯段落结构
      children.push(
        atsFriendly
          ? new Paragraph({ text: `• ${item.text}` })
          : new Paragraph({ text: item.text, bullet: { level: 0 } }),
      )
      hasNormal = true
    }
  }
  const doc = new Document({ sections: [{ children }] })
  downloadBlob(filename, await Packer.toBlob(doc))
}

// 打印 / 存 PDF：A4 排版写入隐藏 iframe 后调起系统打印（浏览器「另存为 PDF」）。
// 用 srcdoc 而非 document.write：内容虽经 esc() 全量转义，document.write 仍是
// XSS 高危 sink；srcdoc 文档还继承本页 CSP，即使未来出现转义遗漏也无法执行脚本
function printHtmlDocument(html: string): void {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'

  let removed = false
  const cleanup = (): void => {
    if (!removed) {
      removed = true
      iframe.remove()
    }
  }
  iframe.addEventListener('load', () => {
    const win = iframe.contentWindow
    if (!win) {
      cleanup()
      return
    }
    win.addEventListener('afterprint', () => window.setTimeout(cleanup, 300))
    win.focus()
    win.print()
  })
  iframe.srcdoc = html
  document.body.appendChild(iframe)
  window.setTimeout(cleanup, 60000) // 兜底清理
}

export function printHighlights(parsed: Parsed, includeNotes: boolean): void {
  printHtmlDocument(buildPrintHtml(parsed, includeNotes))
}

export function buildPrintHtml(parsed: Parsed, includeNotes: boolean): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const sections = parsed.groups
    .map((group) => {
      let hasNormal = false
      const lis = group.items
        .map((item) => {
          const note = isNoteLine(item.text)
          if (note && hasNormal) {
            if (!includeNotes) return ''
            return `<li class="note">${esc(item.text)}</li>`
          }
          hasNormal = true
          return `<li>${esc(item.text)}</li>`
        })
        .join('')
      return `<section><h2>${esc(group.title)}</h2><ul>${lis}</ul></section>`
    })
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>简历亮点</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.7; }
  h2 { font-size: 12.5pt; border-bottom: 1px solid #999; padding-bottom: 2px; margin: 14pt 0 6pt; }
  ul { margin: 0; padding-left: 1.4em; }
  li { margin: 3pt 0; }
  li.note { color: #666; font-size: 10pt; list-style: none; margin-left: -0.9em; }
</style>
</head>
<body>${sections}</body>
</html>`
}

/** 整页简历的抬头信息（都可留空） */
export interface ResumeMeta {
  name: string
  contact: string
  role: string
}

// 整页简历：勾选条目套用单栏 A4 模板，可直接打印 / 存 PDF / 另存 HTML 投递。
// 单栏、无表格、无图形，保持 ATS 可解析；条目内不排版【待补】等标记（保持原文）
export function buildResumeHtml(parsed: Parsed, meta: ResumeMeta, includeNotes: boolean): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const sections = parsed.groups
    .map((group) => {
      let hasNormal = false
      const lis = group.items
        .map((item) => {
          const note = isNoteLine(item.text)
          if (note && hasNormal) {
            if (!includeNotes) return ''
            return `<li class="note">${esc(item.text)}</li>`
          }
          hasNormal = true
          return `<li>${esc(item.text)}</li>`
        })
        .join('')
      return `<section><h2>${esc(group.title)}</h2><ul>${lis}</ul></section>`
    })
    .join('')

  const name = meta.name.trim() || '姓名'
  const role = meta.role.trim()
  const contact = meta.contact.trim()
  const subtitle = role === '' ? '' : `<p class="role">${esc(role)}</p>`
  const contactLine = contact === '' ? '' : `<p class="contact">${esc(contact)}</p>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(name)}的简历</title>
<style>
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #1a1a1a; font-size: 10.5pt; line-height: 1.65;
    margin: 0; padding: 24px;
  }
  header { border-bottom: 2px solid #1a1a1a; padding-bottom: 8pt; margin-bottom: 10pt; }
  h1 { font-size: 19pt; margin: 0; letter-spacing: 0.06em; }
  .role { margin: 3pt 0 0; font-size: 11pt; color: #333; }
  .contact { margin: 3pt 0 0; font-size: 10pt; color: #555; }
  section { margin-top: 10pt; page-break-inside: auto; }
  h2 {
    font-size: 12pt; margin: 0 0 4pt; padding-bottom: 2px;
    border-bottom: 1px solid #999; letter-spacing: 0.04em;
  }
  ul { margin: 0; padding-left: 1.2em; }
  li { margin: 3pt 0; page-break-inside: avoid; }
  li.note { color: #666; font-size: 9.5pt; list-style: none; margin-left: -1em; }
  @media screen {
    body { max-width: 820px; margin: 0 auto; background: #fff; }
  }
</style>
</head>
<body>
<header>
  <h1>${esc(name)}</h1>
  ${subtitle}
  ${contactLine}
</header>
${sections}
</body>
</html>`
}

export function printResume(parsed: Parsed, meta: ResumeMeta, includeNotes: boolean): void {
  printHtmlDocument(buildResumeHtml(parsed, meta, includeNotes))
}

export function downloadResumeHtml(parsed: Parsed, meta: ResumeMeta, includeNotes: boolean): void {
  downloadText(resumeFilename('html'), buildResumeHtml(parsed, meta, includeNotes), 'text/html')
}
