// 导出前真实性核查清单：把「数字可追溯 / 职责不夸大 / 出处齐全」三类风险聚合成可勾选清单。
// 纯前端计算，勾选状态只存 sessionStorage（不写入草稿 / 版本，避免污染存档）。
import { isNoteLine, recordLines, type Parsed } from './parse'

export type VerifyKind = 'digit' | 'strongVerb' | 'noSource' | 'citation'

export interface VerifyEntry {
  kind: VerifyKind
  group: string
  index: number
  text: string
  sources: number[]
}

export interface VerifyList {
  /** 含数字的条目：数字是否真实可追溯 */
  digit: VerifyEntry[]
  /** 含强动词的条目：职责是否属实（面试会追问分工） */
  strongVerb: VerifyEntry[]
  /** 无「源N」出处的条目：缺少原始记录依据 */
  noSource: VerifyEntry[]
}

/** 强动词（与「动词引领」风格预设一脉相承）：这类表述最容易在面试中被追问分工 */
export const STRONG_VERBS = [
  '主导', '搭建', '重构', '推动', '落地', '自动化', '定义', '拉通', '清零', '沉淀',
]

function entry(kind: VerifyKind, group: string, index: number, text: string, sources: number[]): VerifyEntry {
  return { kind, group, index, text, sources }
}

export function buildVerifyList(parsed: Parsed): VerifyList {
  const digit: VerifyEntry[] = []
  const strongVerb: VerifyEntry[] = []
  const noSource: VerifyEntry[] = []
  const normal: VerifyEntry[] = []
  for (const group of parsed.groups) {
    group.items.forEach((item, index) => {
      if (isNoteLine(item.text)) return
      const base = entry('digit', group.title, index, item.text, item.sources)
      if (/\d/.test(item.text)) digit.push(base)
      if (STRONG_VERBS.some((v) => item.text.includes(v))) {
        strongVerb.push(entry('strongVerb', group.title, index, item.text, item.sources))
      }
      normal.push(entry('noSource', group.title, index, item.text, item.sources))
    })
  }
  // 与评分口径一致：只在走提炼链路（至少一条有出处）时聚合「无出处」清单，
  // 避免手动粘贴的外部结果被整屏标红
  if (normal.some((e) => e.sources.length > 0)) {
    noSource.push(...normal.filter((e) => e.sources.length === 0))
  }
  return { digit, strongVerb, noSource }
}

/** 勾选键：以「类型 + 分组 + 文本」为键，条目移动/重排后勾选状态仍然有效 */
export function verifyKey(e: VerifyEntry): string {
  return `${e.kind}#${e.group}#${e.text}`
}

/** 摊平成带类型与说明的清单（UI 渲染用） */
export interface VerifyRow extends VerifyEntry {
  key: string
  title: string
  hint: string
  label: string
  /** 引用核对行专用：AI 标注的编号、引用行原文、本地建议编号 */
  citations?: number[]
  citedLines?: Array<{ n: number; text: string }>
  suggestion?: number[]
  /** 引用编号超出记录行数时为 true */
  outOfRange?: boolean
}

export function flattenVerify(list: VerifyList): VerifyRow[] {
  const rows: VerifyRow[] = []
  const push = (
    kind: VerifyKind,
    title: string,
    hint: string,
    label: string,
    entries: VerifyEntry[],
  ): void => {
    for (const e of entries) rows.push({ ...e, key: verifyKey(e), title, hint, label })
  }
  push('digit', '数字核对', '这些条目里有数字：数字是真的吗？原始记录里找得到吗？面试官会追问它怎么算出来的。', '数字', list.digit)
  push('strongVerb', '动词强度', '这些条目用了有力的动词（主导、搭建等）：事情真是你主导的吗？面试会追问你具体做了哪部分。', '职责', list.strongVerb)
  push('noSource', '出处', '这些条目还没标出处：确认是真事，能在原始记录里找到就补上对应的行。', '出处', list.noSource)
  return rows
}

export const VERIFY_STORAGE_KEY = 'rhe.verify.v1'

// ---------- 「源N」引用核对：AI 标的行号是否真的对得上内容 ----------
// 实测推理型模型常把「行号」理解成条目序号，导致出处指向不相干的行；
// 这里做纯本地校验（字符 2-gram 重叠 + 数字命中），不调 AI，只做提示与建议。

