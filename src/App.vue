<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import HelpDialog from './components/HelpDialog.vue'
import InputPanel from './components/InputPanel.vue'
import ResultPanel from './components/ResultPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ToastHost from './components/ToastHost.vue'
import VersionPanel from './components/VersionPanel.vue'
import { notify } from './lib/toast'
import {
  callAi,
  describeAiError,
  isAbortError,
  loadAiSettings,
  saveAiSettings,
  type AiSettings,
} from './lib/ai'
import { DEFAULT_RULES, RULE_PRESETS, composeDetailAskPrompt, composeDetailFillPrompt, composeInterviewFeedbackPrompt, composeInterviewPrompt, composePrompt, composeRewritePrompt, composeRulePrompt, composeSupplementPrompt, composeTranslatePrompt, matchKeywords, sanitizeRules, extractJdKeywords } from './lib/rules'
import { checkDateGaps, filterSelected, findUntraceableNumbers, listItems, parseResult, recordLines, serializeParsed, type DateCoverage, type Group, type Parsed, type ParsedItem } from './lib/parse'
import { buildExport } from './lib/export'
import { loadDraft, saveDraft } from './lib/draft'
import { loadStats, recordStat, recentCount, averageMs } from './lib/stats'
import { SAMPLE_RECORDS } from './lib/samples'
import {
  deleteVersion,
  listVersions,
  saveVersion,
  type SavedVersion,
} from './lib/versions'
import {
  applyTheme,
  effectiveTheme,
  loadThemePref,
  nextThemePref,
  saveThemePref,
  type ThemePref,
} from './lib/theme'

const records = ref('')
const rules = ref(DEFAULT_RULES)
const jd = ref('')
const style = ref('')
const scenario = ref('')
const prompt = ref('')
const aiRaw = ref('')
const parsed = ref<Parsed | null>(null)
const dateCheck = ref<DateCoverage | null>(null)
// 面试追问 / 英文译文随草稿保留：刷新后不丢，用户无需先复制再自测
const interviewRaw = ref('')
const translated = ref<string | null>(null)
const translatedSource = ref('')

// 草稿恢复：在子组件渲染前执行，刷新后自动还原上次输入；恢复解析不弹 toast
const restored = loadDraft()
if (restored) {
  records.value = restored.records
  rules.value = restored.rules
  jd.value = restored.jd
  style.value = restored.style
  scenario.value = restored.scenario
  aiRaw.value = restored.aiRaw
  interviewRaw.value = restored.interview
  translated.value = restored.translated.trim() === '' ? null : restored.translated
  translatedSource.value = restored.translatedSource
  if (aiRaw.value.trim() !== '') parsed.value = parseResult(aiRaw.value)
  dateCheck.value = checkDateGaps(records.value)
}

// 草稿防抖写入：500ms 内连续输入只落一次盘，全量覆盖
let draftTimer: number | undefined
watch(
  [records, rules, jd, style, scenario, aiRaw, interviewRaw, translated, translatedSource],
  () => {
    window.clearTimeout(draftTimer)
    draftTimer = window.setTimeout(() => {
      saveDraft({
        records: records.value,
        rules: rules.value,
        aiRaw: aiRaw.value,
        jd: jd.value,
        style: style.value,
        scenario: scenario.value,
        interview: interviewRaw.value,
        translated: translated.value ?? '',
        translatedSource: translatedSource.value,
        rulesCustom: !RULE_PRESETS.some((p) => p.rules === rules.value),
      })
    }, 500)
  },
)

const aiSettings = ref<AiSettings | null>(loadAiSettings())
const showSettings = ref(false)
// 应用内精简版说明书（页头 / 页脚入口，Esc 或遮罩关闭）
const showHelp = ref(false)
const extracting = ref(false)
const ruleGen = ref(false)
let controller: AbortController | null = null

// 最近一次提炼失败的原因（供按钮下方错误条 + 一键重试）
const lastError = ref<string | null>(null)

// 本机使用统计（页脚展示累计与近 7 天；每次提炼后刷新）
const stats = ref(loadStats())
// 数据看板：默认收起，展开后展示成功率 / 平均耗时 / JD 匹配度趋势
const boardOpen = ref(false)
const okRate = computed(() =>
  stats.value.count === 0 ? 0 : Math.round((stats.value.ok / stats.value.count) * 100),
)
// 匹配度趋势：只取填过 JD 的成功提炼，最近 20 次
const matchTrend = computed(() => stats.value.history.filter((p) => p.pct !== null).slice(-20))

