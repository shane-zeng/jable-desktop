<script setup lang="ts">
import { ref, watch } from 'vue';
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

function resetPageInput() {
  pageInput.value = String(props.currentPage);
}

function commitPage() {
  const value = String(pageInput.value).trim();
  if (!value) {
    resetPageInput();
    return;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    resetPageInput();
    return;
  }

  const nextPage = Math.max(1, Math.min(props.totalPages, Math.trunc(parsed)));
  pageInput.value = String(nextPage);
  emit('page', nextPage);
}
</script>

<template>
  <div
    class="grid min-h-12 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-[var(--panel-border)] bg-[var(--panel)] px-3.5 py-2 max-[760px]:grid-cols-1"
  >
    <div></div>
    <div class="flex items-center justify-center gap-3">
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
    <form
      class="flex items-center justify-end gap-1.5 text-xs text-[var(--muted)] max-[760px]:justify-center"
      @submit.prevent="commitPage"
    >
      <span>{{ t('pagination.goTo') }}</span>
      <input
        v-model="pageInput"
        class="h-8 w-16 text-center text-[13px]"
        type="number"
        inputmode="numeric"
        min="1"
        step="1"
        :max="totalPages"
        :disabled="busy || totalPages <= 1"
        :aria-label="t('pagination.pageInput')"
        @keydown.esc="resetPageInput"
      />
      <span v-if="t('pagination.pageSuffix')">{{ t('pagination.pageSuffix') }}</span>
      <button class="h-8 min-h-8 px-2.5 text-[12px]" type="submit" :disabled="busy || totalPages <= 1">
        {{ t('pagination.go') }}
      </button>
    </form>
  </div>
</template>
