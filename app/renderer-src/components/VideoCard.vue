<script setup>
import { ref } from 'vue';

var props = defineProps({
  video: {
    type: Object,
    required: true
  }
});

var emit = defineEmits(['open']);
var previewVideo = ref(null);

function formatNumber(value) {
  if (value === null || typeof value === 'undefined') return '-';
  return Number(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleString();
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

  var play = previewVideo.value.play();
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

function openVideo(event) {
  event.preventDefault();
  emit('open', props.video.url);
}
</script>

<template>
  <article class="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--card)] p-2.5 shadow-[var(--shadow)]">
    <div
      class="relative aspect-[16/10] w-full overflow-hidden rounded-md bg-[var(--thumb-bg)]"
      @pointerenter="startPreview"
      @pointerleave="stopPreview"
    >
      <img
        v-if="video.img"
        class="absolute inset-0 h-full w-full object-cover"
        :src="video.img"
        alt=""
      >
      <div
        v-else
        class="absolute inset-0 bg-[var(--thumb-bg)]"
      ></div>
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
    </div>

    <div class="flex min-h-[124px] min-w-0 flex-col gap-2">
      <div class="video-title-wrap">
        <a
          class="min-h-[4.05em] overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] font-bold leading-[1.35] text-[var(--text)] no-underline hover:text-[var(--accent)]"
          :href="video.url"
          @click="openVideo"
        >
          {{ video.title || video.url }}
        </a>
        <span
          class="video-title-tooltip"
          aria-hidden="true"
        >
          {{ video.title || video.url }}
        </span>
      </div>
      <div class="mt-auto space-y-1 border-t border-[var(--panel-border)] pt-2 text-xs leading-[1.4] text-[var(--muted)]">
        <div class="truncate">
          <span class="font-medium text-[var(--text)]">{{ formatNumber(video.views) }}</span>
          <span> views</span>
          <span class="px-1.5">·</span>
          <span class="font-medium text-[var(--text)]">{{ formatNumber(video.likes) }}</span>
          <span> likes</span>
        </div>
        <div class="truncate">
          同步 {{ formatDate(video.last_seen_at) }}
        </div>
      </div>
    </div>
  </article>
</template>
