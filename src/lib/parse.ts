export interface ParsedItem {
  text: string
  /** 该亮点由哪几条原始记录提炼（记录编号，从 1 开始）；无出处为空数组 */
  sources: number[]
  /** 是否纳入导出（勾选范围）；不写入 aiRaw，仅影响导出与评分 */
  selected: boolean
  /** AI 改写前的原文（「对比修改前」用）；仅本次会话内存，不写入 aiRaw */
  prevText?: string
}

export interface Group {
  title: string
  items: ParsedItem[]
}

export interface Parsed {
  groups: Group[]
}

export interface ParseOptions {
  /** 提炼时要求 AI 标注「源N」出处；开启后无出处的亮点强制追加【待补】标记 */
  enforceSources?: boolean
}

export interface IssueCount {
  weak: number
  todo: number
  items: number
}

export interface DateCoverage {
  from: string
  to: string
  missing: string[]
}

export type SegmentType = 'plain' | 'weak' | 'todo' | 'hit'

export type Segment = { type: SegmentType; text: string }

const BULLET_PATTERN = /^\s*(?:[-*•]|\d+[.、)])\s+/
const DATE_PATTERN = /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/g
const WEAK_VERBS = ['负责', '参与', '协助', '跟进']
const SEGMENT_PATTERN = new RegExp(`(【待补[^】]*】)|(${WEAK_VERBS.join('|')})`, 'g')
// 句尾的「源1,3」出处标记（提炼结果约定格式，展示与导出前剥掉）
const SOURCE_PATTERN = /[（(「『\[]?源[:：]?\s*(\d+(?:\s*[,，、]\s*\d+)*)[）)」』\]]?\s*$/

const NOTE_PREFIX = '面试展开点'

export function isNoteLine(item: string): boolean {
  return item.trim().startsWith(NOTE_PREFIX)
}

// 从句尾剥出「源N」出处标记，返回干净文本与编号列表
function extractSources(text: string): { text: string; sources: number[] } {
  const match = text.match(SOURCE_PATTERN)
  if (!match || match.index === undefined) return { text, sources: [] }
  const sources = match[1]
    .split(/\s*[,，、]\s*/)
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
  return { text: text.slice(0, match.index).trimEnd(), sources }
}

export function parseResult(raw: string, options: ParseOptions = {}): Parsed {
  const groups: Group[] = []
  let current: Group | null = null

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const heading = matchHeading(trimmed)
    if (heading !== null) {
      const title = canonicalTitle(heading)
      current = groups.find((g) => g.title === title) ?? null
      if (!current) {
        current = { title, items: [] }
        groups.push(current)
      }
      continue
    }

    if (BULLET_PATTERN.test(line)) {
      const rawText = trimmed.replace(BULLET_PATTERN, '').replace(/\*\*/g, '').trim()
      if (!rawText) continue
      if (!current) {
        current = { title: '全部亮点', items: [] }
        groups.push(current)
      }
      const { text, sources } = extractSources(rawText)
      // 无出处的亮点强制带上待补标记（已有【待补】或面试展开点附注除外）
      const noSource =
        options.enforceSources === true &&
        sources.length === 0 &&
        !isNoteLine(rawText) &&
        !rawText.includes('【待补')
      current.items.push({
        text: noSource ? `${text}【待补：无原始记录依据】` : text,
        sources,
        selected: true,
      })
    }
  }

  return { groups }
}

