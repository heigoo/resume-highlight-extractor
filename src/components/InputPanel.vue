<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import Collapse from './Collapse.vue'
import { copyText } from '../lib/clipboard'
import { notify } from '../lib/toast'
import { SAMPLE_AI_RESULT, SAMPLE_RECORDS } from '../lib/samples'
import {
  RULE_PRESETS,
  SCENARIO_PRESETS,
  STYLE_PRESETS,
  parseRules,
  serializeRules,
  type RulePreset,
} from '../lib/rules'
import { downloadText, exportFilename } from '../lib/download'
import { extractTextFromFile, isSupportedImportFile } from '../lib/fileimport'
import { splitRecordSegments } from '../lib/parse'

const props = defineProps<{
  records: string
  rules: string
  jd: string
  style: string
  scenario: string
  /** AI 原文：一键提炼的返回，或手动粘贴的返回（都在「备用」区编辑与重新格式化） */
  raw: string
  prompt: string
  extracting: boolean
  configured: boolean
  ruleGen: boolean
  streamCount: number
  jdKeywords: string[]
  lastError: string | null
  /** 结果区「去填 JD」的请求序号：每次递增即展开 JD 面板并聚焦输入框 */
  jdFocusSeq: number
  /** 结果区「查看原始返回」的请求序号：每次递增即展开备用区并聚焦原文框 */
  rawFocusSeq: number
  /** 提炼失败后「改用备用路径」的请求序号：每次递增即展开备用区并聚焦复制指令 */
  backupFocusSeq: number
}>()

const emit = defineEmits<{
  (e: 'update:records', value: string): void
  (e: 'update:rules', value: string): void
  (e: 'update:jd', value: string): void
  (e: 'update:style', value: string): void
  (e: 'update:scenario', value: string): void
  (e: 'update:raw', value: string): void
  (e: 'generate'): void
  (e: 'extract'): void
  (e: 'stop'): void
  (e: 'format'): void
  (e: 'auto-rules'): void
  (e: 'use-backup'): void
  (e: 'focus-keyword', keyword: string): void
}>()

const copied = ref(false)
// 预设高亮按当前 rules 匹配：首次访问命中 tech 预设，恢复自定义规则时不高亮
const activePreset = ref<string | null>(
  RULE_PRESETS.find((p) => p.rules === props.rules)?.id ?? null,
)
const promptBox = ref<HTMLElement | null>(null)
const promptOpen = ref(false)
// JD 对标面板：默认收起，已有 JD 内容（草稿恢复）时展开
const jdOpen = ref(props.jd.trim() !== '')
// 规则编辑区默认折叠（预设足够用时降低认知负担）；自定义规则时自动展开
const rulesOpen = ref(!RULE_PRESETS.some((p) => p.rules === props.rules))

// 非空记录行数：过少时提前提示，避免白跑一次 AI
const recordLineCount = computed(
  () => props.records.split(/\r?\n/).filter((l) => l.trim() !== '').length,
)
// 记录过长：可能超出模型上下文或稀释提炼质量，提前提示分段
const LONG_RECORD_CHARS = 8000
const recordTooLong = computed(() => props.records.length > LONG_RECORD_CHARS)
// 用独占一行的 --- 分隔的多段记录：提示已识别段数
const recordSegmentCount = computed(() => splitRecordSegments(props.records).length)

// 当前组合（岗位规则 · 表达风格 · 人群场景 · 是否带 JD）：让「将发送什么」一目了然
const comboLabels = computed(() => [
  RULE_PRESETS.find((p) => p.rules === props.rules)?.label ?? '自定义规则',
  STYLE_PRESETS.find((s) => s.id === props.style)?.label ?? '默认风格',
  SCENARIO_PRESETS.find((s) => s.id === props.scenario)?.label ?? '通用',
])

