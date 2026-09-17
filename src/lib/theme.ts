// 主题偏好：亮 / 暗 / 跟随系统三态循环；偏好存 localStorage（rhe.theme）
// 兼容旧数据：缺省或非法值按「跟随系统」处理

export type ThemePref = 'light' | 'dark' | 'auto'

export const THEME_KEY = 'rhe.theme'

export function loadThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'auto' ? raw : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // 存储不可用时静默
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// 把偏好应用到 <html class="dark">
export function applyTheme(pref: ThemePref): void {
  if (typeof document === 'undefined') return
  const dark = pref === 'dark' || (pref === 'auto' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

export function effectiveTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'dark' || (pref === 'auto' && systemPrefersDark()) ? 'dark' : 'light'
}

// 三态循环：跟随系统 → 暗 → 亮 → 跟随系统
export function nextThemePref(pref: ThemePref): ThemePref {
  return pref === 'auto' ? 'dark' : pref === 'dark' ? 'light' : 'auto'
}