// 把解析结果序列化回 Markdown（行内编辑后回写 aiRaw 用）：
// 出处以「源N」标记重新附加，保证 serialize → parseResult 往返一致
export function serializeParsed(parsed: Parsed): string {
  return parsed.groups
    .map((group) => {
      const lines = [`## ${group.title}`]
      for (const item of group.items) {
        lines.push(
          item.sources.length > 0
            ? `- ${item.text} 「源${item.sources.join(',')}」`
            : `- ${item.text}`,
        )
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

function matchHeading(line: string): string | null {
  const plain = line.replace(/\*\*/g, '')
  const markdown = plain.match(/^#{1,6}\s*(.+)$/)
  if (markdown) return markdown[1].replace(/[：:]\s*$/, '').trim()
  if (plain.length <= 12 && /^(新增|优化|修复|工程)/.test(plain)) {
    return plain.replace(/[：:]\s*$/, '').trim()
  }
  return null
}

function canonicalTitle(title: string): string {
  if (title.includes('新增')) return '新增能力'
  if (title.includes('优化')) return '优化提升'
  if (title.includes('修复')) return '问题修复'
  if (title.includes('工程')) return '工程与治理'
  return title
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 关键词命中匹配的正则：去重、按长度降序（长词优先）、忽略大小写
export function buildHitPattern(keywords: string[]): RegExp | null {
  const escaped = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  if (escaped.length === 0) return null
  return new RegExp(`(${escaped.join('|')})`, 'gi')
}

// 把文本切成 plain / weak / todo / hit 分段：todo、weak 优先于 hit，互不重叠
export function segment(text: string, hits: string[] = []): Segment[] {
  interface RawMatch {
    start: number
    end: number
    type: SegmentType
    prio: number
  }
  const matches: RawMatch[] = []
  for (const match of text.matchAll(SEGMENT_PATTERN)) {
    const index = match.index ?? 0
    matches.push({
      start: index,
      end: index + match[0].length,
      type: match[1] ? 'todo' : 'weak',
      prio: 2,
    })
  }
  const hitPattern = buildHitPattern(hits)
  if (hitPattern) {
    for (const match of text.matchAll(hitPattern)) {
      const index = match.index ?? 0
      matches.push({ start: index, end: index + match[0].length, type: 'hit', prio: 1 })
    }
  }
  matches.sort((a, b) => a.start - b.start || b.prio - a.prio || b.end - a.end)

  const segments: Segment[] = []
  let cursor = 0
  for (const m of matches) {
    if (m.start < cursor) continue
    if (m.start > cursor) segments.push({ type: 'plain', text: text.slice(cursor, m.start) })
    segments.push({ type: m.type, text: text.slice(m.start, m.end) })
    cursor = m.end
  }
  if (cursor < text.length) segments.push({ type: 'plain', text: text.slice(cursor) })
  return segments
}

export function countIssues(parsed: Parsed): IssueCount {
  let weak = 0
  let todo = 0
  let items = 0
  for (const group of parsed.groups) {
    for (const item of group.items) {
      items += 1
      for (const seg of segment(item.text)) {
        if (seg.type === 'weak') weak += 1
        if (seg.type === 'todo') todo += 1
      }
    }
  }
  return { weak, todo, items }
}

// 只保留勾选条目（导出 / 评分 / JD 对标的统一视图）
export function filterSelected(parsed: Parsed | null): Parsed | null {
  if (!parsed) return null
  return {
    groups: parsed.groups
      .map((g) => ({ title: g.title, items: g.items.filter((i) => i.selected !== false) }))
      .filter((g) => g.items.length > 0),
  }
}

export interface ItemRef {
  group: string
  index: number
  text: string
  /** 「源N」出处编号（无出处为空数组） */
  sources: number[]
}

// 按组展开条目列表（面试追问的编号顺序与前端定位共用同一口径）
export function listItems(parsed: Parsed, options: { skipNotes?: boolean } = {}): ItemRef[] {
  const out: ItemRef[] = []
  for (const group of parsed.groups) {
    group.items.forEach((item, index) => {
      if (options.skipNotes === true && isNoteLine(item.text)) return
      out.push({ group: group.title, index, text: item.text, sources: item.sources })
    })
  }
  return out
}

// 原始记录的非空行（行号从 1 开始，与「源N」约定一致）
export function recordLines(records: string): string[] {
  return records
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

// 记录分段：独占一行的 --- / *** / === 视为分隔符，返回各段内容（去掉空段）。
// 用于「一次贴多段经历」的场景：提示分段数量，并让提炼时按段区分归属。
const SEGMENT_SPLIT_PATTERN = /^\s*(?:-{3,}|\*{3,}|={3,})\s*$/

export function splitRecordSegments(records: string): string[] {
  const buckets: string[][] = [[]]
  for (const line of records.split(/\r?\n/)) {
    if (SEGMENT_SPLIT_PATTERN.test(line)) {
      buckets.push([])
      continue
    }
    buckets[buckets.length - 1].push(line)
  }
  return buckets.map((lines) => lines.join('\n').trim()).filter((s) => s !== '')
}

// 在原始记录里找与关键词（或近似片段）相关的行：缺口清单的「找素材」入口
export function findRecordLines(
  records: string,
  keyword: string,
  max = 3,
): Array<{ n: number; text: string }> {
  const lines = recordLines(records)
  const kw = keyword.trim().toLowerCase()
  if (kw === '') return []
  const scored: Array<{ n: number; text: string; score: number }> = []
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]
    if (text.includes(keyword)) {
      scored.push({ n: i + 1, text, score: kw.length + 10 })
      continue
    }
    const score = longestCommonSubstring(text.toLowerCase(), kw)
    // 至少 2 字重合才算近似，避免单字噪声
    if (score >= 2) scored.push({ n: i + 1, text, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .slice(0, max)
    .map(({ n, text }) => ({ n, text }))
}

// 最长公共子串长度（短文本暴力扫描即可）
function longestCommonSubstring(a: string, b: string): number {
  let best = 0
  for (let i = 0; i < a.length; i += 1) {
    for (let len = best + 1; i + len <= a.length; len += 1) {
      if (b.includes(a.slice(i, i + len))) best = len
      else break
    }
  }
  return best
}

// 文本里不在给定素材中出现过的数字（% 前缀等边界要精确，避免 9 与 93 误判）
export function findUntraceableNumbers(text: string, materials: string[]): string[] {
  const hay = materials.join('\n')
  if (hay.trim() === '') return []
  const out = new Set<string>()
  for (const match of text.matchAll(/\d+(?:\.\d+)?%?/g)) {
    const num = match[0]
    const escaped = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(?<![\\d.])${escaped}(?![\\d])`)
    if (!pattern.test(hay)) out.add(num)
  }
  return [...out]
}

export interface InterviewQuestion {
  q: string
  /** AI 标注的关联条目编号（对应传入 prompt 的 1-based 顺序）；无标注为空 */
  refs: number[]
}

// 解析面试追问结果：每行一个问题，句末「（关联：第2条）」标注关联条目
export function parseInterviewList(raw: string): InterviewQuestion[] {
  const out: InterviewQuestion[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*•]\s*/, '').replace(/^\d+\s*[.、)]\s*/, '')
    if (trimmed === '') continue
    const match = trimmed.match(/[（(]\s*关联\s*[：:]\s*第?\s*([\d,，、\s]+?)\s*条?\s*[)）]\s*$/)
    let q = trimmed
    let refs: number[] = []
    if (match && match.index !== undefined) {
      refs = match[1]
        .split(/[,，、\s]+/)
        .map((n) => Number.parseInt(n, 10))
        .filter((n) => Number.isInteger(n) && n > 0)
      q = trimmed.slice(0, match.index).trim()
    }
    if (q !== '') out.push({ q, refs })
  }
  return out
}

export function checkDateGaps(raw: string): DateCoverage | null {
  const days = new Set<string>()
  for (const match of raw.matchAll(DATE_PATTERN)) {
    const month = match[2].padStart(2, '0')
    const day = match[3].padStart(2, '0')
    days.add(`${match[1]}-${month}-${day}`)
  }
  if (days.size < 2) return null

  // 纯日期运算走 UTC，避免本地时区 / 夏令时造成 ±1 天偏差
  const sorted = [...days].sort()
  const from = sorted[0]
  const to = sorted[sorted.length - 1]
  const toUtc = (key: string): number => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  const startUtc = toUtc(from)
  const span = Math.round((toUtc(to) - startUtc) / 86400000) + 1
  if (span > 62) return null

  const missing: string[] = []
  for (let i = 0; i < span; i += 1) {
    const day = new Date(startUtc + i * 86400000)
    const key = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
    if (!days.has(key)) missing.push(key.slice(5))
  }
  return { from, to, missing }
}
