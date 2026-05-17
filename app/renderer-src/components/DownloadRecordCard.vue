<script setup lang="ts">
import { t } from '../i18n';
import type { CollectionKey, DownloadRecord, DownloadState } from '../../types/jable';

defineProps<{
  record: DownloadRecord;
}>();

const emit = defineEmits<{
  open: [videoUrl: string];
  'open-page': [videoUrl: string];
  reveal: [videoUrl: string];
  retry: [videoUrl: string];
  cancel: [videoUrl: string];
  delete: [videoUrl: string];
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

function bytesLabel(size: number) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex += 1;
  }

  const formatted =
    unitIndex === 0 || Number.isInteger(value) || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return formatted + ' ' + units[unitIndex];
}

function fileSizeLabel(record: DownloadRecord) {
  const size = bytesLabel(record.fileSizeBytes ?? -1);
  return size ? t('downloadList.fileSize', { size: size }) : '';
}

function downloadProgressDetailLabel(record: DownloadRecord) {
  if (record.state !== 'downloading') return '';

  const downloaded = bytesLabel(record.downloadedBytes ?? -1);
  const speed = bytesLabel(record.downloadSpeedBytesPerSecond ?? -1);
  const parts = [];

  if (downloaded) parts.push(t('downloadList.downloadedBytes', { size: downloaded }));
  if (speed) parts.push(t('downloadList.downloadSpeed', { speed: speed + '/s' }));

  return parts.join(' · ');
}

function formatTimestamp(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes;
}

function timestampLabel(record: DownloadRecord) {
  const completedAt = formatTimestamp(record.completedAt);
  if (record.state === 'ready' && completedAt) {
    return t('downloadList.completedAt', { time: completedAt });
  }

  const updatedAt = formatTimestamp(record.updatedAt);
  return updatedAt ? t('downloadList.updatedAt', { time: updatedAt }) : '';
}

function collectionLabel(collectionKey: CollectionKey) {
  return t('collections.' + collectionKey);
}

function collectionListLabel(record: DownloadRecord) {
  const keys = Array.isArray(record.collectionKeys) && record.collectionKeys.length ? record.collectionKeys : null;
  if (keys) return keys.map(collectionLabel).join(' / ');
  return '';
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
      <p v-if="collectionListLabel(record)" class="m-0 text-xs text-[var(--muted)]">
        {{ collectionListLabel(record) }}
      </p>
      <code
        v-if="record.localPath"
        class="min-w-0 break-all rounded-md bg-[var(--control)] px-2 py-1 text-xs text-[var(--muted)]"
      >
        {{ record.localPath }}
      </code>
      <p v-if="record.error" class="m-0 text-xs leading-5 text-[#f2b35d]">
        {{ t('downloadList.error', { error: record.error }) }}
      </p>
      <p v-if="fileSizeLabel(record)" class="m-0 text-xs text-[var(--muted)]">
        {{ fileSizeLabel(record) }}
      </p>
      <p v-if="timestampLabel(record)" class="m-0 text-xs text-[var(--muted)]">
        {{ timestampLabel(record) }}
      </p>
    </div>

    <div class="flex flex-wrap items-start justify-end gap-2">
      <span class="rounded-full px-2 py-1 text-xs font-semibold" :class="stateClass(record.state)">
        {{ t('downloadList.state.' + record.state) }}
      </span>
      <span v-if="progressLabel(record)" class="py-1 text-xs text-[var(--muted)]">
        {{ progressLabel(record) }}
      </span>
      <span v-if="downloadProgressDetailLabel(record)" class="py-1 text-xs text-[var(--muted)]">
        {{ downloadProgressDetailLabel(record) }}
      </span>
      <button
        type="button"
        class="min-h-7 px-2 py-1 text-xs"
        data-test="download-record-open-page"
        @click="emit('open-page', record.videoUrl)"
      >
        {{ t('downloadList.openPage') }}
      </button>
      <button
        v-if="record.state === 'ready'"
        type="button"
        class="min-h-7 px-2 py-1 text-xs"
        data-test="download-record-reveal"
        @click="emit('reveal', record.videoUrl)"
      >
        {{ t('downloadList.reveal') }}
      </button>
      <button
        v-if="record.state === 'failed' || record.state === 'missing'"
        type="button"
        class="min-h-7 px-2 py-1 text-xs"
        data-test="download-record-retry"
        @click="emit('retry', record.videoUrl)"
      >
        {{ t('downloadList.retry') }}
      </button>
      <button
        v-if="record.state === 'queued' || record.state === 'downloading'"
        type="button"
        class="danger min-h-7 px-2 py-1 text-xs"
        data-test="download-record-cancel"
        @click="emit('cancel', record.videoUrl)"
      >
        {{ t('downloadList.cancel') }}
      </button>
      <button
        v-if="record.state === 'ready' || record.state === 'failed' || record.state === 'missing'"
        type="button"
        class="danger min-h-7 px-2 py-1 text-xs"
        data-test="download-record-delete"
        @click="emit('delete', record.videoUrl)"
      >
        {{ t('downloadList.delete') }}
      </button>
    </div>
  </article>
</template>
