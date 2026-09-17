<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { testConnection, type AiSettings } from '../lib/ai'
import { averageMs, loadStats, recentCount, STATS_KEY } from '../lib/stats'
import { DRAFT_KEY, clearDraft } from '../lib/draft'
import {
  clearVersions,
  estimateStorage,
  formatBytes,
  importVersions,
  listVersions,
  type SavedVersion,
} from '../lib/versions'
import { downloadText, exportFilename } from '../lib/download'
import { notify } from '../lib/toast'

const props = defineProps<{
  settings: AiSettings | null
}>()

const emit = defineEmits<{
  (e: 'save', value: AiSettings): void
  (e: 'close'): void
}>()

// 父组件用 v-if 控制显示，挂载时从已保存设置初始化 draft
const draft = reactive<AiSettings>({
  baseUrl: props.settings?.baseUrl ?? '',
  apiKey: props.settings?.apiKey ?? '',
  model: props.settings?.model ?? '',
})

// 挂载即读取本地统计（不响应式，关闭再打开面板会重新读取）
const stats = loadStats()

const showKey = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

const canSubmit = computed(
  () => draft.baseUrl.trim() !== '' && draft.apiKey.trim() !== '' && draft.model.trim() !== '',
)

function trimmedDraft(): AiSettings {
  return {
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
  }
}

function onSave() {
  if (!canSubmit.value) return
  emit('save', trimmedDraft())
}

async function onTest() {
  if (!canSubmit.value || testing.value) return
  testing.value = true
  testResult.value = null
  testResult.value = await testConnection(trimmedDraft())
  testing.value = false
}

// ---------- 服务商预设：一键填充地址与模型，降低首次配置门槛 ----------
const PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    keyUrl: '',
  },
]

// 按当前服务地址反显匹配的预设（输入框被手动修改时自动失焦）
const matchedPreset = computed(
  () => PROVIDER_PRESETS.find((p) => p.baseUrl === draft.baseUrl.trim()) ?? null,
)

function applyProviderPreset(id: string): void {
  const preset = PROVIDER_PRESETS.find((p) => p.id === id)
  if (!preset) return
  draft.baseUrl = preset.baseUrl
  draft.model = preset.model
}

// ---------- 隐私与本地数据 ----------
const backupInput = ref<HTMLInputElement | null>(null)
const privacyDraftSize = ref('—')
const privacyVersionLabel = ref('—')
const privacyStorageLabel = ref('—')
let privacyVersions: SavedVersion[] = []

onMounted(async () => {
  await refreshPrivacy()
})

async function refreshPrivacy() {
  privacyDraftSize.value = formatBytes((localStorage.getItem(DRAFT_KEY) ?? '').length)
  privacyVersions = await listVersions()
  privacyVersionLabel.value = `${privacyVersions.length} 份`
  const est = await estimateStorage()
  privacyStorageLabel.value = est
    ? `${formatBytes(est.usage)}${est.quota > 0 ? ` / 配额 ${formatBytes(est.quota)}` : ''}`
    : '未知'
}

function onClearDraft() {
  if (!window.confirm('清空草稿？你粘贴的记录、规则和提炼结果都会被清掉（刷新后生效）。')) return
  clearDraft()
  notify('ok', '草稿已清空，刷新页面生效')
  void refreshPrivacy()
}

async function onClearVersions() {
  if (!window.confirm('清空版本库？所有保存过的版本都会被删除，无法恢复。')) return
  await clearVersions()
  notify('ok', '版本库已清空')
  await refreshPrivacy()
}

function onExportBackup() {
  const payload = {
    kind: 'rhe-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    draft: localStorage.getItem(DRAFT_KEY),
    stats: localStorage.getItem(STATS_KEY),
    versions: privacyVersions,
  }
  downloadText(exportFilename('json').replace('简历亮点', 'rhe-backup'), JSON.stringify(payload, null, 2), 'application/json')
  notify('ok', '备份已下载（不含你的密钥）')
}

async function onImportBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const data = JSON.parse(await file.text()) as {
      kind?: string
      draft?: unknown
      stats?: unknown
      versions?: unknown
    }
    if (data.kind !== 'rhe-backup') throw new Error('不是本工具导出的备份文件')
    if (typeof data.draft === 'string') localStorage.setItem(DRAFT_KEY, data.draft)
    if (typeof data.stats === 'string') localStorage.setItem(STATS_KEY, data.stats)
    const count = await importVersions(data.versions)
    notify('ok', `备份已导入（新增 ${count} 个版本）：刷新页面后生效`)
    await refreshPrivacy()
  } catch (e) {
    notify('err', e instanceof Error ? e.message : '备份导入失败')
  }
}
</script>

