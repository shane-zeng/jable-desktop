<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../i18n';
import type { DownloadRecord } from '../../types/jable';

defineProps<{
  records: DownloadRecord[];
  shown: number;
  total: number;
  canShowAll: boolean;
  showAll: boolean;
  previewLimit: number;
  errorSummaryLabel: (record: DownloadRecord) => string;
  failurePhaseLabel: (record: DownloadRecord) => string;
  optionalDetail: (value: string | number | null | undefined) => string;
}>();

const emit = defineEmits<{
  close: [];
  'toggle-show-all': [];
}>();

const modalRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
let previouslyFocusedElement: HTMLElement | null = null;

function focusableElements() {
  if (!modalRef.value) return [];

  return Array.from(
    modalRef.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(function (element) {
    return element.tabIndex >= 0;
  });
}

function focusInitialElement() {
  const target = closeButtonRef.value || focusableElements()[0] || modalRef.value;
  target?.focus();
}

function handleModalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;

  const focusable = focusableElements();
  if (!focusable.length) {
    event.preventDefault();
    modalRef.value?.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(function () {
  previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  void nextTick(focusInitialElement);
});

onBeforeUnmount(function () {
  if (previouslyFocusedElement?.isConnected) {
    previouslyFocusedElement.focus();
  }
});
</script>

<template>
  <div class="app-modal-backdrop" role="presentation" @click.self="emit('close')">
    <section
      ref="modalRef"
      class="app-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('downloadList.errorLogTitle')"
      tabindex="-1"
      data-test="download-error-log-modal"
      @keydown="handleModalKeydown"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-base font-bold">{{ t('downloadList.errorLogTitle') }}</h2>
        <button
          ref="closeButtonRef"
          type="button"
          class="app-toast-close"
          :aria-label="t('downloadList.errorLogClose')"
          data-test="download-error-log-close"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
      <div v-if="!records.length" class="text-sm text-[var(--muted)]">
        {{ t('downloadList.errorLogEmpty') }}
      </div>
      <div v-else class="grid gap-3">
        <div
          class="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]"
          data-test="download-error-log-summary"
        >
          <span>
            {{
              t('downloadList.errorLogShowing', {
                shown: shown,
                total: total
              })
            }}
          </span>
          <button
            v-if="canShowAll"
            type="button"
            class="min-h-0 px-2 py-1 text-xs"
            data-test="download-error-log-show-all"
            @click="emit('toggle-show-all')"
          >
            {{
              showAll
                ? t('downloadList.errorLogShowRecent', { count: previewLimit })
                : t('downloadList.errorLogShowAll')
            }}
          </button>
        </div>
        <div class="grid max-h-[520px] gap-3 overflow-auto pr-1">
          <article
            v-for="record in records"
            :key="record.videoUrl"
            class="grid gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--card)] p-3 text-xs leading-5"
            data-test="download-error-log-row"
          >
            <h3 class="text-sm font-semibold text-[var(--text)]">{{ record.title || record.videoUrl }}</h3>
            <p class="m-0 break-all text-[var(--muted)]">{{ record.videoUrl }}</p>
            <p class="m-0 text-[var(--muted)]">
              {{ t('downloadList.errorLogState', { state: t('downloadList.state.' + record.state) }) }}
            </p>
            <p class="intent-text-warning m-0">{{ errorSummaryLabel(record) }}</p>
            <p class="m-0 text-[var(--muted)]">
              {{ t('downloadList.failurePhase', { phase: failurePhaseLabel(record) }) }}
            </p>
            <p class="m-0 text-[var(--muted)]">
              {{ t('downloadList.failureCode', { code: optionalDetail(record.failureCode) }) }}
            </p>
            <p class="m-0 text-[var(--muted)]">
              {{ t('downloadList.attemptCount', { count: record.attemptCount || 0 }) }}
            </p>
            <p class="m-0 text-[var(--muted)]">
              {{ t('downloadList.lastStartedAt', { time: optionalDetail(record.lastStartedAt) }) }}
            </p>
            <p class="m-0 text-[var(--muted)]">
              {{ t('downloadList.lastErrorAt', { time: optionalDetail(record.lastErrorAt) }) }}
            </p>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>
