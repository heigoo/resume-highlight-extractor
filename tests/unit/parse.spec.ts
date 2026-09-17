import { describe, expect, it } from 'vitest'
import {
  buildHitPattern,
  checkDateGaps,
  countIssues,
  filterSelected,
  findRecordLines,
  findUntraceableNumbers,
  isNoteLine,
  listItems,
  parseInterviewList,
  parseResult,
  segment,
  serializeParsed,
  splitRecordSegments,
} from '../../src/lib/parse'

describe('parseResult', () => {
  it('解析 Markdown 分组与列表条目', () => {
    const raw = `## 新增能力

- 上线大文件分片上传能力
- 参与列表筛选组件开发

## 问题修复

- 修复详情页白屏问题`
    const parsed = parseResult(raw)
    expect(parsed.groups).toHaveLength(2)
    expect(parsed.groups[0].title).toBe('新增能力')
    expect(parsed.groups[0].items.map((i) => i.text)).toEqual([
      '上线大文件分片上传能力',
      '参与列表筛选组件开发',
    ])
    expect(parsed.groups[1].title).toBe('问题修复')
  })

  it('解析纯文本分组标题（无 # 前缀）', () => {
    const parsed = parseResult('新增能力\n- 完成拆分上传')
    expect(parsed.groups[0].title).toBe('新增能力')
    expect(parsed.groups[0].items[0].text).toBe('完成拆分上传')
  })

  it('剥离句尾「源N」出处标记并解析编号', () => {
    const parsed = parseResult('## 新增能力\n- 上线拆分上传，弱网可用 「源2,4」')
    expect(parsed.groups[0].items[0].text).toBe('上线拆分上传，弱网可用')
    expect(parsed.groups[0].items[0].sources).toEqual([2, 4])
  })

  it('兼容全角逗号与「源：N」写法', () => {
    const parsed = parseResult('- 亮点甲 「源：3、5」')
    expect(parsed.groups[0].items[0].sources).toEqual([3, 5])
  })

  it('enforceSources 时无出处条目追加【待补：无原始记录依据】', () => {
    const raw = '## 新增能力\n- 有出处条目 「源1」\n- 无出处条目\n- 面试展开点：某亮点的展开'
    const parsed = parseResult(raw, { enforceSources: true })
    const items = parsed.groups[0].items.map((i) => i.text)
    expect(items[0]).toBe('有出处条目')
    expect(items[1]).toBe('无出处条目【待补：无原始记录依据】')
    // 附注行不强制
    expect(items[2]).toBe('面试展开点：某亮点的展开')
  })

  it('已有【待补】的无出处条目不重复追加', () => {
    const parsed = parseResult('- 排查偶发报错【待补：结论】', { enforceSources: true })
    expect(parsed.groups[0].items[0].text).toBe('排查偶发报错【待补：结论】')
  })

  it('正文中间出现「数据源」不误判为出处标记', () => {
    const parsed = parseResult('- 优化数据源连接配置')
    expect(parsed.groups[0].items[0].text).toBe('优化数据源连接配置')
    expect(parsed.groups[0].items[0].sources).toEqual([])
  })

  it('无分组时落入「全部亮点」', () => {
    const parsed = parseResult('- 一条亮点 「源1」')
    expect(parsed.groups[0].title).toBe('全部亮点')
  })
})

describe('isNoteLine', () => {
  it('识别面试展开点附注', () => {
    expect(isNoteLine('面试展开点：讲讲取舍')).toBe(true)
    expect(isNoteLine('普通亮点')).toBe(false)
  })
})

describe('serializeParsed', () => {
  it('serialize → parseResult 往返一致（含出处标记）', () => {
    const raw = '## 新增能力\n- 上线分片上传能力 「源1,3」\n- 面试展开点：略\n\n## 问题修复\n- 修复白屏'
    const once = parseResult(raw)
    const serialized = serializeParsed(once)
    const twice = parseResult(serialized)
    expect(twice).toEqual(once)
  })

  it('无出处的条目不加「源」标记', () => {
    const parsed = parseResult('## 新增能力\n- 无出处条目')
    expect(serializeParsed(parsed)).toBe('## 新增能力\n- 无出处条目')
  })
})

describe('segment', () => {
  it('标记弱动词与【待补】', () => {
    const segs = segment('负责接口联调【待补：耗时数据】')
    expect(segs).toEqual([
      { type: 'weak', text: '负责' },
      { type: 'plain', text: '接口联调' },
      { type: 'todo', text: '【待补：耗时数据】' },
    ])
  })

  it('标记 JD 关键词命中（忽略大小写）', () => {
    const segs = segment('用 TypeScript 重构构建链路', ['typescript'])
    expect(segs.some((s) => s.type === 'hit' && s.text === 'TypeScript')).toBe(true)
  })

  it('todo / weak 优先于 hit，重叠不重复', () => {
    // 「参与」同时是弱动词与命中关键词：weak 优先，不再标 hit
    const segs = segment('参与性能优化工作', ['参与', '性能优化'])
    expect(segs.map((s) => s.type)).toContain('weak')
    expect(segs.some((s) => s.type === 'hit' && s.text === '参与')).toBe(false)
    expect(segs.some((s) => s.type === 'hit' && s.text === '性能优化')).toBe(true)
  })

  it('无命中时与普通分段一致', () => {
    expect(segment('普通文本', [])).toEqual([{ type: 'plain', text: '普通文本' }])
  })
})

