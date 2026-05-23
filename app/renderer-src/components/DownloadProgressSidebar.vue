<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { isIndeterminateProgress, progressStyle, recordTimeLabel, secondaryInfoLabel } from '../download-display';
import { t } from '../i18n';
import type { DownloadRecord, DownloadState } from '../../types/jable';

type ResizeFrameCallback = (time: number) => void;

const props = withDefaults(
  defineProps<{
    collapsed: boolean;
    currentPlaybackVideoUrl?: string | null;
    hasMoreActive?: boolean;
    hiddenActiveCount?: number;
    records: DownloadRecord[];
    width: number;
  }>(),
  {
    hasMoreActive: false,
    hiddenActiveCount: 0
  }
);

const emit = defineEmits<{
  'cancel-current-playback-download': [videoUrl: string];
  'reset-width': [];
  'resize-width': [width: number, final: boolean];
  'show-more': [];
  toggle: [];
}>();

const resizing = ref(false);
const resizeStart = ref({
  x: 0,
  width: 0,
  moved: false,
  pointerId: null as number | null,
  target: null as HTMLElement | null
});
let pendingResizeFrame: number | null = null;
let pendingResizeWidth: number | null = null;

function stateClass(state: DownloadState) {
  if (state === 'ready') return 'download-state-ready';
  if (state === 'failed' || state === 'missing') return 'download-state-failed';
  if (state === 'downloading') return 'download-state-downloading';
  if (state === 'paused') return 'download-state-paused';
  return 'download-state-muted';
}

function progressFillClass(state: DownloadState) {
  if (state === 'ready') return 'download-progress-ready';
  if (state === 'failed' || state === 'missing') return 'download-progress-failed';
  if (state === 'downloading') return 'download-progress-downloading';
  if (state === 'paused') return 'download-progress-paused';
  return 'download-progress-muted';
}

function thumbnailLabel(record: DownloadRecord) {
  return record.title || record.videoUrl;
}

function secondaryLabel(record: DownloadRecord) {
  return secondaryInfoLabel(record, t);
}

function isCurrentVideoRecord(record: DownloadRecord) {
  return Boolean(props.currentPlaybackVideoUrl) && record.videoUrl === props.currentPlaybackVideoUrl;
}

function isPlaybackAutoDownload(record: DownloadRecord) {
  return record.downloadSource === 'playback_auto';
}

function canCancelCurrentPlaybackAutoRecord(record: DownloadRecord) {
  return (
    isCurrentVideoRecord(record) &&
    isPlaybackAutoDownload(record) &&
    (record.state === 'queued' || record.state === 'downloading')
  );
}

function requestResizeFrame(callback: ResizeFrameCallback): number {
  if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback);
  return window.setTimeout(callback, 16);
}

function cancelResizeFrame(frameId: number) {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frameId);
  else window.clearTimeout(frameId);
}

function flushPendingResize() {
  const width = pendingResizeWidth;
  pendingResizeFrame = null;
  pendingResizeWidth = null;
  if (width !== null && resizing.value) emit('resize-width', width, false);
}

function scheduleResize(width: number) {
  pendingResizeWidth = width;
  if (pendingResizeFrame !== null) return;
  pendingResizeFrame = requestResizeFrame(flushPendingResize);
}

function cancelPendingResize() {
  if (pendingResizeFrame !== null) cancelResizeFrame(pendingResizeFrame);
  pendingResizeFrame = null;
  pendingResizeWidth = null;
}

function releaseResizePointerCapture() {
  const target = resizeStart.value.target;
  const pointerId = resizeStart.value.pointerId;
  if (!target || pointerId === null || typeof target.releasePointerCapture !== 'function') return;

  try {
    target.releasePointerCapture(pointerId);
  } catch {}
}

function startResize(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement | null;
  const pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
  resizing.value = true;
  resizeStart.value = {
    x: event.clientX,
    width: Number(target?.dataset.width) || 0,
    moved: false,
    pointerId: pointerId,
    target: target
  };
  if (target && pointerId !== null && typeof target.setPointerCapture === 'function') {
    try {
      target.setPointerCapture(pointerId);
    } catch {}
  }
  event.preventDefault();
  window.addEventListener('pointermove', resizeSidebar);
  window.addEventListener('pointerup', stopResize);
}

function resizeSidebar(event: PointerEvent) {
  if (!resizing.value) return;

  const nextWidth = resizeStart.value.width + resizeStart.value.x - event.clientX;
  if (Math.abs(event.clientX - resizeStart.value.x) > 3) resizeStart.value.moved = true;
  scheduleResize(nextWidth);
}

function cleanupResizeListeners() {
  window.removeEventListener('pointermove', resizeSidebar);
  window.removeEventListener('pointerup', stopResize);
}

function stopResize(event?: PointerEvent) {
  if (!resizing.value) return;

  const wasMoved = resizeStart.value.moved;
  const nextWidth = event ? resizeStart.value.width + resizeStart.value.x - event.clientX : resizeStart.value.width;
  resizing.value = false;
  releaseResizePointerCapture();
  cleanupResizeListeners();
  cancelPendingResize();

  if (wasMoved) {
    emit('resize-width', nextWidth, true);
    return;
  }
  emit('toggle');
}

onBeforeUnmount(function () {
  resizing.value = false;
  releaseResizePointerCapture();
  cleanupResizeListeners();
  cancelPendingResize();
});
</script>

