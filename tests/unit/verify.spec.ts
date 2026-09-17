import { describe, expect, it } from 'vitest'
import {
  buildVerifyList,
  checkCitations,
  citationRows,
  flattenVerify,
  STRONG_VERBS,
  verifyKey,
} from '../../src/lib/verify'
import { parseResult } from '../../src/lib/parse'

describe('buildVerifyList', () => {
  it('按三类风险聚合：数字核对 / 动词强度 / 出处', () => {
    const parsed = parseResult(
      '## 优化提升\n- 主导上传模块重构，覆盖 32 处调用点 「源2」\n- 修复白屏问题，恢复正常 「源3」\n- 排查线上偶发报错',
    )
    const list = buildVerifyList(parsed)
    expect(list.digit.map((e) => e.text)).toEqual(['主导上传模块重构，覆盖 32 处调用点'])
    expect(list.strongVerb.map((e) => e.text)).toEqual(['主导上传模块重构，覆盖 32 处调用点'])
    expect(list.noSource.map((e) => e.text)).toEqual(['排查线上偶发报错'])
    expect(list.digit[0].sources).toEqual([2])
  })

  it('手动粘贴（全无出处）时不聚合「无出处」，避免整屏标红', () => {
    const list = buildVerifyList(parseResult('## 新增能力\n- 上线分片上传能力 99%'))
    expect(list.noSource).toEqual([])
    expect(list.digit).toHaveLength(1)
  })

  it('附注行（面试展开点）不进入清单', () => {
    const list = buildVerifyList(parseResult('## 新增能力\n- 面试展开点：分片大小 2MB 的取舍 「源1」'))
    expect(list.digit).toEqual([])
    expect(list.strongVerb).toEqual([])
  })

  it('强动词清单覆盖「主导/搭建/推动」等易被追问分工的表达', () => {
    expect(STRONG_VERBS).toContain('主导')
    expect(STRONG_VERBS).toContain('搭建')
    const list = buildVerifyList(parseResult('## 新增能力\n- 搭建内部工具链 3 个 「源1」'))
    expect(list.strongVerb).toHaveLength(1)
  })
})

describe('flattenVerify / verifyKey', () => {
  it('摊平后带类型标题与稳定勾选键（类型 + 分组 + 文本）', () => {
    const rows = flattenVerify(
      buildVerifyList(
        parseResult('## 新增能力\n- 上线分片上传能力 99% 「源1」\n- 排查线上偶发报错'),
      ),
    )
    expect(rows.map((r) => r.title)).toEqual(['数字核对', '出处'])
    expect(rows[0].label).toBe('数字')
    expect(rows[0].key).toBe('digit#新增能力#上线分片上传能力 99%')
    expect(verifyKey(rows[0])).toBe(rows[0].key)
  })
})

describe('checkCitations（「源N」引用核对）', () => {
  const records = `09-01 日报
- 修复详情页偶发白屏：接口报错没兜底，补上错误处理后恢复
- 类型清理：积压的 TS 报错从 93 个清到 0

09-05 git log
a3f92c1 feat(list): 列表筛选支持多条件组合
7d21e08 feat(upload): 大文件分片上传，失败自动重试`

  it('引用行与内容对得上时不报问题', () => {
    const parsed = parseResult(
      '## 问题修复\n- 修复详情页偶发白屏问题，恢复正常可用 「源2」\n## 新增能力\n- 开发列表筛选的多条件组合查询 「源5」',
    )
    const report = checkCitations(parsed, records)
    expect(report.mismatch).toEqual([])
    expect(report.outOfRange).toEqual([])
  })

  it('引用行与内容完全对不上时给出建议行号（模型按条目序号编号的典型场景）', () => {
    // 白屏那条实际在第 2 行，却标了 源1（09-01 日报，与内容无任何重叠）
    const parsed = parseResult('## 问题修复\n- 修复详情页偶发白屏问题，恢复正常可用 「源1」')
    const report = checkCitations(parsed, records)
    expect(report.mismatch).toHaveLength(1)
    expect(report.mismatch[0].citations).toEqual([1])
    expect(report.mismatch[0].citedLines[0].text).toBe('09-01 日报')
    expect(report.mismatch[0].suggestion).toContain(2)
  })

  it('引用编号超出记录行数时单独归类', () => {
    const parsed = parseResult('## 新增能力\n- 开发列表筛选的多条件组合查询 「源99」')
    const report = checkCitations(parsed, records)
    expect(report.outOfRange).toHaveLength(1)
    expect(report.outOfRange[0].suggested ?? report.outOfRange[0].suggestion).toContain(5)
    expect(report.mismatch).toEqual([])
  })

  it('找不到更匹配的行时同样提示，但只给「人工核对」不给建议行号', () => {
    const parsed = parseResult('## 新增能力\n- 组织跨部门季度复盘并输出改进项 「源1」')
    const report = checkCitations(parsed, records)
    expect(report.mismatch).toHaveLength(1)
    expect(report.mismatch[0].suggestion).toEqual([])
    expect(citationRows(report)[0].suggestion).toEqual([])
  })

  it('附注行与无出处条目不参与核对；citationRows 生成可勾选行', () => {
    const parsed = parseResult(
      '## 问题修复\n- 修复详情页偶发白屏问题，恢复正常可用 「源1」\n- 面试展开点：讲讲排查思路 「源1」\n- 无出处条目',
    )
    const report = checkCitations(parsed, records)
    expect(report.mismatch).toHaveLength(1)
    const rows = citationRows(report)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('citation')
    expect(rows[0].title).toBe('出处核对')
    expect(rows[0].key).toBe('citation#问题修复#修复详情页偶发白屏问题，恢复正常可用')
    expect(rows[0].suggestion).toContain(2)
  })
})