function trendLabel(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- 条目级撤销：内容改动前压栈，Ctrl+Z 或提示条上的「撤销」回退 ----------
const UNDO_LIMIT = 20
const undoStack = ref<Parsed[]>([])

function cloneParsed(value: Parsed): Parsed {
  return JSON.parse(JSON.stringify(value)) as Parsed
}

// 所有会改变结果内容的操作，在改动前调用
function pushUndo(): void {
  if (!parsed.value || parsed.value.groups.length === 0) return
  undoStack.value = [...undoStack.value.slice(-(UNDO_LIMIT - 1)), cloneParsed(parsed.value)]
}

function clearUndo(): void {
  undoStack.value = []
}

function undo(): void {
  const prev = undoStack.value.pop()
  undoStack.value = [...undoStack.value]
  if (!prev) {
    notify('warn', '没有可撤销的操作')
    return
  }
  parsed.value = prev
  syncRawFromParsed()
  notify('ok', '已撤销上一步改动，导出内容同步回退')
}

// 破坏性操作（删除 / 改写 / 追问改写）的提示条带「撤销」按钮
function notifyWithUndo(text: string, kind: 'ok' | 'warn' = 'ok'): void {
  notify(kind, text, undefined, { label: '撤销', run: undo })
}

// 结果区「去填 JD」：展开左栏 JD 面板并聚焦输入框
const jdFocusSeq = ref(0)
function onRequestJd(): void {
  jdFocusSeq.value += 1
}

// 结果区「查看原始返回」：展开左栏「备用」区并聚焦 AI 原文编辑框
const rawFocusSeq = ref(0)
function onRequestRaw(): void {
  rawFocusSeq.value += 1
}

// 说明书里的「去连接 AI」：关说明、开设置
function onOpenSettingsFromHelp(): void {
  showHelp.value = false
  showSettings.value = true
}

// 提炼失败后的「改用备用路径」：本地生成指令并展开左栏「备用」区（seq 递增触发定位）
const backupSeq = ref(0)
function onUseBackup(): void {
  if (records.value.trim() === '') return
  onGenerate()
  backupSeq.value += 1
}

// 定位请求：左侧 JD 关键词芯片点击 → 结果区高亮对应条目（seq 递增保证重复点击也触发）
const focusRequest = ref<{ keyword: string; seq: number } | null>(null)
let focusSeq = 0
function onFocusKeyword(keyword: string) {
  if (!parsed.value || parsed.value.groups.length === 0) {
    notify('warn', '先提炼出结果，再按关键词定位条目')
    return
  }
  focusSeq += 1
  focusRequest.value = { keyword, seq: focusSeq }
}

// 首访引导：无草稿、无提炼记录且未看过引导时显示一次
const ONBOARDING_KEY = 'rhe.onboarded'
const showOnboarding = ref(
  !localStorage.getItem(ONBOARDING_KEY) && !restored && loadStats().count === 0,
)
function dismissOnboarding(): void {
  showOnboarding.value = false
  try {
    localStorage.setItem(ONBOARDING_KEY, '1')
  } catch {
    // 存储不可用时仅本次会话内隐藏
  }
}
function fillSampleFromOnboarding(): void {
  records.value = SAMPLE_RECORDS
  dismissOnboarding()
  // 未配置 AI 时提示指向页头常驻的「连接 AI」按钮：引导条会被本函数关掉，不能指向条上的按钮
  notify(
    'ok',
    aiSettings.value
      ? '示例已填入，点「一键提炼」即可体验完整流程'
      : '示例已填入：先点页头「连接 AI」完成设置（只需一次），再点「一键提炼」',
  )
}

// 首访未配置 AI：引导条直接给出「配置 AI 连接」入口，避免用户先撞上失败再回头找设置
function openSettingsFromOnboarding(): void {
  showSettings.value = true
}

// 流式期间节流实时解析：内容边生成边进结果区，消除「盲等」
let streamParseTimer: number | undefined
watch(aiRaw, (raw) => {
  if (!extracting.value) return
  window.clearTimeout(streamParseTimer)
  streamParseTimer = window.setTimeout(() => {
    parsed.value = parseResult(raw)
  }, 120)
})

// 对标关键词：JD 输入变化时本地即时重算（纯前端抽取，不调 AI）
const jdKeywords = computed(() => (jd.value.trim() === '' ? [] : extractJdKeywords(jd.value).terms))
// 流式提炼时已收到的字数（用于按钮区进度提示）
const streamCount = computed(() => (extracting.value ? aiRaw.value.length : 0))

// ---------- 暗色模式（auto / dark / light 三态循环） ----------
const themePref = ref<ThemePref>(loadThemePref())
const isDark = computed(() => effectiveTheme(themePref.value) === 'dark')
applyTheme(themePref.value)

function toggleTheme() {
  themePref.value = nextThemePref(themePref.value)
  saveThemePref(themePref.value)
  applyTheme(themePref.value)
}

const themeLabel = computed(() => {
  if (themePref.value === 'auto') return '切换到暗色模式（当前跟随系统）'
  if (themePref.value === 'dark') return '切换到亮色模式'
  return '切换到跟随系统'
})

// 未手动固定主题时跟随系统变化；环境不支持 matchMedia 时静默
const themeMedia =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null
function onSystemThemeChange() {
  if (themePref.value === 'auto') applyTheme('auto')
}
themeMedia?.addEventListener('change', onSystemThemeChange)
onUnmounted(() => themeMedia?.removeEventListener('change', onSystemThemeChange))

// Esc 关闭使用说明 / 设置面板；Ctrl/⌘+Z 撤销结果区改动（输入框内保留浏览器原生撤销）
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // 说明与设置同时打开时，先关最上层的说明
    if (showHelp.value) {
      showHelp.value = false
      return
    }
    if (showSettings.value) {
      showSettings.value = false
      return
    }
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
    const el = e.target as HTMLElement | null
    const typing =
      !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    if (typing) return
    e.preventDefault()
    undo()
  }
}
window.addEventListener('keydown', onGlobalKeydown)
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))

// ---------- 版本库（IndexedDB） ----------
const versions = ref<SavedVersion[]>([])
const versionsBusy = ref(false)

async function refreshVersions() {
  versions.value = await listVersions()
}
void refreshVersions()

async function onSaveVersion(name: string, role = '') {
  if (aiBusy.value) {
    notify('warn', 'AI 操作进行中，请等待完成或停止后再存版本')
    return
  }
  if (!parsed.value || parsed.value.groups.length === 0) {
    notify('warn', '先提炼出结果，再存为版本')
    return
  }
  versionsBusy.value = true
  try {
    const now = Date.now()
    await saveVersion({
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      records: records.value,
      rules: rules.value,
      jd: jd.value,
      style: style.value,
      aiRaw: aiRaw.value,
      role: role.trim() === '' ? undefined : role.trim(),
    })
    await refreshVersions()
    notify('ok', `已存为版本「${name}」${role.trim() ? `（岗位：${role.trim()}）` : ''}`)
  } catch {
    notify('err', '保存失败：浏览器本地存储不可用（无痕模式或清理过浏览器数据时可能这样）。换普通窗口重试看看')
  } finally {
    versionsBusy.value = false
  }
}

