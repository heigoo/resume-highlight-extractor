<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import Collapse from './Collapse.vue'
import { notify } from '../lib/toast'
import { formatBytes, type SavedVersion } from '../lib/versions'
import { parseResult } from '../lib/parse'
import { buildExport } from '../lib/export'
import { extractJdKeywords, matchKeywords } from '../lib/rules'

const props = defineProps<{
  versions: SavedVersion[]
  busy: boolean
  /** 当前会话内容是否已存入某个版本；未存档时载入确认升级为强警告 */
  currentSaved: boolean
  /** 岗位标签候选（规则预设 + 已用过的岗位） */
  roleOptions: string[]
  /** 当前工作区反推的岗位（按规则预设），用于「按当前岗位新建」预填 */
  currentRole: string
}>()

const emit = defineEmits<{
  (e: 'save', name: string, role: string): void
  (e: 'load', version: SavedVersion): void
  (e: 'rename', version: SavedVersion, name: string, role: string): void
  (e: 'delete', version: SavedVersion): void
  (e: 'clear-snapshots'): void
}>()

const AUTO_PREFIX = '自动快照-'

const autoCount = computed(() => props.versions.filter((v) => v.name.startsWith(AUTO_PREFIX)).length)
const isAuto = (version: SavedVersion): boolean => version.name.startsWith(AUTO_PREFIX)

// 岗位筛选（海投多岗位时按岗位对照）
const roleFilter = ref('')
const roles = computed(() => {
  const set = new Set<string>()
  for (const v of props.versions) if (v.role) set.add(v.role)
  return [...set]
})
const countByRole = (role: string): number =>
  props.versions.filter((v) => v.role === role).length
const filteredVersions = computed(() =>
  roleFilter.value === ''
    ? props.versions
    : props.versions.filter((v) => v.role === roleFilter.value),
)

// 筛选岗位被删空时自动回到「全部」
watch(roles, (list) => {
  if (roleFilter.value !== '' && !list.includes(roleFilter.value)) roleFilter.value = ''
})

