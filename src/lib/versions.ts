// 版本库：按岗位/公司保存多套提炼结果，IndexedDB 持久化（rhe-db / versions）
// 草稿仍存 localStorage（需要同步恢复渲染），大体量历史数据走 IDB

export interface SavedVersion {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  records: string
  rules: string
  jd: string
  style: string
  aiRaw: string
  /** 目标岗位标签（可选，用于按岗位筛选与对照）；旧存档无此字段，向后兼容 */
  role?: string
}

const DB_NAME = 'rhe-db'
const DB_VERSION = 1
const STORE = 'versions'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
    })
  } finally {
    db.close()
  }
}

function isSavedVersion(v: unknown): v is SavedVersion {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Partial<SavedVersion>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.records === 'string' &&
    typeof o.aiRaw === 'string'
  )
}

// 全部版本，按更新时间倒序
export async function listVersions(): Promise<SavedVersion[]> {
  try {
    const all = await withStore<SavedVersion[]>('readonly', (store) => store.getAll() as IDBRequest<SavedVersion[]>)
    return all.filter(isSavedVersion).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function saveVersion(version: SavedVersion): Promise<void> {
  await withStore('readwrite', (store) => store.put(version) as IDBRequest<IDBValidKey>)
}

export async function deleteVersion(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id) as IDBRequest<undefined>)
}

export async function clearVersions(): Promise<void> {
  await withStore('readwrite', (store) => store.clear() as IDBRequest<undefined>)
}

// 导入备份时批量写入（校验后逐条 put）
export async function importVersions(list: unknown): Promise<number> {
  if (!Array.isArray(list)) return 0
  let count = 0
  for (const item of list) {
    if (!isSavedVersion(item)) continue
    await saveVersion(item)
    count += 1
  }
  return count
}

// 浏览器存储占用估算（含 IndexedDB）；不支持时返回 null
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
