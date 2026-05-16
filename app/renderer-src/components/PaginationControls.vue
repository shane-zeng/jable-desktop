<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '../i18n';

const props = defineProps<{
  busy: boolean;
  currentPage: number;
  totalPages: number;
  pageLabel: string;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
  page: [page: number];
}>();

const pageInput = ref<string | number>(String(props.currentPage));

watch([() => props.currentPage, () => props.totalPages], function () {
  pageInput.value = String(props.currentPage);
});

const targetPage = computed(function () {
  const value = String(pageInput.value).trim();
  if (!value) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return Math.max(1, Math.min(props.totalPages, Math.trunc(parsed)));
});

const hasPageChange = computed(function () {
  return targetPage.value !== null && targetPage.value !== props.currentPage;
});

function resetPageInput() {
  pageInput.value = String(props.currentPage);
}

function commitPage() {
  if (targetPage.value === null) {
    resetPageInput();
    return;
  }

  pageInput.value = String(targetPage.value);
  if (targetPage.value !== props.currentPage) emit('page', targetPage.value);
}

function triggerNextAction() {
  if (hasPageChange.value) {
    commitPage();
    return;
  }

  emit('next');
}
</script>

<template>
  <div
    class="flex min-h-12 items-center justify-center gap-3 border-t border-[var(--panel-border)] bg-[var(--panel)] px-3.5 py-2"
  >
    <button class="min-w-[86px]" type="button" :disabled="busy || currentPage <= 1" @click="emit('prev')">
      {{ t('pagination.prev') }}
    </button>
    <label
      class="flex min-w-32 items-center justify-center gap-1.5 text-center text-[13px] text-[var(--muted)]"
      :aria-label="pageLabel"
    >
      <span>{{ t('pagination.pagePrefix') }}</span>
      <input
        v-model="pageInput"
        class="h-8 w-14 text-center text-[13px] font-semibold text-[var(--text)]"
        data-test="pagination-page-input"
        type="number"
        inputmode="numeric"
        min="1"
        step="1"
        :max="totalPages"
        :disabled="busy"
        :aria-label="t('pagination.pageInput')"
        @keydown.enter.prevent="commitPage"
        @keydown.esc="resetPageInput"
      />
      <span>{{ t('pagination.pageTotal', { total: totalPages }) }}</span>
    </label>
    <button
      class="min-w-[86px]"
      data-test="pagination-action"
      type="button"
      :disabled="busy || (!hasPageChange && currentPage >= totalPages)"
      @click="triggerNextAction"
    >
      {{ hasPageChange ? t('pagination.go') : t('pagination.next') }}
    </button>
  </div>
</template>
