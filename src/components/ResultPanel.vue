<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import AlchemyCanvas from './AlchemyCanvas.vue'
import Collapse from './Collapse.vue'
import VerifyCard from './VerifyCard.vue'
import { copyRichHtml, copyText } from '../lib/clipboard'
import { notify } from '../lib/toast'
import { buildExport, buildRichTextExport, countTodoMarks, type ExportFormat } from '../lib/export'
import { downloadDocx, downloadResumeHtml, downloadText, exportFilename, printHighlights, printResume, type ResumeMeta } from '../lib/download'
import { groupJdGaps, matchKeyword, matchKeywords } from '../lib/rules'
import { computeScore, type ScoreItemRef, type ScoreResult } from '../lib/score'
import {
  countIssues,
  filterSelected,
  findRecordLines,
  listItems,
  parseInterviewList,
  segment,
  type DateCoverage,
  type Parsed,
} from '../lib/parse'

const props = defineProps<{
  parsed: Parsed | null
  dateCheck: DateCoverage | null
  /** 是否已有 AI 原文（决定「查看原始返回」入口是否显示） */
  hasRaw: boolean
  /** 原始记录文本，用于「源N」出处的引用展示 */
  records: string
  jdKeywords: string[]
  /** AI 是否已配置（决定「换个说法」是否可用） */
  configured: boolean
  /** 一键提炼进行中：版本/重写等 AI 操作统一禁用 */
  extracting: boolean
  /** 「点铁成金」等待动画：种子（记录哈希） */
  alchemySeed: number
  /** 「点铁成金」等待动画：流式进度 0~0.92 */
  extractProgress: number
  /** 暗色模式（动画调色板随主题） */
  isDark: boolean
  /** 正在重写中的条目 key（`${groupTitle}#${index}`） */
  rewritingKey: string | null
  /** 未命中关键词补充提炼进行中 */
  supplementing: boolean
  /** 面试追问生成中 */
  interviewing: boolean
  /** 面试追问的流式结果 */
  interviewRaw: string
  /** 追问细节弹层目标条目 key；null 表示未打开 */
  detailingKey: string | null
  /** 追问细节第一步（生成问题）的流式结果 */
  detailAskRaw: string
  /** 追问细节第二步（生成补充描述）进行中 */
  detailFillBusy: boolean
  /** 英文翻译进行中 */
  translating: boolean
  /** 英文翻译结果（可编辑）；null 表示未翻译 */
  translated: string | null
  /** 译文过期：翻译后条目内容有修改 */
  translatedStale: boolean
  /** 结果区一次性引导（首次出结果时显示） */
  showGuide: boolean
  /** 左侧是否已填 JD：未填时结果区显示引导卡 */
  hasJd: boolean
  /** 是否存在可撤销的改动（Ctrl+Z 或按钮回退） */
  canUndo: boolean
  /** 面试模拟：正在点评的问题下标；null 表示未在点评 */
  practiceIndex: number | null
  /** 面试模拟点评的流式结果 */
  practiceRaw: string
  /** 面试模拟点评生成中 */
  practiceBusy: boolean
  /** 左侧 JD 关键词芯片的定位请求：对象换新即触发一次定位 */
  focusRequest: { keyword: string; seq: number } | null
}>()

const emit = defineEmits<{
  (e: 'update:translated', value: string): void
  (e: 'edit-item', groupTitle: string, index: number, text: string): void
  (e: 'rewrite-item', groupTitle: string, index: number): void
  (e: 'toggle-item', groupTitle: string, index: number, checked: boolean): void
  (e: 'select-all'): void
  (e: 'delete-item', groupTitle: string, index: number): void
  (e: 'move-item', groupTitle: string, index: number, delta: number): void
  (e: 'supplement', missingKeywords: string[]): void
  (e: 'interview'): void
  (e: 'detail-ask', groupTitle: string, index: number): void
  (e: 'detail-fill', groupTitle: string, index: number, answers: string): void
  (e: 'detail-cancel'): void
  (e: 'translate'): void
  (e: 'close-translated'): void
  (e: 'fix-sources', groupTitle: string, index: number, sources: number[]): void
  (e: 'extract'): void
  (e: 'stop'): void
  (e: 'request-raw'): void
  (e: 'dismiss-guide'): void
  (e: 'request-jd'): void
  (e: 'undo'): void
  (e: 'practice', index: number, question: string, context: string, answer: string): void
  (e: 'practice-cancel'): void
}>()

const collapsed = ref<Record<string, boolean>>({})
const exportFormat = ref<ExportFormat>('markdown')
const includeNotes = ref(false)
const copied = ref(false)
const docxBusy = ref(false)
const docxAts = ref(false)
const resultBox = ref<HTMLElement | null>(null)
const openSources = ref<Record<string, boolean>>({})
const editingKey = ref<string | null>(null)
const editText = ref('')
const scoreOpen = ref(false)
// 「对比修改前」：AI 改写 / 追问改写后展示被替换的原句
const openPrev = ref<Record<string, boolean>>({})

function togglePrev(key: string) {
  openPrev.value = { ...openPrev.value, [key]: !openPrev.value[key] }
}

// 「点铁成金」完成闪光：提炼结束且出了结果时，结果区扫过一次金色微光（纯装饰；减动态偏好下跳过）
const alchemyFlash = ref(false)
let alchemyFlashTimer: number | undefined

