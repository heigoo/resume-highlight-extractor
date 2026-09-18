<script setup lang="ts">
// 「淬金」：提炼等待区的生成式动画（p5.js 实例模式，动态导入）
// 哲学与数据映射见 src/lib/alchemy.ts 头注释。
// 失败兜底：p5 加载失败时本组件保持不可见，父级静态等待文案照常工作（手动兜底路径）。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type p5 from 'p5'
import { ALCHEMY_PALETTES, type AlchemyPalette } from '../lib/alchemy'

const props = defineProps<{
  /** 种子（原始记录哈希）：同一份记录重播同一场冶炼；挂载时快照，提炼中编辑记录不打断 */
  seed: number
  /** 流式进度 0~0.92（App 由 aiRaw 长度算出） */
  progress: number
  /** 暗色模式 */
  dark: boolean
}>()

const host = ref<HTMLElement | null>(null)
const ready = ref(false)

/** 挂载时快照：种子只在动画开始那一刻生效 */
const seedSnapshot = props.seed

let inst: p5 | null = null
let targetProgress = props.progress
let smoothProgress = 0
/** 环境进度：长时间无内容（思考型模型）时缓慢自发推进到 0.45 封顶，让「冶炼中」叙事保持可见；仅内部编排，不外露 */
let ambient = 0
let palette = props.dark ? ALCHEMY_PALETTES.dark : ALCHEMY_PALETTES.light
let reducedMotion = false
let canvasW = 1
let canvasH = 1

watch(
  () => props.progress,
  (v) => {
    targetProgress = v
  },
)
watch(
  () => props.dark,
  (d) => {
    palette = d ? ALCHEMY_PALETTES.dark : ALCHEMY_PALETTES.light
  },
)

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  /** 目标晶格点（归一化坐标）+ 微偏移，避免叠死在同一像素 */
  tu: number
  tv: number
  size: number
  twinkle: number
}

onMounted(async () => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  try {
    const P5 = (await import('p5')).default
    const el = host.value
    if (!el) return
    inst = new P5(makeSketch(), el)
    ready.value = true
  } catch {
    // p5 加载失败（离线首访等）：保持不可见，静态等待文案兜底
  }
})

