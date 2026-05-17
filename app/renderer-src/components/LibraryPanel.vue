<script setup lang="ts">
import { computed } from 'vue';
import CollectionTabs from './CollectionTabs.vue';
import DownloadRecordCard from './DownloadRecordCard.vue';
import PaginationControls from './PaginationControls.vue';
import PendingRemoteOperationCard from './PendingRemoteOperationCard.vue';
import VideoCard from './VideoCard.vue';
import {
  DIRECTION_OPTIONS,
  DOWNLOAD_SORT_OPTIONS,
  DOWNLOAD_STATE_FILTER_OPTIONS,
  SEARCH_MODE_OPTIONS,
  SORT_OPTIONS
} from '../constants';
import { t } from '../i18n';
import type {
  CollectionKey,
  DownloadRecord,
  DownloadSortKey,
  DownloadStateFilter,
  LibraryTabKey,
  LibraryVideoMenuPayload,
  PendingRemoteOperationGroup,
  SearchMode,
  SortDirection,
  SortKey,
  VideoRow
} from '../../types/jable';

const props = withDefaults(
  defineProps<{
    active: boolean;
    activeCollection: CollectionKey;
    activeTab: LibraryTabKey;
    busy: boolean;
    ffmpegReady: boolean;
    fullSyncLabel: string;
    pendingCount: number;
    pendingGroups: PendingRemoteOperationGroup[];
    search: string;
    searchMode: SearchMode;
    sort: SortKey;
    direction: SortDirection;
    downloadSearch?: string;
    downloadSort?: DownloadSortKey;
    downloadDirection?: SortDirection;
    downloadStateFilter?: DownloadStateFilter;
    countLabel: string;
    pageLabel: string;
    downloads: DownloadRecord[];
    downloadRecords?: DownloadRecord[];
    batchDownloadSelection?: string[];
    rows: VideoRow[];
    currentPage: number;
    totalPages: number;
  }>(),
  {
    downloadSearch: '',
    downloadSort: 'updated_at',
    downloadDirection: 'desc',
    downloadStateFilter: 'all',
    downloadRecords: function () {
      return [];
    },
    batchDownloadSelection: function () {
      return [];
    }
  }
);

const emit = defineEmits<{
  'select-tab': [tabKey: string];
  'quick-sync': [];
  'full-sync': [];
  'update:search': [value: string];
  'update:search-mode': [value: SearchMode];
  'update:sort': [value: SortKey];
  'update:direction': [value: SortDirection];
  'update:download-search': [value: string];
  'update:download-sort': [value: DownloadSortKey];
  'update:download-direction': [value: SortDirection];
  'update:download-state-filter': [value: DownloadStateFilter];
  'prev-page': [];
  'next-page': [];
  'go-page': [page: number];
  'open-download': [videoUrl: string];
  'reveal-download': [videoUrl: string];
  'retry-download': [videoUrl: string];
  'pause-download': [videoUrl: string];
  'resume-download': [videoUrl: string];
  'cancel-download': [videoUrl: string];
  'delete-download': [videoUrl: string];
  'download-video': [video: VideoRow];
  'select-downloadable': [videos: VideoRow[]];
  'download-selected': [];
  'clear-download-selection': [];
  'toggle-download-selection': [payload: { video: VideoRow; selected: boolean }];
  'open-video': [url: string];
  'open-video-new-tab': [url: string];
  'add-pending-group': [groupId: string];
  'remove-pending-group': [groupId: string];
  'resolve-pending-group': [groupId: string];
  'video-context-menu': [payload: LibraryVideoMenuPayload];
}>();

function inputValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function updateSearchMode(event: Event) {
  emit('update:search-mode', inputValue(event) as SearchMode);
}

function updateSort(event: Event) {
  emit('update:sort', inputValue(event) as SortKey);
}

function updateDirection(event: Event) {
  emit('update:direction', inputValue(event) as SortDirection);
}

function updateDownloadSort(event: Event) {
  emit('update:download-sort', inputValue(event) as DownloadSortKey);
}

function updateDownloadDirection(event: Event) {
  emit('update:download-direction', inputValue(event) as SortDirection);
}

function updateDownloadStateFilter(event: Event) {
  emit('update:download-state-filter', inputValue(event) as DownloadStateFilter);
}

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

function isVideoSelectedForDownload(video: VideoRow) {
  return batchDownloadSelectionSet.value.has(video.url);
}
</script>

