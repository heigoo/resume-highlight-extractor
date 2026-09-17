<script setup lang="ts">
import { dismiss, triggerAction, useToasts } from '../lib/toast'

const { list } = useToasts()
</script>

<template>
  <!-- 手机 / 平板：抬高到悬浮主按钮之上，避免遮挡「一键提炼」；宽屏回到常规底部 -->
  <!-- 整条提示不接收点击（含出现/消失动画期间）：否则它会静默吞掉落在其上的点击，
       造成「按钮点了没反应」；只有提示上的操作按钮可点 -->
  <div
    class="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-5"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup name="toast">
      <div
        v-for="toast in list"
        :key="toast.id"
        class="pointer-events-none flex max-w-full items-start gap-2.5 rounded-lg bg-ink px-4 py-2.5 text-left text-sm text-paper shadow-xl shadow-black/25 sm:items-center"
      >
        <span
          class="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full sm:mt-0"
          :class="toast.kind === 'ok' ? 'bg-jade' : toast.kind === 'warn' ? 'bg-marker' : 'bg-seal'"
          aria-hidden="true"
        />
        <span class="line-clamp-3 min-w-0 sm:line-clamp-2">{{ toast.text }}</span>
        <button
          v-if="toast.action"
          type="button"
          class="pointer-events-auto shrink-0 rounded border border-paper/40 px-2 py-0.5 text-xs font-medium transition hover:bg-paper/15"
          @click="triggerAction(toast.id)"
        >
          {{ toast.action.label }}
        </button>
        <button
          type="button"
          class="pointer-events-auto shrink-0 rounded px-1 text-xs text-paper/60 transition hover:text-paper"
          aria-label="关闭提示"
          @click="dismiss(toast.id)"
        >
          ✕
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}
</style>