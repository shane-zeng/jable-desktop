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
const showErrorDetails = ref(false);

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
    return Math.max(2, Math.round(Math.min(1, Math.max(0, record.progress)) * 100));
  }
  return 0;
}

function progressStyle(record: DownloadRecord) {
  return { width: progressPercent(record) + '%' };
}

function isIndeterminateProgress(record: DownloadRecord) {
  return record.state === 'downloading' && typeof record.progress !== 'number';
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

function formatTimeLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
}

function collectionLabel(collectionKey: CollectionKey) {
  return t('collections.' + collectionKey);
}

function collectionList(record: DownloadRecord) {
  return Array.isArray(record.collectionKeys) ? record.collectionKeys : [];
}

function fileSizeValueLabel(record: DownloadRecord) {
  return bytesLabel(record.fileSizeBytes ?? -1);
}

function downloadProgressDetailLabel(record: DownloadRecord) {
  if (record.state !== 'downloading') return '';

  const downloaded = bytesLabel(record.downloadedBytes ?? -1);
  const speed = bytesLabel(record.downloadSpeedBytesPerSecond ?? -1);
  const parts = [];

  if (downloaded) parts.push(downloaded);
  if (speed) parts.push(speed + '/s');
  if (!parts.length && progressLabel(record)) parts.push(progressLabel(record));

  return parts.join(' · ');
}

function secondaryInfoLabel(record: DownloadRecord) {
  if (record.state === 'downloading') return downloadProgressDetailLabel(record);
  if (record.state === 'ready') return fileSizeValueLabel(record);
  return '';
}

function recordTimeLabel(record: DownloadRecord) {
  if (record.state === 'ready') return formatTimeLabel(record.completedAt || record.updatedAt);
  return formatTimeLabel(record.updatedAt);
}

function hasErrorDetails(record: DownloadRecord) {
  return (record.state === 'failed' || record.state === 'missing') && Boolean(record.error);
}

function readableErrorMessage(error: string | null) {
  const text = (error || '').trim();
  if (!text) return t('downloadList.errorReason.generic');

  if (/取消|cancel/i.test(text)) return t('downloadList.errorReason.cancelled');
  if (/http\s*(401|403|428|429)|precondition|required|forbidden|unauthorized|too many requests/i.test(text)) {
    return t('downloadList.errorReason.accessRejected');
  }
  if (/enoent|no such file|file removed|not found|找不到|遺失/i.test(text)) {
    return t('downloadList.errorReason.missingFile');
  }
  if (/ffmpeg|muxer|output format|invalid argument|remux/i.test(text)) {
    return t('downloadList.errorReason.ffmpeg');
  }
  if (/m3u8|playlist|hls|segment/i.test(text)) {
    return t('downloadList.errorReason.playlist');
  }
  if (/network|timeout|timed out|econn|dns|socket|connection/i.test(text)) {
    return t('downloadList.errorReason.network');
  }

  return text;
}

function technicalErrorDetails(error: string | null) {
  const text = (error || '').trim();
  if (!text || readableErrorMessage(text) === text) return '';
  if (/取消|cancel/i.test(text)) return '';
  if (text.length < 80 && !/ffmpeg|avformat|muxer|remux|invalid argument/i.test(text)) return '';
  return text;
}

