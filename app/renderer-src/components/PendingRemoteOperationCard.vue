<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../i18n';
import type { PendingRemoteOperationGroup } from '../../types/jable';
import VideoPreviewThumb from './VideoPreviewThumb.vue';

const props = defineProps<{
  group: PendingRemoteOperationGroup;
  busy: boolean;
}>();

const emit = defineEmits<{
  add: [groupId: string];
  remove: [groupId: string];
  resolve: [groupId: string];
  open: [url: string];
  'open-new': [url: string];
}>();
const i18n = useI18n();

const stateLabel = computed(function () {
  return i18n.t('pendingRemote.state.' + props.group.state);
});

const syncStateClass = computed(function () {
  return stateChipClass(props.group.state);
});

const metadataItems = computed(function () {
  const items: Array<{ key: string; value: string; label: string }> = [];

  if (props.group.views !== null && typeof props.group.views !== 'undefined') {
    items.push({
      key: 'views',
      value: formatNumber(props.group.views),
      label: i18n.t('video.views')
    });
  }

  if (props.group.likes !== null && typeof props.group.likes !== 'undefined') {
    items.push({
      key: 'likes',
      value: formatNumber(props.group.likes),
      label: i18n.t('video.likes')
    });
  }

  return items;
});

const sequenceSteps = computed(function () {
  return props.group.sequence.map(function (step) {
    return {
      id: step.id,
      label: i18n.t('pendingRemote.action.' + step.action),
      ariaLabel: i18n.t('pendingRemote.sequenceStep', {
        action: i18n.t('pendingRemote.action.' + step.action),
        state: i18n.t('pendingRemote.state.' + step.state)
      }),
      className: actionChipClass(step.action)
    };
  });
});

function formatNumber(value: number) {
  return Number(value).toLocaleString(i18n.locale.value);
}

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(window.navigator.platform || '');
}

function stateChipClass(state: PendingRemoteOperationGroup['state']) {
  if (state === 'failed') return 'pending-chip-failed';
  if (state === 'blocked') return 'pending-chip-blocked';
  return 'pending-chip-pending';
}

function actionChipClass(action: PendingRemoteOperationGroup['sequence'][number]['action']) {
  if (action === 'remove') return 'pending-chip-remove';
  return 'pending-chip-pending';
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
</script>

<template>
  <article
    class="grid grid-cols-[132px_minmax(0,1fr)_max-content] gap-3 rounded-lg border border-[var(--panel-border)] bg-[var(--card)] p-3 shadow-[var(--shadow)] max-[760px]:grid-cols-1"
    data-test="pending-remote-card"
  >
    <VideoPreviewThumb
      :href="group.videoUrl"
      :title="group.title || group.videoUrl"
      :img="group.img"
      :preview="group.preview"
      @open="emit('open', $event)"
      @open-new="emit('open-new', $event)"
    />

    <div class="min-w-0 space-y-3">
      <a
        class="block truncate text-sm font-bold text-[var(--text)] no-underline hover:text-[var(--accent)]"
        :href="group.videoUrl"
        @click="openVideo"
        @auxclick="openVideoAux"
      >
        {{ group.title || group.videoUrl }}
      </a>

      <div
        v-if="metadataItems.length"
        class="flex flex-wrap gap-x-2 gap-y-1 text-xs leading-[1.4] text-[var(--muted)]"
        data-test="pending-remote-metadata"
      >
        <template v-for="(item, index) in metadataItems" :key="item.key">
          <span v-if="index > 0" aria-hidden="true">·</span>
          <span class="whitespace-nowrap">
            <strong class="font-medium text-[var(--text)]" :data-test="'pending-remote-' + item.key + '-value'">
              {{ item.value }}
            </strong>
            <span class="pl-1" :data-test="'pending-remote-' + item.key + '-label'">{{ item.label }}</span>
          </span>
        </template>
      </div>

      <div class="flex flex-wrap gap-2" data-test="pending-remote-summary">
        <div class="pending-summary-chip pending-chip-neutral">
          <span>{{ i18n.t('pendingRemote.collection') }}</span>
          <strong>{{ i18n.t('collections.' + group.collectionKey) }}</strong>
        </div>
        <div class="pending-summary-chip" :class="syncStateClass">
          <span>{{ i18n.t('pendingRemote.syncState') }}</span>
          <strong>{{ stateLabel }}</strong>
        </div>
      </div>

      <div
        v-if="group.error"
        class="max-h-14 overflow-auto rounded-md border border-[rgba(214,64,85,0.48)] bg-[rgba(214,64,85,0.12)] px-2.5 py-1.5 text-xs leading-5 text-[var(--text)]"
      >
        <span class="font-bold">{{ i18n.t('pendingRemote.error') }}</span>
        <span class="pl-1 text-[var(--muted)]">{{ group.error }}</span>
      </div>

      <div
        class="rounded-md border border-[var(--panel-border)] bg-[rgba(255,255,255,0.025)] px-2.5 py-2"
        data-test="pending-remote-sequence"
      >
        <div class="mb-1 text-[10px] font-bold tracking-wide text-[var(--muted)]">
          {{ i18n.t('pendingRemote.sequence') }} · {{ group.operationCount }}
        </div>
        <div class="flex max-h-16 flex-wrap gap-1.5 overflow-auto pr-1">
          <template v-for="(step, index) in sequenceSteps" :key="step.id">
            <span v-if="index > 0" class="self-center text-[10px] text-[var(--muted)]" aria-hidden="true">-&gt;</span>
            <span
              class="pending-sequence-step"
              :class="step.className"
              :title="step.ariaLabel"
              :aria-label="step.ariaLabel"
            >
              {{ step.label }}
            </span>
          </template>
        </div>
      </div>
    </div>

    <div class="flex flex-col items-stretch justify-start gap-2">
      <button type="button" class="success whitespace-nowrap" :disabled="busy" @click="emit('add', group.groupId)">
        {{ i18n.t('pendingRemote.add') }}
      </button>
      <button type="button" class="danger whitespace-nowrap" :disabled="busy" @click="emit('remove', group.groupId)">
        {{ i18n.t('pendingRemote.remove') }}
      </button>
      <button type="button" class="whitespace-nowrap" :disabled="busy" @click="emit('resolve', group.groupId)">
        {{ i18n.t('pendingRemote.resolve') }}
      </button>
    </div>
  </article>
</template>
