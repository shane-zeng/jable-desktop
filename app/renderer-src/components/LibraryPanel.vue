<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CollectionTabs from './CollectionTabs.vue';
import DownloadRecordCard from './DownloadRecordCard.vue';
import PaginationControls from './PaginationControls.vue';
import PendingRemoteOperationCard from './PendingRemoteOperationCard.vue';
import VideoCard from './VideoCard.vue';
import {
  COLLECTION_DOWNLOAD_FILTER_OPTIONS,
  DIRECTION_OPTIONS,
  DOWNLOAD_SORT_OPTIONS,
  DOWNLOAD_STATE_FILTER_OPTIONS,
  SEARCH_MODE_OPTIONS,
  SORT_OPTIONS
} from '../constants';
import { t } from '../i18n';
import type {
  CollectionDownloadFilter,
  CollectionKey,
  DownloadRecord,
  DownloadSortKey,
  DownloadStateFilter,
  DownloadStateFilters,
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
    collectionDownloadFilter?: CollectionDownloadFilter;
    sort: SortKey;
    direction: SortDirection;
    downloadSearch?: string;
    downloadSort?: DownloadSortKey;
    downloadDirection?: SortDirection;
    downloadStateFilters?: DownloadStateFilters;
    countLabel: string;
    pageLabel: string;
    downloads: DownloadRecord[];
    downloadRecords?: DownloadRecord[];
    batchDownloadSelection?: string[];
    selectedDownloadUrls?: string[];
    rows: VideoRow[];
    currentPage: number;
    totalPages: number;
  }>(),
  {
    downloadSearch: '',
    collectionDownloadFilter: 'all',
    downloadSort: 'updated_at',
    downloadDirection: 'desc',
    downloadStateFilters: function () {
      return ['all'];
    },
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
  'update:search': [value: string];
  'update:search-mode': [value: SearchMode];
  'update:collection-download-filter': [value: CollectionDownloadFilter];
  'update:sort': [value: SortKey];
  'update:direction': [value: SortDirection];
  'update:download-search': [value: string];
  'update:download-sort': [value: DownloadSortKey];
  'update:download-direction': [value: SortDirection];
  'update:download-state-filters': [value: DownloadStateFilters];
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
  'retry-failed-downloads': [];
  'pause-all-downloads': [];
  'resume-paused-downloads': [];
  'cancel-queued-downloads': [];
  'delete-selected-downloads': [];
  'toggle-download-record-selection': [payload: { videoUrl: string; selected: boolean }];
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

const downloadQueueActionsRef = ref<HTMLDetailsElement | null>(null);
const downloadStateFiltersRef = ref<HTMLDetailsElement | null>(null);

function inputValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function updateSearchMode(event: Event) {
  emit('update:search-mode', inputValue(event) as SearchMode);
}

function updateCollectionDownloadFilter(event: Event) {
  emit('update:collection-download-filter', inputValue(event) as CollectionDownloadFilter);
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

const selectedDownloadUrlSet = computed(function () {
  return new Set(props.selectedDownloadUrls);
});

const selectedDownloadStateFilters = computed(function () {
  return new Set(props.downloadStateFilters);
});

const downloadStateFilterLabel = computed(function () {
  if (selectedDownloadStateFilters.value.has('all') || props.downloadStateFilters.length === 0) {
    return t('options.downloadStateFilter.all');
  }
  if (props.downloadStateFilters.length === 1) {
    return t('options.downloadStateFilter.' + props.downloadStateFilters[0]);
  }
  return t('downloadList.stateFilterSelected', { count: props.downloadStateFilters.length });
});

const downloadActionRecords = computed(function () {
  return props.downloadRecords.length ? props.downloadRecords : props.downloads;
});

const retryFailedDownloadCount = computed(function () {
  return downloadActionRecords.value.filter(function (record) {
    return record.state === 'failed' || record.state === 'missing';
  }).length;
});

const activeDownloadCount = computed(function () {
  return downloadActionRecords.value.filter(function (record) {
    return record.state === 'queued' || record.state === 'downloading';
  }).length;
});

const pausedDownloadCount = computed(function () {
  return downloadActionRecords.value.filter(function (record) {
    return record.state === 'paused';
  }).length;
});

const queuedDownloadCount = computed(function () {
  return downloadActionRecords.value.filter(function (record) {
    return record.state === 'queued';
  }).length;
});

function isDownloadStateFilterSelected(filter: DownloadStateFilter) {
  if (filter === 'all') return selectedDownloadStateFilters.value.has('all') || props.downloadStateFilters.length === 0;
  return !selectedDownloadStateFilters.value.has('all') && selectedDownloadStateFilters.value.has(filter);
}

function toggleDownloadStateFilter(filter: DownloadStateFilter) {
  if (filter === 'all') {
    emit('update:download-state-filters', ['all']);
    return;
  }

  const next = props.downloadStateFilters.filter(function (value) {
    return value !== 'all';
  });
  const index = next.indexOf(filter);
  if (index === -1) next.push(filter);
  else next.splice(index, 1);

  const orderedNext = DOWNLOAD_STATE_FILTER_OPTIONS.map(function (option) {
    return option.value;
  }).filter(function (value) {
    return value !== 'all' && next.indexOf(value) !== -1;
  });

  emit('update:download-state-filters', orderedNext.length ? orderedNext : ['all']);
}

function closeDownloadQueueActions() {
  if (downloadQueueActionsRef.value) downloadQueueActionsRef.value.open = false;
}

function closeDropdownsOnOutsideClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;

  const queueActions = downloadQueueActionsRef.value;
  if (queueActions && queueActions.open && !queueActions.contains(target)) queueActions.open = false;

  const stateFilters = downloadStateFiltersRef.value;
  if (stateFilters && stateFilters.open && !stateFilters.contains(target)) stateFilters.open = false;
}

function isDownloadDeleteSelectable(record: DownloadRecord) {
  return (
    record.state === 'ready' || record.state === 'paused' || record.state === 'failed' || record.state === 'missing'
  );
}

const selectedDownloadCount = computed(function () {
  return props.downloads.filter(function (record) {
    return isDownloadDeleteSelectable(record) && selectedDownloadUrlSet.value.has(record.videoUrl);
  }).length;
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

onMounted(function () {
  document.addEventListener('click', closeDropdownsOnOutsideClick);
});

onBeforeUnmount(function () {
  document.removeEventListener('click', closeDropdownsOnOutsideClick);
});
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
      <div v-else-if="activeTab === 'downloads' && ffmpegReady" class="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          :disabled="busy || retryFailedDownloadCount === 0"
          data-test="download-retry-failed"
          @click="emit('retry-failed-downloads')"
        >
          {{ t('downloadList.retryFailed') }}
        </button>
        <details ref="downloadQueueActionsRef" class="relative" data-test="download-queue-actions">
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-[var(--control-border)] bg-[var(--control)] px-3 py-2 text-sm font-semibold text-[var(--text)] shadow-sm outline-none hover:border-[var(--accent)] hover:bg-[var(--control-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden"
          >
            <span>{{ t('downloadList.queueActions') }}</span>
            <span
              class="h-2 w-2 shrink-0 rotate-45 border-b border-r border-current text-[var(--muted)]"
              aria-hidden="true"
            ></span>
          </summary>
          <div
            class="absolute right-0 z-20 mt-2 grid min-w-52 gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--card)] p-2 shadow-[var(--shadow)]"
          >
            <button
              type="button"
              class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left"
              :disabled="busy || activeDownloadCount === 0"
              data-test="download-pause-all"
              @click="
                closeDownloadQueueActions();
                emit('pause-all-downloads');
              "
            >
              <span>{{ t('downloadList.pauseAll') }}</span>
              <span class="tabular-nums text-[var(--muted)]">{{ activeDownloadCount }}</span>
            </button>
            <button
              type="button"
              class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left"
              :disabled="busy || pausedDownloadCount === 0"
              data-test="download-resume-paused"
              @click="
                closeDownloadQueueActions();
                emit('resume-paused-downloads');
              "
            >
              <span>{{ t('downloadList.resumeAll') }}</span>
              <span class="tabular-nums text-[var(--muted)]">{{ pausedDownloadCount }}</span>
            </button>
            <button
              type="button"
              class="danger grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left"
              :disabled="busy || queuedDownloadCount === 0"
              data-test="download-cancel-queued"
              @click="
                closeDownloadQueueActions();
                emit('cancel-queued-downloads');
              "
            >
              <span>{{ t('downloadList.cancelQueued') }}</span>
              <span class="tabular-nums text-[var(--muted)]">{{ queuedDownloadCount }}</span>
            </button>
          </div>
        </details>
        <button
          type="button"
          class="danger"
          :disabled="busy || selectedDownloadCount === 0"
          data-test="download-delete-selected"
          @click="emit('delete-selected-downloads')"
        >
          {{ t('downloadList.deleteSelected') }}
        </button>
      </div>
    </div>

    <div
      v-if="activeTab !== 'pending_remote' && activeTab !== 'downloads'"
      class="grid grid-cols-[minmax(132px,max-content)_minmax(220px,1fr)_minmax(132px,max-content)_160px_120px] gap-2 border-b border-[var(--panel-border)] px-3.5 py-3 max-[1180px]:grid-cols-1"
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
      <select
        class="w-auto min-w-[132px] max-w-[220px]"
        :aria-label="t('library.downloadFilter')"
        :value="collectionDownloadFilter"
        @change="updateCollectionDownloadFilter"
      >
        <option v-for="option in COLLECTION_DOWNLOAD_FILTER_OPTIONS" :key="option.value" :value="option.value">
          {{ t('options.collectionDownloadFilter.' + option.value) }}
        </option>
      </select>
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
      class="grid grid-cols-[minmax(220px,1fr)_minmax(190px,max-content)_160px_120px] gap-2 border-b border-[var(--panel-border)] px-3.5 py-3 max-[1180px]:grid-cols-1"
      data-test="download-filters"
    >
      <input
        type="search"
        :placeholder="t('downloadList.searchPlaceholder')"
        :value="downloadSearch"
        @input="emit('update:download-search', inputValue($event))"
      />
      <details ref="downloadStateFiltersRef" class="relative min-w-[190px]" data-test="download-state-filters">
        <summary
          class="flex min-h-[42px] cursor-pointer list-none items-center justify-between rounded-md border border-[var(--control-border)] bg-[var(--control)] px-3 py-2 text-sm font-semibold text-[var(--text)] shadow-sm outline-none hover:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden"
          :aria-label="t('downloadList.stateFilter')"
        >
          <span class="min-w-0 truncate">{{ downloadStateFilterLabel }}</span>
          <span
            class="ml-3 h-2 w-2 shrink-0 rotate-45 border-b border-r border-current text-[var(--muted)]"
            aria-hidden="true"
          ></span>
        </summary>
        <div
          class="absolute left-0 z-20 mt-2 grid min-w-56 gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--card)] p-2 shadow-[var(--shadow)]"
        >
          <button
            v-for="option in DOWNLOAD_STATE_FILTER_OPTIONS"
            :key="option.value"
            type="button"
            class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-semibold text-[var(--text)] hover:bg-[var(--control-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            :class="{ 'bg-[var(--control)]': isDownloadStateFilterSelected(option.value) }"
            role="menuitemcheckbox"
            :aria-checked="isDownloadStateFilterSelected(option.value)"
            :data-test="'download-state-filter-' + option.value"
            @click="toggleDownloadStateFilter(option.value)"
          >
            <span
              class="grid h-4 w-4 place-items-center rounded border border-[var(--control-border)]"
              :class="
                isDownloadStateFilterSelected(option.value)
                  ? 'border-[var(--accent-strong)] bg-[var(--accent)]'
                  : 'bg-[var(--control)]'
              "
              aria-hidden="true"
            >
              <span v-if="isDownloadStateFilterSelected(option.value)" class="h-1.5 w-1.5 rounded-sm bg-white"></span>
            </span>
            <span class="min-w-0 truncate">{{ t('options.downloadStateFilter.' + option.value) }}</span>
          </button>
        </div>
      </details>
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
