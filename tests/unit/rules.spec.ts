import { describe, expect, it } from 'vitest'
import {
  composeDetailAskPrompt,
  composeDetailFillPrompt,
  composeInterviewFeedbackPrompt,
  composeInterviewPrompt,
  composePrompt,
  composeRewritePrompt,
  composeSupplementPrompt,
  composeTranslatePrompt,
  extractJdKeywords,
  groupJdGaps,
  matchKeyword,
  matchKeywords,
  parseRules,
  sanitizeRules,
  scenarioInstruction,
  serializeRules,
  styleInstruction,
} from '../../src/lib/rules'

describe('composePrompt', () => {
  const records = '2026-09-01 修复白屏\n2026-09-02 改造接口'

  it('包含出处标注规则（源N）与行号说明，原始记录逐行编号', () => {
    const prompt = composePrompt(records, '1. 只基于材料；')
    expect(prompt).toContain('「源N」')
    expect(prompt).toContain('行号')
    // 逐行编号：让模型照抄左侧编号，而不是自己数（真实模型常按条目序号编号）
    expect(prompt).toContain('1 | 2026-09-01 修复白屏')
    expect(prompt).toContain('2 | 2026-09-02 改造接口')
    expect(prompt).toContain('照抄')
  })

  it('注入 JD 原文（对标模式）', () => {
    const prompt = composePrompt(records, '1. 只基于材料；', { jd: '要求熟悉 Vue3 与性能优化' })
    expect(prompt).toContain('目标岗位 JD')
    expect(prompt).toContain('Vue3 与性能优化')
  })

  it('无 JD 时不注入对标段', () => {
    const prompt = composePrompt(records, '1. 只基于材料；')
    expect(prompt).not.toContain('目标岗位 JD')
  })

  it('风格预设注入表达风格段', () => {
    const prompt = composePrompt(records, '1. 只基于材料；', { style: 'star' })
    expect(prompt).toContain('表达风格')
    expect(prompt).toContain('情境-任务-行动-结果')
    expect(styleInstruction('classic')).toBe('')
    expect(styleInstruction('unknown')).toBe('')
  })

  it('重写指令强调不改事实', () => {
    const prompt = composeRewritePrompt('- 负责某模块')
    expect(prompt).toContain('只改表达，不改事实')
    expect(prompt).toContain('- 负责某模块')
  })

  it('补充提炼指令带缺失关键词与不编造约束', () => {
    const prompt = composeSupplementPrompt('2026-09-01 修复白屏', ['vue', 'docker'])
    expect(prompt).toContain('还没有被覆盖')
    expect(prompt).toContain('vue、docker')
    expect(prompt).toContain('无相关素材')
    expect(prompt).toContain('源N')
  })
})

describe('extractJdKeywords', () => {
  it('提取英文技术词（忽略大小写）并按词频排序', () => {
    const { terms } = extractJdKeywords('熟悉 React，了解 React 生态；加分项：Node.js')
    expect(terms).toContain('react')
    expect(terms).toContain('node.js')
    expect(terms.indexOf('react')).toBeLessThan(terms.indexOf('node.js'))
  })

  it('中文关键词取重复片段并过滤停用词', () => {
    const { terms } = extractJdKeywords('负责性能优化与跨端方案设计，有性能优化经验优先')
    expect(terms).toContain('性能优化')
    // 单次出现的跨词垃圾片段不保留
    expect(terms).not.toContain('与跨端方案设')
    expect(terms).not.toContain('熟悉')
    expect(terms).not.toContain('负责')
  })

  it('过滤被更长词包含的短词', () => {
    const { terms } = extractJdKeywords('前端工程师，工程师文化')
    expect(terms).toContain('工程师')
    expect(terms).not.toContain('工程')
  })

  it('空输入返回空数组', () => {
    expect(extractJdKeywords('   ').terms).toEqual([])
  })
})

describe('matchKeyword / matchKeywords', () => {
  it('英文关键词忽略大小写', () => {
    expect(matchKeyword('用 Vue3 重构', 'vue3')).toBe(true)
    expect(matchKeyword('纯中文文本', 'vue')).toBe(false)
  })

  it('matchKeywords 拆分命中与未命中', () => {
    const { hit, miss } = matchKeywords(['推动性能优化落地', '封装公共组件'], ['性能优化', 'docker'])
    expect(hit).toEqual(['性能优化'])
    expect(miss).toEqual(['docker'])
  })

  it('空关键词不参与匹配', () => {
    expect(matchKeyword('任意文本', '  ')).toBe(false)
  })
})

describe('sanitizeRules', () => {
  it('剥离代码块围栏并保留规则行', () => {
    const raw = '```\n1. 第一条\n2. 第二条\n3. 第三条\n```'
    expect(sanitizeRules(raw)).toBe('1. 第一条\n2. 第二条\n3. 第三条')
  })

  it('规则行不足时保留全部非空行', () => {
    expect(sanitizeRules('自由发挥的说明')).toBe('自由发挥的说明')
  })
})

