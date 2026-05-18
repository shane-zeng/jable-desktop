<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '../i18n';

const props = withDefaults(
  defineProps<{
    href: string;
    title: string;
    img?: string | null;
    preview?: string | null;
    disabled?: boolean;
    dataTest?: string;
    openNewGestures?: boolean;
  }>(),
  {
    img: null,
    preview: null,
    disabled: false,
    dataTest: undefined,
    openNewGestures: true
  }
);

const emit = defineEmits<{
  open: [href: string];
  'open-new': [href: string];
}>();

const i18n = useI18n();
const previewVideo = ref<HTMLVideoElement | null>(null);

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(window.navigator.platform || '');
}

function startPreview() {
  if (!props.preview || !previewVideo.value) return;

  if (!previewVideo.value.getAttribute('src')) {
    previewVideo.value.setAttribute('src', props.preview);
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

function openThumb(event: MouseEvent) {
  event.preventDefault();
  if (props.disabled) return;

  const macPlatform = isMacPlatform();

  if (event.metaKey || (!macPlatform && event.ctrlKey)) {
    if (props.openNewGestures) {
      emit('open-new', props.href);
    } else {
      emit('open', props.href);
    }
    return;
  }

  if (macPlatform && event.ctrlKey) return;

  emit('open', props.href);
}

function openThumbAux(event: MouseEvent) {
  if (event.button !== 1) return;

  event.preventDefault();
  if (props.disabled || !props.openNewGestures) return;

  emit('open-new', props.href);
}
</script>

<template>
  <a
    class="relative aspect-[16/10] w-full overflow-hidden rounded-md bg-[var(--thumb-bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    :class="disabled ? 'cursor-default' : 'cursor-pointer'"
    :href="href"
    :aria-label="i18n.t('video.open', { target: title || href })"
    :aria-disabled="disabled"
    :data-test="dataTest"
    @click="openThumb"
    @auxclick="openThumbAux"
    @pointerenter="startPreview"
    @pointerleave="stopPreview"
  >
    <img v-if="img" class="absolute inset-0 h-full w-full object-cover" :src="img" alt="" draggable="false" />
    <div v-else class="absolute inset-0 bg-[var(--thumb-bg)]"></div>
    <video
      v-if="preview"
      ref="previewVideo"
      class="thumb-preview absolute inset-0 h-full w-full bg-[var(--thumb-bg)] object-cover"
      muted
      loop
      playsinline
      preload="none"
      aria-hidden="true"
    ></video>
  </a>
</template>