function openCardTarget(event: MouseEvent, record: DownloadRecord) {
  event.preventDefault();
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
    <a
      class="relative aspect-[16/10] w-full overflow-hidden rounded-md bg-[var(--thumb-bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      :class="record.state === 'ready' ? 'cursor-pointer' : 'cursor-default'"
      :href="record.videoUrl"
      :aria-disabled="record.state !== 'ready'"
      @click="openCardTarget($event, record)"
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
    </a>

    <div class="flex min-h-[140px] min-w-0 flex-col gap-2">
      <a
        class="min-h-[3.9em] overflow-hidden rounded-none border-0 bg-transparent p-0 text-left text-lg font-bold leading-[1.3] text-[var(--text)] no-underline shadow-none outline-none [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] hover:text-[var(--accent)] focus-visible:text-[var(--accent)]"
        :class="record.state === 'ready' ? 'cursor-pointer' : 'cursor-default'"
        :href="record.videoUrl"
        :aria-disabled="record.state !== 'ready'"
        @click="openCardTarget($event, record)"
      >
        {{ record.title || record.videoUrl }}
      </a>

      <div class="mt-auto grid gap-2 pt-2">
        <div class="h-1.5 overflow-hidden rounded-full bg-[var(--control)]" data-test="download-record-progress">
          <div
            v-if="isIndeterminateProgress(record)"
            class="download-progress-indeterminate h-full rounded-full"
            :class="progressFillClass(record.state)"
          ></div>
          <div
            v-else
            class="h-full rounded-full transition-[width] duration-300"
            :class="progressFillClass(record.state)"
            :style="progressStyle(record)"
          ></div>
        </div>

        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div class="flex min-w-0 flex-wrap gap-1.5">
            <span
              v-for="collectionKey in collectionList(record)"
              :key="collectionKey"
              class="rounded-md bg-[var(--control)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]"
            >
              {{ collectionLabel(collectionKey) }}
            </span>
          </div>

          <div class="flex min-w-0 items-center justify-end gap-1.5">
            <span
              class="shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold"
              :class="stateClass(record.state)"
            >
              {{ t('downloadList.state.' + record.state) }}
            </span>
            <button
              v-if="hasErrorDetails(record)"
              type="button"
              class="grid h-6 min-h-0 w-6 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-[#f2b35d] outline-none hover:bg-[#4f2a1c] focus:outline-none"
              data-test="download-record-error-details"
              :aria-label="t('downloadList.errorDetails')"
              @click="showErrorDetails = true"
            >
              <svg
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v3.75m-9.3 3.38c-.87 1.5.22 3.37 1.95 3.37h14.7c1.73 0 2.82-1.87 1.95-3.37L13.95 3.38c-.87-1.5-3.03-1.5-3.9 0L2.7 16.13ZM12 15.75h.01v.01H12v-.01Z"
                />
              </svg>
            </button>
          </div>
        </div>

        <div class="grid min-h-5 grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs leading-5 text-[var(--muted)]">
          <span class="min-w-0 truncate">
            {{ secondaryInfoLabel(record) }}
          </span>
          <span class="shrink-0 tabular-nums">
            {{ recordTimeLabel(record) }}
          </span>
        </div>

        <div
          class="grid gap-2"
          :class="record.state === 'queued' || record.state === 'downloading' ? 'grid-cols-2' : 'grid-cols-3'"
        >
          <button
            type="button"
            class="min-h-8 w-full whitespace-nowrap px-2 py-1 text-xs"
            data-test="download-record-open-page"
            :title="t('downloadList.openPage')"
            @click="emit('open-page', record.videoUrl)"
          >
            {{ t('downloadList.openPageShort') }}
          </button>
          <button
            v-if="record.state === 'ready'"
            type="button"
            class="min-h-8 w-full whitespace-nowrap px-2 py-1 text-xs"
            data-test="download-record-reveal"
            :title="t('downloadList.reveal')"
            @click="emit('reveal', record.videoUrl)"
          >
            {{ t('downloadList.revealShort') }}
          </button>
          <button
            v-if="record.state === 'failed' || record.state === 'missing'"
            type="button"
            class="min-h-8 w-full whitespace-nowrap px-2 py-1 text-xs"
            data-test="download-record-retry"
            @click="emit('retry', record.videoUrl)"
          >
            {{ t('downloadList.retry') }}
          </button>
          <button
            v-if="record.state === 'queued' || record.state === 'downloading'"
            type="button"
            class="danger min-h-8 w-full whitespace-nowrap px-2 py-1 text-xs"
            data-test="download-record-cancel"
            @click="emit('cancel', record.videoUrl)"
          >
            {{ t('downloadList.cancel') }}
          </button>
          <button
            v-if="record.state === 'ready' || record.state === 'failed' || record.state === 'missing'"
            type="button"
            class="danger min-h-8 w-full whitespace-nowrap px-2 py-1 text-xs"
            data-test="download-record-delete"
            @click="emit('delete', record.videoUrl)"
          >
            {{ t('downloadList.delete') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showErrorDetails && hasErrorDetails(record)"
      class="app-modal-backdrop"
      data-test="download-record-error-modal"
      @click.self="showErrorDetails = false"
    >
      <section class="app-modal max-w-[520px] gap-3 p-4" role="dialog" aria-modal="true">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="m-0 flex items-center gap-2 text-base font-bold text-[var(--text)]">
              <svg
                class="h-5 w-5 shrink-0 text-[#f2b35d]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v3.75m-9.3 3.38c-.87 1.5.22 3.37 1.95 3.37h14.7c1.73 0 2.82-1.87 1.95-3.37L13.95 3.38c-.87-1.5-3.03-1.5-3.9 0L2.7 16.13ZM12 15.75h.01v.01H12v-.01Z"
                />
              </svg>
              {{ t('downloadList.errorDetails') }}
            </h2>
            <p class="m-0 mt-1 truncate text-xs text-[var(--muted)]">
              {{ record.title || record.videoUrl }}
            </p>
          </div>
          <button
            type="button"
            class="grid h-8 min-h-0 w-8 place-items-center border-0 bg-transparent p-0 text-xl leading-none text-[var(--muted)] hover:bg-[var(--control-hover)] hover:text-[var(--text)]"
            data-test="download-record-error-close"
            :aria-label="t('downloadList.closeErrorDetails')"
            @click="showErrorDetails = false"
          >
            <svg
              class="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p class="m-0 rounded-md border border-[#9b6230] bg-[#4f2a1c] px-3 py-2 text-sm leading-6 text-[#f7d49d]">
          {{ readableErrorMessage(record.error) }}
        </p>

        <div v-if="technicalErrorDetails(record.error)" class="text-xs text-[var(--muted)]">
          <p class="m-0 font-semibold text-[var(--text)]">
            {{ t('downloadList.technicalDetails') }}
          </p>
          <p class="m-0 mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--control)] p-2">
            {{ technicalErrorDetails(record.error) }}
          </p>
        </div>
      </section>
    </div>
  </article>
</template>