async function onLoadVersion(version: SavedVersion) {
  if (aiBusy.value) {
    notify('warn', 'AI 操作进行中，请等待完成或停止后再载入版本')
    return
  }
  records.value = version.records
  rules.value = version.rules
  jd.value = version.jd
  style.value = version.style
  aiRaw.value = version.aiRaw
  parsed.value = version.aiRaw.trim() === '' ? null : parseResult(version.aiRaw)
  clearUndo() // 整份工作区被替换，旧撤销点已无意义
  dateCheck.value = checkDateGaps(records.value)
}

async function onDeleteVersion(version: SavedVersion) {
  versionsBusy.value = true
  try {
    await deleteVersion(version.id)
    await refreshVersions()
  } catch {
    notify('err', '版本删除失败：请重试一次')
  } finally {
    versionsBusy.value = false
  }
}

async function onRenameVersion(version: SavedVersion, name: string, role = '') {
  versionsBusy.value = true
  try {
    await saveVersion({
      ...version,
      name,
      role: role.trim() === '' ? undefined : role.trim(),
      updatedAt: Date.now(),
    })
    await refreshVersions()
    notify('ok', `已改名为「${name}」`)
  } catch {
    notify('err', '版本改名失败：请重试一次')
  } finally {
    versionsBusy.value = false
  }
}

// 一键清理「自动快照-」前缀的存档（不影响手动命名的版本）
async function onClearSnapshots() {
  const autos = versions.value.filter((v) => v.name.startsWith('自动快照'))
  if (autos.length === 0) return
  if (!window.confirm(`清理这 ${autos.length} 条自动快照？你自己命名保存的版本不会被删。`)) return
  versionsBusy.value = true
  try {
    for (const v of autos) await deleteVersion(v.id)
    await refreshVersions()
    notify('ok', `已清理 ${autos.length} 条自动快照`)
  } catch {
    notify('err', '快照清理失败：请重试一次')
  } finally {
    versionsBusy.value = false
  }
}

// 当前会话内容是否已存入某个版本（载入版本前的覆盖风险提示用）
const currentSaved = computed(() =>
  versions.value.some(
    (v) =>
      v.records === records.value &&
      v.rules === rules.value &&
      v.jd === jd.value &&
      v.style === style.value &&
      v.aiRaw === aiRaw.value,
  ),
)

// 版本面板的岗位标签选项：规则预设 + 已有版本里出现过的岗位
const roleOptions = computed(() => {
  const set = new Set<string>(RULE_PRESETS.map((p) => p.label))
  for (const v of versions.value) if (v.role) set.add(v.role)
  return [...set]
})
// 当前工作区对应的岗位（按规则预设反推），用于「按当前岗位新建版本」
const currentRole = computed(() => RULE_PRESETS.find((p) => p.rules === rules.value)?.label ?? '')

// ---------- 条目勾选 / 删除 / 排序（导出范围由勾选决定） ----------
function onToggleItem(groupTitle: string, index: number, checked: boolean) {
  const found = findItem(groupTitle, index)
  if (!found) return
  found.item.selected = checked
}

function onSelectAll() {
  for (const group of parsed.value?.groups ?? []) {
    for (const item of group.items) item.selected = true
  }
  notify('ok', '已全选，导出将包含全部条目')
}

function onDeleteItem(groupTitle: string, index: number) {
  const found = findItem(groupTitle, index)
  if (!found) return
  pushUndo()
  found.group.items.splice(index, 1)
  if (parsed.value) {
    parsed.value = { groups: parsed.value.groups.filter((g) => g.items.length > 0) }
  }
  syncRawFromParsed()
  notifyWithUndo('已删除该条，不再出现在结果与导出中')
}

function onMoveItem(groupTitle: string, index: number, delta: number) {
  const found = findItem(groupTitle, index)
  if (!found) return
  const target = index + delta
  if (target < 0 || target >= found.group.items.length) return
  pushUndo()
  const [item] = found.group.items.splice(index, 1)
  found.group.items.splice(target, 0, item)
  syncRawFromParsed()
}

// ---------- 未命中关键词补充提炼 ----------
const supplementing = ref(false)

async function onSupplementItem(missingKeywords: string[]) {
  if (!aiSettings.value || aiBusy.value) return
  if (!records.value.trim() || !parsed.value) return
  supplementing.value = true
  try {
    const content = await callAi(
      aiSettings.value,
      composeSupplementPrompt(records.value, missingKeywords),
    )
    const trimmed = content.trim()
    if (trimmed === '' || trimmed.startsWith('无相关素材')) {
      notify('warn', '原始记录中没有与缺失关键词相关的素材，已保持原结果（不编造）')
      return
    }
    const addition = parseResult(trimmed, { enforceSources: true })
    pushUndo()
    let added = 0
    for (const group of addition.groups) {
      let target = parsed.value.groups.find((g) => g.title === group.title)
      if (!target) {
        target = { title: group.title, items: [] }
        parsed.value.groups.push(target)
      }
      for (const item of group.items) {
        target.items.push(item)
        added += 1
      }
    }
    if (added === 0) {
      notify('warn', '原始记录中没有相关素材，已保持原结果（不编造）')
      return
    }
    syncRawFromParsed()
    notify('ok', `已补充 ${added} 条，JD 覆盖情况也更新了`)
  } catch (e) {
    notify('err', isAbortError(e) ? '已停止补充提炼' : describeAiError(e))
  } finally {
    supplementing.value = false
  }
}

// ---------- 行内编辑 / 单条重生成 ----------
function findItem(groupTitle: string, index: number): { group: Group; item: ParsedItem } | null {
  const group = parsed.value?.groups.find((g) => g.title === groupTitle)
  const item = group?.items[index]
  if (!group || !item) return null
  return { group, item }
}

