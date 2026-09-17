// 量化评分：0-100 分 + 透明扣分明细（对标 Rezi Score，去黑盒——每项扣分都给出依据）
// 行动化：每条明细带受影响条目定位（itemRefs）与具体改法（suggestion），点击可跳转
import type { DateCoverage, Parsed, ParsedItem } from './parse'
import { isNoteLine, segment } from './parse'
import { matchKeywords } from './rules'

export interface ScoreItemRef {
  /** 所属分组标题 */
  group: string
  /** 条目在该分组内的序号（0 起） */
  index: number
  /** 条目原文（定位时以文本为准，勾选过滤后序号可能变化） */
  text: string
}

export interface ScoreDetail {
  label: string
  deduction: number
  note: string
  /** 受影响的条目（点击跳转定位）；无条目级影响时为空数组 */
  itemRefs: ScoreItemRef[]
  /** 具体改法建议（可复制） */
  suggestion: string
}

export interface ScoreResult {
  score: number
  details: ScoreDetail[]
}

export interface ScoreInput {
  parsed: Parsed
  dateCheck: DateCoverage | null
  jdKeywords: string[]
}

interface ScoredItem {
  group: string
  index: number
  item: ParsedItem
}

function collectItems(parsed: Parsed): ScoredItem[] {
  const out: ScoredItem[] = []
  for (const group of parsed.groups) {
    group.items.forEach((item, index) => out.push({ group: group.title, index, item }))
  }
  return out
}

function toRef(entry: ScoredItem): ScoreItemRef {
  return { group: entry.group, index: entry.index, text: entry.item.text }
}

export function computeScore(input: ScoreInput): ScoreResult {
  const { parsed, dateCheck, jdKeywords } = input
  const details: ScoreDetail[] = []
  const all = collectItems(parsed)
  const normal = all.filter((e) => !isNoteLine(e.item.text))

  // 弱动词：每处 -4，上限 -20
  const weakRefs = all.filter((e) => segment(e.item.text).some((s) => s.type === 'weak'))
  pushDetail(
    details,
    '弱动词',
    weakRefs.length,
    4,
    20,
    '负责/参与/协助/跟进 会让经历显得被动',
    weakRefs.map(toRef),
    '把「负责 / 参与 / 协助」换成更有力的开头：主导、搭建、推动、交付、落地；拿不准就直接写你实际做的那件事（设计、重构、排查、上线）。',
  )

  // 【待补】：每处 -6，上限 -24（含无出处强标的待补）
  const todoRefs = all.filter((e) => segment(e.item.text).some((s) => s.type === 'todo'))
  pushDetail(
    details,
    '待补数据',
    todoRefs.length,
    6,
    24,
    '缺数据的亮点说服力打折，补上再写进简历',
    todoRefs.map(toRef),
    '按【待补】提示补上具体数字：数量、比例、耗时、覆盖范围；数字一定要能从原始记录或你自己的回答里得到。',
  )

  // 无出处条目：仅在走提炼链路（至少一条有出处）时计分，每条 -5，上限 -15
  const noSourceRefs = normal.filter((e) => e.item.sources.length === 0)
  const hasSourceFlow = normal.some((e) => e.item.sources.length > 0)
  if (hasSourceFlow) {
    pushDetail(
      details,
      '无原始记录依据',
      noSourceRefs.length,
      5,
      15,
      '找不到出处的亮点在面试中容易被追问穿帮',
      noSourceRefs.map(toRef),
      '回到原始记录里找到对应的那几行，补上依据；实在找不到，就删掉这条——面试官一追问细节，这里最容易露馅。',
    )
  }

  // 无量化数字的条目：每条 -3，上限 -15（附注行除外）
  const noNumberRefs = normal.filter((e) => !/\d/.test(e.item.text))
  pushDetail(
    details,
    '缺量化数字',
    noNumberRefs.length,
    3,
    15,
    '尽量给每条亮点一个数字：比例、耗时、条数',
    noNumberRefs.map(toRef),
    '给这条加一个数字：比例、耗时、条数、规模、增幅；没有实测数据就用「＋ 追问细节」帮你从素材里挖。',
  )

  // 日期断档：断档天数 1:1 扣，上限 -10
  if (dateCheck && dateCheck.missing.length > 0) {
    const deduction = Math.min(10, dateCheck.missing.length)
    details.push({
      label: '记录日期断档',
      deduction,
      note: `有 ${dateCheck.missing.length} 天没写记录（${dateCheck.missing.slice(0, 5).join('、')}${dateCheck.missing.length > 5 ? ' 等' : ''}）`,
      itemRefs: [],
      suggestion:
        '面试可能问到这段时间在做什么：补上缺的原始记录，或提前准备一句如实、简短的说明（学习、项目、休假都可以）。',
    })
  }

  // JD 命中率：未命中占比 × 15（未贴 JD 时不计）
  if (jdKeywords.length > 0) {
    const allText = all.map((e) => e.item.text)
    const { hit, miss } = matchKeywords(allText, jdKeywords)
    const deduction = Math.round((miss.length / jdKeywords.length) * 15)
    if (deduction > 0) {
      details.push({
        label: 'JD 关键词未覆盖',
        deduction,
        note: `已覆盖 ${hit.length} / ${jdKeywords.length} 个，还差：${miss.slice(0, 6).join('、')}${miss.length > 6 ? ' 等' : ''}`,
        itemRefs: [],
        suggestion:
          '去上方「JD 对标」卡片的缺口清单：能补素材的点「✦ 补充提炼」，记录里已有的点「在记录中找素材」，两样都没有就别硬编。',
      })
    }
  }

  const totalDeduction = details.reduce((sum, d) => sum + d.deduction, 0)
  return { score: Math.max(0, 100 - totalDeduction), details }
}

function pushDetail(
  details: ScoreDetail[],
  label: string,
  count: number,
  per: number,
  cap: number,
  why: string,
  itemRefs: ScoreItemRef[],
  suggestion: string,
): void {
  if (count <= 0) return
  details.push({
    label,
    deduction: Math.min(cap, count * per),
    note: `${count} 处 · ${why}`,
    itemRefs,
    suggestion,
  })
}