const open = ref(false)
const saving = ref(false)
const saveName = ref('')
const saveRole = ref('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameRole = ref('')

// 模板 ref 在 v-for 里会变成数组，改用 DOM 查询聚焦（重命名行是动态渲染的）
function focusRenameInput() {
  document.querySelector<HTMLInputElement>('input[aria-label="新版本名称"]')?.focus()
}

// 默认名带上当前岗位，多岗位版本在一列里也能一眼区分
function defaultName(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  return props.currentRole ? `${props.currentRole}-${stamp}` : `版本-${stamp}`
}

// 可保存判定交给父组件（提炼结果是否为空）；这里只管交互
function startSave(role = '') {
  saving.value = true
  saveName.value = defaultName()
  saveRole.value = role
  // 聚焦时先禁止隐式滚动、再用瞬时滚动归位：html 上是 scroll-behavior: smooth，
  // 平滑滚动会让页面持续位移数百毫秒，期间落在面板上的点击可能落空
  void nextTick(() => {
    const el = document.getElementById('version-name-input')
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  })
}

// 「按当前岗位新建」：预填岗位名，内容沿用当前工作区
function startSaveWithRole() {
  startSave(props.currentRole)
}

function confirmSave() {
  const name = saveName.value.trim()
  if (!name) return
  emit('save', name, saveRole.value)
  saving.value = false
}

function startRename(version: SavedVersion) {
  renamingId.value = version.id
  renameValue.value = version.name
  renameRole.value = version.role ?? ''
  void nextTick(focusRenameInput)
}

function confirmRename(version: SavedVersion) {
  const name = renameValue.value.trim()
  emit('rename', version, name || version.name, renameRole.value)
  renamingId.value = null
}

function onLoad(version: SavedVersion) {
  const message = props.currentSaved
    ? `载入「${version.name}」会把现在的输入和结果换掉，确定？`
    : `载入「${version.name}」会把现在的输入和结果换掉，而且没法恢复。\n建议先点「存为版本」把当前内容存一份。要继续吗？`
  if (!window.confirm(message)) return
  emit('load', version)
  notify('ok', `已载入版本「${version.name}」`)
}

function onDelete(version: SavedVersion) {
  if (!window.confirm(`删除版本「${version.name}」？删掉就找不回来了。`)) return
  emit('delete', version)
  notify('ok', '版本已删除')
}

function timeLabel(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function versionSize(version: SavedVersion): string {
  return formatBytes(
    version.records.length + version.aiRaw.length + version.rules.length + version.jd.length,
  )
}

function itemCount(version: SavedVersion): number {
  return parseResult(version.aiRaw).groups.reduce((sum, g) => sum + g.items.length, 0)
}

// ---------- 版本对照：同岗位多版本并排比对（行级差异高亮） ----------
const compareBase = ref<SavedVersion | null>(null)
const compareWithId = ref('')

const compareCandidates = computed(() =>
  props.versions.filter((v) => v.id !== compareBase.value?.id),
)
const compareWith = computed(
  () => compareCandidates.value.find((v) => v.id === compareWithId.value) ?? null,
)

function exportLines(version: SavedVersion | null): string[] {
  if (!version) return []
  const parsed = parseResult(version.aiRaw)
  if (parsed.groups.length === 0) return []
  return buildExport(parsed, { format: 'plain', includeNotes: false })
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

const compareRows = computed(() => {
  const base = compareBase.value
  const other = compareWith.value
  if (!base || !other) return { a: [], b: [] }
  const a = exportLines(base)
  const b = exportLines(other)
  const bSet = new Set(b)
  const aSet = new Set(a)
  return {
    a: a.map((line) => ({ line, only: !bSet.has(line) })),
    b: b.map((line) => ({ line, only: !aSet.has(line) })),
  }
})

function startCompare(version: SavedVersion) {
  compareBase.value = version
  const sameRole = props.versions.find(
    (v) => v.id !== version.id && v.role !== undefined && v.role === version.role,
  )
  compareWithId.value = sameRole?.id ?? compareCandidates.value[0]?.id ?? ''
}

// JD 匹配度：按版本自带的 JD 抽关键词，与版本结果文本比对（纯本地，口径与结果区一致）
interface JdStats {
  pct: number
  hit: number
  total: number
  miss: string[]
}

function jdStats(version: SavedVersion): JdStats | null {
  const keywords = extractJdKeywords(version.jd).terms
  if (keywords.length === 0) return null
  const parsed = parseResult(version.aiRaw)
  const texts = parsed.groups.flatMap((g) => g.items.map((i) => i.text))
  const { hit, miss } = matchKeywords(texts, keywords)
  return {
    pct: Math.round((hit.length / keywords.length) * 100),
    hit: hit.length,
    total: keywords.length,
    miss,
  }
}

const baseJd = computed(() => (compareBase.value ? jdStats(compareBase.value) : null))
const withJd = computed(() => (compareWith.value ? jdStats(compareWith.value) : null))

// 缺口差异：只看「一边缺、另一边不缺」的关键词（都缺的不算差异）
const gapDiff = computed(() => {
  const a = new Set(baseJd.value?.miss ?? [])
  const b = new Set(withJd.value?.miss ?? [])
  return {
    onlyA: [...a].filter((k) => !b.has(k)),
    onlyB: [...b].filter((k) => !a.has(k)),
  }
})

function capMiss(miss: string[], max = 8): string {
  if (miss.length <= max) return miss.join('、')
  return `${miss.slice(0, max).join('、')} 等 ${miss.length} 个`
}

function closeCompare() {
  compareBase.value = null
  compareWithId.value = ''
}

function onCompareKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && compareBase.value) closeCompare()
}
window.addEventListener('keydown', onCompareKeydown)
onUnmounted(() => window.removeEventListener('keydown', onCompareKeydown))
</script>

<template>
  <section class="panel reveal p-4 sm:p-5">
    <header class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div class="flex items-center gap-2.5">
        <span class="seal-chip seal-sm seal-soft font-display" aria-hidden="true">档</span>
        <h2 class="font-display text-[15px] font-bold whitespace-nowrap text-ink">版本库</h2>
        <span class="text-[11px] whitespace-nowrap text-ink-faint">{{ versions.length }} 份</span>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <button
          v-if="autoCount > 0"
          type="button"
          class="link-btn"
          :disabled="busy"
          title="删除提炼时自动帮你留的备份，自己命名保存的版本不受影响"
          @click="emit('clear-snapshots')"
        >
          清理快照({{ autoCount }})
        </button>
        <button
          type="button"
          class="link-btn"
          :disabled="busy"
          title="把现在的内容再存一份，岗位名已帮你填好，方便按岗位各留一份"
          @click="startSaveWithRole"
        >
          按当前岗位新建
        </button>
        <button
          type="button"
          class="link-btn"
          :disabled="busy"
          @click="startSave()"
        >
          存为版本
        </button>
        <button
          type="button"
          class="link-btn"
          :aria-expanded="open"
          @click="open = !open"
        >
          {{ open ? '收起' : '展开' }}
          <span
            class="inline-block transition-transform duration-200"
            :class="open ? 'rotate-180' : ''"
            aria-hidden="true"
            >▾</span
          >
        </button>
      </div>
    </header>

    <Collapse :open="saving">
      <div class="mt-3 space-y-2">
        <div class="flex items-center gap-2">
          <input
            id="version-name-input"
            v-model="saveName"
            type="text"
            class="field flex-1 py-2 text-sm"
            placeholder="版本名称，如：字节-前端-A卷"
            aria-label="版本名称"
            @keydown.enter.prevent="confirmSave"
          />
        </div>
        <div class="flex items-center gap-2">
          <input
            v-model="saveRole"
            type="text"
            class="field flex-1 py-2 text-sm"
            list="version-role-options"
            placeholder="目标岗位（可选），如：前端技术岗"
            aria-label="目标岗位"
            @keydown.enter.prevent="confirmSave"
          />
          <datalist id="version-role-options">
            <option v-for="role in roleOptions" :key="role" :value="role"></option>
          </datalist>
          <button type="button" class="btn-mini btn-mini-done shrink-0" @click="confirmSave">
            保存
          </button>
          <button type="button" class="link-btn shrink-0" @click="saving = false">取消</button>
        </div>
      </div>
    </Collapse>

    <Collapse :open="open">
      <div v-if="roles.length > 0" class="mt-3 flex flex-wrap items-center gap-1.5">
        <span class="text-[11px] text-ink-faint">岗位</span>
        <button
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition"
          :class="
            roleFilter === ''
              ? 'border-seal/60 bg-seal/10 text-seal-deep'
              : 'border-line text-ink-faint hover:border-ink/25 hover:text-ink-soft'
          "
          @click="roleFilter = ''"
        >
          全部（{{ versions.length }}）
        </button>
        <button
          v-for="role in roles"
          :key="role"
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition"
          :class="
            roleFilter === role
              ? 'border-seal/60 bg-seal/10 text-seal-deep'
              : 'border-line text-ink-faint hover:border-ink/25 hover:text-ink-soft'
          "
          @click="roleFilter = role"
        >
          {{ role }}（{{ countByRole(role) }}）
        </button>
      </div>

      <p v-if="versions.length === 0" class="pt-3 text-xs leading-relaxed text-ink-faint">
        还没有存档：提炼满意后点「存为版本」，按岗位 / 公司各存一份，随时切换对比。这些内容只存在你自己的浏览器里，不会上传。
      </p>
      <p
        v-else-if="filteredVersions.length === 0"
        class="pt-3 text-xs leading-relaxed text-ink-faint"
      >
        该岗位下还没有版本，可点「按当前岗位新建」存一份。
      </p>
      <ul v-else class="mt-3 space-y-1.5">
        <li
          v-for="version in filteredVersions"
          :key="version.id"
          class="rounded-lg border border-transparent px-3 py-2 transition hover:border-ink/10 hover:bg-sheet"
        >
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <button
              type="button"
              class="min-w-0 text-left text-sm font-medium transition"
              :class="isAuto(version) ? 'text-ink-faint' : 'text-ink hover:text-seal'"
              :title="`载入「${version.name}」`"
              @click="onLoad(version)"
            >
              {{ version.name }}
            </button>
            <div class="flex shrink-0 flex-wrap items-center gap-2.5 text-[11px] text-ink-faint">
              <span
                v-if="version.role"
                class="rounded-full border border-jade/40 bg-jade/5 px-2 py-0.5 text-[10px] text-jade"
                >{{ version.role }}</span
              >
              <span class="hidden font-mono sm:inline">{{ versionSize(version) }}</span>
              <span>{{ timeLabel(version.updatedAt) }}</span>
              <button
                type="button"
                class="link-btn"
                :disabled="versions.length < 2"
                title="与其他版本并排对照"
                @click="startCompare(version)"
              >
                对比
              </button>
              <button type="button" class="link-btn" @click="startRename(version)">改名</button>
              <button type="button" class="link-btn hover:!border-seal hover:!text-seal" @click="onDelete(version)">
                删除
              </button>
            </div>
          </div>
          <div v-if="renamingId === version.id" class="mt-2 space-y-2">
            <input
              v-model="renameValue"
              type="text"
              class="field w-full py-1.5 text-xs"
              aria-label="新版本名称"
              @keydown.enter.prevent="confirmRename(version)"
              @keydown.esc.prevent="renamingId = null"
            />
            <div class="flex items-center gap-2">
              <input
                v-model="renameRole"
                type="text"
                class="field flex-1 py-1.5 text-xs"
                list="version-role-options"
                placeholder="目标岗位（可选）"
                aria-label="新目标岗位"
                @keydown.enter.prevent="confirmRename(version)"
                @keydown.esc.prevent="renamingId = null"
              />
              <button type="button" class="btn-mini shrink-0" @click="confirmRename(version)">
                确定
              </button>
              <button type="button" class="link-btn shrink-0" @click="renamingId = null">取消</button>
            </div>
          </div>
        </li>
      </ul>
    </Collapse>

    <!-- 版本对照弹层：左右并排，行级差异高亮（仅一边有的行着色） -->
    <div
      v-if="compareBase"
      class="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="版本对照"
    >
      <div class="panel max-h-[85vh] w-full max-w-3xl overflow-y-auto p-4 sm:p-5">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="seal-chip seal-sm seal-soft font-display" aria-hidden="true">照</span>
            <h3 class="font-display text-[15px] font-bold text-ink">版本对照</h3>
          </div>
          <button type="button" class="link-btn" @click="closeCompare">关闭</button>
        </header>

        <div class="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <span class="shrink-0 text-ink-faint">对照</span>
          <select
            v-model="compareWithId"
            class="field w-auto max-w-full py-1.5 text-xs"
            aria-label="选择对照版本"
          >
            <option v-for="v in compareCandidates" :key="v.id" :value="v.id">
              {{ v.name }}{{ v.role ? ` · ${v.role}` : '' }}
            </option>
          </select>
        </div>

        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div class="rounded-lg border border-line-soft bg-sheet px-3 py-2">
            <p class="text-xs font-medium text-ink">
              {{ compareBase.name }}
              <span v-if="compareBase.role" class="ml-1 text-[10px] text-jade">{{ compareBase.role }}</span>
            </p>
            <p class="mt-0.5 text-[11px] text-ink-faint">
              {{ itemCount(compareBase) }} 条 · {{ timeLabel(compareBase.updatedAt) }}
            </p>
            <p v-if="baseJd" class="mt-1 text-[11px] text-jade">
              JD 匹配度 {{ baseJd.pct }}%（命中 {{ baseJd.hit }}/{{ baseJd.total }}）
            </p>
            <p v-if="baseJd && baseJd.miss.length" class="mt-0.5 text-[11px] leading-relaxed text-seal-deep">
              缺口：{{ capMiss(baseJd.miss) }}
            </p>
            <p v-else-if="!baseJd" class="mt-1 text-[11px] text-ink-faint">该版本未填 JD</p>
            <ul class="mt-2 space-y-1">
              <li
                v-for="(row, i) in compareRows.a"
                :key="i"
                class="text-xs leading-relaxed"
                :class="row.only ? 'text-seal-deep' : 'text-ink-soft'"
              >
                · {{ row.line }}
              </li>
            </ul>
          </div>
          <div class="rounded-lg border border-line-soft bg-sheet px-3 py-2">
            <p class="text-xs font-medium text-ink">
              {{ compareWith?.name ?? '（选择版本）' }}
              <span v-if="compareWith?.role" class="ml-1 text-[10px] text-jade">{{ compareWith.role }}</span>
            </p>
            <p v-if="compareWith" class="mt-0.5 text-[11px] text-ink-faint">
              {{ itemCount(compareWith) }} 条 · {{ timeLabel(compareWith.updatedAt) }}
            </p>
            <p v-if="withJd" class="mt-1 text-[11px] text-jade">
              JD 匹配度 {{ withJd.pct }}%（命中 {{ withJd.hit }}/{{ withJd.total }}）
            </p>
            <p v-if="withJd && withJd.miss.length" class="mt-0.5 text-[11px] leading-relaxed text-seal-deep">
              缺口：{{ capMiss(withJd.miss) }}
            </p>
            <p v-else-if="compareWith && !withJd" class="mt-1 text-[11px] text-ink-faint">该版本未填 JD</p>
            <ul class="mt-2 space-y-1">
              <li
                v-for="(row, i) in compareRows.b"
                :key="i"
                class="text-xs leading-relaxed"
                :class="row.only ? 'text-jade' : 'text-ink-soft'"
              >
                · {{ row.line }}
              </li>
            </ul>
          </div>
        </div>
        <p class="mt-2 text-[11px] text-ink-faint">
          红色行 = 只在左边这版里有，绿色行 = 只在右边这版里有：一眼看出两个岗位版本改了什么。
        </p>
        <!-- 缺口差异：换岗位/改一版之后，哪些关键词从「缺」变成了「有」 -->
        <div
          v-if="baseJd || withJd"
          class="mt-3 rounded-lg border border-line-soft bg-card px-3 py-2 text-[11px] leading-relaxed"
        >
          <p class="text-ink-soft">
            <b class="text-ink">JD 缺口对照</b>：只看「一边有、另一边没有」的关键词，两边都没提到的就不列
          </p>
          <p class="mt-1 text-seal-deep">
            仅「{{ compareBase.name }}」缺：{{ gapDiff.onlyA.length ? capMiss(gapDiff.onlyA) : '无' }}
          </p>
          <p class="mt-0.5 text-jade">
            仅「{{ compareWith?.name ?? '右侧版本' }}」缺：{{ gapDiff.onlyB.length ? capMiss(gapDiff.onlyB) : '无' }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>