// 行内编辑后以 parsed 为准回写 aiRaw，导出/复制自动保持一致
function syncRawFromParsed() {
  if (parsed.value) aiRaw.value = serializeParsed(parsed.value)
}

function onEditItem(groupTitle: string, index: number, text: string) {
  const found = findItem(groupTitle, index)
  if (!found) return
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === found.item.text) return
  pushUndo()
  found.item.text = trimmed
  syncRawFromParsed()
  notifyWithUndo('已更新该条亮点，导出内容同步更新')
}

// 核查清单里「改用建议出处」：本地校验发现 AI 数错行号时，一键换成匹配的原始记录行
function onFixSources(groupTitle: string, index: number, sources: number[]) {
  const found = findItem(groupTitle, index)
  if (!found || sources.length === 0) return
  pushUndo()
  found.item.sources = [...sources]
  syncRawFromParsed()
  notifyWithUndo(`已改用 源${sources.join(',')}，出处已换成对得上的记录行`)
}

const rewritingKey = ref<string | null>(null)

async function onRewriteItem(groupTitle: string, index: number) {
  if (!aiSettings.value || aiBusy.value) return
  const found = findItem(groupTitle, index)
  if (!found) return
  rewritingKey.value = `${groupTitle}#${index}`
  try {
    const content = await callAi(aiSettings.value, composeRewritePrompt(found.item.text))
    const cleaned = content.trim().replace(/^[-*\d.、)]\s*/, '').trim()
    if (cleaned === '') throw new Error('AI 没返回内容：请再试一次')
    // 防编造：改写引入的新数字若不在出处原文里，自动标【待补】
    pushUndo()
    found.item.prevText = found.item.text
    found.item.text = withNumberGuard(cleaned, sourceLinesOf(found.item))
    syncRawFromParsed()
    notifyWithUndo('已换一种说法（出处保持不变）')
  } catch (e) {
    notify('err', isAbortError(e) ? '已停止重写' : describeAiError(e))
  } finally {
    rewritingKey.value = null
  }
}

// ---------- AI 生成兜底：数字可溯源 ----------
// 引用行的原文（「源N」对应的原始记录行）
function sourceLinesOf(item: ParsedItem): string[] {
  const lines = recordLines(records.value)
  return item.sources
    .filter((n) => n >= 1 && n <= lines.length)
    .map((n) => lines[n - 1])
}

// 文本里出现素材中没有的数字时补【待补】标记（素材为空则不判，避免手动粘贴路径误标）
function withNumberGuard(text: string, materials: string[]): string {
  if (materials.length === 0) return text
  const untraceable = findUntraceableNumbers(text, materials)
  if (untraceable.length === 0) return text
  return `${text}【待补：核实数字 ${untraceable.join('、')}】`
}

// ---------- 共享并发守卫：任一 AI 操作进行中，其它 AI 入口统一禁用 ----------
// （interviewRaw / translated / translatedSource 在文件顶部声明，随草稿持久化）
const interviewing = ref(false)
const detailingKey = ref<string | null>(null)
const detailAskRaw = ref('')
const detailFillBusy = ref(false)
const translating = ref(false)
// 面试模拟：当前正在点评的问题下标 + 流式点评内容（仅本次会话）
const practiceIndex = ref<number | null>(null)
const practiceRaw = ref('')
const practiceBusy = ref(false)

const aiBusy = computed(
  () =>
    extracting.value ||
    rewritingKey.value !== null ||
    supplementing.value ||
    interviewing.value ||
    translating.value ||
    detailingKey.value !== null ||
    practiceBusy.value ||
    ruleGen.value,
)

// 勾选范围内的解析结果 / 条目（导出、面试追问共用同一口径）
function selectedParsed(): Parsed | null {
  return filterSelected(parsed.value)
}

function selectedItems(): ReturnType<typeof listItems> {
  const view = selectedParsed()
  return view ? listItems(view, { skipNotes: true }) : []
}

// ---------- 面试追问（F4）：基于勾选条目生成 HR 最可能追问的问题 ----------
async function onInterview() {
  if (!aiSettings.value || aiBusy.value) return
  const items = selectedItems()
  if (items.length === 0) {
    notify('warn', '先提炼出结果（并勾选条目），再生成面试追问')
    return
  }
  interviewing.value = true
  interviewRaw.value = ''
  try {
    const content = await callAi(
      aiSettings.value,
      composeInterviewPrompt(
        items.map((i) => i.text),
        jd.value,
      ),
      undefined,
      (chunk) => {
        interviewRaw.value += chunk
      },
    )
    interviewRaw.value = content
    notify('ok', '已生成面试追问清单，可点「复制清单」发给同伴模拟面试')
  } catch (e) {
    notify('err', isAbortError(e) ? '已停止生成面试追问' : describeAiError(e))
    if (interviewRaw.value.trim() === '') interviewRaw.value = ''
  } finally {
    interviewing.value = false
  }
}

// ---------- 面试模拟（F4 延伸）：逐题作答 → AI 点评（不编造，只用候选人给的信息） ----------
async function onPractice(index: number, question: string, context: string, answer: string) {
  if (!aiSettings.value || aiBusy.value) return
  if (answer.trim() === '') return
  practiceIndex.value = index
  practiceRaw.value = ''
  practiceBusy.value = true
  try {
    const content = await callAi(
      aiSettings.value,
      composeInterviewFeedbackPrompt(question, context, answer),
      undefined,
      (chunk) => {
        practiceRaw.value += chunk
      },
    )
    practiceRaw.value = content
  } catch (e) {
    notify('err', isAbortError(e) ? '已停止生成点评' : describeAiError(e))
    if (practiceRaw.value.trim() === '') {
      practiceIndex.value = null
      practiceRaw.value = ''
    }
  } finally {
    practiceBusy.value = false
  }
}

function onPracticeCancel() {
  practiceIndex.value = null
  practiceRaw.value = ''
}