// 结果区「去填 JD」：展开 JD 面板、滚动定位并聚焦输入框
const jdBox = ref<HTMLTextAreaElement | null>(null)
watch(
  () => props.jdFocusSeq,
  async (seq) => {
    if (!seq) return
    jdOpen.value = true
    await nextTick()
    jdBox.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    jdBox.value?.focus()
  },
)

// 备用区：AI 原文（手动粘贴的返回，或一键提炼的返回）在这里编辑后重新格式化
const rawBox = ref<HTMLTextAreaElement | null>(null)

// 点「填入示例结果」即展开备用区并填入示例，不需要先手动展开
function fillSampleResult(): void {
  emit('update:raw', SAMPLE_AI_RESULT)
  promptOpen.value = true
}

// 结果区「查看原始返回」：展开备用区、滚动定位并聚焦原文框
watch(
  () => props.rawFocusSeq,
  async (seq) => {
    if (!seq) return
    promptOpen.value = true
    await nextTick()
    rawBox.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    rawBox.value?.focus()
  },
)

// 展开备用区、滚动到指令框并聚焦「复制指令」：所有「让用户看指令」的入口都走这里
const copyBtn = ref<HTMLButtonElement | null>(null)
async function revealBackup(): Promise<void> {
  promptOpen.value = true
  await nextTick()
  promptBox.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  copyBtn.value?.focus()
}

// 提炼失败「改用备用路径」：展开备用区（指令已由父组件生成），滚动并聚焦「复制指令」
watch(
  () => props.backupFocusSeq,
  async (seq) => {
    if (!seq) return
    await revealBackup()
  },
)

// 提炼等待计时：请求进行中每秒累加，结束或卸载时清理
const waited = ref(0)
let waitedTimer: number | undefined

watch(
  () => props.extracting,
  (active) => {
    window.clearInterval(waitedTimer)
    waitedTimer = undefined
    waited.value = 0
    if (active) {
      waitedTimer = window.setInterval(() => {
        waited.value += 1
      }, 1000)
    }
  },
)

onUnmounted(() => {
  window.clearInterval(waitedTimer)
})

const canGenerate = computed(() => props.records.trim().length > 0)

function selectPreset(preset: RulePreset) {
  activePreset.value = preset.id
  emit('update:rules', preset.rules)
}

function onRulesInput(value: string) {
  activePreset.value = null
  emit('update:rules', value)
}

// rules 被外部改变（AI 定制、草稿恢复）时，同步预设高亮与编辑区展开状态
watch(
  () => props.rules,
  (value) => {
    const isPreset = RULE_PRESETS.some((p) => p.rules === value)
    activePreset.value = RULE_PRESETS.find((p) => p.rules === value)?.id ?? null
    if (!isPreset) rulesOpen.value = true
  },
)

// 主按钮：提炼中点击 = 停止；否则发起一键提炼
function onMainClick() {
  if (props.extracting) {
    emit('stop')
    return
  }
  emit('extract')
}

// 生成指令：记录为空时给出明确反馈（按钮不置灰，否则点击毫无响应）；
// reveal=true 用于「预览最终指令」——展开备用区让人真的看到指令
async function onGenerateBackup(reveal = false) {
  if (!canGenerate.value) {
    notify('warn', '先粘贴工作记录，再生成提炼指令')
    return
  }
  emit('generate')
  if (reveal) await revealBackup()
}

// ---------- 文件导入（纯客户端解析，零上传） ----------
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file || importing.value) return
  if (!isSupportedImportFile(file)) {
    notify('err', '仅支持 15MB 内的 .pdf / .docx / .txt / .md 文件')
    return
  }
  importing.value = true
  try {
    const { text, kind } = await extractTextFromFile(file)
    const merged =
      props.records.trim() === '' ? text : `${props.records.trimEnd()}\n\n${text}`
    emit('update:records', merged)
    notify('ok', `已导入 ${file.name}（${kind.toUpperCase()} 文件 · 在你的浏览器里读取，没有上传）`)
  } catch (e) {
    notify('err', e instanceof Error ? e.message : '文件解析失败')
  } finally {
    importing.value = false
  }
}