<template>
  <section class="panel reveal p-4 sm:p-5" aria-label="连接 AI 设置">
    <header class="mb-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <span class="seal-chip seal-sm font-display" aria-hidden="true">链</span>
        <h2 class="font-display text-[15px] font-bold text-ink">连接 AI 设置</h2>
      </div>
      <button type="button" class="link-btn" @click="emit('close')">关闭</button>
    </header>

    <div class="mb-3">
      <span class="mb-1.5 block text-xs font-medium text-ink-soft">常用 AI 服务（点一下，自动帮你填好网址和模型）</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="preset in PROVIDER_PRESETS"
          :key="preset.id"
          type="button"
          class="rounded-full border px-3 py-1 text-xs font-medium transition"
          :class="
            matchedPreset?.id === preset.id
              ? 'border-jade/60 bg-jade/10 text-jade'
              : 'border-line text-ink-faint hover:border-ink/25 hover:text-ink-soft'
          "
          @click="applyProviderPreset(preset.id)"
        >
          {{ preset.label }}
        </button>
      </div>
      <p v-if="matchedPreset" class="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        <template v-if="matchedPreset.keyUrl">
          用 {{ matchedPreset.label }} 需要先申请一串密钥（API Key）：<a
            :href="matchedPreset.keyUrl"
            target="_blank"
            rel="noreferrer"
            class="underline hover:text-seal"
            >去申请 ↗</a
          >，申请完粘到下面的 Key 框里就好。
        </template>
        <template v-else>
          本地模型不用 Key：模型名填你已经下载好的那个（例如
          qwen2.5:7b），并先在本机启动 Ollama。
        </template>
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block sm:col-span-2">
        <span class="mb-1 block text-xs font-medium text-ink-soft">服务网址</span>
        <input
          v-model="draft.baseUrl"
          type="text"
          class="field font-mono text-xs"
          placeholder="https://api.deepseek.com"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-soft">密钥（API Key）</span>
        <span class="flex items-center gap-2">
          <input
            v-model="draft.apiKey"
            :type="showKey ? 'text' : 'password'"
            class="field min-w-0 flex-1 font-mono text-xs"
            placeholder="sk-..."
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="link-btn" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </span>
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-soft">模型名</span>
        <input
          v-model="draft.model"
          type="text"
          class="field font-mono text-xs"
          placeholder="deepseek-chat"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <button type="button" class="btn-primary" :disabled="!canSubmit" @click="onSave">
        保存设置
      </button>
      <button
        type="button"
        class="btn-secondary"
        :disabled="!canSubmit || testing"
        @click="onTest"
      >
        {{ testing ? '测试中…' : '测试连接' }}
      </button>
      <span
        v-if="testResult"
        class="text-xs"
        :class="testResult.ok ? 'text-jade' : 'text-seal-deep'"
        role="status"
      >
        {{ testResult.ok ? '✓' : '✕' }} {{ testResult.message }}
      </span>
    </div>

    <p class="mt-3 text-xs leading-relaxed text-ink-faint">
      不知道怎么填？最简单的做法：在上面点一个常用服务，它会自动帮你填好网址和模型，你只要把申请到的
      Key 粘进去。请求会由本工具替你发出去，你不用做任何网络设置；用自己电脑上的
      Ollama，网址填 http://localhost:11434/v1（Ollama 要先启动，且本工具要在本机运行）。
      密钥（Key）只保存在你自己的浏览器里。
    </p>
    <p class="mt-2 text-xs text-ink-faint">
      <template v-if="stats.count === 0">尚无提炼记录 · 仅存本地，不上报</template>
      <template v-else>
        本机统计：提炼 {{ stats.count }} 次 · 成功 {{ stats.ok }} · 失败 {{ stats.fail }} ·
        平均耗时 {{ (averageMs(stats) / 1000).toFixed(1) }}s · 近 7 天 {{ recentCount(stats) }} 次 ·
        仅存本地，不上报
      </template>
    </p>

    <div class="mt-4 border-t border-ink/10 pt-4">
      <h3 class="font-display text-[13px] font-bold text-ink-soft">隐私与本地数据</h3>
      <p class="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        未保存的草稿 {{ privacyDraftSize }} · 已存版本 {{ privacyVersionLabel }} · 浏览器占用
        {{ privacyStorageLabel }}。所有内容只存在你自己的浏览器里，不会上传到任何服务器。
      </p>
      <div class="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" class="btn-mini" @click="onClearDraft">清空草稿</button>
        <button type="button" class="btn-mini" @click="onClearVersions">清空版本库</button>
        <button type="button" class="btn-mini" @click="onExportBackup">导出备份</button>
        <button type="button" class="btn-mini" @click="backupInput?.click()">导入备份</button>
        <input
          ref="backupInput"
          type="file"
          accept=".json"
          class="hidden"
          aria-label="选择备份文件"
          @change="onImportBackup"
        />
      </div>
      <p class="mt-2 text-[11px] text-ink-faint">备份文件里不含你的密钥，换台电脑导入即可恢复。</p>
    </div>
  </section>
</template>
