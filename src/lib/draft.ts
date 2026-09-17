// 草稿持久化：记录 / 规则 / AI 返回原文防抖写入 localStorage，刷新后恢复
import { notify } from './toast'

export interface DraftState {
  records: string
  rules: string
  rulesCustom: boolean
  aiRaw: string
  jd: string
  /** 表达风格预设 id（rules.ts STYLE_PRESETS），空为默认 */
  style: string
  /** 人群场景预设 id（rules.ts SCENARIO_PRESETS），空为不指定；旧草稿缺省兼容 */
  scenario: string
  /** 面试追问清单原文（随草稿保留，刷新不丢）；旧草稿缺省兼容 */
  interview: string
  /** 英文译文（可编辑态）与其翻译时的源文本（用于过期判断）；旧草稿缺省兼容 */
  translated: string
  translatedSource: string
}

export const DRAFT_KEY = 'rhe.draft.v1'

export function loadDraft(): DraftState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DraftState>
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const records = str(parsed.records)
    const rules = str(parsed.rules)
    const aiRaw = str(parsed.aiRaw)
    const jd = str(parsed.jd)
    if (records.trim() === '' && rules.trim() === '' && aiRaw.trim() === '' && jd.trim() === '') {
      return null
    }
    return {
      records,
      rules,
      rulesCustom: parsed.rulesCustom === true,
      aiRaw,
      jd,
      style: str(parsed.style),
      scenario: str(parsed.scenario),
      interview: str(parsed.interview),
      translated: str(parsed.translated),
      translatedSource: str(parsed.translatedSource),
    }
  } catch {
    return null
  }
}

// 配额超限只提示一次，写入恢复后重置，避免防抖期间 toast 刷屏
let quotaWarned = false

export function saveDraft(fields: DraftState): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(fields))
    quotaWarned = false
  } catch {
    if (!quotaWarned) {
      quotaWarned = true
      notify(
        'warn',
        '刚才的输入没能自动保存（浏览器存储空间不够）：可在设置里清理数据，或先导出备份再回来',
      )
    }
  }
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY)
}
