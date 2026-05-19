<script setup lang="ts">
import { computed } from 'vue';
import CollectionTabs from './CollectionTabs.vue';
import DownloadActionMenu from './DownloadActionMenu.vue';
import { t } from '../i18n';
import type { CollectionKey, DownloadRecord, LibraryTabKey, VideoRow } from '../../types/jable';

const props = withDefaults(
  defineProps<{
    activeCollection: CollectionKey;
    activeTab: LibraryTabKey;
    busy: boolean;
    ffmpegReady: boolean;
    fullSyncLabel: string;
    pendingCount: number;
    rows: VideoRow[];
    downloads: DownloadRecord[];
    downloadRecords?: DownloadRecord[];
    batchDownloadSelection?: string[];
    selectedDownloadUrls?: string[];
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
  'select-tab': [tabKey: string];
  'quick-sync': [];
  'full-sync': [];
  'select-downloadable': [videos: VideoRow[]];
  'download-selected': [];
  'clear-download-selection': [];
  'retry-failed-downloads': [];
  'pause-all-downloads': [];
  'resume-paused-downloads': [];
  'cancel-queued-downloads': [];
  'delete-selected-downloads': [];
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

const batchDownloadSelectionCount = computed(function () {
  return props.batchDownloadSelection.length;
});

function downloadRecordForVideo(video: VideoRow) {
  return downloadRecordByVideoUrl.value.get(video.url) || null;
}

function isVideoDownloadSelectable(video: VideoRow) {
  const record = downloadRecordForVideo(video);
  return !record || record.state === 'failed' || record.state === 'missing' || record.state === 'paused';
}

const selectableBatchDownloadVideos = computed(function () {
  return props.rows.filter(isVideoDownloadSelectable);
});

const selectableBatchDownloadCount = computed(function () {
  return selectableBatchDownloadVideos.value.length;
});

const allSelectableBatchDownloadsSelected = computed(function () {
  if (selectableBatchDownloadCount.value === 0) return false;

  return selectableBatchDownloadVideos.value.every(function (video) {
    return batchDownloadSelectionSet.value.has(video.url);
  });
});
</script>

<template>
  <div
    class="flex items-start justify-between gap-3 border-b border-[var(--panel-border)] px-3.5 py-2.5 max-[900px]:flex-col max-[900px]:items-stretch"
  >
    <CollectionTabs
      :active-collection="activeCollection"
      :active-tab="activeTab"
      :pending-count="pendingCount"
      @select="emit('select-tab', $event)"
    />

    <div
      v-if="activeTab !== 'pending_remote' && activeTab !== 'downloads'"
      class="flex min-w-0 flex-wrap justify-end gap-2 max-[900px]:justify-start"
    >
      <button
        type="button"
        :disabled="busy || selectableBatchDownloadCount === 0 || allSelectableBatchDownloadsSelected"
        :title="t('library.selectAllDownloadableTitle')"
        data-test="library-select-downloadable"
        @click="emit('select-downloadable', selectableBatchDownloadVideos)"
      >
        {{ t('library.selectAllDownloadable') }}
      </button>
      <button
        type="button"
        :disabled="busy || batchDownloadSelectionCount === 0"
        data-test="library-download-selected"
        @click="emit('download-selected')"
      >
        {{ t('library.downloadSelected', { count: batchDownloadSelectionCount }) }}
      </button>
      <button
        v-if="batchDownloadSelectionCount > 0"
        type="button"
        :disabled="busy"
        data-test="library-clear-download-selection"
        @click="emit('clear-download-selection')"
      >
        {{ t('library.clearSelection') }}
      </button>
      <button type="button" :disabled="busy" @click="emit('quick-sync')">
        {{ t('library.quickSync') }}
      </button>
      <button type="button" :disabled="busy" @click="emit('full-sync')">
        {{ fullSyncLabel }}
      </button>
    </div>

    <DownloadActionMenu
      v-else-if="activeTab === 'downloads' && ffmpegReady"
      :busy="busy"
      :downloads="downloads"
      :download-records="downloadRecords"
      :selected-download-urls="selectedDownloadUrls"
      @retry-failed-downloads="emit('retry-failed-downloads')"
      @pause-all-downloads="emit('pause-all-downloads')"
      @resume-paused-downloads="emit('resume-paused-downloads')"
      @cancel-queued-downloads="emit('cancel-queued-downloads')"
      @delete-selected-downloads="emit('delete-selected-downloads')"
    />
  </div>
</template>