describe('buildHitPattern', () => {
  it('去重、忽略大小写、长词优先', () => {
    const re = buildHitPattern(['vue', 'Vue3', 'vue '])
    expect(re).not.toBeNull()
    const matched = 'Vue3 与 vue'.match(re!)
    expect(matched).toEqual(['Vue3', 'vue'])
  })

  it('转义正则特殊字符', () => {
    const re = buildHitPattern(['c++'])
    expect(re!.test('熟悉 c++ 开发')).toBe(true)
  })

  it('空清单返回 null', () => {
    expect(buildHitPattern([])).toBeNull()
  })
})

describe('countIssues', () => {
  it('统计弱动词、待补与条目数', () => {
    const parsed = parseResult(`## 新增能力
- 负责模块重构
- 完成迁移【待补：数据】
- 面试展开点：略`)
    expect(countIssues(parsed)).toEqual({ weak: 1, todo: 1, items: 3 })
  })
})

describe('checkDateGaps', () => {
  it('提取日期范围与断档', () => {
    const raw = '2026-09-01 做了 A\n2026-09-03 做了 B'
    const coverage = checkDateGaps(raw)
    expect(coverage).not.toBeNull()
    expect(coverage!.from).toBe('2026-09-01')
    expect(coverage!.to).toBe('2026-09-03')
    expect(coverage!.missing).toEqual(['09-02'])
  })

  it('少于两个日期返回 null', () => {
    expect(checkDateGaps('2026-09-01 只有一天')).toBeNull()
  })
})

describe('缺口素材定位（findRecordLines）', () => {
  const records = '09-01 修复白屏：接口报错没兜底\n09-03 性能优化：长列表虚拟滚动\n09-05 部署脚本整理'

  it('命中关键词所在行并给出行号', () => {
    expect(findRecordLines(records, '性能优化')[0]).toEqual({
      n: 2,
      text: '09-03 性能优化：长列表虚拟滚动',
    })
  })

  it('近似片段（≥2 字重合）也能命中，无相关返回空数组', () => {
    expect(findRecordLines(records, '虚拟滚动').length).toBe(1)
    expect(findRecordLines(records, 'docker')).toEqual([])
    expect(findRecordLines(records, '  ')).toEqual([])
  })
})

describe('数字溯源（findUntraceableNumbers）', () => {
  it('精确边界匹配：9 不会被 93 误判为已溯源', () => {
    expect(findUntraceableNumbers('覆盖 93 处调用点', ['TS 报错 93 个'])).toEqual([])
    expect(findUntraceableNumbers('从 9 个清到 0', ['93 个'])).toContain('9')
    expect(findUntraceableNumbers('提升到 99%', ['报错 93 个'])).toEqual(['99%'])
  })

  it('素材为空时不判定（手动粘贴路径不误标）', () => {
    expect(findUntraceableNumbers('任何 123 与 45%', [])).toEqual([])
  })
})

describe('parseInterviewList', () => {
  it('剥离序号并解析「关联：第N条」标注', () => {
    const list = parseInterviewList(
      '1. 这个 32 处调用点是怎么统计的？（关联：第1条）\n2. 你负责哪部分？（关联：第2,3条）\n3. 没有标注的问题',
    )
    expect(list).toEqual([
      { q: '这个 32 处调用点是怎么统计的？', refs: [1] },
      { q: '你负责哪部分？', refs: [2, 3] },
      { q: '没有标注的问题', refs: [] },
    ])
  })
})

describe('filterSelected / listItems', () => {
  it('过滤视图只保留勾选条目，定位口径按组内序号', () => {
    const parsed = parseResult('## 新增能力\n- A 「源1」\n- B\n## 问题修复\n- C')
    parsed.groups[0].items[1].selected = false
    const view = filterSelected(parsed)
    expect(view?.groups[0].items.map((i) => i.text)).toEqual(['A'])
    expect(listItems(view!, { skipNotes: true }).map((i) => `${i.group}#${i.index}`)).toEqual([
      '新增能力#0',
      '问题修复#0',
    ])
    expect(listItems(view!)[0].sources).toEqual([1])
  })
})

describe('splitRecordSegments', () => {
  it('独占一行的 --- 为分隔符，去掉空段', () => {
    const segments = splitRecordSegments('项目 A\n- 做了 X\n\n---\n\n项目 B\n- 做了 Y')
    expect(segments).toEqual(['项目 A\n- 做了 X', '项目 B\n- 做了 Y'])
  })

  it('*** 与 === 同样视为分隔符；行内连字符不算', () => {
    expect(splitRecordSegments('A\n***\nB\n===\nC')).toEqual(['A', 'B', 'C'])
    expect(splitRecordSegments('A -- B\nC')).toEqual(['A -- B\nC'])
  })

  it('没有分隔符时返回单段；空文本返回空数组', () => {
    expect(splitRecordSegments('只有一段记录')).toEqual(['只有一段记录'])
    expect(splitRecordSegments('  \n ')).toEqual([])
  })
})