export interface CitationCheck {
  group: string
  index: number
  text: string
  /** AI 标注的行号（可能含越界编号） */
  citations: number[]
  /** 引用行原文（越界编号对应空文本） */
  citedLines: Array<{ n: number; text: string }>
  /** 本地匹配到的建议行号（可能为空） */
  suggestion: number[]
}

export interface CitationReport {
  /** 行号在记录范围内、但内容对不上的条目 */
  mismatch: CitationCheck[]
  /** 引用了超出记录行数的编号 */
  outOfRange: CitationCheck[]
}

// 行与条目的匹配分：中文 2-gram 重叠数 + 数字命中加权（数字是最强信号）
function matchScore(line: string, itemText: string): number {
  let score = 0
  for (const num of itemText.matchAll(/\d+(?:\.\d+)?%?/g)) {
    const escaped = num[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?<![\\d.])${escaped}(?![\\d])`).test(line)) score += 2
  }
  const grams = new Set<string>()
  const chars = itemText.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  for (let i = 0; i + 2 <= chars.length; i += 1) grams.add(chars.slice(i, i + 2).toLowerCase())
  for (const g of grams) if (line.toLowerCase().includes(g)) score += 1
  return score
}

export function checkCitations(parsed: Parsed, records: string): CitationReport {
  const lines = recordLines(records)
  const mismatch: CitationCheck[] = []
  const outOfRange: CitationCheck[] = []
  for (const group of parsed.groups) {
    group.items.forEach((item, index) => {
      if (isNoteLine(item.text) || item.sources.length === 0) return
      const citedLines = item.sources.map((n) => ({
        n,
        text: n >= 1 && n <= lines.length ? lines[n - 1] : '',
      }))
      const validLines = citedLines.filter((l) => l.text !== '')
      const bestCited = Math.max(0, ...validLines.map((l) => matchScore(l.text, item.text)))
      // 建议：未被引用且匹配分 ≥2 的行，取前 2 个
      const suggestions = lines
        .map((text, i) => ({ n: i + 1, text }))
        .filter((l) => !item.sources.includes(l.n) && matchScore(l.text, item.text) >= 2)
        .sort((a, b) => matchScore(b.text, item.text) - matchScore(a.text, item.text))
        .slice(0, 2)
        .map((l) => l.n)
      const entry: CitationCheck = {
        group: group.title,
        index,
        text: item.text,
        citations: item.sources,
        citedLines,
        suggestion: suggestions,
      }
      if (validLines.length === 0) {
        outOfRange.push(entry)
        return
      }
      // 所有引用行都与条目内容对不上（匹配分 0）→ 提示核对；能定位到更匹配的行时一并给建议
      if (bestCited === 0) mismatch.push(entry)
    })
  }
  return { mismatch, outOfRange }
}

/** 把引用核对结果转成核查清单行（第四类：出处核对，可一键改用建议行号） */
export function citationRows(report: CitationReport): VerifyRow[] {
  const rows: VerifyRow[] = []
  const push = (issue: CitationCheck, hint: string, outOfRange: boolean): void => {
    rows.push({
      kind: 'citation',
      group: issue.group,
      index: issue.index,
      text: issue.text,
      sources: issue.citations,
      key: verifyKey({ kind: 'citation', group: issue.group, index: issue.index, text: issue.text, sources: issue.citations }),
      title: '出处核对',
      hint,
      label: '出处',
      citations: issue.citations,
      citedLines: issue.citedLines,
      suggestion: issue.suggestion,
      outOfRange,
    })
  }
  for (const issue of report.mismatch) {
    push(issue, '这些出处和条目对不上（AI 可能把行号标错了）：有「建议」的就点一下改用，没有的就点条目上的出处自己核对。', false)
  }
  for (const issue of report.outOfRange) {
    push(issue, '这些出处指向的行号在原始记录里根本不存在：请点条目上的出处重新挑一行。', true)
  }
  return rows
}

export function loadVerifyChecked(): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(VERIFY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) if (value === true) out[key] = true
    return out
  } catch {
    return {}
  }
}

/** 只保留当前清单里的键，避免 sessionStorage 随历史结果无限膨胀 */
export function saveVerifyChecked(checked: Record<string, boolean>, activeKeys: string[]): void {
  try {
    const active = new Set(activeKeys)
    const pruned: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(checked)) {
      if (value === true && active.has(key)) pruned[key] = true
    }
    sessionStorage.setItem(VERIFY_STORAGE_KEY, JSON.stringify(pruned))
  } catch {
    // sessionStorage 不可用（隐私模式等）时仅本次会话内生效
  }
}