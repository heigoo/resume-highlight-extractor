import { beforeEach, describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  STATS_KEY,
  averageMs,
  loadStats,
  recentCount,
  recordStat,
} from '../../src/lib/stats'

// Node 环境没有 localStorage：用最小内存实现替代，仅覆盖统计读写
class MemoryStorage {
  private map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

describe('recordStat / loadStats', () => {
  it('记录成功与失败次数、耗时，并累计当天次数', () => {
    recordStat('ok', 3000)
    recordStat('fail', 1000)
    const stats = loadStats()
    expect(stats.count).toBe(2)
    expect(stats.ok).toBe(1)
    expect(stats.fail).toBe(1)
    expect(averageMs(stats)).toBe(2000)
    expect(recentCount(stats)).toBe(2)
  })

  it('成功时写入匹配度与条目数；失败不写历史', () => {
    recordStat('ok', 1200, { pct: 62, items: 8 })
    recordStat('fail', 900)
    const stats = loadStats()
    expect(stats.history).toHaveLength(1)
    expect(stats.history[0].pct).toBe(62)
    expect(stats.history[0].items).toBe(8)
    expect(stats.history[0].t).toBeGreaterThan(0)
  })

  it('未填 JD 时匹配度记 null，条目数默认 0', () => {
    recordStat('ok', 800, { pct: null })
    const stats = loadStats()
    expect(stats.history[0].pct).toBeNull()
    expect(stats.history[0].items).toBe(0)
  })

  it('匹配度超出 0-100 时被裁剪', () => {
    recordStat('ok', 800, { pct: 130, items: 3 })
    recordStat('ok', 800, { pct: -5, items: 3 })
    const stats = loadStats()
    expect(stats.history.map((p) => p.pct)).toEqual([100, 0])
  })

  it('历史只保留最近 HISTORY_LIMIT 条', () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) recordStat('ok', 100, { pct: i, items: 1 })
    const stats = loadStats()
    expect(stats.history).toHaveLength(HISTORY_LIMIT)
    expect(stats.history[0].pct).toBe(5)
  })
})

describe('loadStats 容错', () => {
  it('旧数据没有 history 字段时按空数组处理', () => {
    globalThis.localStorage.setItem(
      STATS_KEY,
      JSON.stringify({ count: 3, ok: 2, fail: 1, totalMs: 900, days: {} }),
    )
    const stats = loadStats()
    expect(stats.count).toBe(3)
    expect(stats.history).toEqual([])
  })

  it('历史里的脏点被清洗掉', () => {
    globalThis.localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        count: 2,
        ok: 2,
        fail: 0,
        totalMs: 1000,
        days: {},
        history: [
          { t: 0, pct: 50, items: 1 },
          'not-an-object',
          { t: Date.now(), pct: 'x', items: -3 },
        ],
      }),
    )
    const stats = loadStats()
    expect(stats.history).toHaveLength(1)
    expect(stats.history[0].pct).toBeNull()
    expect(stats.history[0].items).toBe(0)
  })

  it('JSON 损坏时回退到全零状态', () => {
    globalThis.localStorage.setItem(STATS_KEY, '{broken')
    const stats = loadStats()
    expect(stats.count).toBe(0)
    expect(stats.history).toEqual([])
  })
})