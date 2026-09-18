import { describe, expect, it } from 'vitest'
import { ALCHEMY_PALETTES, hashString, streamProgress } from '../../src/lib/alchemy'

describe('hashString（动画种子）', () => {
  it('确定性：同一输入永远同一输出', () => {
    expect(hashString('日报\n修了个白屏\n')).toBe(hashString('日报\n修了个白屏\n'))
  })

  it('区分性：不同输入产生不同种子', () => {
    const seeds = new Set(
      ['周一修复白屏', '周一修复黑屏', 'another day', ''].map((s) => hashString(s)),
    )
    // 4 个输入至少 3 个不同（空串与其他碰撞概率极低，但留余量）
    expect(seeds.size).toBeGreaterThanOrEqual(3)
  })

  it('输出为正整数（p5 randomSeed/noiseSeed 可用），空串不 NaN', () => {
    for (const s of ['', 'a', '记录内容xyz123']) {
      const n = hashString(s)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThan(0)
    }
  })
})

describe('streamProgress（流式进度）', () => {
  it('无字符时为 0', () => {
    expect(streamProgress(0)).toBe(0)
    expect(streamProgress(-5)).toBe(0)
  })

  it('单调不减：字符越多进度越高（封顶前严格递增）', () => {
    let prev = -1
    for (const len of [1, 10, 50, 200, 700, 1500, 2000, 9000]) {
      const v = streamProgress(len)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    // 封顶前严格递增（1500 字符 ≈ 0.88，未到 0.92 上限）
    expect(streamProgress(1500)).toBeGreaterThan(streamProgress(700))
  })

  it('700 字符 ≈ 0.632（指数饱和过半点）', () => {
    expect(streamProgress(700)).toBeCloseTo(1 - Math.exp(-1), 2)
  })

  it('提炼中永不满格：有限长度下 < 0.93', () => {
    expect(streamProgress(100)).toBeLessThan(0.93)
    expect(streamProgress(1_000_000)).toBeLessThanOrEqual(0.92)
  })
})

describe('ALCHEMY_PALETTES（双主题调色板）', () => {
  it('亮暗两套各含 4 个 6 位十六进制颜色', () => {
    for (const key of ['light', 'dark'] as const) {
      const pal = ALCHEMY_PALETTES[key]
      for (const color of [pal.dust, pal.ore, pal.gold, pal.glow]) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })
})
