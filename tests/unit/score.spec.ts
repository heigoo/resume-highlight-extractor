import { describe, expect, it } from 'vitest'
import { computeScore } from '../../src/lib/score'
import { parseResult, checkDateGaps } from '../../src/lib/parse'

const NO_DATE = null

describe('computeScore', () => {
  it('无瑕疵结果满分，无扣分明细', () => {
    const parsed = parseResult(
      '## 新增能力\n- 上线分片上传能力，弱网成功率提升到 99% 「源2」\n- 修复白屏问题，覆盖 32 处调用点 「源3」',
    )
    const result = computeScore({ parsed, dateCheck: NO_DATE, jdKeywords: [] })
    expect(result.score).toBe(100)
    expect(result.details).toEqual([])
  })

  it('弱动词与待补按条扣分', () => {
    const parsed = parseResult(
      '## 优化提升\n- 负责接口改造 【待补：覆盖率】\n- 参与性能优化【待补：耗时】',
    )
    const result = computeScore({ parsed, dateCheck: NO_DATE, jdKeywords: [] })
    const weak = result.details.find((d) => d.label === '弱动词')
    const todo = result.details.find((d) => d.label === '待补数据')
    const noNumber = result.details.find((d) => d.label === '缺量化数字')
    expect(weak?.deduction).toBe(8) // 负责 + 参与
    expect(todo?.deduction).toBe(12) // 2 处
    expect(noNumber?.deduction).toBe(6) // 2 条均无数字，各 -3
    expect(result.score).toBe(100 - 8 - 12 - 6)
  })

  it('无出处扣分仅在提炼链路（至少一条有出处）时生效', () => {
    const withSource = parseResult('## 新增能力\n- 有出处 「源1」\n- 无出处但带数字 93')
    const noSource = parseResult('## 新增能力\n- 外部粘贴的无出处条目 93')
    expect(
      computeScore({ parsed: withSource, dateCheck: NO_DATE, jdKeywords: [] }).details.some(
        (d) => d.label === '无原始记录依据',
      ),
    ).toBe(true)
    expect(
      computeScore({ parsed: noSource, dateCheck: NO_DATE, jdKeywords: [] }).details.some(
        (d) => d.label === '无原始记录依据',
      ),
    ).toBe(false)
  })

  it('JD 未命中按比例扣分', () => {
    const parsed = parseResult('## 新增能力\n- 上线分片上传能力 99% 「源1」')
    const result = computeScore({ parsed, dateCheck: NO_DATE, jdKeywords: ['vue', 'react'] })
    const jd = result.details.find((d) => d.label === 'JD 关键词未覆盖')
    expect(jd?.deduction).toBe(15) // 0/2 命中 → 15
  })

  it('日期断档按天扣分，上限 10', () => {
    const parsed = parseResult('## 新增能力\n- 上线分片上传能力 99% 「源1」')
    const dateCheck = checkDateGaps('2026-09-01 A\n2026-09-14 B')
    const result = computeScore({ parsed, dateCheck, jdKeywords: [] })
    const gap = result.details.find((d) => d.label === '记录日期断档')
    expect(gap?.deduction).toBe(10) // 12 天断档，封顶 10
  })

  it('各项扣分触及上限（弱动词 20 / 待补 24 / 缺数字 15）', () => {
    // 12 条无数字的扣分条目：弱动词 12×4→封顶 20，待补 12×6→封顶 24，缺数字 12×3→封顶 15
    const parsed = parseResult(
      Array.from({ length: 12 }, () => '- 负责某某模块【待补：数据】').join('\n'),
    )
    const result = computeScore({ parsed, dateCheck: NO_DATE, jdKeywords: [] })
    expect(result.details.find((d) => d.label === '弱动词')?.deduction).toBe(20)
    expect(result.details.find((d) => d.label === '待补数据')?.deduction).toBe(24)
    expect(result.details.find((d) => d.label === '缺量化数字')?.deduction).toBe(15)
    expect(result.score).toBe(100 - 20 - 24 - 15)
  })

  it('扣分明细带条目定位（itemRefs）与改法建议（suggestion）', () => {
    const parsed = parseResult(
      '## 优化提升\n- 负责接口改造 【待补：覆盖率】\n- 上线分片上传能力，成功率 99% 「源1」',
    )
    const result = computeScore({ parsed, dateCheck: NO_DATE, jdKeywords: ['docker'] })

    const weak = result.details.find((d) => d.label === '弱动词')
    expect(weak?.itemRefs).toEqual([
      { group: '优化提升', index: 0, text: expect.stringContaining('负责接口改造') },
    ])
    expect(weak?.suggestion).toContain('更有力的开头')

    const todo = result.details.find((d) => d.label === '待补数据')
    expect(todo?.itemRefs.map((r) => r.index)).toEqual([0])
    expect(todo?.suggestion).toContain('数字')

    const noNumber = result.details.find((d) => d.label === '缺量化数字')
    expect(noNumber?.itemRefs.map((r) => r.index)).toEqual([0])

    const noSource = result.details.find((d) => d.label === '无原始记录依据')
    expect(noSource?.itemRefs.map((r) => r.index)).toEqual([0])

    // JD 缺口无条目级定位，但给出可执行入口
    const jd = result.details.find((d) => d.label === 'JD 关键词未覆盖')
    expect(jd?.itemRefs).toEqual([])
    expect(jd?.suggestion).toContain('补充提炼')
  })

  it('日期断档给出解释建议且无条目定位', () => {
    const parsed = parseResult('## 新增能力\n- 上线分片上传能力 99% 「源1」')
    const dateCheck = checkDateGaps('2026-09-01 A\n2026-09-14 B')
    const gap = computeScore({ parsed, dateCheck, jdKeywords: [] }).details.find(
      (d) => d.label === '记录日期断档',
    )
    expect(gap?.itemRefs).toEqual([])
    expect(gap?.suggestion).toContain('补上缺的原始记录')
  })
})
