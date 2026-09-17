<script setup lang="ts">
defineProps<{ open: boolean }>()
</script>

<template>
  <!-- grid-template-rows 0fr→1fr 过渡实现高度动画；inert 保证收起内容不可聚焦 -->
  <div class="fold" :class="open && 'fold-open'" :inert="!open" :aria-hidden="!open">
    <div class="fold-inner">
      <slot />
    </div>
  </div>
</template>
