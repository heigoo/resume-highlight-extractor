<script setup lang="ts">
// 应用内精简版说明书：完整版见仓库根目录《使用说明书.md》。
// 弹层本身只负责展示；Esc / 遮罩关闭在父组件与本地 click.self 处理。
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-settings'): void
}>()
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
    role="dialog"
    aria-modal="true"
    aria-label="使用说明"
    @click.self="emit('close')"
  >
    <div class="panel max-h-[85vh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="seal-chip seal-sm seal-soft font-display" aria-hidden="true">引</span>
          <h2 class="font-display text-[15px] font-bold text-ink">使用说明</h2>
          <span class="text-[11px] text-ink-faint">精简版 · 完整版见项目里的《使用说明书》</span>
        </div>
        <button type="button" class="link-btn" @click="emit('close')">关闭（Esc）</button>
      </header>

      <div class="mt-4">
        <h3 class="font-display text-[13px] font-bold text-ink-soft">三步上手</h3>
        <ol class="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-soft">
          <li>
            <b class="text-ink">① 粘贴记录</b>：git 日志 / 日报 / 待办直接粘进左栏「原始记录」；也可点「导入文件」（PDF / Word / 文本文件，只在你自己的浏览器里解析）。
          </li>
          <li>
            <b class="text-ink">② 选规则、填 JD（可选）</b>：已经默认选好一套岗位规则，直接提炼就行；粘贴目标岗位 JD 还能看匹配度和缺哪些关键词。
          </li>
          <li>
            <b class="text-ink">③ 点「一键提炼」</b>：结果实时出现在右栏 → 打磨 → 核查 → 导出进简历。记录框内按 Ctrl + Enter 同效。
          </li>
        </ol>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-jade/30 bg-jade/5 px-3 py-2">
          <p class="min-w-0 text-xs leading-relaxed text-ink-soft">
            首次使用先连接 AI：选一家常用的 AI 服务（DeepSeek / Kimi / SiliconFlow，或用自己电脑上的 Ollama）→
            粘贴你申请到的密钥 → 点「测试连接」。
            <b class="text-ink">密钥只存在你自己的浏览器里</b>。
          </p>
          <button type="button" class="btn-mini shrink-0" @click="emit('open-settings')">去连接 AI</button>
        </div>
      </div>

      <div class="mt-4">
        <h3 class="font-display text-[13px] font-bold text-ink-soft">提炼后怎么打磨</h3>
        <ul class="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-soft">
          <li>
            <b class="text-ink">评分</b>：点结果区「评分」展开扣分明细与改法（弱动词 / 待补数据 / 无出处 / 缺数字 / 日期断档 / JD 未覆盖），点条目数可定位到对应行。
          </li>
          <li>
            <b class="text-ink">JD 缺口</b>：缺的关键词可以让 AI 再补一版素材；记录里确实没有的，它会明说，不编造。
          </li>
          <li>
            <b class="text-ink">条目操作</b>：勾选决定导出范围；可编辑 / 换个说法 / 追问细节 / 删除 / 上下移；Ctrl + Z 撤销。
          </li>
          <li>
            <b class="text-ink">导出前核查</b>：数字、职责、出处逐项过一遍；出处行号对不上时，可以一键「改用建议出处」。
          </li>
        </ul>
      </div>

      <div class="mt-4">
        <h3 class="font-display text-[13px] font-bold text-ink-soft">导出方式（只含勾选条目）</h3>
        <p class="mt-2 text-xs leading-relaxed text-ink-soft">
          一键复制（纯文字）· 复制带格式（粘进 Word 不丢格式）· 下载文本文件 / Word（可选机器初筛友好版式）· 打印 / 存 PDF ·
          整页简历（排成一页 A4）· 译成英文。网申建议用纯文字版，别用表格和分栏。
        </p>
      </div>

      <div class="mt-4">
        <h3 class="font-display text-[13px] font-bold text-ink-soft">不想配 AI，或连不上？走备用路径</h3>
        <p class="mt-2 text-xs leading-relaxed text-ink-soft">
          左栏底部「备用」区：① 生成指令并复制 → ② 发给任意 AI（网页版、手机 App 都行）→ ③ 把回复整段粘回来，点「格式化并检查」。
          后续打磨 / 核查 / 导出与一键提炼完全一致；没现成回复可先点「填入示例结果」体验。
        </p>
      </div>

      <div class="mt-4 border-t border-ink/10 pt-3">
        <p class="text-[11px] leading-relaxed text-ink-faint">
          数据只在你浏览器里：记录、结果、密钥、存档都不会上传；只有点 AI 按钮时，才会把当次需要的内容发给你设置好的 AI 服务。
          设置里可以导出备份（不含密钥）或清空本地数据。
        </p>
        <p class="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          快捷键：Ctrl + Enter 快速提炼（记录框内）· Ctrl + Z 撤销结果改动 · Esc 关闭本说明。
        </p>
      </div>
    </div>
  </div>
</template>