// ---------- 追问补细节（F5）：AI 先问 → 用户回答 → 结合原记录改写该条 ----------
async function onDetailAsk(groupTitle: string, index: number) {
  if (!aiSettings.value || aiBusy.value) return
  const found = findItem(groupTitle, index)
  if (!found) return
  detailingKey.value = `${groupTitle}#${index}`
  detailAskRaw.value = ''
  try {
    const content = await callAi(
      aiSettings.value,
      composeDetailAskPrompt(found.item.text, sourceLinesOf(found.item)),
      undefined,
      (chunk) => {
        detailAskRaw.value += chunk
      },
    )
    detailAskRaw.value = content
  } catch (e) {
    notify('err', isAbortError(e) ? '已停止生成问题' : describeAiError(e))
    if (detailAskRaw.value.trim() === '') onDetailCancel()
  }
}

async function onDetailFill(groupTitle: string, index: number, answers: string) {
  if (!aiSettings.value || detailFillBusy.value) return
  const found = findItem(groupTitle, index)
  if (!found || answers.trim() === '') return
  detailFillBusy.value = true
  try {
    const sourceLines = sourceLinesOf(found.item)
    const content = await callAi(
      aiSettings.value,
      composeDetailFillPrompt(found.item.text, sourceLines, answers.trim()),
    )
    // 只取第一条非空行，并剥掉可能带的序号 / 引号 / 出处标记
    const cleaned = (content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l !== '') ?? '')
      .replace(/^[-*\d.、)]\s*/, '')
      .replace(/^["'「『]|["'」』]$/g, '')
      .replace(/\s*[（(「『\[]?源[：:]?\s*\d+(?:\s*[,，、]\s*\d+)*[）)」』\]]?\s*$/, '')
      .trim()
    if (cleaned === '') throw new Error('AI 没返回内容：请再试一次')
    // 防编造双保险：只认「原记录 + 我的回答」里的数字，其余标【待补】
    const guarded = withNumberGuard(cleaned, [...sourceLines, answers])
    const flagged = guarded !== cleaned
    pushUndo()
    found.item.prevText = found.item.text
    found.item.text = guarded
    syncRawFromParsed()
    detailingKey.value = null
    detailAskRaw.value = ''
    notifyWithUndo(
      flagged
        ? '已按你的回答改写；其中新数字未经原始记录核实，已标【待补】'
        : '已按你的回答改写该条，出处保持不变',
      flagged ? 'warn' : 'ok',
    )
  } catch (e) {
    notify('err', isAbortError(e) ? '已停止生成补充描述' : describeAiError(e))
  } finally {
    detailFillBusy.value = false
  }
}

function onDetailCancel() {
  detailingKey.value = null
  detailAskRaw.value = ''
}

// ---------- 中英翻译（F9） ----------
async function onTranslate() {
  if (!aiSettings.value || aiBusy.value) return
  const view = selectedParsed()
  if (!view || view.groups.length === 0) {
    notify('warn', '先提炼出结果，再翻译')
    return
  }
  const source = buildExport(view, { format: 'markdown', includeNotes: false })
  if (source.trim() === '') {
    notify('warn', '没有可翻译的内容')
    return
  }
  translating.value = true
  translated.value = ''
  translatedSource.value = source
  try {
    const content = await callAi(
      aiSettings.value,
      composeTranslatePrompt(source),
      undefined,
      (chunk) => {
        translated.value = (translated.value ?? '') + chunk
      },
    )
    translated.value = content
    notify('ok', '翻译完成：术语与数字建议人工校对后再投递')
  } catch (e) {
    notify('err', isAbortError(e) ? '已停止翻译' : describeAiError(e))
    if (!translated.value?.trim()) translated.value = null
  } finally {
    translating.value = false
  }
}

function onCloseTranslated() {
  translated.value = null
  translatedSource.value = ''
}

// 译文过期判断：翻译之后条目内容（勾选范围）有改动 → 提示重新翻译或人工校对。
// 对比时剥掉【待补…】标记与空白：提炼路径的 enforceSources 强标在刷新重解析后会消失，
// 不能仅因此就判定译文过期；真正的表达修改（编辑/重写/增删条目）仍会被检出。
const translatedStale = computed(() => {
  if (!translated.value?.trim() || translatedSource.value === '') return false
  const normalize = (s: string): string => s.replace(/【待补[^】]*】/g, '').replace(/\s+/g, '')
  const view = filterSelected(parsed.value)
  const current = view ? buildExport(view, { format: 'markdown', includeNotes: false }) : ''
  return normalize(current) !== normalize(translatedSource.value)
})

// ---------- 结果区一次性引导：评分 → 缺口 → 核查 → 导出 ----------
const RESULT_GUIDE_KEY = 'rhe.resultGuide.v1'
const resultGuideDismissed = ref(!!localStorage.getItem(RESULT_GUIDE_KEY))
function dismissResultGuide() {
  resultGuideDismissed.value = true
  try {
    localStorage.setItem(RESULT_GUIDE_KEY, '1')
  } catch {
    // 存储不可用时仅本次会话内隐藏
  }
}

const flow = [
  { num: '壹', label: '粘贴记录' },
  { num: '贰', label: '选规则（可选）' },
  { num: '叁', label: '一键提炼' },
  { num: '肆', label: '导出使用' },
]

function onGenerate() {
  prompt.value = composePrompt(records.value, rules.value, {
    jd: jd.value,
    style: style.value,
    scenario: scenario.value,
  })
}

function onSaveSettings(s: AiSettings) {
  saveAiSettings(s)
  aiSettings.value = s
  showSettings.value = false
  notify('ok', '连接设置已保存')
}

