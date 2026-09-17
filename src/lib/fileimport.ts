// 文件导入：PDF / DOCX / TXT / MD → 纯文本。
// 全程客户端解析（pdf.js + mammoth 均为本地库按需动态加载），零上传。
const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_PDF_PAGES = 40

export interface ImportResult {
  text: string
  kind: 'pdf' | 'docx' | 'text'
}

export function isSupportedImportFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    file.size <= MAX_FILE_BYTES &&
    (name.endsWith('.pdf') || name.endsWith('.docx') || name.endsWith('.txt') || name.endsWith('.md'))
  )
}

export async function extractTextFromFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('这个文件超过 15MB：请先拆成几个小文件，或只挑重要部分再导入')
  }
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return { text: await extractPdf(file), kind: 'pdf' }
  if (name.endsWith('.docx')) return { text: await extractDocx(file), kind: 'docx' }
  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return { text: normalize(await file.text()), kind: 'text' }
  }
  throw new Error('这个格式暂时不能导入：请换成 PDF、Word（.docx）或纯文本（.txt / .md）文件')
}

// PDF：pdf.js 按页提取文本；worker 走 Vite ?url 资源，避免内联 worker 的 CSP 问题
async function extractPdf(file: File): Promise<string> {
  const [pdfjs, workerUrl] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: buffer })
  const doc = await loadingTask.promise
  const pages: string[] = []
  const total = Math.min(doc.numPages, MAX_PDF_PAGES)
  for (let i = 1; i <= total; i += 1) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const line = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (line !== '') pages.push(line)
  }
  await loadingTask.destroy()
  if (pages.length === 0)
    throw new Error('这份 PDF 里读不到文字（可能是扫描件或图片版）：请换文字版 PDF，或直接把内容粘贴进记录框')
  return normalize(pages.join('\n'))
}

// DOCX：mammoth 提取纯文本（保留段落换行）
async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const buffer = await file.arrayBuffer()
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer })
  const text = normalize(value)
  if (text.trim() === '')
    throw new Error('这个 Word 文件里读不到文字（内容可能在图片或文本框里）：请把文字直接复制粘贴进记录框')
  return text
}

// 归一化：统一换行、去多余空行（保留行结构供「源N」对位）
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
