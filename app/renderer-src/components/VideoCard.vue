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
  <article class="grid grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--card)] p-2.5 shadow-[var(--shadow)]">
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

    <div class="grid min-w-0 content-start gap-1.5">
      <a
        class="font-bold leading-[1.35] text-[var(--text)] no-underline hover:text-[var(--accent)]"
        :href="video.url"
        @click="openVideo"
      >
        {{ video.title || video.url }}
      </a>
      <div class="flex flex-wrap gap-2 text-xs leading-[1.4] text-[var(--muted)]">
        <span>Views {{ formatNumber(video.views) }}</span>
        <span>Likes {{ formatNumber(video.likes) }}</span>
      </div>
      <div class="flex flex-wrap gap-2 text-xs leading-[1.4] text-[var(--muted)]">
        同步 {{ formatDate(video.last_seen_at) }}
      </div>
    </div>
  </article>
</template>
