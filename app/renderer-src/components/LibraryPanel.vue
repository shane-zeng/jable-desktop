<script setup lang="ts">
import DownloadFilters from './DownloadFilters.vue';
import LibraryActionBar from './LibraryActionBar.vue';
import LibraryFilters from './LibraryFilters.vue';
import LibraryGrid from './LibraryGrid.vue';
import PaginationControls from './PaginationControls.vue';
import { t } from '../i18n';
import type {
  CollectionDownloadFilter,
  CollectionKey,
  DownloadRecord,
  DownloadSortKey,
  DownloadStateFilters,
  LibraryTabKey,
  LibraryVideoMenuPayload,
  PendingRemoteOperationGroup,
  SearchMode,
  SortDirection,
  SortKey,
  VideoRow
} from '../../types/jable';

withDefaults(
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
  'refresh-ffmpeg': [];
  'choose-ffmpeg': [];
  'open-ffmpeg-guide': [];
  'download-video': [video: VideoRow];
  'locate-download': [videoUrl: string];
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
</script>

<template>
  <section
    class="h-full min-h-0 w-full min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--panel)]"
    :class="active ? 'grid' : 'hidden'"
    :aria-label="t('library.aria')"
  >
    <LibraryActionBar
      :active-collection="activeCollection"
      :active-tab="activeTab"
      :busy="busy"
      :ffmpeg-ready="ffmpegReady"
      :full-sync-label="fullSyncLabel"
      :pending-count="pendingCount"
      :rows="rows"
      :downloads="downloads"
      :download-records="downloadRecords"
      :batch-download-selection="batchDownloadSelection"
      :selected-download-urls="selectedDownloadUrls"
      @select-tab="emit('select-tab', $event)"
      @quick-sync="emit('quick-sync')"
      @full-sync="emit('full-sync')"
      @select-downloadable="emit('select-downloadable', $event)"
      @download-selected="emit('download-selected')"
      @clear-download-selection="emit('clear-download-selection')"
      @retry-failed-downloads="emit('retry-failed-downloads')"
      @pause-all-downloads="emit('pause-all-downloads')"
      @resume-paused-downloads="emit('resume-paused-downloads')"
      @cancel-queued-downloads="emit('cancel-queued-downloads')"
      @delete-selected-downloads="emit('delete-selected-downloads')"
    />

    <LibraryFilters
      v-if="activeTab !== 'pending_remote' && activeTab !== 'downloads'"
      :search="search"
      :search-mode="searchMode"
      :collection-download-filter="collectionDownloadFilter"
      :sort="sort"
      :direction="direction"
      @update:search="emit('update:search', $event)"
      @update:search-mode="emit('update:search-mode', $event)"
      @update:collection-download-filter="emit('update:collection-download-filter', $event)"
      @update:sort="emit('update:sort', $event)"
      @update:direction="emit('update:direction', $event)"
    />

    <DownloadFilters
      v-if="activeTab === 'downloads' && ffmpegReady"
      :download-search="downloadSearch"
      :download-sort="downloadSort"
      :download-direction="downloadDirection"
      :download-state-filters="downloadStateFilters"
      @update:download-search="emit('update:download-search', $event)"
      @update:download-sort="emit('update:download-sort', $event)"
      @update:download-direction="emit('update:download-direction', $event)"
      @update:download-state-filters="emit('update:download-state-filters', $event)"
    />

    <div
      class="flex items-center justify-between gap-2 border-b border-[var(--panel-border)] px-3 py-2.5 text-xs text-[var(--muted)]"
    >
      <span>{{ countLabel }}</span>
    </div>

    <LibraryGrid
      :active-tab="activeTab"
      :busy="busy"
      :ffmpeg-ready="ffmpegReady"
      :pending-groups="pendingGroups"
      :downloads="downloads"
      :download-records="downloadRecords"
      :batch-download-selection="batchDownloadSelection"
      :selected-download-urls="selectedDownloadUrls"
      :rows="rows"
      @open-download="emit('open-download', $event)"
      @reveal-download="emit('reveal-download', $event)"
      @retry-download="emit('retry-download', $event)"
      @pause-download="emit('pause-download', $event)"
      @resume-download="emit('resume-download', $event)"
      @cancel-download="emit('cancel-download', $event)"
      @delete-download="emit('delete-download', $event)"
      @toggle-download-record-selection="emit('toggle-download-record-selection', $event)"
      @refresh-ffmpeg="emit('refresh-ffmpeg')"
      @choose-ffmpeg="emit('choose-ffmpeg')"
      @open-ffmpeg-guide="emit('open-ffmpeg-guide')"
      @download-video="emit('download-video', $event)"
      @locate-download="emit('locate-download', $event)"
      @toggle-download-selection="emit('toggle-download-selection', $event)"
      @open-video="emit('open-video', $event)"
      @open-video-new-tab="emit('open-video-new-tab', $event)"
      @add-pending-group="emit('add-pending-group', $event)"
      @remove-pending-group="emit('remove-pending-group', $event)"
      @resolve-pending-group="emit('resolve-pending-group', $event)"
      @video-context-menu="emit('video-context-menu', $event)"
    />

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
