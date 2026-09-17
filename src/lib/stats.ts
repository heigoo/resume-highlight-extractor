// 本地使用统计：仅存 localStorage，不做任何远程上报

/** 一次成功提炼的记录点（本机数据看板用） */
export interface StatPoint {
  /** 提炼完成时间戳 */
  t: number
  /** 本次 JD 匹配度（0-100）；未填 JD 时为 null */
  pct: number | null
  /** 本次提炼出的条目数 */
  items: number
}

export interface AiStats {
  count: number
  ok: number
  fail: number
  totalMs: number
  /** 按天累计的提炼次数（YYYY-MM-DD → 次数），用于「近 7 天」展示；旧数据缺省为 {} */
  days: Record<string, number>
  /** 成功提炼的历史点（最多 HISTORY_LIMIT 条）；旧数据缺省为 [] */
  history: StatPoint[]
}

export const STATS_KEY = 'rhe.stats.v1'

/** 历史点上限：只留最近 40 次，避免长期使用后 localStorage 体量无限增长 */
export const HISTORY_LIMIT = 40

// 字段非有限非负数时按 0 处理
function sanitize(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

function sanitizeHistory(v: unknown): StatPoint[] {
  if (!Array.isArray(v)) return []
  const out: StatPoint[] = []
  for (const item of v) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Partial<StatPoint>
    if (typeof o.t !== 'number' || !Number.isFinite(o.t) || o.t <= 0) continue
    const pct =
      typeof o.pct === 'number' && Number.isFinite(o.pct)
        ? Math.min(100, Math.max(0, Math.round(o.pct)))
        : null
    out.push({ t: o.t, pct, items: Math.round(sanitize(o.items)) })
  }
  return out.slice(-HISTORY_LIMIT)
}

function sanitizeDays(v: unknown): Record<string, number> {
  if (typeof v !== 'object' || v === null) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) out[key] = sanitize(value)
  }
  return out
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function loadStats(): AiStats {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (!raw) return { count: 0, ok: 0, fail: 0, totalMs: 0, days: {}, history: [] }
    const parsed = JSON.parse(raw) as Partial<AiStats>
    return {
      count: sanitize(parsed.count),
      ok: sanitize(parsed.ok),
      fail: sanitize(parsed.fail),
      totalMs: sanitize(parsed.totalMs),
      days: sanitizeDays(parsed.days),
      history: sanitizeHistory(parsed.history),
    }
  } catch {
    return { count: 0, ok: 0, fail: 0, totalMs: 0, days: {}, history: [] }
  }
}

export function recordStat(
  outcome: 'ok' | 'fail',
  ms: number,
  info?: { pct?: number | null; items?: number },
): void {
  const stats = loadStats()
  stats.count += 1
  if (outcome === 'ok') stats.ok += 1
  else stats.fail += 1
  stats.totalMs += Math.max(0, Math.round(ms))
  const today = dayKey(Date.now())
  stats.days[today] = (stats.days[today] ?? 0) + 1
  // 只保留最近 30 天，避免长期使用后统计体量无限增长
  const cutoff = dayKey(Date.now() - 30 * 86400000)
  for (const key of Object.keys(stats.days)) if (key < cutoff) delete stats.days[key]
  if (outcome === 'ok') {
    const pct =
      typeof info?.pct === 'number' && Number.isFinite(info.pct)
        ? Math.min(100, Math.max(0, Math.round(info.pct)))
        : null
    stats.history = [
      ...stats.history,
      { t: Date.now(), pct, items: Math.max(0, Math.round(info?.items ?? 0)) },
    ].slice(-HISTORY_LIMIT)
  }
  localStorage.setItem(STATS_KEY, JSON.stringify(stats))
}

export function averageMs(stats: AiStats): number {
  if (stats.count === 0) return 0
  return Math.round(stats.totalMs / stats.count)
}

// 近 N 天（含今天）的提炼次数
export function recentCount(stats: AiStats, days = 7): number {
  let sum = 0
  for (let i = 0; i < days; i += 1) sum += stats.days[dayKey(Date.now() - i * 86400000)] ?? 0
  return sum
}