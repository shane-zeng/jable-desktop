<script setup>
defineProps({
  busy: {
    type: Boolean,
    required: true
  },
  currentPage: {
    type: Number,
    required: true
  },
  totalPages: {
    type: Number,
    required: true
  },
  pageLabel: {
    type: String,
    required: true
  }
});

var emit = defineEmits(['prev', 'next']);
</script>

<template>
  <div
    class="flex min-h-12 items-center justify-center gap-3 border-t border-[var(--panel-border)] bg-[var(--panel)] px-3.5 py-2"
  >
    <button type="button" :disabled="busy || currentPage <= 1" @click="emit('prev')">上一頁</button>
    <span class="min-w-24 text-center text-[13px] text-[var(--muted)]">
      {{ pageLabel }}
    </span>
    <button type="button" :disabled="busy || currentPage >= totalPages" @click="emit('next')">下一頁</button>
  </div>
</template>
