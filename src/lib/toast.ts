import { reactive } from 'vue'

/** 提示上的可选操作按钮（如「撤销」） */
export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  kind: 'ok' | 'warn' | 'err'
  text: string
  action?: ToastAction
}

const state = reactive<{ list: Toast[] }>({ list: [] })
let seq = 0

export function notify(
  kind: Toast['kind'],
  text: string,
  duration?: number,
  action?: ToastAction,
): void {
  const id = ++seq
  state.list.push({ id, kind, text, action })
  // 错误默认停留更久；带操作按钮的提示留足点击时间；可显式覆盖
  const ttl = duration ?? (action ? 6000 : kind === 'err' ? 5200 : 2800)
  window.setTimeout(() => dismiss(id), ttl)
}

export function dismiss(id: number): void {
  const index = state.list.findIndex((t) => t.id === id)
  if (index >= 0) state.list.splice(index, 1)
}

// 点击提示上的操作按钮：先收起提示再执行动作，避免动作内 notify 时两条并存
export function triggerAction(id: number): void {
  const toast = state.list.find((t) => t.id === id)
  dismiss(id)
  toast?.action?.run()
}

export function useToasts() {
  return state
}