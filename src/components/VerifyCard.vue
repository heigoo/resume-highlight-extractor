<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Collapse from './Collapse.vue'
import {
  buildVerifyList,
  checkCitations,
  citationRows,
  flattenVerify,
  loadVerifyChecked,
  saveVerifyChecked,
  type VerifyRow,
} from '../lib/verify'
import type { Parsed } from '../lib/parse'

const props = defineProps<{
  /** 当前勾选范围的解析结果（与导出内容保持一致） */
  parsed: Parsed | null
  /** 原始记录文本：用于核对「源N」引用行是否对得上内容 */
  records: string
  /** AI 操作进行中：禁用「改用建议出处」等改动操作 */
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'pending', count: number): void
  (e: 'total', count: number): void
  (e: 'fix-sources', group: string, index: number, sources: number[]): void
}>()

const open = ref(false)
const checked = ref<Record<string, boolean>>(loadVerifyChecked())

const rows = computed<VerifyRow[]>(() => {
  if (!props.parsed) return []
  const base = flattenVerify(buildVerifyList(props.parsed))
  if (props.records.trim() === '') return base
  return [...base, ...citationRows(checkCitations(props.parsed, props.records))]
})

const pending = computed(() => rows.value.filter((row) => !checked.value[row.key]).length)
const done = computed(() => rows.value.length - pending.value)

// 按核查类型分组渲染（数字核对 / 动词强度 / 出处）
const groups = computed(() => {
  const order: string[] = []
  const map = new Map<string, { title: string; hint: string; items: VerifyRow[] }>()
  for (const row of rows.value) {
    if (!map.has(row.kind)) {
      map.set(row.kind, { title: row.title, hint: row.hint, items: [] })
      order.push(row.kind)
    }
    map.get(row.kind)?.items.push(row)
  }
  return order.map((kind) => map.get(kind)!)
})

// 「源N」引用核对：行号对不上内容的条目（作为核查清单的第四类，含一键改用建议行号）
function issueKey(issue: { group: string; index: number }): string {
  return `${issue.group}#${issue.index}`
}

function useSuggestion(issue: { group: string; index: number; suggestion?: number[] }) {
  if (!issue.suggestion || issue.suggestion.length === 0) return
  emit('fix-sources', issue.group, issue.index, issue.suggestion)
}

function linePreview(text: string, max = 26): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

function currentKeys(): string[] {
  return rows.value.map((row) => row.key)
}

function toggle(row: VerifyRow) {
  checked.value = { ...checked.value, [row.key]: !checked.value[row.key] }
  saveVerifyChecked(checked.value, currentKeys())
}

function markAllDone() {
  const next: Record<string, boolean> = { ...checked.value }
  for (const row of rows.value) next[row.key] = true
  checked.value = next
  saveVerifyChecked(checked.value, currentKeys())
}

watch(pending, (value) => emit('pending', value), { immediate: true })
watch(
  () => rows.value.length,
  (value) => emit('total', value),
  { immediate: true },
)
// 结果变化后清理历史键，避免 sessionStorage 无限膨胀（当前会话勾选状态仍保留）
watch(rows, () => saveVerifyChecked(checked.value, currentKeys()))
</script>

<template>
  <section class="panel reveal p-4 sm:p-5" aria-label="导出前核查">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2.5">
        <span class="seal-chip seal-sm seal-soft font-display" aria-hidden="true">核</span>
        <h3 class="font-display text-[15px] font-bold text-ink">导出前核查</h3>
        <span v-if="rows.length === 0" class="text-[11px] text-ink-faint">暂无可核查项</span>
        <span v-else class="stamp" :class="pending === 0 && 'stamp-ok'">
          {{ pending === 0 ? '可以放心导出' : `还有 ${pending} 项待确认` }}
        </span>
        <span v-if="rows.length > 0" class="text-[11px] text-ink-faint">
          已确认 {{ done }}/{{ rows.length }}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <button
          v-if="rows.length > 0 && pending > 0"
          type="button"
          class="link-btn"
          @click="markAllDone"
        >
          全部确认
        </button>
        <button type="button" class="link-btn" :aria-expanded="open" @click="open = !open">
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

    <Collapse :open="open">
      <p class="mt-2 text-xs leading-relaxed text-ink-faint">
        导出前逐项过一遍：数字是真的、事情是你主导的、出处找得到——这三类最容易被面试追问穿帮。勾选只在这次浏览时有效，关掉页面就重置，也不会改动你保存的内容。
      </p>
      <div v-for="group in groups" :key="group.title" class="mt-3">
        <p class="text-xs font-medium text-ink-soft">{{ group.title }}（{{ group.items.length }} 项）</p>
        <p class="mt-0.5 mb-1.5 text-[11px] leading-relaxed text-ink-faint">{{ group.hint }}</p>
        <ul class="space-y-1">
          <li
            v-for="row in group.items"
            :key="row.key"
            class="flex items-start gap-2 rounded-lg border border-line-soft bg-sheet px-3 py-2"
          >
            <input
              type="checkbox"
              class="mt-0.5 accent-jade"
              :checked="!!checked[row.key]"
              :aria-label="`已确认核查：${row.text}`"
              @change="toggle(row)"
            />
            <span
              class="min-w-0 flex-1 text-xs leading-relaxed"
              :class="checked[row.key] ? 'text-ink-faint' : 'text-ink-soft'"
            >
              <span class="mr-1.5 rounded bg-card-deep px-1 py-0.5 text-[10px] text-ink-faint">{{
                row.label
              }}</span>{{ row.text }}
              <template v-if="row.kind === 'citation'">
                <span class="ml-1.5 font-mono text-[10px] text-seal-deep"
                  >现引用 源 {{ row.citations?.join(',') }}{{ row.outOfRange ? '（记录里没有这行）' : '' }}</span
                >
                <span
                  v-for="line in row.citedLines"
                  :key="line.n"
                  class="mt-0.5 block text-[10px] text-ink-faint"
                  >[{{ line.n }}] {{ line.text === '' ? '（原始记录没有这一行）' : linePreview(line.text) }}</span
                >
                <span v-if="row.suggestion?.length" class="mt-1 flex flex-wrap items-center gap-2">
                  <span class="font-mono text-[10px] text-jade"
                    >建议 源 {{ row.suggestion.join(',') }}</span
                  >
                  <button
                    type="button"
                    class="link-btn"
                    :disabled="busy"
                    @click="useSuggestion(row)"
                  >
                    改用建议出处
                  </button>
                </span>
                <span v-else class="mt-1 block text-[10px] text-ink-faint">
                  没找到更匹配的记录行：请点条目上的「源」自己核对，或删掉这条出处
                </span>
              </template>
              <span v-else-if="row.sources.length" class="ml-1.5 font-mono text-[10px] text-jade"
                >源 {{ row.sources.join(',') }}</span
              >
              <span v-else class="ml-1.5 text-[10px] text-seal-deep">无出处</span>
            </span>
          </li>
        </ul>
      </div>
    </Collapse>
  </section>
</template>