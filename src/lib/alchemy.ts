// 「淬金」——提炼等待区的生成式动画数据层（algorithmic-art 技能落地）
//
// 算法哲学：混沌受自然律约束，秩序自扰动中涌现。
// 数百粒铁灰色尘埃生于虚空，被多层 Perlin 噪声构成的湍流场搬运——那是流水账的原始形态：
// 密集、无向、彼此相似。一股不可见的引力（提炼本身）随文本生长而增强，把尘埃卷入按黄金角
// 排布的螺旋晶格。速度即色彩：湍流中的粒子是铁灰，被晶格捕获的粒子升温、落定、燃成金色，
// 并在落定点留下微光。同一份记录，同一场冶炼：种子使每次重播分毫不差。
// 概念种子：产品口号「凡流水账，皆可点铁成金」——熟悉的人会心一笑，不熟悉的人看到一场粒子冶炼。

/** FNV-1a 32 位哈希：records → 数字种子（同一份记录 = 同一场动画） */
export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // p5 的 randomSeed/noiseSeed 接受正整数；保证非负非 NaN
  return Math.abs(hash >>> 0) || 1
}

/** 进度饱和常数：700 字符 ≈ 典型提炼结果过半（1-1/e ≈ 0.632） */
const PROGRESS_SCALE = 700
/** 提炼中永不满格：完成态由组件卸载与金色闪光表达，动画不假装「快好了」 */
const PROGRESS_CAP = 0.92

/**
 * 流式进度：aiRaw 字符数 → 0~0.92 的饱和曲线。
 * SSE 无总长信息，指数饱和让开头几块字符就有可感的聚拢反馈，之后趋缓。
 */
export function streamProgress(len: number): number {
  if (!(len > 0)) return 0
  return Math.min(PROGRESS_CAP, 1 - Math.exp(-len / PROGRESS_SCALE))
}

export interface AlchemyPalette {
  /** 湍流尘埃（铁灰） */
  dust: string
  /** 深层矿灰（慢速粒子） */
  ore: string
  /** 落定金 */
  gold: string
  /** 辉光金（晶格光晕） */
  glow: string
}

/** 亮 / 暗两套调色板：与全局 @theme 的 ink 灰阶同源，金为本功能专属 */
export const ALCHEMY_PALETTES: { light: AlchemyPalette; dark: AlchemyPalette } = {
  light: { dust: '#5d5647', ore: '#9a9180', gold: '#c9971e', glow: '#e8c56a' },
  dark: { dust: '#7e7663', ore: '#b2a891', gold: '#e8b84b', glow: '#f5d98a' },
}
