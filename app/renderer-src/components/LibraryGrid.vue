<script setup lang="ts">
import { computed } from 'vue';
import DownloadRecordCard from './DownloadRecordCard.vue';
import PendingRemoteOperationCard from './PendingRemoteOperationCard.vue';
import VideoCard from './VideoCard.vue';
import { isDownloadDeleteSelectable } from '../download-display';
import { t } from '../i18n';
import type {
  DownloadRecord,
  LibraryTabKey,
  LibraryVideoMenuPayload,
  PendingRemoteOperationGroup,
  VideoRow
} from '../../types/jable';

const props = withDefaults(
  defineProps<{
    activeTab: LibraryTabKey;
    busy: boolean;
    ffmpegReady: boolean;
    pendingGroups: PendingRemoteOperationGroup[];
    downloads: DownloadRecord[];
    downloadRecords?: DownloadRecord[];
    batchDownloadSelection?: string[];
    selectedDownloadUrls?: string[];
    rows: VideoRow[];
  }>(),
  {
    downloadRecords: function () {
      return [];
    },
    batchDownloadSelection: function () {
      return [];
    },
    selectedDownloadUrls: function () {
      return [];
    }
  }
);

const emit = defineEmits<{
  'open-download': [videoUrl: string];
  'reveal-download': [videoUrl: string];
  'retry-download': [videoUrl: string];
  'pause-download': [videoUrl: string];
  'resume-download': [videoUrl: string];
  'cancel-download': [videoUrl: string];
  'delete-download': [videoUrl: string];
  'toggle-download-record-selection': [payload: { videoUrl: string; selected: boolean }];
  'refresh-ffmpeg': [];
  'choose-ffmpeg': [];
  'open-ffmpeg-guide': [];
  'download-video': [video: VideoRow];
  'locate-download': [videoUrl: string];
  'toggle-download-selection': [payload: { video: VideoRow; selected: boolean }];
  'open-video': [url: string];
  'open-video-new-tab': [url: string];
  'add-pending-group': [groupId: string];
  'remove-pending-group': [groupId: string];
  'resolve-pending-group': [groupId: string];
  'video-context-menu': [payload: LibraryVideoMenuPayload];
}>();

const downloadRecordByVideoUrl = computed(function () {
  const records = new Map<string, DownloadRecord>();

  for (const record of props.downloadRecords) {
    records.set(record.videoUrl, record);
  }

  return records;
});

const batchDownloadSelectionSet = computed(function () {
  return new Set(props.batchDownloadSelection);
});

const selectedDownloadUrlSet = computed(function () {
  return new Set(props.selectedDownloadUrls);
});

function downloadRecordForVideo(video: VideoRow) {
  return downloadRecordByVideoUrl.value.get(video.url) || null;
}

function isVideoSelectedForDownload(video: VideoRow) {
  return batchDownloadSelectionSet.value.has(video.url);
}
</script>

<template>
  <div
    class="grid min-h-0 content-start gap-3 overflow-auto p-3.5"
    data-test="library-grid"
    :class="
      activeTab === 'pending_remote'
        ? '[grid-template-columns:minmax(0,1fr)]'
        : activeTab === 'downloads'
          ? '[grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]'
          : '[grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]'
    "
  >
    <template v-if="activeTab === 'pending_remote'">
      <div v-if="!pendingGroups.length" class="col-span-full px-3 py-8 text-center text-[var(--muted)]">
        {{ t('pendingRemote.empty') }}
      </div>
      <template v-else>
        <PendingRemoteOperationCard
          v-for="group in pendingGroups"
          :key="group.groupId"
          :group="group"
          :busy="busy"
          @add="emit('add-pending-group', $event)"
          @remove="emit('remove-pending-group', $event)"
          @resolve="emit('resolve-pending-group', $event)"
          @open="emit('open-video', $event)"
          @open-new="emit('open-video-new-tab', $event)"
        />
      </template>
    </template>

    <template v-else-if="activeTab === 'downloads'">
      <div
        v-if="!ffmpegReady"
        class="col-span-full mx-auto grid max-w-xl gap-3 px-3 py-8 text-center text-[var(--muted)]"
      >
        <p class="m-0 text-sm font-semibold text-[var(--text)]" data-test="download-list-setup-required-title">
          {{ t('downloadList.setupRequired') }}
        </p>
        <p class="m-0 text-sm leading-6" data-test="download-list-setup-required">
          {{ t('downloadList.setupDescription') }}
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            class="primary min-h-9 px-3 py-1.5 text-sm"
            data-test="download-list-refresh-ffmpeg"
            :disabled="busy"
            @click="emit('refresh-ffmpeg')"
          >
            {{ t('downloadList.checkFfmpeg') }}
          </button>
          <button
            type="button"
            class="min-h-9 px-3 py-1.5 text-sm"
            data-test="download-list-choose-ffmpeg"
            :disabled="busy"
            @click="emit('choose-ffmpeg')"
          >
            {{ t('downloadList.chooseFfmpeg') }}
          </button>
          <button
            type="button"
            class="min-h-9 px-3 py-1.5 text-sm"
            data-test="download-list-open-ffmpeg-guide"
            @click="emit('open-ffmpeg-guide')"
          >
            {{ t('downloadList.readFfmpegGuide') }}
          </button>
        </div>
      </div>
      <div
        v-else-if="!downloads.length"
        class="col-span-full px-3 py-8 text-center text-[var(--muted)]"
        data-test="download-list-empty"
      >
        {{ t('downloadList.empty') }}
      </div>
      <template v-else>
        <DownloadRecordCard
          v-for="record in downloads"
          :key="record.videoUrl"
          :record="record"
          :selectable="isDownloadDeleteSelectable(record)"
          :selected="selectedDownloadUrlSet.has(record.videoUrl)"
          @open="emit('open-download', $event)"
          @open-page="emit('open-video', $event)"
          @reveal="emit('reveal-download', $event)"
          @retry="emit('retry-download', $event)"
          @pause="emit('pause-download', $event)"
          @resume="emit('resume-download', $event)"
          @cancel="emit('cancel-download', $event)"
          @delete="emit('delete-download', $event)"
          @toggle-select="emit('toggle-download-record-selection', $event)"
        />
      </template>
    </template>

    <div v-else-if="!rows.length" class="col-span-full px-3 py-8 text-center text-[var(--muted)]">
      {{ t('library.empty') }}
    </div>
    <template v-else>
      <VideoCard
        v-for="video in rows"
        :key="video.url"
        :video="video"
        :download-record="downloadRecordForVideo(video)"
        :show-download-selection="true"
        :download-selection-selected="isVideoSelectedForDownload(video)"
        @open="emit('open-video', $event)"
        @open-new="emit('open-video-new-tab', $event)"
        @download="emit('download-video', $event)"
        @locate-download="emit('locate-download', $event)"
        @retry-download="emit('retry-download', $event)"
        @resume-download="emit('resume-download', $event)"
        @toggle-download-selection="emit('toggle-download-selection', $event)"
        @context-menu="emit('video-context-menu', $event)"
      />
    </template>
  </div>
</template>