<template>
  <section
    class="h-full min-h-0 w-full min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--panel)]"
    :class="active ? 'grid' : 'hidden'"
    :aria-label="t('library.aria')"
  >
    <div
      class="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] px-3.5 py-2.5 max-[1180px]:flex-wrap"
    >
      <CollectionTabs
        :active-collection="activeCollection"
        :active-tab="activeTab"
        :pending-count="pendingCount"
        @select="emit('select-tab', $event)"
      />

      <div v-if="activeTab !== 'pending_remote' && activeTab !== 'downloads'" class="flex flex-wrap justify-end gap-2">
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
        <button class="primary" type="button" :disabled="busy" @click="emit('quick-sync')">
          {{ t('library.quickSync') }}
        </button>
        <button type="button" :disabled="busy" @click="emit('full-sync')">
          {{ fullSyncLabel }}
        </button>
      </div>
    </div>

    <div
      v-if="activeTab !== 'pending_remote' && activeTab !== 'downloads'"
      class="grid grid-cols-[minmax(132px,max-content)_minmax(220px,1fr)_160px_120px] gap-2 border-b border-[var(--panel-border)] px-3.5 py-3 max-[1180px]:grid-cols-1"
      data-test="library-filters"
    >
      <select
        class="w-auto min-w-[132px] max-w-[220px]"
        :aria-label="t('library.searchMode')"
        :value="searchMode"
        @change="updateSearchMode"
      >
        <option v-for="option in SEARCH_MODE_OPTIONS" :key="option.value" :value="option.value">
          {{ t('options.searchMode.' + option.value) }}
        </option>
      </select>
      <input
        type="search"
        :placeholder="t('library.searchPlaceholder')"
        :value="search"
        @input="emit('update:search', inputValue($event))"
      />
      <select :aria-label="t('library.sort')" :value="sort" @change="updateSort">
        <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
          {{ t('options.sort.' + option.value) }}
        </option>
      </select>
      <select :aria-label="t('library.sortDirection')" :value="direction" @change="updateDirection">
        <option v-for="option in DIRECTION_OPTIONS" :key="option.value" :value="option.value">
          {{ t('options.direction.' + option.value) }}
        </option>
      </select>
    </div>

    <div
      v-if="activeTab === 'downloads' && ffmpegReady"
      class="grid grid-cols-[minmax(220px,1fr)_minmax(170px,max-content)_160px_120px] gap-2 border-b border-[var(--panel-border)] px-3.5 py-3 max-[1180px]:grid-cols-1"
      data-test="download-filters"
    >
      <input
        type="search"
        :placeholder="t('downloadList.searchPlaceholder')"
        :value="downloadSearch"
        @input="emit('update:download-search', inputValue($event))"
      />
      <select
        class="w-auto min-w-[170px] max-w-[260px]"
        :aria-label="t('downloadList.stateFilter')"
        :value="downloadStateFilter"
        @change="updateDownloadStateFilter"
      >
        <option v-for="option in DOWNLOAD_STATE_FILTER_OPTIONS" :key="option.value" :value="option.value">
          {{ t('options.downloadStateFilter.' + option.value) }}
        </option>
      </select>
      <select :aria-label="t('downloadList.sort')" :value="downloadSort" @change="updateDownloadSort">
        <option v-for="option in DOWNLOAD_SORT_OPTIONS" :key="option.value" :value="option.value">
          {{ t('options.downloadSort.' + option.value) }}
        </option>
      </select>
      <select
        :aria-label="t('downloadList.sortDirection')"
        :value="downloadDirection"
        @change="updateDownloadDirection"
      >
        <option v-for="option in DIRECTION_OPTIONS" :key="option.value" :value="option.value">
          {{ t('options.direction.' + option.value) }}
        </option>
      </select>
    </div>

    <div
      class="flex items-center justify-between gap-2 border-b border-[var(--panel-border)] px-3 py-2.5 text-xs text-[var(--muted)]"
    >
      <span>{{ countLabel }}</span>
    </div>

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
        <div v-if="!ffmpegReady" class="col-span-full px-3 py-8 text-center text-[var(--muted)]">
          <p class="m-0 text-sm font-semibold text-[var(--text)]" data-test="download-list-setup-required">
            {{ t('downloadList.setupRequired') }}
          </p>
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
            @open="emit('open-download', $event)"
            @open-page="emit('open-video', $event)"
            @reveal="emit('reveal-download', $event)"
            @retry="emit('retry-download', $event)"
            @pause="emit('pause-download', $event)"
            @resume="emit('resume-download', $event)"
            @cancel="emit('cancel-download', $event)"
            @delete="emit('delete-download', $event)"
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
          @retry-download="emit('retry-download', $event)"
          @resume-download="emit('resume-download', $event)"
          @toggle-download-selection="emit('toggle-download-selection', $event)"
          @context-menu="emit('video-context-menu', $event)"
        />
      </template>
    </div>

    <PaginationControls
      v-if="activeTab !== 'pending_remote' && activeTab !== 'downloads'"
      :busy="busy"
      :current-page="currentPage"
      :total-pages="totalPages"
      :page-label="pageLabel"
      @prev="emit('prev-page')"
      @next="emit('next-page')"
      @page="emit('go-page', $event)"
    />
  </section>
</template>
