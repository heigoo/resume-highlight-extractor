import { isNoteLine, type Parsed } from './parse'

export type ExportFormat = 'markdown' | 'plain'

export interface ExportOptions {
  format: ExportFormat
  includeNotes: boolean
}

export function buildExport(parsed: Parsed, options: ExportOptions): string {
  const { format, includeNotes } = options

  const blocks = parsed.groups.map((group) => {
    const lines: string[] = [format === 'markdown' ? `## ${group.title}` : group.title]
    let hasNormal = false

    for (const item of group.items) {
      const note = isNoteLine(item.text)
      if (note && hasNormal) {
        if (!includeNotes) continue
        lines.push(format === 'markdown' ? `  - ${item.text}` : `  ↳ ${item.text}`)
        continue
      }
      // 普通条目；或前面没有任何普通条目的附注（边界情况，按普通条目渲染）
      lines.push(format === 'markdown' ? `- ${item.text}` : `· ${item.text}`)
      hasNormal = true
    }

    return lines.join('\n')
  })

  return blocks.join('\n\n')
}

export function countTodoMarks(text: string): number {
  return (text.match(/【待补/g) ?? []).length
}

// 富文本导出（HTML 片段）：保留加粗与列表，粘贴进 Word / 在线编辑器不丢格式
export function buildRichTextExport(parsed: Parsed, options: { includeNotes: boolean }): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const blocks = parsed.groups.map((group) => {
    const lines: string[] = []
    const notes: string[] = []
    for (const item of group.items) {
      if (isNoteLine(item.text)) {
        if (options.includeNotes) notes.push(`<li><em>${esc(item.text)}</em></li>`)
        continue
      }
      lines.push(`<li>${esc(item.text)}</li>`)
    }
    const notesBlock = notes.length ? `<ul>${notes.join('')}</ul>` : ''
    return `<p><strong>${esc(group.title)}</strong></p>\n<ul>${lines.join('')}</ul>${notesBlock}`
  })
  return blocks.join('\n')
}