describe('人群场景预设', () => {
  it('选择场景后注入人群场景段，通用场景与其他维度互不干扰', () => {
    const prompt = composePrompt('2026-09-01 修复白屏', '1. 只基于材料；', {
      scenario: 'switch',
      style: 'star',
      jd: '要求 Vue3',
    })
    expect(prompt).toContain('人群场景')
    expect(prompt).toContain('可迁移能力')
    expect(prompt).toContain('表达风格')
    expect(prompt).toContain('目标岗位 JD')
  })

  it('未选择或未知场景不注入人群段', () => {
    expect(composePrompt('记录', '1. X')).not.toContain('人群场景')
    expect(composePrompt('记录', '1. X', { scenario: 'unknown' })).not.toContain('人群场景')
    expect(scenarioInstruction('')).toBe('')
    expect(scenarioInstruction('gap')).toContain('空窗')
  })
})

describe('规则导入导出', () => {
  const rules = '1. 只基于材料\n2. 动词开头\n3. 过滤事务性描述'

  it('导出的 JSON 可再导入且等值', () => {
    expect(parseRules(serializeRules(rules))).toBe(rules)
  })

  it('兼容规则纯文本；无效内容返回 null', () => {
    expect(parseRules(rules)).toBe(rules)
    expect(parseRules('1. 只有一条')).toBeNull()
    expect(parseRules('{"foo":1}')).toBeNull()
    expect(parseRules('   ')).toBeNull()
  })
})

describe('JD 缺口分组', () => {
  it('英文 / 技术方法类归硬技能，其余归软能力', () => {
    const { hard, soft } = groupJdGaps(['TypeScript', '性能优化', '沟通协作', '英语'])
    expect(hard).toContain('TypeScript')
    expect(hard).toContain('性能优化')
    expect(soft).toContain('沟通协作')
    expect(soft).toContain('英语')
  })
})

describe('追问与翻译指令的防编造约束', () => {
  it('面试追问只针对已有条目并标注关联编号', () => {
    const prompt = composeInterviewPrompt(['主导上传模块重构 「源3」'], '要求 Vue3')
    expect(prompt).toContain('不得虚构')
    expect(prompt).toContain('1. 主导上传模块重构')
    expect(prompt).toContain('（关联：第X条）')
    expect(prompt).toContain('要求 Vue3')
  })

  it('追问补细节：先问后写，写作只用原记录与回答', () => {
    const ask = composeDetailAskPrompt('上线分片上传', ['09-05 分片上传按弱网实测取 2MB'])
    expect(ask).toContain('不要虚构')
    expect(ask).toContain('09-05 分片上传按弱网实测取 2MB')
    const fill = composeDetailFillPrompt('上线分片上传', ['09-05 分片上传'], '分片取 2MB')
    expect(fill).toContain('只能使用原始记录与我的回答里出现过的事实与数字')
    expect(fill).toContain('分片取 2MB')
    expect(fill).toContain('【待补：具体补什么】')
  })

  it('翻译指令保留结构与数字，不虚构', () => {
    const prompt = composeTranslatePrompt('## 新增能力\n- 上线分片上传，覆盖 32 处调用点')
    expect(prompt).toContain('保留 Markdown 分组标题与列表结构')
    expect(prompt).toContain('不虚构')
    expect(prompt).toContain('覆盖 32 处调用点')
  })
})

describe('多段记录提示', () => {
  it('含 --- 分隔时注入分段归属规则', () => {
    const prompt = composePrompt('项目 A\n- 做了 X\n---\n项目 B\n- 做了 Y', '1. 规则')
    expect(prompt).toContain('已按「---」分成 2 段')
    expect(prompt).toContain('不要把不同段的成果混写成一条')
  })

  it('单段记录不注入分段规则', () => {
    const prompt = composePrompt('项目 A\n- 做了 X', '1. 规则')
    expect(prompt).not.toContain('分成')
    expect(prompt).not.toContain('不要混写')
  })
})

describe('composeInterviewFeedbackPrompt', () => {
  it('带上问题、关联条目与回答，且明确只用候选人给的信息', () => {
    const prompt = composeInterviewFeedbackPrompt(
      '2MB 这个分片大小怎么定的？',
      '为上传模块新增分片上传，取 2MB',
      '按弱网实测定的，这块我主导实现',
    )
    expect(prompt).toContain('候选人准备把下面的亮点写进简历')
    expect(prompt).toContain('2MB 这个分片大小怎么定的？')
    expect(prompt).toContain('为上传模块新增分片上传，取 2MB')
    expect(prompt).toContain('按弱网实测定的，这块我主导实现')
    expect(prompt).toContain('不得编造新数据或新经历')
  })

  it('没有关联条目时给出兜底说明', () => {
    const prompt = composeInterviewFeedbackPrompt('你的个人贡献是什么？', '', '我负责方案设计')
    expect(prompt).toContain('这条问题没有标注关联亮点')
  })
})