watch(
  () => props.extracting,
  (busy) => {
    if (busy) return
    if (!props.parsed || props.parsed.groups.length === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    window.clearTimeout(alchemyFlashTimer)
    alchemyFlash.value = true
    alchemyFlashTimer = window.setTimeout(() => {
      alchemyFlash.value = false
    }, 1300)
  },
)

// ---------- 下一步动线：核查 → 导出（结果区顶部常驻一行） ----------
const verifyBox = ref<HTMLElement | null>(null)
const exportBox = ref<HTMLElement | null>(null)
// JD 对标卡片：印章点击后跳到这里看命中与缺口明细
const jdCardBox = ref<HTMLElement | null>(null)

function jumpToVerify() {
  verifyBox.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function jumpToExport() {
  exportBox.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function jumpToJdCard() {
  jdOpen.value = true
  jdCardBox.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 任一 AI 操作进行中：所有 AI 入口（重写/补充/追问/翻译/模拟点评）互斥
const aiBusy = computed(
  () =>
    props.extracting ||
    props.supplementing ||
    props.interviewing ||
    props.translating ||
    props.detailingKey !== null ||
    props.practiceBusy,
)

/** 单击条目 key：`${groupTitle}#${index}`（定位 / 闪烁共用） */
function itemKey(groupTitle: string, index: number): string {
  return `${groupTitle}#${index}`
}

const rendered = computed(() =>
  (props.parsed?.groups ?? [])
    .map((group) => ({
      title: group.title,
      items: group.items.map((item) => ({
        selected: item.selected,
        text: item.text,
        prev: item.prevText ?? '',
        sources: item.sources,
        segments: segment(item.text, props.jdKeywords),
      })),
    }))
    .filter((group) => group.items.length > 0),
)

// 导出/评分/JD 命中都只基于勾选条目（未勾选的保留在结果区可随时勾回）
const exportParsed = computed<Parsed | null>(() => filterSelected(props.parsed))

// 面试追问的条目顺序：勾选范围内的普通条目（与 App 构造 prompt 的口径一致）
const selectedItems = computed(() =>
  exportParsed.value ? listItems(exportParsed.value, { skipNotes: true }) : [],
)

const visibleIssues = computed(() => (exportParsed.value ? countIssues(exportParsed.value) : null))

const selectedStats = computed(() => {
  const items = props.parsed?.groups.flatMap((g) => g.items) ?? []
  return {
    selected: items.filter((i) => i.selected !== false).length,
    total: items.length,
  }
})

// 是否还有勾选内容：全不勾时导出为空，「评分 / 无弱动词」等基于空内容的结论会误导
const hasSelection = computed(() => selectedStats.value.selected > 0)

const exportText = computed(() =>
  exportParsed.value
    ? buildExport(exportParsed.value, {
        format: exportFormat.value,
        includeNotes: includeNotes.value,
      })
    : '',
)

const todoCount = computed(() => countTodoMarks(exportText.value))

// 量化评分：0-100 分 + 扣分明细（弱动词/待补/无出处/缺数字/断档/JD 命中），只算勾选范围
const score = computed<ScoreResult | null>(() =>
  exportParsed.value
    ? computeScore({ parsed: exportParsed.value, dateCheck: props.dateCheck, jdKeywords: props.jdKeywords })
    : null,
)

const scoreLevel = computed(() => {
  const s = score.value?.score ?? 0
  if (s >= 90) return 'score-high'
  if (s >= 70) return 'score-mid'
  return 'score-low'
})

// JD 对标命中统计：以勾选条目为准
const jdSummary = computed(() => {
  if (!props.jdKeywords.length || !exportParsed.value) return null
  const allText = exportParsed.value.groups.flatMap((g) => g.items.map((i) => i.text))
  const { hit, miss } = matchKeywords(allText, props.jdKeywords)
  return { hit, miss, total: props.jdKeywords.length }
})

// 缺口清单：硬技能 / 软能力分组（纯前端启发式，不新增 AI 调用）
const jdGaps = computed(() =>
  jdSummary.value ? groupJdGaps(jdSummary.value.miss) : { hard: [], soft: [] },
)

// 缺口清单渲染分组（硬技能 / 软能力）
const jdGapGroups = computed(() => [
  {
    key: 'hard',
    title: '硬技能缺口',
    hint: '技术 / 工具 / 方法类：有素材就用补充提炼补上，没有就如实放弃。',
    items: jdGaps.value.hard,
  },
  {
    key: 'soft',
    title: '软能力缺口',
    hint: '沟通 / 协作 / 素质类：在已有条目里自然融入，不要硬塞词。',
    items: jdGaps.value.soft,
  },
])

const jdPercent = computed(() =>
  jdSummary.value && jdSummary.value.total > 0
    ? Math.round((jdSummary.value.hit.length / jdSummary.value.total) * 100)
    : 0,
)

const jdOpen = ref(true)
// 缺口「在记录中找素材」的展开结果
const gapHints = ref<Record<string, Array<{ n: number; text: string }>>>({})
// 导出前核查未确认项数（来自 VerifyCard）
const verifyPending = ref(0)
const verifyTotal = ref(0)

function toggleGroup(title: string) {
  collapsed.value[title] = !collapsed.value[title]
}

function setAllCollapsed(value: boolean) {
  const next: Record<string, boolean> = {}
  for (const group of props.parsed?.groups ?? []) next[group.title] = value
  collapsed.value = next
}

function sourceKey(groupTitle: string, index: number): string {
  return itemKey(groupTitle, index)
}

// ---------- 条目定位：闪烁 + 滚动（扣分项 / 关键词 / 面试追问共用） ----------
const pulseKeys = ref<Set<string>>(new Set())
let pulseTimer: number | undefined

function attrEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function pulseItem(groupTitle: string, index: number) {
  collapsed.value[groupTitle] = false
  await nextTick()
  const el = resultBox.value?.querySelector<HTMLElement>(
    `[data-hl="${attrEscape(itemKey(groupTitle, index))}"]`,
  )
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  pulseKeys.value = new Set([itemKey(groupTitle, index)])
  window.clearTimeout(pulseTimer)
  pulseTimer = window.setTimeout(() => {
    pulseKeys.value = new Set()
  }, 1800)
}

// 按文本定位（勾选过滤 / 排序后序号可能变化，文本更稳）
async function locate(groupTitle: string, text: string, fallbackIndex = 0) {
  const group = rendered.value.find((g) => g.title === groupTitle)
  if (!group) return
  let index = group.items.findIndex((i) => i.text === text)
  if (index < 0) index = Math.min(fallbackIndex, group.items.length - 1)
  if (index < 0) return
  await pulseItem(groupTitle, index)
}

function jumpToRef(ref: ScoreItemRef) {
  void locate(ref.group, ref.text, ref.index)
}

// 核查清单「改用建议出处」→ 交给 App 改 item.sources 并回写 aiRaw
function onFixSources(groupTitle: string, index: number, sources: number[]) {
  emit('fix-sources', groupTitle, index, sources)
}

// 点「弱动词 × N」「待补数据 × N」印章 → 定位到第一条相关条目（改法在评分明细里）
function jumpToLabel(label: string) {
  const detail = score.value?.details.find((d) => d.label === label)
  const first = detail?.itemRefs[0]
  if (first) {
    void jumpToRef(first)
    return
  }
  notify('warn', `当前勾选范围内没有「${label}」条目`)
}

// 关键词定位：命中多条时全部闪烁，滚动到第一条
async function focusKeyword(keyword: string) {
  const matched: Array<{ group: string; index: number }> = []
  for (const group of rendered.value) {
    group.items.forEach((item, index) => {
      if (matchKeyword(item.text, keyword)) matched.push({ group: group.title, index })
    })
  }
  if (matched.length === 0) {
    notify('warn', `结果区没有含「${keyword}」的条目`)
    return
  }
  for (const m of matched) collapsed.value[m.group] = false
  await nextTick()
  const first = matched[0]
  resultBox.value
    ?.querySelector<HTMLElement>(`[data-hl="${attrEscape(itemKey(first.group, first.index))}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  pulseKeys.value = new Set(matched.map((m) => itemKey(m.group, m.index)))
  window.clearTimeout(pulseTimer)
  pulseTimer = window.setTimeout(() => {
    pulseKeys.value = new Set()
  }, 1800)
}

watch(
  () => props.focusRequest,
  (req) => {
    if (req) void focusKeyword(req.keyword)
  },
)

function toggleGapHint(keyword: string) {
  if (gapHints.value[keyword]) {
    const next = { ...gapHints.value }
    delete next[keyword]
    gapHints.value = next
    return
  }
  gapHints.value = { ...gapHints.value, [keyword]: findRecordLines(props.records, keyword) }
}

// 扣分明细「复制改法」
const copiedSuggestion = ref<string | null>(null)

async function copySuggestion(detail: { label: string; suggestion: string }) {
  if (!(await copyText(detail.suggestion))) {
    notify('err', '复制失败，请手动选择文本复制')
    return
  }
  copiedSuggestion.value = detail.label
  notify('ok', '改法已复制')
  window.setTimeout(() => {
    if (copiedSuggestion.value === detail.label) copiedSuggestion.value = null
  }, 1600)
}

// ---------- 行内编辑 / 单条重生成 ----------
function startEdit(groupTitle: string, index: number, text: string) {
  editingKey.value = sourceKey(groupTitle, index)
  editText.value = text
}

function cancelEdit() {
  editingKey.value = null
  editText.value = ''
}

function confirmEdit(groupTitle: string, index: number) {
  emit('edit-item', groupTitle, index, editText.value)
  cancelEdit()
}

function isRewriting(groupTitle: string, index: number): boolean {
  return props.rewritingKey === sourceKey(groupTitle, index)
}

// 「换个说法」禁用判定：未配置 AI / 其他 AI 操作进行中
function rewriteDisabled(groupTitle: string, index: number): boolean {
  if (!props.configured || aiBusy.value) return true
  return props.rewritingKey !== null && !isRewriting(groupTitle, index)
}

function rewriteTitle(groupTitle: string, index: number): string {
  if (!props.configured) return '需先在页头连接 AI'
  if (props.extracting) return '提炼进行中，请稍候'
  if (aiBusy.value && !isRewriting(groupTitle, index)) return '其他 AI 操作进行中，请稍候'
  return 'AI 换一种表达，不改事实与出处'
}

// 「追问细节」：AI 先问 2-3 个补强问题，回答后改写该条
function isDetailing(groupTitle: string, index: number): boolean {
  return props.detailingKey === itemKey(groupTitle, index)
}

function detailDisabled(groupTitle: string, index: number): boolean {
  if (!props.configured || aiBusy.value) return true
  return !isDetailing(groupTitle, index) && props.detailingKey !== null
}

function detailTitle(groupTitle: string, index: number): string {
  if (!props.configured) return '需先在页头连接 AI'
  if (aiBusy.value && !isDetailing(groupTitle, index)) return '其他 AI 操作进行中，请稍候'
  return '素材太薄？让 AI 先问几个问题，再结合你的回答改写（不编造）'
}

// ---------- 追问细节弹层 ----------
const detailAnswers = ref('')
const detailQuestions = computed(() => parseInterviewList(props.detailAskRaw).map((q) => q.q))
const detailParts = computed(() => {
  if (!props.detailingKey) return null
  const hash = props.detailingKey.lastIndexOf('#')
  if (hash < 0) return null
  return {
    group: props.detailingKey.slice(0, hash),
    index: Number.parseInt(props.detailingKey.slice(hash + 1), 10),
  }
})
const detailTarget = computed(() => {
  const parts = detailParts.value
  if (!parts) return null
  return props.parsed?.groups.find((g) => g.title === parts.group)?.items[parts.index] ?? null
})

function submitDetailFill() {
  if (!detailParts.value) return
  emit('detail-fill', detailParts.value.group, detailParts.value.index, detailAnswers.value)
}

watch(
  () => props.detailingKey,
  (key) => {
    if (key) detailAnswers.value = ''
  },
)

function onDetailKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.detailingKey) emit('detail-cancel')
}
window.addEventListener('keydown', onDetailKeydown)
onUnmounted(() => {
  window.removeEventListener('keydown', onDetailKeydown)
  window.clearTimeout(pulseTimer)
  window.clearTimeout(alchemyFlashTimer)
})

// ---------- 面试追问面板 ----------
const interviewOpen = ref(false)
const interviewQuestions = computed(() => parseInterviewList(props.interviewRaw))

watch(
  () => [props.interviewing, props.interviewRaw] as const,
  ([busy, raw]) => {
    if (busy || raw.trim() !== '') interviewOpen.value = true
  },
  // immediate：追问清单随草稿恢复时（interviewRaw 挂载前已非空）也要展开面板
  { immediate: true },
)

function jumpInterviewRef(n: number) {
  const target = selectedItems.value[n - 1]
  if (!target) return
  void locate(target.group, target.text, target.index)
}

async function onCopyInterview() {
  if (!(await copyText(props.interviewRaw.trim()))) {
    notify('err', '复制失败，请手动选择文本复制')
    return
  }
  notify('ok', '追问清单已复制，可发给同伴模拟面试')
}

// ---------- 面试模拟（P2）：逐题作答 → AI 点评（点评只基于回答与条目，不编造） ----------
const practiceOpenAt = ref<number | null>(null)
const practiceAnswer = ref('')

function startPractice(index: number) {
  practiceOpenAt.value = practiceOpenAt.value === index ? null : index
  practiceAnswer.value = ''
}

function closePractice() {
  practiceOpenAt.value = null
  practiceAnswer.value = ''
  emit('practice-cancel')
}

function submitPractice(index: number) {
  const q = interviewQuestions.value[index]
  if (!q) return
  // 关联条目的原文：作为点评的对照事实，避免 AI 凭空评判
  const context = q.refs
    .map((ref) => selectedItems.value[ref - 1]?.text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n')
  emit('practice', index, q.q, context, practiceAnswer.value)
}

// 换一批追问后，作答框与点评结果都不再对应当前问题
watch(
  () => props.interviewRaw,
  () => {
    practiceOpenAt.value = null
    practiceAnswer.value = ''
  },
)

function toggleSource(key: string) {
  openSources.value[key] = !openSources.value[key]
}

// 「源N」引用的原始记录行；越界编号忽略
function sourceLines(sources: number[]): Array<{ n: number; text: string }> {
  const lines = props.records.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  return sources
    .filter((n) => n >= 1 && n <= lines.length)
    .map((n) => ({ n, text: lines[n - 1] }))
}

function sourceLabel(sources: number[]): string {
  return sources.map((n) => String(n).padStart(2, '0')).join(' · ')
}

async function onCopyExport() {
  if (!exportText.value) return
  if (!(await copyText(exportText.value))) {
    notify('err', '复制失败，请手动全选文本复制')
    return
  }
  copied.value = true
  notify('ok', '已复制到剪贴板，可直接粘贴进简历')
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}

// 带格式复制：粘到 Word / 在线编辑器里保留加粗与列表
async function onCopyRich() {
  if (!exportParsed.value || !exportText.value) return
  const html = buildRichTextExport(exportParsed.value, { includeNotes: includeNotes.value })
  if (!(await copyRichHtml(html, exportText.value))) {
    notify('err', '复制失败：可以改用「一键复制」')
    return
  }
  notify('ok', '已复制（带格式）：粘到 Word 里会保留加粗和列表')
}

async function onCopyTranslated() {
  if (!props.translated?.trim()) return
  if (!(await copyText(props.translated))) {
    notify('err', '复制失败，请手动全选译文复制')
    return
  }
  notify('ok', '译文已复制（建议人工校对后再投递）')
}

function onDownloadFile() {
  if (!exportText.value) return
  const ext = exportFormat.value === 'markdown' ? 'md' : 'txt'
  downloadText(exportFilename(ext), exportText.value, exportFormat.value === 'markdown' ? 'text/markdown' : 'text/plain')
  notify('ok', `已下载 ${ext.toUpperCase()} 文件`)
}

async function onDownloadDocx() {
  if (!exportParsed.value || docxBusy.value) return
  docxBusy.value = true
  try {
    await downloadDocx(exportParsed.value, exportFilename('docx'), includeNotes.value, docxAts.value)
    notify('ok', docxAts.value ? 'Word（ATS 友好版式）已生成，无水印' : 'Word 文档已生成，无水印')
  } catch {
    notify('err', 'Word 生成失败：可以改用「一键复制」，或下载文本文件')
  } finally {
    docxBusy.value = false
  }
}

function onPrint() {
  if (!exportParsed.value) return
  printHighlights(exportParsed.value, includeNotes.value)
}

// ---------- 整页简历（P2）：抬头信息本地记住，套单页 A4 模板打印 / 存 HTML ----------
const RESUME_META_KEY = 'rhe.resumeMeta'
const resumeOpen = ref(false)
const resumeMeta = ref<ResumeMeta>(loadResumeMeta())

function loadResumeMeta(): ResumeMeta {
  try {
    const raw = localStorage.getItem(RESUME_META_KEY)
    if (!raw) return { name: '', contact: '', role: '' }
    const parsed = JSON.parse(raw) as Partial<ResumeMeta>
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    return { name: str(parsed.name), contact: str(parsed.contact), role: str(parsed.role) }
  } catch {
    return { name: '', contact: '', role: '' }
  }
}

function saveResumeMeta(): void {
  try {
    localStorage.setItem(RESUME_META_KEY, JSON.stringify(resumeMeta.value))
  } catch {
    // 存储不可用时仅本次会话有效
  }
}

function onPrintResume() {
  if (!exportParsed.value) return
  saveResumeMeta()
  printResume(exportParsed.value, resumeMeta.value, includeNotes.value)
  notify('ok', '已打开打印视图：可直接打印，或「另存为 PDF」投递')
}

function onDownloadResumeHtml() {
  if (!exportParsed.value) return
  saveResumeMeta()
  downloadResumeHtml(exportParsed.value, resumeMeta.value, includeNotes.value)
  notify('ok', '简历页 HTML 已下载：浏览器打开即可打印 / 存 PDF')
}

function missingLabel(missing: string[]): string {
  if (missing.length <= 5) return missing.join('、')
  return `${missing.slice(0, 5).join('、')} 等 ${missing.length} 天`
}

// 小屏下结果首次出现时自动滚动定位；流式期间的增量更新不反复滚动
watch(
  () => (props.parsed?.groups.length ?? 0) > 0,
  async (hasResult, hadResult) => {
    if (!hasResult || hadResult || window.innerWidth >= 1024) return
    await nextTick()
    resultBox.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
)
</script>

<template>
  <div class="min-w-0 space-y-5">
    <section v-if="parsed && parsed.groups.length" ref="resultBox" class="panel reveal relative p-4 sm:p-5">
      <!-- 「点铁成金」收束：提炼完成瞬间扫过一次金色微光 -->
      <div
        v-if="alchemyFlash"
        class="alchemy-flash pointer-events-none absolute inset-0 z-20 rounded-xl"
        aria-hidden="true"
      ></div>
      <!-- 一次性引导：只出现到用户点「知道了」为止，不重复打扰 -->
      <div
        v-if="showGuide"
        class="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-jade/30 bg-jade/5 px-3 py-2"
        role="note"
        aria-label="结果区使用引导"
      >
        <p class="min-w-0 text-xs leading-relaxed text-ink-soft">
          建议顺序：<b class="text-ink">① 看评分</b>按提示改掉弱动词和待补 →
          <b class="text-ink">② 看 JD 对标</b>补上缺的关键词 →
          <b class="text-ink">③ 导出前核查</b>确认数字和出处是真的 →
          <b class="text-ink">④ 导出使用</b>
        </p>
        <button type="button" class="link-btn shrink-0" @click="emit('dismiss-guide')">知道了</button>
      </div>
      <header class="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="seal-chip seal-sm font-display" aria-hidden="true">叁</span>
          <h2 class="font-display text-[15px] font-bold whitespace-nowrap text-ink">提炼结果</h2>
          <span
            v-if="extracting"
            class="flex items-center gap-1.5 rounded-full bg-jade/10 px-2 py-0.5 text-[11px] font-medium text-jade"
            role="status"
          >
            <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-jade" aria-hidden="true"></span>
            生成中，实时预览
          </span>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
          <button
            v-if="hasRaw"
            type="button"
            class="link-btn"
            title="到左栏「备用」区看 AI 的完整回复，改好后能重新整理成条目"
            @click="emit('request-raw')"
          >
            查看 AI 回复原文
          </button>
          <!-- 提炼中：结果区就地可停（小屏滚到结果区后主按钮已不在视口内） -->
          <button
            v-if="extracting"
            type="button"
            class="link-btn"
            title="中断本次提炼，已生成的部分保留在结果区"
            @click="emit('stop')"
          >
            ⏹ 停止提炼
          </button>
          <button
            v-else
            type="button"
            class="link-btn disabled:pointer-events-none disabled:opacity-40"
            :disabled="!configured || aiBusy"
            :title="!configured ? '需先在页头连接 AI' : '用左侧记录重新提炼一版；现有结果会先自动备份，之后能找回'"
            @click="emit('extract')"
          >
             重新提炼
          </button>
          <button type="button" class="link-btn" @click="setAllCollapsed(true)">全部折叠</button>
          <button type="button" class="link-btn" @click="setAllCollapsed(false)">全部展开</button>
        </div>
      </header>

      <!-- 下一步动线：把「核查 → 导出」串成显性两步，避免用户自己找 -->
      <div
        class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-faint"
        role="note"
        aria-label="下一步"
      >
        <span class="shrink-0">下一步</span>
        <button
          type="button"
          class="link-btn"
          :disabled="verifyTotal === 0"
          :title="
            verifyTotal === 0
              ? '当前没有需要核查的项目'
              : verifyPending > 0
                ? '跳到「导出前核查」清单，逐项确认'
                : '核查已全部确认'
          "
          @click="jumpToVerify"
        >
          {{ verifyTotal === 0 ? '核查清单无须处理' : verifyPending > 0 ? `去核对 ${verifyPending} 项` : '核查已全部确认 ✓' }}
        </button>
        <span aria-hidden="true">→</span>
        <button type="button" class="link-btn" title="跳到导出区" @click="jumpToExport">
          跳到导出 ↓
        </button>
        <button
          v-if="canUndo"
          type="button"
          class="link-btn ml-auto"
          title="回退最近一次结果区改动（也可按 Ctrl+Z）"
          @click="emit('undo')"
        >
          ↶ 撤销上一步
        </button>
      </div>

      <!-- 无 JD 引导：核心差异化能力（匹配度 / 缺口 / 定向补充）不填 JD 就用不上 -->
      <div
        v-if="!hasJd"
        class="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-marker/60 bg-marker/10 px-3 py-2"
        role="note"
        aria-label="未填 JD 引导"
      >
        <p class="min-w-0 text-xs leading-relaxed text-ink-soft">
          <b class="text-ink">还没填目标岗位 JD</b>：填入后可看到关键词匹配度、缺口清单，并按缺口定向补充提炼。
        </p>
        <button type="button" class="btn-mini shrink-0" @click="emit('request-jd')">去填 JD</button>
      </div>

      <div v-if="visibleIssues" class="mb-4 flex flex-wrap items-center gap-2.5">
        <button
          v-if="score && hasSelection"
          type="button"
          class="score-chip"
          :class="scoreLevel"
          :aria-expanded="scoreOpen"
          title="点击查看扣分明细与改法"
          @click="scoreOpen = !scoreOpen"
        >
          评分 <b>{{ score.score }}</b><span class="opacity-70">/100</span>
          <span
            class="inline-block transition-transform duration-200"
            :class="scoreOpen ? 'rotate-180' : ''"
            aria-hidden="true"
            >▾</span
          >
        </button>
        <span v-if="visibleIssues.weak > 0" class="stamp">
          <button
            type="button"
            class="cursor-pointer transition hover:text-seal"
            title="点击定位到第一条含弱动词的条目（改法见评分明细）"
            @click="jumpToLabel('弱动词')"
          >
            弱动词 × {{ visibleIssues.weak }}
          </button>
        </span>
        <span v-if="visibleIssues.todo > 0" class="stamp">
          <button
            type="button"
            class="cursor-pointer transition hover:text-seal"
            title="点击定位到第一条待补数据的条目"
            @click="jumpToLabel('待补数据')"
          >
            待补数据 × {{ visibleIssues.todo }}
          </button>
        </span>
        <!-- 全部取消勾选时无内容可评：「满分」「无弱动词」都是误导，只在有勾选时展示 -->
        <span
          v-if="hasSelection && visibleIssues.weak === 0 && visibleIssues.todo === 0"
          class="stamp stamp-ok"
        >
          无弱动词 · 无待补
        </span>
        <span v-if="dateCheck" class="stamp stamp-plain">
          记录覆盖 {{ dateCheck.from.slice(5) }} ~ {{ dateCheck.to.slice(5) }}
          <template v-if="dateCheck.missing.length > 0">
            · 断档 {{ missingLabel(dateCheck.missing) }}
          </template>
          <template v-else>· 无断档</template>
        </span>
        <span v-if="visibleIssues.items > 0" class="stamp stamp-plain">
          已选 {{ visibleIssues.items }} 条
        </span>
        <!-- JD 命中压缩成一行印章：明细（命中词 / 缺口 / 补素材）都在下方卡片里，点印章直接跳过去 -->
        <button
          v-if="jdSummary"
          type="button"
          class="stamp cursor-pointer transition hover:text-jade"
          :class="jdSummary.miss.length === 0 && 'stamp-ok'"
          title="跳到下方 JD 对标卡片：看命中关键词与缺口明细"
          @click="jumpToJdCard"
        >
          JD 对标命中 {{ jdSummary.hit.length }}/{{ jdSummary.total }}
          <template v-if="jdSummary.miss.length > 0">· 缺口 {{ jdSummary.miss.length }}</template>
        </button>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            v-if="jdSummary && jdSummary.miss.length > 0"
            type="button"
            class="link-btn"
            :disabled="aiBusy"
            title="基于原始记录，定向补充能体现缺失关键词的亮点；找不到素材会明说"
            @click="emit('supplement', jdSummary.miss)"
          >
            {{ supplementing ? '✦ 补充提炼中…' : `✦ 按缺失关键词补充提炼` }}
          </button>
          <button
            type="button"
            class="link-btn"
            :disabled="!configured || aiBusy || selectedItems.length === 0"
            :title="
              !configured
                ? '需先在页头连接 AI'
                : aiBusy
                  ? '其他 AI 操作进行中，请稍候'
                  : '基于勾选条目生成 5 个面试官最可能追问的问题（自测用）'
            "
            @click="emit('interview')"
          >
            &#127919; {{ interviewing ? '生成追问中…' : '面试追问' }}
          </button>
        </div>
      </div>

      <Collapse :open="scoreOpen && !!score && hasSelection">
        <div class="mb-4 rounded-lg border border-line-soft bg-sheet px-4 py-3">
          <p v-if="score && score.details.length === 0" class="text-xs text-jade">
            满分：无弱动词、无待补、条条有出处有数字，继续保持。
          </p>
          <ul v-else-if="score" class="space-y-2.5">
            <li v-for="detail in score.details" :key="detail.label" class="text-xs">
              <div class="flex items-start justify-between gap-3">
                <button
                  type="button"
                  class="min-w-0 text-left transition disabled:cursor-default"
                  :class="detail.itemRefs.length ? 'hover:text-seal' : ''"
                  :disabled="detail.itemRefs.length === 0"
                  :title="detail.itemRefs.length ? '点击定位到对应条目' : undefined"
                  @click="detail.itemRefs.length && jumpToRef(detail.itemRefs[0])"
                >
                  <span class="text-ink-soft">{{ detail.label }}</span>
                  <span class="text-ink-faint">· {{ detail.note }}</span>
                  <span v-if="detail.itemRefs.length" class="ml-1 text-seal-deep"
                    >· 影响 {{ detail.itemRefs.length }} 条，点击定位</span
                  >
                </button>
                <span class="shrink-0 font-mono text-seal-deep">-{{ detail.deduction }}</span>
              </div>
              <p class="mt-1 leading-relaxed text-ink-faint">改法：{{ detail.suggestion }}</p>
              <button
                type="button"
                class="link-btn mt-1"
                :class="copiedSuggestion === detail.label && '!border-jade !text-jade'"
                @click="copySuggestion(detail)"
              >
                {{ copiedSuggestion === detail.label ? '已复制改法 ✓' : '复制改法' }}
              </button>
            </li>
          </ul>
        </div>
      </Collapse>

      <div v-if="jdSummary" ref="jdCardBox" class="mb-4 rounded-lg border border-jade/25 bg-jade/5 px-4 py-3">
        <div class="flex flex-wrap items-center gap-3">
          <div
            class="relative h-10 w-10 shrink-0 sm:h-12 sm:w-12"
            role="img"
            :aria-label="`JD 匹配度 ${jdPercent}%`"
          >
            <svg viewBox="0 0 36 36" class="h-10 w-10 -rotate-90 sm:h-12 sm:w-12" aria-hidden="true">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" stroke-width="3.4" class="text-line-soft" />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                stroke-width="3.4"
                stroke-linecap="round"
                class="text-jade transition-all duration-500"
                :stroke-dasharray="`${(jdPercent / 100) * 97.4} 97.4`"
              />
            </svg>
            <span
              class="absolute inset-0 flex items-center justify-center font-display text-[11px] font-bold text-jade"
              >{{ jdPercent }}%</span
            >
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-medium text-ink">JD 对标：匹配度 {{ jdPercent }}%</span>
              <span class="text-[11px] text-ink-faint"
                >命中 {{ jdSummary.hit.length }}/{{ jdSummary.total }} 个关键词
                <template v-if="jdSummary.miss.length > 0"
                  >· {{ jdSummary.miss.length }} 个缺口待补</template
                ></span
              >
              <button type="button" class="link-btn" :aria-expanded="jdOpen" @click="jdOpen = !jdOpen">
                {{ jdOpen ? '收起明细' : '展开明细' }}
              </button>
            </div>
            <p class="mt-1 hidden text-[11px] leading-relaxed text-ink-faint sm:block">
              关键词要自然融进表达，而不是堆砌；点关键词可在结果区定位。
            </p>
          </div>
        </div>

        <Collapse :open="jdOpen">
          <div v-if="jdSummary.hit.length" class="mt-3">
            <p class="mb-1.5 text-[11px] text-ink-faint">已命中（点击定位对应条目）：</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="kw in jdSummary.hit"
                :key="kw"
                type="button"
                class="kw-chip transition hover:!bg-jade/20"
                :title="`在结果区定位含「${kw}」的条目`"
                @click="focusKeyword(kw)"
              >
                {{ kw }}
              </button>
            </div>
          </div>

          <div v-if="jdSummary.miss.length === 0" class="mt-3 text-xs text-jade">
            全部关键词已覆盖，继续保持。
          </div>

          <div v-for="gap in jdGapGroups" :key="gap.key" class="mt-3">
            <template v-if="gap.items.length">
              <p class="text-[11px] font-medium text-ink-soft">{{ gap.title }}（{{ gap.items.length }}）</p>
              <p class="mb-1.5 text-[11px] text-ink-faint">{{ gap.hint }}</p>
              <ul class="space-y-1.5">
                <li v-for="kw in gap.items" :key="kw" class="rounded-lg border border-line-soft bg-card px-3 py-2">
                  <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <span class="text-xs font-medium whitespace-nowrap text-seal-deep">{{ kw }}</span>
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <button
                        type="button"
                        class="link-btn"
                        :disabled="aiBusy"
                        title="让 AI 重新审一遍原始记录，定向补这个关键词；找不到会明说"
                        @click="emit('supplement', [kw])"
                      >
                        ✦ 补充提炼
                      </button>
                      <button type="button" class="link-btn" @click="toggleGapHint(kw)">
                        {{ gapHints[kw] ? '收起素材' : '在记录中找素材' }}
                      </button>
                    </div>
                  </div>
                  <div
                    v-if="gapHints[kw]"
                    class="mt-1.5 space-y-1 rounded-lg border border-line-soft bg-sheet px-3 py-2"
                  >
                    <p
                      v-for="line in gapHints[kw]"
                      :key="line.n"
                      class="text-xs leading-relaxed text-ink-soft"
                    >
                      <span class="mr-1 font-mono text-[10px] text-ink-faint">[{{ line.n }}]</span
                      >{{ line.text }}
                    </p>
                    <p v-if="gapHints[kw].length === 0" class="text-xs text-ink-faint">
                      原始记录里没有相近内容：可让 AI 再审一遍，或如实放弃这个要求。
                    </p>
                  </div>
                </li>
              </ul>
            </template>
          </div>
        </Collapse>
      </div>

      <Collapse :open="interviewOpen && (interviewing || interviewRaw.trim() !== '')">
        <div class="mb-4 rounded-lg border border-jade/25 bg-jade/5 px-4 py-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs font-medium text-ink">
              🎯 面试追问清单
              <span class="ml-1 font-normal text-ink-faint">点「第N条」可定位到对应亮点</span>
            </p>
            <div class="flex items-center gap-2.5">
              <button
                type="button"
                class="link-btn"
                :disabled="!configured || aiBusy"
                @click="emit('interview')"
              >
                {{ interviewing ? '生成中…' : '换一批' }}
              </button>
              <button
                type="button"
                class="link-btn"
                :disabled="interviewRaw.trim() === ''"
                @click="onCopyInterview"
              >
                复制清单
              </button>
              <button type="button" class="link-btn" @click="interviewOpen = false">收起</button>
            </div>
          </div>
          <p v-if="interviewing && interviewRaw.trim() === ''" class="mt-2 text-xs text-jade" role="status">
            正在生成面试追问…
          </p>
          <ol v-else class="mt-2 space-y-1.5">
            <li v-for="(q, i) in interviewQuestions" :key="i" class="text-xs leading-relaxed text-ink-soft">
              <div>
                <span class="mr-1 font-mono text-[10px] text-ink-faint"
                  >{{ String(i + 1).padStart(2, '0') }}</span
                >{{ q.q }}
                <button
                  v-for="ref in q.refs"
                  :key="ref"
                  type="button"
                  class="src-chip ml-1 align-middle"
                  :title="`定位到关联的第 ${ref} 条亮点`"
                  @click="jumpInterviewRef(ref)"
                >
                  第{{ ref }}条
                </button>
                <button
                  type="button"
                  class="link-btn ml-1.5 align-middle"
                  :disabled="aiBusy"
                  :title="
                    aiBusy
                      ? '其他 AI 操作进行中，请稍候'
                      : '自己先答一遍，让 AI 帮你点评（用你设置好的 AI）'
                  "
                  @click="startPractice(i)"
                >
                  {{ practiceOpenAt === i ? '收起作答' : '练一练' }}
                </button>
              </div>
              <div
                v-if="practiceOpenAt === i"
                class="mt-1.5 rounded-lg border border-jade/30 bg-card px-3 py-2"
              >
                <p class="text-[11px] text-ink-faint">
                  模拟作答：像面试一样口述成文字（先给结论、带上数字、说清自己做了哪部分）。点评由你设置好的 AI 完成
                </p>
                <textarea
                  v-model="practiceAnswer"
                  rows="3"
                  class="field mt-1.5 resize-y text-xs"
                  aria-label="模拟面试作答"
                  placeholder="例：这块由我主导方案与实现，2MB 是按弱网实测定的，联调拉了后端和客户端各 1 人"
                ></textarea>
                <div class="mt-1.5 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    class="btn-mini"
                    :disabled="practiceAnswer.trim() === '' || practiceBusy"
                    @click="submitPractice(i)"
                  >
                    {{ practiceBusy ? '点评生成中…' : '请 AI 点评' }}
                  </button>
                  <button type="button" class="link-btn" @click="closePractice">关闭</button>
                </div>
                <p
                  v-if="practiceIndex === i && practiceBusy && practiceRaw.trim() === ''"
                  class="mt-1.5 text-xs text-jade"
                  role="status"
                >
                  正在生成点评…
                </p>
                <p
                  v-else-if="practiceIndex === i && practiceRaw.trim() !== ''"
                  class="mt-1.5 rounded-lg border border-line-soft bg-sheet px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-ink-soft"
                  aria-label="AI 点评"
                >
                  {{ practiceRaw }}
                </p>
              </div>
            </li>
          </ol>
        </div>
      </Collapse>

      <div class="space-y-5">
        <div v-for="group in rendered" :key="group.title">
          <button
            type="button"
            class="group flex w-full items-center justify-between gap-2 text-left"
            :aria-expanded="!collapsed[group.title]"
            @click="toggleGroup(group.title)"
          >
            <h3 class="font-display text-sm font-bold text-ink-soft transition group-hover:text-ink">
              <span
                class="mr-1.5 inline-block h-1.5 w-1.5 rotate-45 bg-seal/70 align-middle"
                aria-hidden="true"
              ></span>
              {{ group.title }}
            </h3>
            <span
              class="flex items-center gap-1.5 text-xs text-ink-faint transition group-hover:text-ink-soft"
            >
              {{ group.items.length }} 条
              <span
                class="inline-block transition-transform duration-200"
                :class="collapsed[group.title] ? '-rotate-90' : ''"
                aria-hidden="true"
                >▾</span
              >
            </span>
          </button>
          <Collapse :open="!collapsed[group.title]">
            <ul class="mt-2 space-y-1.5">
              <li
                v-for="(item, index) in group.items"
                :key="index"
                :data-hl="itemKey(group.title, index)"
                class="hl-row flex gap-2.5 rounded-lg px-3 py-2 transition-opacity"
                :class="[
                  !item.selected && 'opacity-45',
                  pulseKeys.has(itemKey(group.title, index)) && 'hl-pulse',
                ]"
              >
                <span class="row-num pt-0.5 font-display text-[11px] leading-5 text-ink-faint select-none">
                  {{ String(index + 1).padStart(2, '0') }}
                </span>
                <div class="min-w-0 flex-1">
                  <template v-if="editingKey === sourceKey(group.title, index)">
                    <textarea
                      v-model="editText"
                      rows="3"
                      class="field resize-y text-sm"
                      aria-label="编辑亮点"
                      @keydown.esc.prevent="cancelEdit"
                    ></textarea>
                    <div class="mt-1.5 flex items-center gap-2.5">
                      <button
                        type="button"
                        class="btn-mini btn-mini-done"
                        @click="confirmEdit(group.title, index)"
                      >
                        保存
                      </button>
                      <button type="button" class="link-btn" @click="cancelEdit">取消</button>
                    </div>
                  </template>
                  <template v-else>
                    <div class="flex items-start gap-2">
                      <input
                        type="checkbox"
                        :checked="item.selected"
                        class="mt-1 accent-seal"
                        :aria-label="`纳入导出：${item.text}`"
                        @change="emit('toggle-item', group.title, index, ($event.target as HTMLInputElement).checked)"
                      />
                      <p class="min-w-0 flex-1 text-sm leading-relaxed text-ink">
                        <template v-for="(seg, i) in item.segments" :key="i">
                          <span v-if="seg.type === 'weak'" class="mark-weak">{{ seg.text }}</span>
                          <span v-else-if="seg.type === 'todo'" class="mark-todo">{{ seg.text }}</span>
                          <mark v-else-if="seg.type === 'hit'" class="mark-hit">{{ seg.text }}</mark>
                          <template v-else>{{ seg.text }}</template>
                        </template>
                      </p>
                    </div>
                    <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <button
                        type="button"
                        class="link-btn"
                        :disabled="index === 0"
                        :title="index === 0 ? '已经是第一条' : '上移'"
                        @click="emit('move-item', group.title, index, -1)"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="link-btn"
                        :disabled="index === group.items.length - 1"
                        :title="index === group.items.length - 1 ? '已经是最后一条' : '下移'"
                        @click="emit('move-item', group.title, index, 1)"
                      >
                        ↓
                      </button>
                      <button
                        v-if="item.sources.length"
                        type="button"
                        class="src-chip"
                        :aria-expanded="!!openSources[sourceKey(group.title, index)]"
                        @click="toggleSource(sourceKey(group.title, index))"
                      >
                        <span aria-hidden="true">⟲</span>
                        源 {{ sourceLabel(item.sources) }}
                      </button>
                      <div class="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          class="link-btn"
                          @click="startEdit(group.title, index, item.text)"
                        >
                          ✎ 编辑
                        </button>
                        <button
                          type="button"
                          class="link-btn disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40"
                          :disabled="rewriteDisabled(group.title, index)"
                          :title="rewriteTitle(group.title, index)"
                          @click="emit('rewrite-item', group.title, index)"
                        >
                          {{ isRewriting(group.title, index) ? '⟳ 改写中…' : '⟳ 换个说法' }}
                        </button>
                        <button
                          type="button"
                          class="link-btn disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40"
                          :disabled="detailDisabled(group.title, index)"
                          :title="detailTitle(group.title, index)"
                          @click="emit('detail-ask', group.title, index)"
                        >
                          {{ isDetailing(group.title, index) ? '＋ 追问中…' : '＋ 追问细节' }}
                        </button>
                        <button
                          v-if="item.prev"
                          type="button"
                          class="link-btn"
                          :aria-expanded="!!openPrev[sourceKey(group.title, index)]"
                          title="AI 改写前的原句"
                          @click="togglePrev(sourceKey(group.title, index))"
                        >
                          对比修改前
                        </button>
                        <button
                          type="button"
                          class="link-btn hover:!border-seal hover:!text-seal"
                          title="删除这条亮点"
                          @click="emit('delete-item', group.title, index)"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div
                      v-if="openSources[sourceKey(group.title, index)]"
                      class="mt-1.5 space-y-1 rounded-lg border border-line-soft bg-sheet px-3 py-2"
                    >
                      <p
                        v-for="line in sourceLines(item.sources)"
                        :key="line.n"
                        class="text-xs leading-relaxed text-ink-soft"
                      >
                        <span class="mr-1 font-mono text-[10px] text-ink-faint">[{{ line.n }}]</span
                        >{{ line.text }}
                      </p>
                      <p v-if="sourceLines(item.sources).length === 0" class="text-xs text-ink-faint">
                        原始记录已修改，找不到对应行
                      </p>
                    </div>
                    <!-- 改写前后对照：看清 AI 到底改了什么，也方便自己判断是否保留 -->
                    <div
                      v-if="item.prev && openPrev[sourceKey(group.title, index)]"
                      class="mt-1.5 rounded-lg border border-line-soft bg-sheet px-3 py-2"
                    >
                      <p class="text-[11px] text-ink-faint">修改前</p>
                      <p class="text-xs leading-relaxed text-ink-faint line-through decoration-ink-faint/60">
                        {{ item.prev }}
                      </p>
                      <p class="mt-1 text-[11px] text-jade">不满意可点上方「↶ 撤销上一步」回到原句</p>
                    </div>
                  </template>
                </div>
              </li>
            </ul>
          </Collapse>
        </div>
      </div>

      <div ref="verifyBox" class="mt-6 border-t border-ink/10 pt-5">
        <VerifyCard
          :parsed="exportParsed"
          :records="records"
          :busy="aiBusy || extracting"
          @pending="verifyPending = $event"
          @total="verifyTotal = $event"
          @fix-sources="onFixSources"
        />
      </div>

      <div ref="exportBox" class="mt-6 border-t border-ink/10 pt-5">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <span class="seal-chip seal-sm font-display" aria-hidden="true">肆</span>
            <h3 class="font-display text-[15px] font-bold text-ink">导出使用</h3>
            <span v-if="selectedStats.total > 0" class="text-[11px] text-ink-faint">
              已选 {{ selectedStats.selected }}/{{ selectedStats.total }} 条（导出只含勾选条目）
              <button
                v-if="selectedStats.selected < selectedStats.total"
                type="button"
                class="link-btn ml-1"
                @click="emit('select-all')"
                >全选</button
              >
            </span>
            <span v-if="verifyTotal > 0 && verifyPending > 0" class="stamp"
              >核查待确认 {{ verifyPending }} 项</span
            >
            <span v-else-if="verifyTotal > 0" class="stamp stamp-ok">核查完成 ✓</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 max-sm:grid max-sm:w-full max-sm:grid-cols-2">
            <button
              type="button"
              class="btn-mini"
              :class="copied && 'btn-mini-done'"
              :disabled="!exportText"
              :title="exportText ? '复制成纯文字，可直接粘到简历里' : '当前没有可导出的内容：先在结果区勾选条目'"
              @click="onCopyExport"
            >
              {{ copied ? '已复制 ✓' : '一键复制' }}
            </button>
            <button
              type="button"
              class="btn-mini"
              :disabled="!exportText"
              title="保留加粗和列表：粘到 Word 里格式不会丢"
              @click="onCopyRich"
            >
              复制带格式
            </button>
            <button
              type="button"
              class="btn-mini"
              :disabled="!exportText"
              title="下载成文本文件，之后还能在编辑器里继续改"
              @click="onDownloadFile"
            >
              下载 {{ exportFormat === 'markdown' ? '.md' : '.txt' }}
            </button>
            <button
              type="button"
              class="btn-mini"
              :disabled="docxBusy || !exportText"
              @click="onDownloadDocx"
            >
              {{ docxBusy ? '生成中…' : '下载 Word' }}
            </button>
            <button
              type="button"
              class="btn-mini"
              :disabled="!exportText"
              @click="onPrint"
            >
              打印 / 存 PDF
            </button>
            <button
              type="button"
              class="btn-mini"
              :disabled="!configured || aiBusy || !exportText"
              :title="
                !configured
                  ? '需先在页头连接 AI'
                  : aiBusy
                    ? '其他 AI 操作进行中，请稍候'
                    : '把当前勾选的亮点翻译成英文（建议人工校对）'
              "
              @click="emit('translate')"
            >
              {{ translating ? '翻译中…' : '译成英文' }}
            </button>
          </div>
        </header>

        <div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div class="seg" role="group" aria-label="导出格式">
            <button
              type="button"
              :class="exportFormat === 'markdown' && 'seg-active'"
              title="带小标题和列表的文本，便于再编辑"
              @click="exportFormat = 'markdown'"
            >
              带格式（Markdown）
            </button>
            <button
              type="button"
              :class="exportFormat === 'plain' && 'seg-active'"
              @click="exportFormat = 'plain'"
            >
              简历纯文本
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
              <input v-model="includeNotes" type="checkbox" class="accent-seal" />
              包含面试展开点
            </label>
            <label
              class="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft"
              title="单栏、无表格、小标题用常见说法：招聘系统读起来更省事，不容易被读错"
            >
              <input v-model="docxAts" type="checkbox" class="accent-seal" />
              Word 用 ATS 友好版式
            </label>
          </div>
        </div>

        <p v-if="exportFormat === 'plain'" class="mb-3 rounded-lg border border-jade/25 bg-jade/5 px-3 py-2 text-xs leading-relaxed text-ink-soft">
          网申小提示：建议用纯文字版——别用表格和分栏，小标题写成「项目经历」这类常见说法，粘完检查有没有串行。不少公司用系统自动读简历，排版越简单越不容易被读错。
        </p>

        <p v-if="todoCount > 0" class="mb-3 text-xs text-seal-deep">
          导出内容含 {{ todoCount }} 处【待补】，补齐后再写进简历。
        </p>

        <p
          v-if="selectedStats.total > 0 && selectedStats.selected === 0"
          class="mb-3 rounded-lg border border-marker/60 bg-marker/10 px-3 py-2 text-xs leading-relaxed text-ink-soft"
          role="status"
        >
          当前一条都没勾选，导出内容为空：在结果区勾上要用的条目，或点上方
          <button type="button" class="link-btn" @click="emit('select-all')">全选</button>
          再导出。
        </p>

        <textarea
          readonly
          rows="6"
          :value="exportText"
          class="w-full resize-y rounded-lg border border-ink bg-ink p-3 font-mono text-xs leading-relaxed text-paper outline-none selection:bg-seal/60"
          aria-label="导出内容预览"
        ></textarea>

        <!-- 整页简历：把勾选条目套进单页 A4 模板，直接投递 -->
        <div
          class="mt-4 rounded-lg border border-line-soft bg-sheet px-3 py-3"
          role="group"
          aria-label="整页简历"
        >
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <p class="min-w-0 text-xs leading-relaxed text-ink-soft">
              <b class="text-ink">整页简历</b>：把勾选的条目排成一页 A4 简历，打印或存成 PDF 就能直接投
            </p>
            <button
              type="button"
              class="link-btn shrink-0"
              :aria-expanded="resumeOpen"
              @click="resumeOpen = !resumeOpen"
            >
              {{ resumeOpen ? '收起' : '展开' }}
            </button>
          </div>
          <Collapse :open="resumeOpen">
            <div class="mt-2 grid gap-2 sm:grid-cols-3">
              <input
                v-model="resumeMeta.name"
                type="text"
                class="field py-1.5 text-xs"
                placeholder="姓名（可留空）"
                aria-label="简历姓名"
              />
              <input
                v-model="resumeMeta.contact"
                type="text"
                class="field py-1.5 text-xs"
                placeholder="电话 / 邮箱（可留空）"
                aria-label="简历联系方式"
              />
              <input
                v-model="resumeMeta.role"
                type="text"
                class="field py-1.5 text-xs"
                placeholder="目标岗位（可留空）"
                aria-label="简历岗位"
              />
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2.5">
              <button type="button" class="btn-mini" :disabled="!exportText" @click="onPrintResume">
                打印 / 存 PDF
              </button>
              <button
                type="button"
                class="btn-mini"
                :disabled="!exportText"
                @click="onDownloadResumeHtml"
              >
                下载 HTML
              </button>
              <span class="text-[11px] text-ink-faint">
                已放入 {{ selectedStats.selected }} 条{{ includeNotes ? '（含面试展开点）' : '' }}；姓名和联系方式只存在本机
              </span>
            </div>
          </Collapse>
        </div>

        <Collapse :open="translating || translated !== null">
          <div class="mt-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs text-ink-soft">
                英文译文（可编辑；术语与数字请人工校对后再投递）
              </p>
              <div class="flex items-center gap-2.5">
                <button
                  type="button"
                  class="btn-mini"
                  :disabled="!translated?.trim()"
                  @click="onCopyTranslated"
                >
                  复制译文
                </button>
                <button type="button" class="link-btn" @click="emit('close-translated')">
                  关闭
                </button>
              </div>
            </div>
            <p v-if="translating && !translated" class="text-xs text-jade" role="status">
              正在翻译…
            </p>
            <p
              v-else-if="translatedStale"
              class="mb-2 rounded-lg border border-marker/50 bg-marker/10 px-3 py-2 text-xs leading-relaxed text-ink-soft"
              role="status"
            >
              译文可能已过期：翻译之后你又改过条目内容，建议再点一次「译成英文」，或自己核对差异。
            </p>
            <textarea
              :value="translated ?? ''"
              rows="8"
              class="field resize-y font-mono text-xs"
              aria-label="英文译文"
              @input="emit('update:translated', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </div>
        </Collapse>
      </div>
    </section>

    <section
      v-else-if="extracting"
      class="reveal relative min-h-[280px] overflow-hidden rounded-xl border border-dashed border-jade/40 bg-jade/5 p-8 text-center sm:min-h-[320px]"
    >
      <!-- 「点铁成金」：粒子从混沌（流水账）冶炼成金色晶格（亮点）；p5 加载失败时静默隐藏，下方文案兜底 -->
      <AlchemyCanvas :seed="alchemySeed" :progress="extractProgress" :dark="isDark" />
      <div class="relative z-10 flex min-h-[216px] flex-col items-center justify-center gap-3 sm:min-h-[256px]">
        <p class="flex items-center justify-center gap-2 text-sm text-jade" role="status">
          <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-jade" aria-hidden="true"></span>
          正在提炼，生成内容将实时出现在这里…
        </p>
        <button
          type="button"
          class="link-btn"
          title="中断本次提炼，已生成的部分保留在结果区"
          @click="emit('stop')"
        >
           停止提炼
        </button>
      </div>
    </section>

    <section
      v-else
      class="reveal d2 relative overflow-hidden rounded-xl border border-dashed border-ink/20 bg-card/60 p-8 text-center"
    >
      <span
        class="pointer-events-none absolute -top-8 -right-3 font-display text-[7rem] leading-none font-black text-ink/[0.05] select-none"
        aria-hidden="true"
        >摘</span
      >
      <p v-if="hasRaw" class="relative text-sm leading-relaxed text-ink-faint">
        收到 AI 的回复了，但没能整理成条目。可以到左栏「备用」区看完整回复，
        <br class="hidden sm:block" />
        把格式调一下，再点「格式化并检查」。
      </p>
      <p v-else-if="!configured" class="relative text-sm leading-relaxed text-ink-faint">
        先点页头的<span class="font-medium text-ink">「连接 AI」</span
        >设置一次（密钥只存在你自己的浏览器里），然后：左侧粘贴记录 → 点【一键提炼】→ 这里出结果并导出。
        <br class="hidden sm:block" />
        生成内容会用<span class="mark-weak">高亮</span>标出弱动词、<span class="mark-todo">红色标记</span>标出待补数据
      </p>
      <p v-else class="relative text-sm leading-relaxed text-ink-faint">
        三步上手：左侧粘贴记录 → 点【一键提炼】→ 这里出结果并导出。
        <br class="hidden sm:block" />
        生成内容会用<span class="mark-weak">高亮</span>标出弱动词、<span class="mark-todo">红色标记</span>标出待补数据，评分章可展开扣分明细与改法
      </p>
      <button
        v-if="hasRaw"
        type="button"
        class="link-btn mt-3"
        title="到左栏「备用」区看 AI 的完整回复，可以直接在那里修改"
        @click="emit('request-raw')"
      >
        查看 / 编辑 AI 回复
      </button>
    </section>

    <!-- 追问细节弹层：AI 先问 2-3 个补强问题，回答后结合原记录改写该条 -->
    <div
      v-if="detailingKey"
      class="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="追问细节"
    >
      <div class="panel max-h-[85vh] w-full max-w-lg overflow-y-auto p-4 sm:p-5">
        <header class="mb-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="seal-chip seal-sm seal-soft font-display" aria-hidden="true">问</span>
            <h3 class="font-display text-[15px] font-bold text-ink">追问细节</h3>
          </div>
          <button type="button" class="link-btn" @click="emit('detail-cancel')">关闭</button>
        </header>
        <p class="rounded-lg border border-line-soft bg-sheet px-3 py-2 text-xs leading-relaxed text-ink-soft">
          {{ detailTarget?.text ?? '该条目已不存在' }}
        </p>
        <div class="mt-3">
          <p class="text-xs font-medium text-ink-soft">AI 想确认这几个细节（回答后据此改写，不会编造）：</p>
          <p
            v-if="detailQuestions.length === 0"
            class="mt-1.5 text-xs text-jade"
            role="status"
          >
            正在生成问题…
          </p>
          <ol v-else class="mt-1.5 space-y-1">
            <li
              v-for="(q, i) in detailQuestions"
              :key="i"
              class="text-xs leading-relaxed text-ink-soft"
            >
              {{ i + 1 }}. {{ q }}
            </li>
          </ol>
        </div>
        <label class="mt-3 block">
          <span class="mb-1 block text-xs font-medium text-ink-soft"
            >你的回答（数字、结果、分工、难点都可以写）</span
          >
          <textarea
            v-model="detailAnswers"
            rows="4"
            class="field resize-y text-sm"
            placeholder="例：分片大小取 2MB 是按弱网实测定的；这块由我负责方案与实现，联调协作 2 人"
            aria-label="追问细节的回答"
          ></textarea>
        </label>
        <p class="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          生成结果只使用原始记录与你的回答；回答里没给的关键数字会标【待补】，不会凭空填。
        </p>
        <div class="mt-3 flex items-center gap-2.5">
          <button
            type="button"
            class="btn-primary"
            :disabled="detailAnswers.trim() === '' || detailFillBusy || detailQuestions.length === 0"
            @click="submitDetailFill"
          >
            {{ detailFillBusy ? '生成中…' : '生成补充描述并替换' }}
          </button>
          <button type="button" class="link-btn" @click="emit('detail-cancel')">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>