async function onExtract() {
  if (!records.value.trim()) return
  if (aiBusy.value) {
    if (!extracting.value) notify('warn', '其他 AI 操作进行中（改写 / 追问 / 翻译），请稍候再提炼')
    return
  }

  // 未配置 AI：只走一条明确路径——打开连接设置（不再同时塞入指令与弹窗，避免三处反馈分散注意力）
  if (!aiSettings.value) {
    showSettings.value = true
    notify(
      'warn',
      '先完成 AI 连接设置（只需一次），之后点「一键提炼」即可；也可在左栏「备用」区生成指令手动发送',
    )
    return
  }

  extracting.value = true
  lastError.value = null
  controller = new AbortController()
  const startedAt = Date.now()
  // 失败时用于恢复：真实网关偶发 429/5xx 时，不能让用户当前的结果区凭空消失
  const prevRaw = aiRaw.value
  const prevParsed = parsed.value
  const prevDateCheck = dateCheck.value
  try {
    // 覆盖前自动快照：当前结果未存档时先落一份，用户无需记得手动保存
    if (parsed.value && parsed.value.groups.length > 0 && !currentSaved.value) {
      try {
        const d = new Date()
        const p = (n: number): string => String(n).padStart(2, '0')
        await saveVersion({
          id: crypto.randomUUID(),
          // 名称带秒：同一分钟内连续提炼的快照也能区分（人工快照重名少且可改名）
          name: `自动快照-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          records: records.value,
          rules: rules.value,
          jd: jd.value,
          style: style.value,
          aiRaw: aiRaw.value,
        })
        await refreshVersions()
      } catch {
        // 快照失败不阻塞提炼
      }
    }
    aiRaw.value = ''
    const content = await callAi(
      aiSettings.value,
      composePrompt(records.value, rules.value, {
        jd: jd.value,
        style: style.value,
        scenario: scenario.value,
      }),
      controller.signal,
      (chunk) => {
        aiRaw.value += chunk
      },
    )
    const ms = Date.now() - startedAt
    aiRaw.value = content
    onFormat(true)
    const total = parsed.value?.groups.reduce((sum, g) => sum + g.items.length, 0) ?? 0
    notify('ok', `提炼完成：共 ${total} 条，耗时 ${(ms / 1000).toFixed(1)}s；可点「🎯 面试追问」自测`)
    recordStat('ok', ms, { pct: currentJdPercent(), items: total })
    stats.value = loadStats()
  } catch (e) {
    if (isAbortError(e)) {
      // 用户主动中止：不计入统计；已收到的部分内容立即解析进结果区供查看
      window.clearTimeout(streamParseTimer)
      if (aiRaw.value.trim() !== '') {
        clearUndo()
        parsed.value = parseResult(aiRaw.value)
        dateCheck.value = checkDateGaps(records.value)
      }
      notify('warn', '已停止本次提炼，已生成的部分内容保留在结果区')
    } else {
      recordStat('fail', Date.now() - startedAt)
      lastError.value = describeAiError(e)
      // 恢复上一次的结果，避免一次失败把工作区清空（快照仍在版本库里）
      const restoredLast = prevParsed !== null && prevParsed.groups.length > 0
      if (restoredLast) {
        aiRaw.value = prevRaw
        parsed.value = prevParsed
        dateCheck.value = prevDateCheck
      }
      notify('err', restoredLast ? `${lastError.value}；已保留上一次的结果` : lastError.value)
    }
  } finally {
    extracting.value = false
    controller = null
  }
}

function onStop() {
  controller?.abort()
}

// 当前勾选结果 vs JD 关键词的匹配度（未填 JD 或没有结果时为 null），写入本机数据看板
function currentJdPercent(): number | null {
  const kws = jdKeywords.value
  const view = filterSelected(parsed.value)
  if (kws.length === 0 || !view) return null
  const texts = view.groups.flatMap((g) => g.items.map((i) => i.text))
  const { hit } = matchKeywords(texts, kws)
  return Math.round((hit.length / kws.length) * 100)
}

// AI 定制规则：根据已粘贴的记录让 AI 判断岗位方向、生成专属规则
async function onAutoRules() {
  if (ruleGen.value) return
  if (!records.value.trim()) {
    notify('warn', '先粘贴原始记录，AI 才能根据内容定制规则')
    return
  }
  if (!aiSettings.value) {
    notify('warn', '未配置 AI 连接，无法自动定制规则；可先完成连接设置')
    showSettings.value = true
    return
  }
  ruleGen.value = true
  try {
    const content = await callAi(aiSettings.value, composeRulePrompt(records.value))
    const cleaned = sanitizeRules(content)
    if (!cleaned) throw new Error('AI 没返回内容：请再试一次')
    rules.value = cleaned
    notify('ok', '已根据你的记录定制规则，可再手动增删')
  } catch (e) {
    notify('err', isAbortError(e) ? '已停止定制' : describeAiError(e))
  } finally {
    ruleGen.value = false
  }
}

// enforceSources=true 仅用于一键提炼完成时：无「源N」出处的条目强制标【待补】；
// 手动粘贴 / 重新格式化 / 草稿恢复不强制，避免外部结果被误标
function onFormat(enforceSources = false) {
  // 流式实时解析的定时器不再需要：完成态解析以此为准，避免被无出处的节流结果覆盖
  window.clearTimeout(streamParseTimer)
  const result = parseResult(aiRaw.value, { enforceSources })
  clearUndo() // 整份结果被替换，旧撤销点已无意义
  parsed.value = result
  dateCheck.value = checkDateGaps(records.value)
  if (!result.groups.length) {
    notify('warn', '没看懂粘贴的内容：请把工作记录按条目分行整理一下再试')
    return
  }
  // 手动粘贴路径：出处不全时提示走核查清单（不拦截，保持克制）
  if (!enforceSources) {
    const items = listItems(result, { skipNotes: true })
    const withSources = items.filter((i) => i.sources.length > 0).length
    if (withSources > 0 && withSources < items.length) {
      notify('warn', `有 ${items.length - withSources} 条还没标出处，建议到「导出前核查」里确认一下`)
    }
  }
}
</script>

<template>
  <div class="relative min-h-screen">
    <div class="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
      <header class="reveal pt-8 sm:pt-12">
        <!-- 窄屏时按钮组整体换行到第二行，避免挤压标题导致逐字折行 -->
        <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div class="flex items-center gap-4">
            <span class="seal-chip seal-lg font-display font-bold" aria-hidden="true">炼</span>
            <div>
              <p class="font-mono text-[10px] tracking-[0.3em] text-ink-faint uppercase sm:text-[11px]">
                Resume Highlight Extractor
              </p>
              <h1 class="mt-1 font-display text-xl font-black tracking-tight whitespace-nowrap text-ink sm:text-2xl">
                项目经历亮点提炼器
              </h1>
            </div>
          </div>
          <div class="ml-auto flex shrink-0 flex-col items-end gap-3">
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="btn-mini"
                title="打开使用说明（Esc 关闭）"
                :aria-expanded="showHelp"
                @click="showHelp = !showHelp"
              >
                使用说明
              </button>
              <button
                type="button"
                class="btn-mini"
                :aria-label="themeLabel"
                :title="themeLabel"
                @click="toggleTheme"
              >
                <span aria-hidden="true">{{ themePref === 'auto' ? '◐' : isDark ? '☀' : '☾' }}</span>
              </button>
              <button
                type="button"
                class="btn-mini"
                :aria-expanded="showSettings"
                @click="showSettings = !showSettings"
              >
                <span
                  v-if="aiSettings"
                  class="inline-block h-1.5 w-1.5 rounded-full bg-jade"
                  aria-hidden="true"
                ></span>
                {{ aiSettings ? 'AI 已连接' : '连接 AI' }}
              </button>
            </div>
            <p class="hidden max-w-[15rem] border-l-2 border-seal/70 pl-4 text-xs leading-relaxed text-ink-soft lg:block">
              内容只在你浏览器里处理；只有点「一键提炼」时，记录才会发给你设置好的 AI 服务。密钥也只存在你的浏览器里。
            </p>
          </div>
        </div>

        <div class="relative mt-10 sm:mt-14">
          <p
            class="vertical-note reveal d2 absolute -top-1 right-0 hidden text-[13px] leading-none text-ink-faint select-none xl:block"
            aria-hidden="true"
          >
            凡流水账，皆可点铁成金
          </p>
          <h2
            class="reveal d1 max-w-3xl font-display text-2xl leading-snug font-bold text-ink sm:text-4xl sm:leading-[1.35]"
          >
            把零散的工作记录，<br />
            提炼成<span class="hl-sweep">简历可用的项目亮点</span>。
          </h2>
          <p class="reveal d2 mt-4 max-w-xl text-sm leading-relaxed text-ink-soft">
            动词太平淡（弱动词）、数据没补上（待补）、日期有断档，都会自动标出来——像一位拿着红笔的编辑，帮你把流水账改成面试官认可的表达。
          </p>
        </div>

        <ol
          class="reveal d3 mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-b-ink/10 border-t-ink/50 border-t-2 py-3"
        >
          <li
            v-for="(step, i) in flow"
            :key="step.num"
            class="flex items-center gap-2.5 text-xs text-ink-soft"
          >
            <span class="seal-chip seal-sm font-display" aria-hidden="true">{{ step.num }}</span>
            <span class="font-medium">{{ step.label }}</span>
            <span v-if="i < flow.length - 1" class="ml-1 text-ink-faint" aria-hidden="true">→</span>
          </li>
        </ol>
      </header>

      <div
        v-if="showOnboarding"
        class="reveal mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-jade/40 bg-jade/5 px-4 py-3"
        role="note"
        aria-label="新手上手引导"
      >
        <p class="min-w-0 text-sm leading-relaxed text-ink-soft">
          <span class="seal-chip seal-sm seal-soft mr-1.5 align-middle font-display" aria-hidden="true">引</span>
          <template v-if="!aiSettings">
            首次使用先连一次 AI：<b class="text-ink">① 配置 AI 连接</b>（填一次密钥，只存在你自己的浏览器里）→
            <b class="text-ink">② 粘贴工作记录</b> →
            <b class="text-ink">③ 点「一键提炼」</b> →
            <b class="text-ink">④ 导出进简历</b>。
          </template>
          <template v-else>
            三步出亮点：<b class="text-ink">① 粘贴工作记录</b> →
            <b class="text-ink">② 点「一键提炼」</b> →
            <b class="text-ink">③ 导出进简历</b>。先加载示例看看效果？
          </template>
        </p>
        <div class="flex shrink-0 flex-wrap items-center gap-2.5">
          <button
            v-if="!aiSettings"
            type="button"
            class="btn-mini btn-mini-done"
            @click="openSettingsFromOnboarding"
          >
            配置 AI 连接
          </button>
          <button
            type="button"
            class="btn-mini"
            :class="aiSettings && 'btn-mini-done'"
            @click="fillSampleFromOnboarding"
          >
            填入示例试一试
          </button>
          <button type="button" class="link-btn" @click="dismissOnboarding">知道了</button>
        </div>
      </div>

      <SettingsPanel
        v-if="showSettings"
        class="mt-6"
        :settings="aiSettings"
        @save="onSaveSettings"
        @close="showSettings = false"
      />

      <HelpDialog
        v-if="showHelp"
        @close="showHelp = false"
        @open-settings="onOpenSettingsFromHelp"
      />

      <main class="mt-6 grid grid-cols-1 items-start gap-5 lg:mt-8 lg:grid-cols-2 lg:gap-6">
        <InputPanel
          v-model:records="records"
          v-model:rules="rules"
          v-model:jd="jd"
          v-model:style="style"
          v-model:scenario="scenario"
          v-model:raw="aiRaw"
          :prompt="prompt"
          :extracting="extracting"
          :stream-count="streamCount"
          :jd-keywords="jdKeywords"
          :configured="!!aiSettings"
          :rule-gen="ruleGen"
          :last-error="lastError"
          :jd-focus-seq="jdFocusSeq"
          :raw-focus-seq="rawFocusSeq"
          :backup-focus-seq="backupSeq"
          @generate="onGenerate"
          @extract="onExtract"
          @stop="onStop"
          @format="onFormat()"
          @auto-rules="onAutoRules"
          @use-backup="onUseBackup"
          @focus-keyword="onFocusKeyword"
        />
        <div class="min-w-0 space-y-5">
          <ResultPanel
            v-model:translated="translated"
            :parsed="parsed"
            :has-raw="aiRaw.trim() !== ''"
            :date-check="dateCheck"
            :records="records"
            :jd-keywords="jdKeywords"
            :configured="!!aiSettings"
            :extracting="extracting"
            :rewriting-key="rewritingKey"
            :supplementing="supplementing"
            :interviewing="interviewing"
            :interview-raw="interviewRaw"
            :detailing-key="detailingKey"
            :detail-ask-raw="detailAskRaw"
            :detail-fill-busy="detailFillBusy"
            :translating="translating"
            :translated-stale="translatedStale"
            :show-guide="!resultGuideDismissed"
            :has-jd="jd.trim() !== ''"
            :can-undo="undoStack.length > 0"
            :practice-index="practiceIndex"
            :practice-raw="practiceRaw"
            :practice-busy="practiceBusy"
            :focus-request="focusRequest"
            @format="onFormat"
            @edit-item="onEditItem"
            @rewrite-item="onRewriteItem"
            @toggle-item="onToggleItem"
            @select-all="onSelectAll"
            @delete-item="onDeleteItem"
            @move-item="onMoveItem"
            @supplement="onSupplementItem"
            @interview="onInterview"
            @practice="onPractice"
            @practice-cancel="onPracticeCancel"
            @detail-ask="onDetailAsk"
            @detail-fill="onDetailFill"
            @detail-cancel="onDetailCancel"
            @translate="onTranslate"
            @close-translated="onCloseTranslated"
            @dismiss-guide="dismissResultGuide"
            @fix-sources="onFixSources"
            @undo="undo"
            @request-jd="onRequestJd"
            @request-raw="onRequestRaw"
            @stop="onStop"
            @extract="onExtract"
          />
          <VersionPanel
            :versions="versions"
            :busy="versionsBusy || aiBusy"
            :current-saved="currentSaved"
            :role-options="roleOptions"
            :current-role="currentRole"
            @save="onSaveVersion"
            @load="onLoadVersion"
            @rename="onRenameVersion"
            @delete="onDeleteVersion"
            @clear-snapshots="onClearSnapshots"
          />
        </div>
      </main>

      <section
        v-if="boardOpen"
        class="panel mt-14 p-4 sm:p-5"
        aria-label="本机数据看板"
      >
        <header class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div class="flex items-center gap-2.5">
            <span class="seal-chip seal-sm seal-soft font-display" aria-hidden="true">数</span>
            <h3 class="font-display text-[15px] font-bold text-ink">数据看板</h3>
            <span class="text-[11px] text-ink-faint">全部数据仅存本机</span>
          </div>
          <button type="button" class="link-btn" @click="boardOpen = false">收起</button>
        </header>
        <div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-soft">
          <span>累计提炼 <b class="font-mono text-ink">{{ stats.count }}</b> 次</span>
          <span>成功率 <b class="font-mono text-ink">{{ okRate }}%</b></span>
          <span v-if="stats.count > 0"
            >平均耗时 <b class="font-mono text-ink">{{ (averageMs(stats) / 1000).toFixed(1) }}s</b></span
          >
          <span>近 7 天 <b class="font-mono text-ink">{{ recentCount(stats) }} 次</b></span>
        </div>
        <div class="mt-4">
          <p class="text-[11px] text-ink-faint">
            JD 匹配度趋势（最近 {{ matchTrend.length }} 次带 JD 的提炼；改一版看分数涨）
          </p>
          <div v-if="matchTrend.length > 0" class="mt-2 flex items-end gap-1.5">
            <div
              v-for="point in matchTrend"
              :key="point.t"
              class="flex h-16 w-4 flex-col justify-end"
              :title="`${trendLabel(point.t)} · 匹配度 ${point.pct}%`"
            >
              <span
                class="w-full rounded-t bg-jade/70 transition hover:bg-jade"
                :style="{ height: `${Math.max(6, ((point.pct ?? 0) / 100) * 64)}px` }"
              ></span>
            </div>
          </div>
          <p v-else class="mt-1 text-xs text-ink-faint">
            还没有带 JD 的提炼记录：在左栏填入目标岗位 JD 再提炼一次，这里会出现匹配度趋势。
          </p>
        </div>
      </section>

      <footer
        class="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-5 text-xs text-ink-faint"
      >
        <p>数据本地处理 · 仅提炼时发送到你配置的 AI 服务商</p>
        <p v-if="stats.count > 0" class="text-ink-faint">
          本机已提炼 {{ stats.count }} 次 · 近 7 天 {{ recentCount(stats) }} 次 · 仅存本地
        </p>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="link-btn"
            :aria-expanded="showHelp"
            @click="showHelp = !showHelp"
          >
            使用说明
          </button>
          <button
            type="button"
            class="link-btn"
            :aria-expanded="boardOpen"
            @click="boardOpen = !boardOpen"
          >
            {{ boardOpen ? '收起数据看板' : '数据看板' }}
          </button>
          <p class="font-mono tracking-[0.2em]">BUILT WITH TRAE · VUE 3 + TAILWIND</p>
        </div>
      </footer>
    </div>

    <ToastHost />
  </div>
</template>
