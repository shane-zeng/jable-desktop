<script setup lang="ts">
import { ref } from 'vue';
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

const previewVideo = ref<HTMLVideoElement | null>(null);

function stateClass(state: DownloadState) {
  if (state === 'ready') return 'bg-[#1c4f2a] text-[#9df0a3]';
  if (state === 'failed' || state === 'missing') return 'bg-[#4f2a1c] text-[#f2b35d]';
  if (state === 'downloading') return 'bg-[#20395f] text-[#9fc7ff]';
  return 'bg-[var(--control)] text-[var(--muted)]';
}

function progressFillClass(state: DownloadState) {
  if (state === 'ready') return 'bg-[#78d17f]';
  if (state === 'failed' || state === 'missing') return 'bg-[#f2b35d]';
  if (state === 'downloading') return 'bg-[var(--accent)]';
  return 'bg-[var(--muted)]';
}

function progressPercent(record: DownloadRecord) {
  if (record.state === 'ready') return 100;
  if (record.state === 'failed' || record.state === 'missing') return 100;
  if (record.state === 'downloading' && typeof record.progress === 'number') {
    return Math.round(Math.min(1, Math.max(0, record.progress)) * 100);
  }
  return 0;
}

function progressStyle(record: DownloadRecord) {
  return { width: progressPercent(record) + '%' };
}

function progressLabel(record: DownloadRecord) {
  if (record.state !== 'downloading' || typeof record.progress !== 'number') return '';
  return Math.round(Math.min(1, Math.max(0, record.progress)) * 100) + '%';
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

function collectionList(record: DownloadRecord) {
  return Array.isArray(record.collectionKeys) ? record.collectionKeys : [];
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
  if (!parts.length && progressLabel(record)) parts.push(progressLabel(record));

  return parts.join(' · ');
}

function secondaryInfoLabel(record: DownloadRecord) {
  if (record.state === 'downloading') return downloadProgressDetailLabel(record);
  if (record.state === 'ready') return fileSizeLabel(record) || timestampLabel(record);
  if (record.state === 'failed' || record.state === 'missing') {
    return record.error ? t('downloadList.error', { error: record.error }) : timestampLabel(record);
  }
  return timestampLabel(record);
}

function extraTimestampLabel(record: DownloadRecord) {
  if (record.state === 'ready' && fileSizeLabel(record)) return timestampLabel(record);
  if ((record.state === 'failed' || record.state === 'missing') && record.error) return timestampLabel(record);
  return '';
}

function openReadyRecord(record: DownloadRecord) {
  if (record.state !== 'ready') return;
  emit('open', record.videoUrl);
}

function startPreview(record: DownloadRecord) {
  if (!record.preview || !previewVideo.value) return;

  if (!previewVideo.value.getAttribute('src')) {
    previewVideo.value.setAttribute('src', record.preview);
  }

  previewVideo.value.classList.add('active');

  const play = previewVideo.value.play();
  if (play && typeof play.catch === 'function') {
    play.catch(function () {});
  }
}

function stopPreview() {
  if (!previewVideo.value) return;

  previewVideo.value.classList.remove('active');
  previewVideo.value.pause();

  try {
    previewVideo.value.currentTime = 0;
  } catch (error) {}
}
</script>

<template>
  <article
    class="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--card)] p-2.5 shadow-[var(--shadow)]"
    data-test="download-record-card"
  >
    <button
      type="button"
      class="relative aspect-[16/10] w-full overflow-hidden rounded-md border-0 bg-[var(--thumb-bg)] p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-default"
      :class="record.state === 'ready' ? 'cursor-pointer' : 'cursor-default'"
      :aria-disabled="record.state !== 'ready'"
      @click="openReadyRecord(record)"
      @pointerenter="startPreview(record)"
      @pointerleave="stopPreview"
    >
      <img
        v-if="record.img"
        class="absolute inset-0 h-full w-full object-cover"
        :src="record.img"
        alt=""
        draggable="false"
      />
      <div v-else class="absolute inset-0 bg-[var(--thumb-bg)]"></div>
      <video
        v-if="record.preview"
        ref="previewVideo"
        class="thumb-preview absolute inset-0 h-full w-full bg-[var(--thumb-bg)] object-cover"
        muted
        loop
        playsinline
        preload="none"
        aria-hidden="true"
      ></video>
    </button>

    <div class="flex min-h-[156px] min-w-0 flex-col gap-2">
      <button
        type="button"
        class="min-h-[3.9em] overflow-hidden border-0 bg-transparent p-0 text-left text-lg font-bold leading-[1.3] text-[var(--text)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] hover:text-[var(--accent)] disabled:cursor-default disabled:hover:text-[var(--text)]"
        :disabled="record.state !== 'ready'"
        @click="emit('open', record.videoUrl)"
      >
        {{ record.title || record.videoUrl }}
      </button>

      <div v-if="collectionList(record).length" class="flex flex-wrap gap-1.5">
        <span
          v-for="collectionKey in collectionList(record)"
          :key="collectionKey"
          class="rounded-md bg-[var(--control)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]"
        >
          {{ collectionLabel(collectionKey) }}
        </span>
      </div>

      <div class="mt-auto border-t border-[var(--panel-border)] pt-2">
        <div class="h-1.5 overflow-hidden rounded-full bg-[var(--control)]" data-test="download-record-progress">
          <div
            class="h-full rounded-full transition-[width] duration-300"
            :class="progressFillClass(record.state)"
            :style="progressStyle(record)"
          ></div>
        </div>

        <div class="mt-2 flex min-w-0 items-center justify-between gap-2 text-xs leading-[1.4] text-[var(--muted)]">
          <span class="rounded-full px-2 py-1 text-xs font-semibold" :class="stateClass(record.state)">
            {{ t('downloadList.state.' + record.state) }}
          </span>
          <span class="min-w-0 truncate text-right">
            {{ secondaryInfoLabel(record) }}
          </span>
        </div>

        <p v-if="extraTimestampLabel(record)" class="m-0 mt-1 truncate text-xs text-[var(--muted)]">
          {{ extraTimestampLabel(record) }}
        </p>

        <div class="mt-2 flex flex-wrap justify-end gap-2">
          <button
            v-if="record.state === 'ready'"
            type="button"
            class="min-h-7 px-2 py-1 text-xs"
            data-test="download-record-open"
            @click="emit('open', record.videoUrl)"
          >
            {{ t('downloadList.open') }}
          </button>
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
      </div>
    </div>
  </article>
</template>
