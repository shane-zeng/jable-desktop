<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { isDownloadDeleteSelectable } from '../download-display';
import { t } from '../i18n';
import type { DownloadRecord } from '../../types/jable';

const props = withDefaults(
  defineProps<{
    busy: boolean;
    downloads: DownloadRecord[];
    downloadRecords?: DownloadRecord[];
    selectedDownloadUrls?: string[];
  }>(),
  {
    downloadRecords: function () {
      return [];
    },
    selectedDownloadUrls: function () {
      return [];
    }
  }
);

const emit = defineEmits<{
  'retry-failed-downloads': [];
  'pause-all-downloads': [];
  'resume-paused-downloads': [];
  'cancel-queued-downloads': [];
  'delete-selected-downloads': [];
}>();

const downloadQueueActionsRef = ref<HTMLDetailsElement | null>(null);
const downloadQueueActionsSummaryRef = ref<HTMLElement | null>(null);

const selectedDownloadUrlSet = computed(function () {
  return new Set(props.selectedDownloadUrls);
});

const downloadActionRecords = computed(function () {
  return props.downloadRecords.length ? props.downloadRecords : props.downloads;
});

const retryFailedDownloadCount = computed(function () {
  return downloadActionRecords.value.filter(function (record) {
    return record.state === 'failed' || record.state === 'missing';
  }).length;
});

const activeDownloadCount = computed(function () {
  return downloadActionRecords.value.filter(function (record) {
    return record.state === 'queued' || record.state === 'downloading';
  }).length;
});

const pausedDownloadCount = computed(function () {
  return downloadActionRecords.value.filter(function (record) {
    return record.state === 'paused';
  }).length;
});

const queuedDownloadCount = computed(function () {
  return downloadActionRecords.value.filter(function (record) {
    return record.state === 'queued';
  }).length;
});

const selectedDownloadCount = computed(function () {
  return props.downloads.filter(function (record) {
    return isDownloadDeleteSelectable(record) && selectedDownloadUrlSet.value.has(record.videoUrl);
  }).length;
});

function closeDownloadQueueActions() {
  if (downloadQueueActionsRef.value) downloadQueueActionsRef.value.open = false;
}

function closeDownloadQueueActionsWithFocus() {
  const queueActions = downloadQueueActionsRef.value;
  if (!queueActions || !queueActions.open) return;

  queueActions.open = false;
  downloadQueueActionsSummaryRef.value?.focus();
}

function closeDropdownOnOutsideClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;

  const queueActions = downloadQueueActionsRef.value;
  if (queueActions && queueActions.open && !queueActions.contains(target)) queueActions.open = false;
}

onMounted(function () {
  document.addEventListener('click', closeDropdownOnOutsideClick);
});

onBeforeUnmount(function () {
  document.removeEventListener('click', closeDropdownOnOutsideClick);
});
</script>

<template>
  <div class="flex min-w-0 flex-wrap justify-end gap-2 max-[900px]:justify-start">
    <button
      type="button"
      :disabled="busy || retryFailedDownloadCount === 0"
      data-test="download-retry-failed"
      @click="emit('retry-failed-downloads')"
    >
      {{ t('downloadList.retryFailed') }}
    </button>
    <details
      ref="downloadQueueActionsRef"
      class="relative"
      data-test="download-queue-actions"
      @keydown.esc.prevent.stop="closeDownloadQueueActionsWithFocus"
    >
      <summary
        ref="downloadQueueActionsSummaryRef"
        class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-[var(--control-border)] bg-[var(--control)] px-3 py-2 text-sm font-semibold text-[var(--text)] shadow-sm outline-none hover:border-[var(--accent)] hover:bg-[var(--control-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden"
      >
        <span>{{ t('downloadList.queueActions') }}</span>
        <span
          class="h-2 w-2 shrink-0 rotate-45 border-b border-r border-current text-[var(--muted)]"
          aria-hidden="true"
        ></span>
      </summary>
      <div
        class="absolute right-0 z-20 mt-2 grid min-w-52 gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--card)] p-2 shadow-[var(--shadow)]"
      >
        <button
          type="button"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left"
          :disabled="busy || activeDownloadCount === 0"
          data-test="download-pause-all"
          @click="
            closeDownloadQueueActions();
            emit('pause-all-downloads');
          "
        >
          <span>{{ t('downloadList.pauseAll') }}</span>
          <span class="tabular-nums text-[var(--muted)]">{{ activeDownloadCount }}</span>
        </button>
        <button
          type="button"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left"
          :disabled="busy || pausedDownloadCount === 0"
          data-test="download-resume-paused"
          @click="
            closeDownloadQueueActions();
            emit('resume-paused-downloads');
          "
        >
          <span>{{ t('downloadList.resumeAll') }}</span>
          <span class="tabular-nums text-[var(--muted)]">{{ pausedDownloadCount }}</span>
        </button>
        <button
          type="button"
          class="danger grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left"
          :disabled="busy || queuedDownloadCount === 0"
          data-test="download-cancel-queued"
          @click="
            closeDownloadQueueActions();
            emit('cancel-queued-downloads');
          "
        >
          <span>{{ t('downloadList.cancelQueued') }}</span>
          <span class="tabular-nums text-[var(--muted)]">{{ queuedDownloadCount }}</span>
        </button>
      </div>
    </details>
    <button
      type="button"
      class="danger"
      :disabled="busy || selectedDownloadCount === 0"
      data-test="download-delete-selected"
      @click="emit('delete-selected-downloads')"
    >
      {{ t('downloadList.deleteSelected') }}
    </button>
  </div>
</template>
