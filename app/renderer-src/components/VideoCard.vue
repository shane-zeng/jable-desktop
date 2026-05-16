<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '../i18n';
import type { DownloadRecord, LibraryVideoMenuPayload, VideoRow } from '../../types/jable';

const props = defineProps<{
  video: VideoRow;
  downloadRecord?: DownloadRecord | null;
}>();

const emit = defineEmits<{
  open: [url: string];
  'open-new': [url: string];
  download: [video: VideoRow];
  'context-menu': [payload: LibraryVideoMenuPayload];
}>();
const i18n = useI18n();
const previewVideo = ref<HTMLVideoElement | null>(null);

const downloadButtonLabel = computed(function () {
  const state = props.downloadRecord && props.downloadRecord.state;
  if (state === 'queued') return i18n.t('video.downloadQueued');
  if (state === 'downloading') return i18n.t('video.downloadDownloading');
  if (state === 'ready') return i18n.t('video.downloadReady');
  if (state === 'failed' || state === 'missing') return i18n.t('video.downloadRetry');
  return i18n.t('video.download');
});

const downloadButtonDisabled = computed(function () {
  const state = props.downloadRecord && props.downloadRecord.state;
  return state === 'queued' || state === 'downloading' || state === 'ready';
});

function formatNumber(value: number | null | undefined) {
  if (value === null || typeof value === 'undefined') return '-';
  return Number(value).toLocaleString(i18n.locale.value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleString(i18n.locale.value);
  } catch (error) {
    return value;
  }
}

function startPreview() {
  if (!props.video.preview || !previewVideo.value) return;

  if (!previewVideo.value.getAttribute('src')) {
    previewVideo.value.setAttribute('src', props.video.preview);
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

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(window.navigator.platform || '');
}

function openVideo(event: MouseEvent) {
  event.preventDefault();

  const macPlatform = isMacPlatform();

  if (event.metaKey || (!macPlatform && event.ctrlKey)) {
    emit('open-new', props.video.url);
    return;
  }

  if (macPlatform && event.ctrlKey) return;

  emit('open', props.video.url);
}

function openVideoAux(event: MouseEvent) {
  if (event.button !== 1) return;

  event.preventDefault();
  emit('open-new', props.video.url);
}

function openVideoMenu(event: MouseEvent) {
  event.preventDefault();
  emit('context-menu', {
    url: props.video.url,
    title: props.video.title || props.video.url,
    x: event.clientX,
    y: event.clientY
  });
}

function downloadVideo(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (downloadButtonDisabled.value) return;
  emit('download', props.video);
}
</script>

<template>
  <article
    class="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--card)] p-2.5 shadow-[var(--shadow)]"
    @contextmenu="openVideoMenu"
  >
    <a
      class="relative aspect-[16/10] w-full overflow-hidden rounded-md bg-[var(--thumb-bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      :href="video.url"
      :aria-label="i18n.t('video.open', { target: video.title || video.url })"
      data-test="video-thumb-link"
      @click="openVideo"
      @auxclick="openVideoAux"
      @pointerenter="startPreview"
      @pointerleave="stopPreview"
    >
      <img
        v-if="video.img"
        class="absolute inset-0 h-full w-full object-cover"
        :src="video.img"
        alt=""
        draggable="false"
      />
      <div v-else class="absolute inset-0 bg-[var(--thumb-bg)]"></div>
      <video
        v-if="video.preview"
        ref="previewVideo"
        class="thumb-preview absolute inset-0 h-full w-full bg-[var(--thumb-bg)] object-cover"
        muted
        loop
        playsinline
        preload="none"
        aria-hidden="true"
      ></video>
    </a>

    <div class="flex min-h-[124px] min-w-0 flex-col gap-2">
      <div class="video-title-wrap">
        <a
          class="min-h-[4.05em] overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] font-bold leading-[1.35] text-[var(--text)] no-underline hover:text-[var(--accent)]"
          :href="video.url"
          data-test="video-title-link"
          @click="openVideo"
          @auxclick="openVideoAux"
        >
          {{ video.title || video.url }}
        </a>
        <span class="video-title-tooltip" aria-hidden="true">
          {{ video.title || video.url }}
        </span>
      </div>
      <div
        class="mt-auto space-y-1 border-t border-[var(--panel-border)] pt-2 text-xs leading-[1.4] text-[var(--muted)]"
      >
        <div class="truncate">
          <span class="font-medium text-[var(--text)]" data-test="video-views-value">{{
            formatNumber(video.views)
          }}</span>
          <span class="pl-1" data-test="video-views-label">{{ i18n.t('video.views') }}</span>
          <span class="px-1.5">·</span>
          <span class="font-medium text-[var(--text)]" data-test="video-likes-value">{{
            formatNumber(video.likes)
          }}</span>
          <span class="pl-1" data-test="video-likes-label">{{ i18n.t('video.likes') }}</span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate">{{ i18n.t('video.synced', { date: formatDate(video.last_seen_at) }) }}</span>
          <button
            type="button"
            class="min-h-7 px-2 py-1 text-xs"
            data-test="video-download"
            :disabled="downloadButtonDisabled"
            @click="downloadVideo"
          >
            {{ downloadButtonLabel }}
          </button>
        </div>
      </div>
    </div>
  </article>
</template>
