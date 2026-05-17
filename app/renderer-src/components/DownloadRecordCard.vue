<script setup lang="ts">
import { ref } from 'vue';
import {
  collectionList,
  isIndeterminateProgress,
  progressStyle,
  recordTimeLabel,
  secondaryInfoLabel as downloadSecondaryInfoLabel
} from '../download-display';
import { t } from '../i18n';
import type { CollectionKey, DownloadRecord, DownloadState } from '../../types/jable';

const props = defineProps<{
  record: DownloadRecord;
  selectable?: boolean;
  selected?: boolean;
}>();

const emit = defineEmits<{
  open: [videoUrl: string];
  'open-page': [videoUrl: string];
  reveal: [videoUrl: string];
  retry: [videoUrl: string];
  pause: [videoUrl: string];
  resume: [videoUrl: string];
  cancel: [videoUrl: string];
  delete: [videoUrl: string];
  'toggle-select': [payload: { videoUrl: string; selected: boolean }];
}>();

const previewVideo = ref<HTMLVideoElement | null>(null);

function stateClass(state: DownloadState) {
  if (state === 'ready') return 'bg-[#1c4f2a] text-[#9df0a3]';
  if (state === 'failed' || state === 'missing') return 'bg-[#4f2a1c] text-[#f2b35d]';
  if (state === 'downloading') return 'bg-[#20395f] text-[#9fc7ff]';
  if (state === 'paused') return 'bg-[#34333f] text-[#d1c4ff]';
  return 'bg-[var(--control)] text-[var(--muted)]';
}

function progressFillClass(state: DownloadState) {
  if (state === 'ready') return 'bg-[#78d17f]';
  if (state === 'failed' || state === 'missing') return 'bg-[#f2b35d]';
  if (state === 'downloading') return 'bg-[var(--accent)]';
  if (state === 'paused') return 'bg-[#8f7bd8]';
  return 'bg-[var(--muted)]';
}

function collectionLabel(collectionKey: CollectionKey) {
  return t('collections.' + collectionKey);
}

function collectionClass(collectionKey: CollectionKey) {
  if (collectionKey === 'favourites') return 'bg-[#303644] text-[#c6cfdd]';
  if (collectionKey === 'watch_later') return 'bg-[#2b3946] text-[#c5d8ea]';
  return 'bg-[var(--control)] text-[var(--muted)]';
}

function secondaryInfoLabel(record: DownloadRecord) {
  return downloadSecondaryInfoLabel(record, t);
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

function toggleSelected(event: Event) {
  emit('toggle-select', {
    videoUrl: props.record.videoUrl,
    selected: (event.target as HTMLInputElement).checked
  });
}
</script>

<template>
  <article
    class="relative grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--card)] p-2.5 shadow-[var(--shadow)]"
    data-test="download-record-card"
  >
    <label
      v-if="selectable"
      class="absolute top-4 left-4 z-10 grid h-7 w-7 place-items-center rounded-md border border-[var(--panel-border)] bg-[rgba(17,19,24,0.82)]"
      :title="t('downloadList.selectDownload')"
    >
      <input
        class="h-5 w-5"
        type="checkbox"
        data-test="download-record-select"
        :aria-label="t('downloadList.selectDownload')"
        :checked="selected"
        @change="toggleSelected"
      />
    </label>
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

    <div class="grid min-w-0 gap-2">
      <a
        class="h-[4.5rem] overflow-hidden rounded-none border-0 bg-transparent p-0 text-left text-lg font-bold leading-[1.3] text-[var(--text)] no-underline shadow-none outline-none [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] hover:text-[var(--accent)] focus-visible:text-[var(--accent)]"
        :class="record.state === 'ready' ? 'cursor-pointer' : 'cursor-default'"
        :href="record.videoUrl"
        :aria-disabled="record.state !== 'ready'"
        @click="openCardTarget($event, record)"
      >
        {{ record.title || record.videoUrl }}
      </a>

      <div class="grid gap-2">
        <div class="h-1.5 overflow-hidden rounded-full bg-[var(--panel-border)]" data-test="download-record-progress">
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

        <div class="grid min-h-7 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div class="flex min-w-0 gap-1.5 overflow-hidden">
            <span
              v-for="collectionKey in collectionList(record)"
              :key="collectionKey"
              class="rounded-md px-2 py-0.5 text-xs font-semibold"
              :class="collectionClass(collectionKey)"
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
          </div>
        </div>

        <div class="grid min-h-10 gap-0.5 text-xs leading-5 text-[var(--muted)]">
          <span
            class="min-h-5 min-w-0 truncate text-right"
            :class="record.state === 'failed' || record.state === 'missing' ? 'text-[#f2b35d]' : ''"
          >
            {{ secondaryInfoLabel(record) }}
          </span>
          <span class="min-h-5 min-w-0 truncate text-right tabular-nums">
            {{ recordTimeLabel(record) }}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2">
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
            v-if="record.state === 'paused'"
            type="button"
            class="min-h-8 w-full whitespace-nowrap px-2 py-1 text-xs"
            data-test="download-record-resume"
            @click="emit('resume', record.videoUrl)"
          >
            {{ t('downloadList.resume') }}
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
            class="min-h-8 w-full whitespace-nowrap px-2 py-1 text-xs"
            data-test="download-record-pause"
            @click="emit('pause', record.videoUrl)"
          >
            {{ t('downloadList.pause') }}
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
            v-if="
              record.state === 'ready' ||
              record.state === 'paused' ||
              record.state === 'failed' ||
              record.state === 'missing'
            "
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
  </article>
</template>