<template>
  <aside
    class="download-progress-sidebar relative h-full min-h-0 border-l border-[var(--panel-border)] bg-[var(--panel)]"
    :class="props.collapsed ? 'grid grid-rows-[1fr]' : 'grid grid-rows-[auto_minmax(0,1fr)]'"
    :aria-label="t('downloadList.sidebarTitle')"
    data-test="download-progress-sidebar"
  >
    <button
      v-if="props.collapsed"
      type="button"
      class="download-progress-sidebar-trigger grid h-full min-h-0 w-full place-items-center border-0 bg-transparent px-0 py-2 text-lg leading-none text-[var(--muted)] hover:bg-[var(--control-hover)]"
      :aria-label="t('downloadList.sidebarExpand')"
      :title="t('downloadList.sidebarExpand')"
      data-test="download-sidebar-toggle"
      @click="emit('toggle')"
    >
      ‹
    </button>

    <template v-else>
      <div
        class="browser-tab-resize-handle absolute inset-y-0 left-[-5px] z-20 w-3 cursor-col-resize"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="t('downloadList.sidebarResize')"
        :title="t('downloadList.sidebarResize')"
        :data-width="props.width"
        data-test="download-sidebar-resize"
        @pointerdown="startResize"
        @dblclick="emit('reset-width')"
        @keydown.enter.prevent="emit('toggle')"
        @keydown.space.prevent="emit('toggle')"
      ></div>
      <header class="flex min-h-[52px] items-center border-b border-[var(--panel-border)] px-3">
        <div class="min-w-0">
          <h2 class="m-0 truncate text-sm font-bold text-[var(--text)]">{{ t('downloadList.sidebarTitle') }}</h2>
          <p class="m-0 truncate text-xs text-[var(--muted)]">
            {{ t('downloadList.sidebarCount', { count: props.records.length }) }}
          </p>
        </div>
      </header>

      <div class="min-h-0 overflow-auto p-2.5" data-test="download-sidebar-list">
        <p
          v-if="!props.records.length"
          class="m-0 px-1 py-6 text-center text-sm leading-6 text-[var(--muted)]"
          data-test="download-sidebar-empty"
        >
          {{ t('downloadList.sidebarEmpty') }}
        </p>

        <article
          v-for="record in props.records"
          :key="record.videoUrl"
          class="mb-2 grid grid-cols-[54px_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--card)] p-2 shadow-[var(--shadow)]"
          :class="{
            'download-card-current-video': isCurrentVideoRecord(record),
            'download-card-playback-auto': isPlaybackAutoDownload(record)
          }"
          data-test="download-sidebar-record"
        >
          <div class="h-[54px] overflow-hidden rounded-md bg-[var(--thumb-bg)]">
            <img
              v-if="record.img"
              class="h-full w-full object-cover"
              :src="record.img"
              :alt="thumbnailLabel(record)"
              draggable="false"
            />
            <span v-else class="grid h-full w-full place-items-center text-xs font-bold text-[var(--muted)]">J</span>
          </div>

          <div class="grid min-w-0 content-start gap-1.5">
            <span
              v-if="isCurrentVideoRecord(record)"
              class="w-fit rounded-full bg-[var(--control-hover)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text)]"
              data-test="download-sidebar-current-video"
            >
              {{ t('downloadList.sidebarCurrentVideo') }}
            </span>

            <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5">
              <h3
                class="m-0 min-w-0 overflow-hidden text-xs font-bold leading-[1.35] text-[var(--text)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
              >
                {{ record.title || record.videoUrl }}
              </h3>
              <span
                class="shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                :class="stateClass(record.state)"
                data-test="download-sidebar-state"
              >
                {{ t('downloadList.state.' + record.state) }}
              </span>
            </div>

            <div
              class="h-1.5 overflow-hidden rounded-full bg-[var(--panel-border)]"
              data-test="download-sidebar-progress"
            >
              <div
                v-if="isIndeterminateProgress(record)"
                class="download-progress-indeterminate h-full rounded-full"
                :class="progressFillClass(record.state)"
                data-test="download-sidebar-progress-fill"
              ></div>
              <div
                v-else
                class="h-full rounded-full transition-[width] duration-300"
                :class="progressFillClass(record.state)"
                :style="progressStyle(record)"
                data-test="download-sidebar-progress-fill"
              ></div>
            </div>

            <div class="grid min-w-0 gap-0.5 text-[11px] leading-4 text-[var(--muted)]">
              <span
                class="min-w-0 truncate"
                :class="record.state === 'failed' || record.state === 'missing' ? 'download-secondary-warning' : ''"
              >
                {{ secondaryLabel(record) }}
              </span>
              <span class="min-w-0 truncate tabular-nums">{{ recordTimeLabel(record) }}</span>
            </div>

            <button
              v-if="canCancelCurrentPlaybackAutoRecord(record)"
              type="button"
              class="danger-secondary mt-1 min-h-[38px] w-full justify-center text-sm font-bold"
              data-test="download-sidebar-current-cancel"
              @click="emit('cancel-current-playback-download', record.videoUrl)"
            >
              {{ t('downloadList.cancel') }}
            </button>
          </div>
        </article>

        <button
          v-if="props.hasMoreActive"
          type="button"
          class="secondary w-full justify-center text-xs"
          :aria-label="t('downloadList.sidebarShowMoreLabel', { count: props.hiddenActiveCount })"
          data-test="download-sidebar-show-more"
          @click="emit('show-more')"
        >
          {{ t('downloadList.sidebarShowMore') }}
        </button>
      </div>
    </template>
  </aside>
</template>