function makeSketch() {
  return (p: p5) => {
    const NOISE_SCALE = 0.0035
    const GOLDEN = p.radians(137.507)
    const LATTICE_COUNT = 36
    const MAX_PARTICLES = 700

    let noiseT = 0
    let particles: Particle[] = []
    /** 晶格点（归一化坐标，resize 无需重算） */
    let lattice: Array<{ u: number; v: number }> = []

    function initSystem() {
      lattice = []
      for (let i = 0; i < LATTICE_COUNT; i++) {
        const r = Math.sqrt((i + 0.5) / LATTICE_COUNT)
        const theta = i * GOLDEN + (p.random() - 0.5) * 0.35
        lattice.push({
          u: 0.5 + Math.cos(theta) * r * 0.82,
          v: 0.5 + Math.sin(theta) * r * 0.86,
        })
      }
      const n = Math.min(MAX_PARTICLES, Math.max(200, Math.round((canvasW * canvasH) / 900)))
      particles = []
      for (let i = 0; i < n; i++) {
        const t = lattice[i % lattice.length]
        particles.push({
          x: p.random(canvasW),
          y: p.random(canvasH),
          vx: 0,
          vy: 0,
          tu: t.u + (p.random() - 0.5) * 0.02,
          tv: t.v + (p.random() - 0.5) * 0.02,
          size: 1.4 + p.random() * 2.2,
          twinkle: p.random(1000),
        })
      }
    }

    function step() {
      const prog = smoothProgress
      // 湍流按进度平方消退：前期汹涌，中段即让位给引力
      const chaos = (1 - prog) * (1 - prog)
      // 引力带底值：纯混沌期也留一丝向晶格的偏置，随进度迅速增强
      const attract = 0.0015 + prog * 0.008
      noiseT += 0.004
      for (const pt of particles) {
        const a = p.noise(pt.x * NOISE_SCALE, pt.y * NOISE_SCALE, noiseT) * Math.PI * 4
        const speed = 0.35 + chaos * 0.9
        pt.vx += Math.cos(a) * speed * chaos
        pt.vy += Math.sin(a) * speed * chaos
        if (attract > 0) {
          const tx = pt.tu * canvasW
          const ty = pt.tv * canvasH
          pt.vx += (tx - pt.x) * attract
          pt.vy += (ty - pt.y) * attract
        }
        pt.vx *= 0.92
        pt.vy *= 0.92
        pt.x += pt.vx
        pt.y += pt.vy
        if (pt.x < -10) pt.x += canvasW + 20
        else if (pt.x > canvasW + 10) pt.x -= canvasW + 20
        if (pt.y < -10) pt.y += canvasH + 20
        else if (pt.y > canvasH + 10) pt.y -= canvasH + 20
      }
    }

    function render() {
      const prog = smoothProgress
      const [dr, dg, db] = hexRgb(palette.dust)
      const [or_, og, ob] = hexRgb(palette.ore)
      const [gr, gg, gb] = hexRgb(palette.gold)
      const [lr, lg, lb] = hexRgb(palette.glow)
      p.clear()
      p.noStroke()
      // 金脉：相邻晶格点连成黄金角螺旋丝线，随进度浮现——「晶格」的可读骨架
      if (prog > 0.15) {
        p.stroke(lr, lg, lb, 46 * prog)
        p.strokeWeight(1)
        p.noFill()
        for (let i = 1; i < lattice.length; i++) {
          p.line(
            lattice[i - 1].u * canvasW,
            lattice[i - 1].v * canvasH,
            lattice[i].u * canvasW,
            lattice[i].v * canvasH,
          )
        }
        p.noStroke()
      }
      // 晶格辉光与金脉核心：提炼越深，金脉越亮
      if (prog > 0.1) {
        p.fill(lr, lg, lb, 18 + 60 * prog)
        for (const t of lattice) p.circle(t.u * canvasW, t.v * canvasH, 22 + 22 * prog)
        if (prog > 0.3) {
          p.fill(gr, gg, gb, 90 * prog)
          for (const t of lattice) p.circle(t.u * canvasW, t.v * canvasH, 3)
        }
      }
      for (const pt of particles) {
        const d = Math.hypot(pt.x - pt.tu * canvasW, pt.y - pt.tv * canvasH)
        const crys = Math.min(1, prog * Math.max(0, 1 - d / 90))
        // 速度即色彩：湍流快者铁灰，慢者矿灰阴影；被晶格捕获者燃金并微微闪烁
        const spd = Math.min(1, Math.hypot(pt.vx, pt.vy) / 2.2)
        let r = dr + (or_ - dr) * spd
        let g = dg + (og - dg) * spd
        let b = db + (ob - db) * spd
        let alpha = 150 + 70 * spd
        if (crys > 0.02) {
          const tw = 0.75 + 0.25 * Math.sin(noiseT * 40 + pt.twinkle)
          r += (gr - r) * crys
          g += (gg - g) * crys
          b += (gb - b) * crys
          alpha = 160 + 95 * crys * tw
        }
        p.fill(r, g, b, alpha)
        p.circle(pt.x, pt.y, pt.size + crys * 1.6)
      }
    }

    p.setup = () => {
      const rect = host.value?.getBoundingClientRect()
      canvasW = Math.max(1, Math.round(rect?.width ?? 1))
      canvasH = Math.max(1, Math.round(rect?.height ?? 1))
      p.createCanvas(canvasW, canvasH)
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1))
      // 先设种子再生成系统：晶格抖动与粒子初始位置全部可复现
      p.randomSeed(seedSnapshot)
      p.noiseSeed(seedSnapshot)
      initSystem()
      if (reducedMotion) {
        // 减少动态：预热到近落定状态，画一帧「已成金」的定格
        smoothProgress = 0.85
        targetProgress = 0.85
        for (let i = 0; i < 140; i++) step()
        render()
        p.noLoop()
      }
    }

    p.draw = () => {
      // 环境进度：无内容（思考型模型慢启动）时自发缓慢推进到 0.45 封顶，约 8 秒走完；
      // 真实进度到达后取二者最大——粒子只进不退，避免视觉回退
      if (targetProgress <= 0.001) ambient = Math.min(0.45, ambient + 0.0009)
      const effective = Math.max(targetProgress, ambient)
      smoothProgress += (effective - smoothProgress) * 0.06
      step()
      render()
    }
  }
}

// 容器尺寸变化：画布跟随，晶格为归一化坐标自动适配
let resizeObserver: ResizeObserver | null = null
let onVisibility: (() => void) | null = null

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (!host.value || !inst) return
    const rect = host.value.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    if (w === canvasW && h === canvasH) return
    canvasW = w
    canvasH = h
    inst.resizeCanvas(w, h)
  })
  if (host.value) resizeObserver.observe(host.value)
  // 页面隐藏时停帧省电，恢复时续播
  onVisibility = () => {
    if (!inst) return
    if (document.hidden) inst.noLoop()
    else if (!reducedMotion) inst.loop()
  }
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
  onVisibility = null
  inst?.remove()
  inst = null
})
</script>

<template>
  <div
    ref="host"
    class="absolute inset-0 overflow-hidden transition-opacity duration-300"
    :class="ready ? 'opacity-100' : 'opacity-0'"
    aria-hidden="true"
  ></div>
</template>