async function onCopy() {
  if (!(await copyText(props.prompt))) {
    notify('err', '复制失败，请手动全选文本复制')
    return
  }
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}

// ---------- 规则 JSON 导入导出（可分享给同伴） ----------
const rulesInput = ref<HTMLInputElement | null>(null)

function onExportRules() {
  downloadText(
    exportFilename('json').replace('简历亮点', '提炼规则'),
    serializeRules(props.rules),
    'application/json',
  )
  notify('ok', '规则已下载为文件，发给同伴就能导入')
}

async function onImportRules(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file) return
  try {
    const rules = parseRules(await file.text())
    if (!rules) throw new Error('这个文件里没读到规则：请选本工具导出的规则文件（或至少 3 行规则文字）')
    emit('update:rules', rules)
    notify('ok', '规则已导入，可在规则编辑区继续修改')
  } catch (e) {
    notify('err', e instanceof Error ? e.message : '规则导入失败')
  }
}

// prompt 由空变非空时自动展开备用区；小屏下展开后滚动定位
watch(
  () => props.prompt,
  async (value, oldValue) => {
    if (oldValue?.trim() || !value.trim()) return
    promptOpen.value = true
    if (window.innerWidth >= 1024) return
    await nextTick()
    promptBox.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
)
</script>

<template>
  <div class="min-w-0 space-y-5">
    <section class="panel reveal d2 p-4 sm:p-5">
      <header class="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div class="flex items-center gap-2.5">
          <span class="seal-chip seal-sm font-display" aria-hidden="true">壹</span>
          <h2 class="font-display text-[15px] font-bold whitespace-nowrap text-ink">原始记录</h2>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
          <button
            type="button"
            class="link-btn"
            :disabled="importing"
            title="导入 PDF / Word / 文本文件；只在你自己的浏览器里解析，文件不会上传"
            @click="fileInput?.click()"
          >
            {{ importing ? '解析中…' : '导入文件' }}
          </button>
          <input
            ref="fileInput"
            type="file"
            accept=".pdf,.docx,.txt,.md"
            class="hidden"
            @change="onImportFile"
          />
          <button type="button" class="link-btn" @click="emit('update:records', SAMPLE_RECORDS)">
            填入示例
          </button>
        </div>
      </header>
      <textarea
        :value="records"
        rows="10"
        placeholder="把 git 提交日志 / 日报 / 待办清单直接粘进来，不用整理"
        class="field ruled-28 resize-y"
        @input="emit('update:records', ($event.target as HTMLTextAreaElement).value)"
        @keydown.ctrl.enter.prevent="emit('extract')"
        @keydown.meta.enter.prevent="emit('extract')"
      ></textarea>
      <footer class="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
        <span>{{ records.length }} 字</span>
        <span class="font-mono">Ctrl + ⏎ 快速提炼</span>
      </footer>
      <p
        v-if="recordLineCount > 0 && recordLineCount < 3"
        class="mt-1.5 text-[11px] text-seal-deep"
        role="status"
      >
        记录只有 {{ recordLineCount }} 行，提炼效果可能有限；多贴些细节（数字、结果、做了什么）效果更好
      </p>
      <p
        v-if="recordTooLong"
        class="mt-1.5 text-[11px] leading-relaxed text-seal-deep"
        role="status"
      >
        记录较长（{{ records.length }} 字）：可能超出 AI 一次能读完的长度，重点也会被稀释；建议按项目拆开、用单独一行的 --- 分隔，再分批提炼
      </p>
      <p
        v-else-if="recordSegmentCount > 1"
        class="mt-1.5 text-[11px] leading-relaxed text-jade"
        role="status"
      >
        已按「---」认出 {{ recordSegmentCount }} 段记录：提炼时每段各自归档，亮点不会串到别的项目里
      </p>
    </section>

    <section class="panel reveal d3 p-4 sm:p-5">
      <header class="mb-3">
        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span class="seal-chip seal-sm font-display" aria-hidden="true">贰</span>
          <h2 class="font-display text-[15px] font-bold whitespace-nowrap text-ink">提炼规则</h2>
          <button type="button" class="link-btn" :aria-expanded="rulesOpen" @click="rulesOpen = !rulesOpen">
            {{ rulesOpen ? '收起编辑' : '自定义规则' }}
          </button>
          <p class="basis-full text-xs text-ink-soft sm:ml-auto sm:basis-auto">
            可选：已经默认选好一套岗位规则，直接提炼就行；想更贴合，先换个岗位，再按需改下面的规则。
          </p>
        </div>
        <!-- 预设 chips 单独一行：宽度不足时整行换行，不再撑破面板 -->
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            v-for="preset in RULE_PRESETS"
            :key="preset.id"
            type="button"
            class="rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition"
            :class="
              activePreset === preset.id
                ? 'border-seal/60 bg-seal/10 text-seal-deep'
                : 'border-line text-ink-faint hover:border-ink/25 hover:text-ink-soft'
            "
            @click="selectPreset(preset)"
          >
            {{ preset.label }}
          </button>
          <span class="h-4 w-px bg-line" aria-hidden="true"></span>
          <button
            type="button"
            class="rounded-full border border-dashed px-3 py-1 text-xs font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-45"
            :class="ruleGen ? 'border-jade/60 bg-jade/10 text-jade' : 'border-jade/40 text-jade hover:bg-jade/10'"
            :disabled="!canGenerate || ruleGen"
            title="把粘贴的记录发给 AI，自动定制一套专属规则"
            @click="emit('auto-rules')"
          >
            {{ ruleGen ? '✦ 定制中…' : '✦ AI 定制' }}
          </button>
        </div>
      </header>
      <Collapse :open="rulesOpen">
        <textarea
          :value="rules"
          rows="9"
          aria-label="提炼规则编辑"
          class="field ruled-24 resize-y font-mono text-xs text-ink-soft"
          @input="onRulesInput(($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </Collapse>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <span class="text-[11px] text-ink-faint">风格</span>
        <button
          v-for="preset in STYLE_PRESETS"
          :key="preset.id"
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition"
          :class="
            style === preset.id
              ? 'border-jade/60 bg-jade/10 text-jade'
              : 'border-line text-ink-faint hover:border-ink/25 hover:text-ink-soft'
          "
          :title="preset.instruction || '不附加额外风格要求'"
          @click="emit('update:style', preset.id)"
        >
          {{ preset.label }}
        </button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <span class="text-[11px] text-ink-faint">人群</span>
        <button
          v-for="preset in SCENARIO_PRESETS"
          :key="preset.id || 'default'"
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition"
          :class="
            scenario === preset.id
              ? 'border-seal/60 bg-seal/10 text-seal-deep'
              : 'border-line text-ink-faint hover:border-ink/25 hover:text-ink-soft'
          "
          :title="preset.instruction || '不附加人群场景引导'"
          @click="emit('update:scenario', preset.id)"
        >
          {{ preset.label }}
        </button>
        <span class="h-4 w-px bg-line" aria-hidden="true"></span>
        <button
          type="button"
          class="link-btn"
          title="把当前规则存成文件，发给同伴就能导入复用"
          @click="onExportRules"
        >
          导出规则
        </button>
        <button
          type="button"
          class="link-btn"
          title="导入同伴分享的规则文件（也可以是规则文字）"
          @click="rulesInput?.click()"
        >
          导入规则
        </button>
        <input
          ref="rulesInput"
          type="file"
          accept=".json,.txt,.md"
          class="hidden"
          aria-label="选择规则文件"
          @change="onImportRules"
        />
      </div>
      <!-- 组合透明化：一眼看到「将发送给 AI 的是什么」组合，可预览完整指令 -->
      <div
        class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-line-soft bg-sheet px-3 py-2 text-[11px] text-ink-soft"
        role="note"
        aria-label="当前提炼组合"
      >
        <span class="text-ink-faint">当前组合</span>
        <span class="font-medium text-ink">{{ comboLabels[0] }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ comboLabels[1] }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ comboLabels[2] }}</span>
        <span v-if="jd.trim()" class="text-jade">+ JD 对标</span>
        <button
          type="button"
          class="link-btn ml-auto"
          title="生成将发送给 AI 的完整指令，并展开下方「备用」区供查看与复制"
          @click="onGenerateBackup(true)"
        >
          预览最终指令
        </button>
      </div>
    </section>

    <section class="panel reveal p-4 sm:p-5">
      <header class="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div class="flex items-center gap-2.5">
          <span class="seal-chip seal-sm seal-soft font-display" aria-hidden="true">靶</span>
          <h2 class="font-display text-[15px] font-bold whitespace-nowrap text-ink">对标岗位 JD</h2>
          <span class="text-[11px] text-ink-faint">可选</span>
        </div>
        <button
          type="button"
          class="link-btn"
          :aria-expanded="jdOpen"
          @click="jdOpen = !jdOpen"
        >
          {{ jdOpen ? '收起' : '展开' }}
          <span
            class="inline-block transition-transform duration-200"
            :class="jdOpen ? 'rotate-180' : ''"
            aria-hidden="true"
            >▾</span
          >
        </button>
      </header>
      <Collapse :open="jdOpen">
        <p class="mb-2 text-xs leading-relaxed text-ink-soft">
          粘贴目标岗位的职位描述（JD）：提炼时会一并参考，命中的关键词在结果里<span class="mark-hit">绿色高亮</span>，帮你对准招聘要求，也更容易通过网申系统的机器初筛。
        </p>
        <textarea
          ref="jdBox"
          :value="jd"
          rows="5"
          placeholder="把目标岗位的 JD（职位描述）粘进来；留空则按通用规则提炼"
          class="field ruled-24 resize-y"
          @input="emit('update:jd', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
        <div v-if="jdKeywords.length" class="mt-3">
          <p class="mb-1.5 text-[11px] text-ink-faint">
            会对准这 {{ jdKeywords.length }} 个关键词（就在你的浏览器里提取，填完立即生效；点一下能跳到结果里的对应条目）：
          </p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="kw in jdKeywords.slice(0, 24)"
              :key="kw"
              type="button"
              class="kw-chip transition hover:!bg-jade/20"
              :title="`在结果区高亮含「${kw}」的条目`"
              @click="emit('focus-keyword', kw)"
            >
              {{ kw }}
            </button>
          </div>
        </div>
      </Collapse>
    </section>

    <div
      class="sticky-cta sticky bottom-3 z-20 space-y-2 rounded-xl bg-paper/90 p-2 shadow-lg shadow-ink/10 backdrop-blur-sm lg:static lg:space-y-2 lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
    >
      <button
        type="button"
        class="btn-primary reveal d4 w-full"
        :class="extracting && 'btn-busy'"
        :disabled="!extracting && !canGenerate"
        @click="onMainClick"
      >
        <template v-if="extracting">
          <span aria-hidden="true">⏹</span>
          提炼中… {{ waited > 0 ? waited + 's · ' : '' }}点击停止
        </template>
        <template v-else>
          <span class="glyph" aria-hidden="true">✎</span>
          一键提炼
          <kbd
            class="ml-1 hidden rounded border border-white/25 px-1.5 py-0.5 font-mono text-[10px] font-normal sm:inline"
            >Ctrl ⏎</kbd
          >
        </template>
      </button>
      <p
        v-if="extracting && streamCount > 0"
        class="flex items-center justify-center gap-1.5 text-center text-[11px] text-jade"
        role="status"
      >
        <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-jade" aria-hidden="true"></span>
        流式生成中，已收到 {{ streamCount }} 字…（右侧结果区实时预览）
      </p>
      <div
        v-if="lastError && !extracting"
        class="rounded-lg border border-seal/40 bg-seal/5 px-3 py-2.5"
        role="alert"
      >
        <p class="text-xs leading-relaxed text-seal-deep">✕ {{ lastError }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" class="btn-mini" @click="emit('extract')">↻ 重试提炼</button>
          <button
            type="button"
            class="link-btn"
            title="不走 AI 连接也能用：展开左栏「备用」区并生成指令，复制给任意 AI 手动提炼"
            @click="emit('use-backup')"
          >
            改用备用路径（手动提炼）
          </button>
        </div>
      </div>
      <p v-if="!configured" class="text-center text-[11px] leading-relaxed text-ink-faint">
        未连接 AI：点击会打开「连接 AI 设置」（只需一次）；也可在下方「备用」区生成指令手动发送
      </p>
    </div>

    <section ref="promptBox" class="panel reveal p-4 sm:p-5">
      <header class="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div class="flex items-center gap-2.5">
          <span class="seal-chip seal-sm seal-soft font-display" aria-hidden="true">备</span>
          <h2 class="font-display text-[15px] font-bold whitespace-nowrap text-ink">备用：手动提炼（可选）</h2>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
          <button
            type="button"
            class="link-btn"
            title="填入一份示例 AI 返回，直接体验「粘贴结果 → 格式化」这条路径"
            @click="fillSampleResult"
          >
            填入示例结果
          </button>
          <button
            type="button"
            class="link-btn"
            :aria-expanded="promptOpen"
            @click="promptOpen = !promptOpen"
          >
            {{ promptOpen ? '收起' : '展开' }}
            <span
              class="inline-block transition-transform duration-200"
              :class="promptOpen ? 'rotate-180' : ''"
              aria-hidden="true"
              >▾</span
            >
          </button>
        </div>
      </header>
      <Collapse :open="promptOpen">
        <p class="mb-3 text-xs leading-relaxed text-ink-soft">
          不想设置 AI、或连不上时走这条路：① 生成指令并复制，发给任意 AI（网页版、手机 App 都行）→ ②
          把 AI 的回复整段粘到下面 → ③ 点「格式化并检查」，结果会出现在右侧「提炼结果」里。
        </p>
        <div class="rounded-lg border border-line-soft bg-sheet p-3">
          <p class="mb-2 text-[11px] font-medium text-ink-soft">① 提炼指令</p>
          <template v-if="prompt">
            <textarea
              readonly
              :value="prompt"
              rows="10"
              class="field ruled-24 resize-y font-mono text-xs text-ink-soft"
              aria-label="提炼指令内容"
            ></textarea>
            <button
              type="button"
              ref="copyBtn"
              class="btn-mini mt-3"
              :class="copied && 'btn-mini-done'"
              @click="onCopy"
            >
              {{ copied ? '已复制 ✓' : '复制指令' }}
            </button>
          </template>
          <button v-else type="button" class="btn-mini" @click="onGenerateBackup()">
            生成提炼指令
          </button>
        </div>
        <div class="mt-3 rounded-lg border border-line-soft bg-sheet p-3">
          <p class="mb-2 text-[11px] font-medium text-ink-soft">② 粘贴 AI 返回的提炼结果</p>
          <textarea
            ref="rawBox"
            :value="raw"
            rows="8"
            placeholder="把 AI 回答的内容整段粘到这里（以 - 或 1. 开头的列表都能认出来）"
            aria-label="手动粘贴结果"
            class="field ruled-28 resize-y"
            @input="emit('update:raw', ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
          <button
            type="button"
            class="btn-mini mt-3"
            :disabled="!raw.trim()"
            @click="emit('format')"
          >
            格式化并检查
          </button>
          <p class="mt-2 text-[11px] text-ink-faint">
            一键提炼的原文也会自动放在这里：改完可以再点一次上面按钮；已保存的版本不受影响。
          </p>
        </div>
      </Collapse>
    </section>
  </div>
</template>
