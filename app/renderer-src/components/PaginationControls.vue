<script setup lang="ts">
import { t } from '../i18n';

defineProps<{
  busy: boolean;
  currentPage: number;
  totalPages: number;
  pageLabel: string;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
}>();
</script>

<template>
  <div
    class="flex min-h-12 items-center justify-center gap-3 border-t border-[var(--panel-border)] bg-[var(--panel)] px-3.5 py-2"
  >
    <button type="button" :disabled="busy || currentPage <= 1" @click="emit('prev')">
      {{ t('pagination.prev') }}
    </button>
    <span class="min-w-24 text-center text-[13px] text-[var(--muted)]">
      {{ pageLabel }}
    </span>
    <button type="button" :disabled="busy || currentPage >= totalPages" @click="emit('next')">
      {{ t('pagination.next') }}
    </button>
  </div>
</template>
