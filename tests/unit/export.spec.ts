import { describe, expect, it } from 'vitest'
import { buildExport, buildRichTextExport, countTodoMarks } from '../../src/lib/export'
import { parseResult } from '../../src/lib/parse'
import { buildPrintHtml, buildResumeHtml, resumeFilename } from '../../src/lib/download'

const SAMPLE_RAW = `## 新增能力

- 上线拆分上传能力 「源1」
- 面试展开点：讲讲拆分策略

## 问题修复

- 修复白屏问题【待补：原因】 「源2」`

describe('buildExport', () => {
  const parsed = parseResult(SAMPLE_RAW)

  it('Markdown 格式：出处标记已剥离', () => {
    const text = buildExport(parsed, { format: 'markdown', includeNotes: false })
    expect(text).toContain('## 新增能力')
    expect(text).toContain('- 上线拆分上传能力')
    expect(text).not.toContain('源1')
    expect(text).not.toContain('面试展开点')
  })

  it('纯文本格式：条目用 · 前缀', () => {
    const text = buildExport(parsed, { format: 'plain', includeNotes: false })
    expect(text).toContain('· 上线拆分上传能力')
    expect(text).not.toContain('## ')
  })

  it('includeNotes 控制附注输出', () => {
    const withNotes = buildExport(parsed, { format: 'markdown', includeNotes: true })
    expect(withNotes).toContain('- 面试展开点：讲讲拆分策略')
  })

  it('保留【待补】标记以便导出后补数据', () => {
    const text = buildExport(parsed, { format: 'markdown', includeNotes: false })
    expect(text).toContain('【待补：原因】')
  })
})

describe('countTodoMarks', () => {
  it('统计【待补】出现次数', () => {
    expect(countTodoMarks('【待补：A】和【待补：B】')).toBe(2)
    expect(countTodoMarks('没有标记')).toBe(0)
  })
})

describe('buildRichTextExport', () => {
  const parsed = parseResult(
    '## 新增能力\n- 上线 <分片> 上传能力\n- 面试展开点：讲讲策略\n## 问题修复\n- 修复白屏问题',
  )

  it('分组标题加粗、条目进列表，HTML 特殊字符转义', () => {
    const html = buildRichTextExport(parsed, { includeNotes: false })
    expect(html).toContain('<p><strong>新增能力</strong></p>')
    expect(html).toContain('<li>上线 &lt;分片&gt; 上传能力</li>')
    expect(html).toContain('<p><strong>问题修复</strong></p>')
    expect(html).not.toContain('面试展开点')
  })

  it('includeNotes=true 时附注以斜体列表输出', () => {
    const html = buildRichTextExport(parsed, { includeNotes: true })
    expect(html).toContain('<li><em>面试展开点：讲讲策略</em></li>')
  })
})

describe('buildPrintHtml', () => {
  it('包含分组标题与条目，转义 HTML 字符', () => {
    const parsed = parseResult('## 新增能力\n- 上线 <b>加粗</b> 能力')
    const html = buildPrintHtml(parsed, false)
    expect(html).toContain('<h2>新增能力</h2>')
    expect(html).toContain('&lt;b&gt;加粗&lt;/b&gt;')
    expect(html).toContain('@page { size: A4;')
  })

  it('includeNotes=false 时不输出附注', () => {
    const parsed = parseResult('## 新增能力\n- 某亮点\n- 面试展开点：略')
    expect(buildPrintHtml(parsed, false)).not.toContain('面试展开点')
    expect(buildPrintHtml(parsed, true)).toContain('面试展开点')
  })
})

describe('buildResumeHtml', () => {
  const parsed = parseResult('## 新增能力\n- 上线分片上传，覆盖 32 处调用点\n## 问题修复\n- 修复白屏')

  it('单栏 A4 模板：抬头 + 分组标题 + 条目', () => {
    const html = buildResumeHtml(parsed, { name: '张三', contact: '138****0000', role: '前端' }, false)
    expect(html).toContain('@page { size: A4;')
    expect(html).toContain('<h1>张三</h1>')
    expect(html).toContain('138****0000')
    expect(html).toContain('<p class="role">前端</p>')
    expect(html).toContain('<h2>新增能力</h2>')
    expect(html).toContain('上线分片上传，覆盖 32 处调用点')
  })

  it('抬头留空时只保留标题占位，不输出空行', () => {
    const html = buildResumeHtml(parsed, { name: '', contact: '', role: '' }, false)
    expect(html).toContain('<h1>姓名</h1>')
    expect(html).not.toContain('class="role"')
    expect(html).not.toContain('class="contact"')
  })

  it('转义 HTML 字符，防止粘贴内容破坏页面', () => {
    const risky = parseResult('## 新增能力\n- 修复 a < b 与 <script>x</script>')
    const html = buildResumeHtml(risky, { name: '<img>', contact: '', role: '' }, false)
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('<h1>&lt;img&gt;</h1>')
  })

  it('includeNotes 控制面试展开点是否进入简历', () => {
    const withNote = parseResult('## 新增能力\n- 某亮点\n- 面试展开点：略')
    expect(buildResumeHtml(withNote, { name: '', contact: '', role: '' }, false)).not.toContain(
      '面试展开点',
    )
    expect(buildResumeHtml(withNote, { name: '', contact: '', role: '' }, true)).toContain('面试展开点')
  })

  it('文件名带时间戳与扩展名', () => {
    expect(resumeFilename('html')).toMatch(/^简历-\d{8}-\d{4}\.html$/)
  })
})
