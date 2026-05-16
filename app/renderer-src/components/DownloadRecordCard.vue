<script setup lang="ts">
import { t } from '../i18n';
import type { DownloadRecord, DownloadState } from '../../types/jable';

defineProps<{
  record: DownloadRecord;
}>();

const emit = defineEmits<{
  open: [videoUrl: string];
}>();

function stateClass(state: DownloadState) {
  if (state === 'ready') return 'bg-[#1c4f2a] text-[#9df0a3]';
  if (state === 'failed' || state === 'missing') return 'bg-[#4f2a1c] text-[#f2b35d]';
  return 'bg-[var(--control)] text-[var(--muted)]';
}

function progressLabel(record: DownloadRecord) {
  if (record.state !== 'downloading' || record.progress === null) return '';
  return Math.round(record.progress * 100) + '%';
}
</script>

<template>
  <article
    class="grid grid-cols-[minmax(0,1fr)_max-content] gap-3 rounded-md border border-[var(--panel-border)] bg-[var(--card)] p-3 max-[680px]:grid-cols-1"
    data-test="download-record-card"
  >
    <div class="grid min-w-0 gap-1">
      <button
        type="button"
        class="min-w-0 justify-self-start border-0 bg-transparent p-0 text-left text-sm font-semibold text-[var(--text)] hover:underline disabled:cursor-default disabled:text-[var(--muted)] disabled:no-underline"
        :disabled="record.state !== 'ready'"
        @click="emit('open', record.videoUrl)"
      >
        {{ record.title || record.videoUrl }}
      </button>
      <p class="m-0 text-xs text-[var(--muted)]">
        {{ record.collectionKey ? t('collections.' + record.collectionKey) : t('downloadList.unknownCollection') }}
      </p>
      <code
        v-if="record.localPath"
        class="min-w-0 break-all rounded-md bg-[var(--control)] px-2 py-1 text-xs text-[var(--muted)]"
      >
        {{ record.localPath }}
      </code>
      <p v-if="record.error" class="m-0 text-xs leading-5 text-[#f2b35d]">
        {{ record.error }}
      </p>
    </div>

    <div class="flex items-start justify-end gap-2">
      <span class="rounded-full px-2 py-1 text-xs font-semibold" :class="stateClass(record.state)">
        {{ t('downloadList.state.' + record.state) }}
      </span>
      <span v-if="progressLabel(record)" class="py-1 text-xs text-[var(--muted)]">
        {{ progressLabel(record) }}
      </span>
    </div>
  </article>
</template>
