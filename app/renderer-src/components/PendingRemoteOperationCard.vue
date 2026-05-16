<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '../i18n';
import type { PendingRemoteOperationGroup } from '../../types/jable';

const props = defineProps<{
  group: PendingRemoteOperationGroup;
  busy: boolean;
}>();

const emit = defineEmits<{
  retry: [groupId: string];
  open: [url: string];
  'open-new': [url: string];
}>();
const i18n = useI18n();
const previewVideo = ref<HTMLVideoElement | null>(null);

const finalStateLabel = computed(function () {
  return i18n.t('pendingRemote.finalAction.' + props.group.finalAction);
});

const stateLabel = computed(function () {
  return i18n.t('pendingRemote.state.' + props.group.state);
});

const sequenceText = computed(function () {
  return props.group.sequence
    .map(function (step) {
      return i18n.t('pendingRemote.sequenceStep', {
        action: i18n.t('pendingRemote.action.' + step.action),
        state: i18n.t('pendingRemote.state.' + step.state)
      });
    })
    .join(' -> ');
});

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(window.navigator.platform || '');
}

function openVideo(event: MouseEvent) {
  event.preventDefault();

  const macPlatform = isMacPlatform();
  if (event.metaKey || (!macPlatform && event.ctrlKey)) {
    emit('open-new', props.group.videoUrl);
    return;
  }

  if (macPlatform && event.ctrlKey) return;
  emit('open', props.group.videoUrl);
}

function openVideoAux(event: MouseEvent) {
  if (event.button !== 1) return;

  event.preventDefault();
  emit('open-new', props.group.videoUrl);
}

function startPreview() {
  if (!props.group.preview || !previewVideo.value) return;

  if (!previewVideo.value.getAttribute('src')) {
    previewVideo.value.setAttribute('src', props.group.preview);
  }

  previewVideo.value.classList.add('active');
  const play = previewVideo.value.play();
  if (play && typeof play.catch === 'function') play.catch(function () {});
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
    class="grid grid-cols-[132px_minmax(0,1fr)_auto] gap-3 rounded-lg border border-[var(--panel-border)] bg-[var(--card)] p-3 shadow-[var(--shadow)] max-[760px]:grid-cols-1"
    data-test="pending-remote-card"
  >
    <a
      class="relative aspect-[16/10] w-full overflow-hidden rounded-md bg-[var(--thumb-bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      :href="group.videoUrl"
      :aria-label="i18n.t('video.open', { target: group.title || group.videoUrl })"
      @click="openVideo"
      @auxclick="openVideoAux"
      @pointerenter="startPreview"
      @pointerleave="stopPreview"
    >
      <img v-if="group.img" class="absolute inset-0 h-full w-full object-cover" :src="group.img" alt="" />
      <div v-else class="absolute inset-0 bg-[var(--thumb-bg)]"></div>
      <video
        v-if="group.preview"
        ref="previewVideo"
        class="thumb-preview absolute inset-0 h-full w-full bg-[var(--thumb-bg)] object-cover"
        muted
        loop
        playsinline
        preload="none"
        aria-hidden="true"
      ></video>
    </a>

    <div class="min-w-0 space-y-2">
      <a
        class="block truncate text-sm font-bold text-[var(--text)] no-underline hover:text-[var(--accent)]"
        :href="group.videoUrl"
        @click="openVideo"
        @auxclick="openVideoAux"
      >
        {{ group.title || group.videoUrl }}
      </a>
      <div class="grid gap-1 text-xs leading-5 text-[var(--muted)]">
        <div>
          <span class="font-semibold text-[var(--text)]">{{ i18n.t('pendingRemote.collection') }}</span>
          <span class="pl-1">{{ i18n.t('collections.' + group.collectionKey) }}</span>
        </div>
        <div>
          <span class="font-semibold text-[var(--text)]">{{ i18n.t('pendingRemote.finalState') }}</span>
          <span class="pl-1">{{ finalStateLabel }}</span>
        </div>
        <div>
          <span class="font-semibold text-[var(--text)]">{{ i18n.t('pendingRemote.syncState') }}</span>
          <span class="pl-1">{{ stateLabel }}</span>
        </div>
        <div v-if="group.error">
          <span class="font-semibold text-[var(--text)]">{{ i18n.t('pendingRemote.error') }}</span>
          <span class="pl-1">{{ group.error }}</span>
        </div>
        <div class="break-words">
          <span class="font-semibold text-[var(--text)]">{{ i18n.t('pendingRemote.sequence') }}</span>
          <span class="pl-1">{{ sequenceText }}</span>
        </div>
      </div>
    </div>

    <div class="flex items-start justify-end">
      <button type="button" :disabled="busy" @click="emit('retry', group.groupId)">
        {{ i18n.t('pendingRemote.retry') }}
      </button>
    </div>
  </article>
</template>
