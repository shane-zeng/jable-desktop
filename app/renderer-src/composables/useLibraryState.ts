import { computed, ref, watch } from 'vue';
import {
  COLLECTION_DOWNLOAD_FILTER_OPTIONS,
  COLLECTIONS,
  DOWNLOAD_SORT_OPTIONS,
  DOWNLOAD_STATE_FILTER_OPTIONS,
  PAGE_SIZE,
  SEARCH_MODE_OPTIONS,
  SORT_OPTIONS
} from '../constants';
import { t } from '../i18n';
import type {
  CollectionDownloadFilter,
  CollectionKey,
  DownloadSortKey,
  DownloadRecord,
  DownloadStateFilter,
  DownloadStateFilters,
  FullSyncContinuation,
  JableAppApi,
  LibraryTabKey,
  ListVideosOptions,
  PendingRemoteOperationGroup,
  SearchMode,
  SortDirection,
  SortKey,
  VideoRow
} from '../../types/jable';

const DEFAULT_SORT: SortKey = 'site_order';
const SORT_VALUES = SORT_OPTIONS.map(function (option) {
  return option.value;
});
const DEFAULT_SEARCH_MODE: SearchMode = 'any';
const SEARCH_MODE_VALUES = SEARCH_MODE_OPTIONS.map(function (option) {
  return option.value;
});
const DEFAULT_COLLECTION_DOWNLOAD_FILTER: CollectionDownloadFilter = 'all';
const COLLECTION_DOWNLOAD_FILTER_VALUES = COLLECTION_DOWNLOAD_FILTER_OPTIONS.map(function (option) {
  return option.value;
});
const DEFAULT_DOWNLOAD_SORT: DownloadSortKey = 'updated_at';
const DOWNLOAD_SORT_VALUES = DOWNLOAD_SORT_OPTIONS.map(function (option) {
  return option.value;
});
const DOWNLOAD_STATE_FILTER_VALUES = DOWNLOAD_STATE_FILTER_OPTIONS.map(function (option) {
  return option.value;
});
const DEFAULT_DOWNLOAD_STATE_FILTERS: DownloadStateFilters = ['all'];

function normalizeSort(value: string): SortKey {
  return SORT_VALUES.indexOf(value as SortKey) === -1 ? DEFAULT_SORT : (value as SortKey);
}

function normalizeSearchMode(value: string): SearchMode {
  return SEARCH_MODE_VALUES.indexOf(value as SearchMode) === -1 ? DEFAULT_SEARCH_MODE : (value as SearchMode);
}

function normalizeCollectionDownloadFilter(value: string): CollectionDownloadFilter {
  return COLLECTION_DOWNLOAD_FILTER_VALUES.indexOf(value as CollectionDownloadFilter) === -1
    ? DEFAULT_COLLECTION_DOWNLOAD_FILTER
    : (value as CollectionDownloadFilter);
}

function normalizeDownloadSort(value: string): DownloadSortKey {
  return DOWNLOAD_SORT_VALUES.indexOf(value as DownloadSortKey) === -1
    ? DEFAULT_DOWNLOAD_SORT
    : (value as DownloadSortKey);
}

function normalizeDownloadStateFilters(values: DownloadStateFilters): DownloadStateFilters {
  const filters: DownloadStateFilter[] = [];
  for (const value of values) {
    if (DOWNLOAD_STATE_FILTER_VALUES.indexOf(value) === -1 || filters.indexOf(value) !== -1) continue;
    filters.push(value);
  }

  if (filters.length === 0 || filters.indexOf('all') !== -1) return DEFAULT_DOWNLOAD_STATE_FILTERS.slice();
  return filters;
}

function isCollectionKey(value: string): value is CollectionKey {
  return Object.prototype.hasOwnProperty.call(COLLECTIONS, value);
}

function searchableDownloadText(record: DownloadRecord): string {
  const collectionKeys = Array.isArray(record.collectionKeys) ? record.collectionKeys.join(' ') : '';
  return [record.title, record.videoUrl, record.localPath, collectionKeys, record.state]
    .filter(function (value) {
      return typeof value === 'string' && value;
    })
    .join(' ')
    .toLowerCase();
}

function matchesDownloadStateFilter(record: DownloadRecord, filter: DownloadStateFilter) {
  if (filter !== 'all') return record.state === filter;
  return true;
}

function matchesDownloadStateFilters(record: DownloadRecord, filters: DownloadStateFilters) {
  if (filters.indexOf('all') !== -1) return true;

  return filters.some(function (filter) {
    return matchesDownloadStateFilter(record, filter);
  });
}

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every(function (value, index) {
    return value === right[index];
  });
}

function downloadSortValue(record: DownloadRecord, sortKey: DownloadSortKey): string | number {
  if (sortKey === 'title') return (record.title || record.videoUrl).toLowerCase();
  if (sortKey === 'state') return record.state;
  if (sortKey === 'file_size') return record.fileSizeBytes ?? -1;
  return record.updatedAt;
}

function compareDownloadRecords(
  a: DownloadRecord,
  b: DownloadRecord,
  sortKey: DownloadSortKey,
  direction: SortDirection
) {
  const left = downloadSortValue(a, sortKey);
  const right = downloadSortValue(b, sortKey);
  const multiplier = direction === 'desc' ? -1 : 1;

  if (typeof left === 'number' && typeof right === 'number') return (left - right) * multiplier;
  return String(left).localeCompare(String(right)) * multiplier;
}

export function useLibraryState(api: JableAppApi) {
  const activeTab = ref<LibraryTabKey>('favourites');
  const activeCollection = ref<CollectionKey>('favourites');
  const currentPage = ref(1);
  const rows = ref<VideoRow[]>([]);
  const downloadRecords = ref<DownloadRecord[]>([]);
  const pendingGroups = ref<PendingRemoteOperationGroup[]>([]);
  const totalRows = ref(0);
  const search = ref('');
  const searchMode = ref<SearchMode>('any');
  const collectionDownloadFilter = ref<CollectionDownloadFilter>('all');
  const sort = ref<SortKey>('site_order');
  const direction = ref<SortDirection>('asc');
  const downloadSearch = ref('');
  const downloadSort = ref<DownloadSortKey>('updated_at');
  const downloadDirection = ref<SortDirection>('desc');
  const downloadStateFilters = ref<DownloadStateFilters>(DEFAULT_DOWNLOAD_STATE_FILTERS.slice());
  const batchDownloadSelection = ref<string[]>([]);
  const fullSyncContinuation = ref<FullSyncContinuation | null>(null);
  let refreshToken = 0;
  let downloadRefreshToken = 0;

  const currentCollection = computed(function () {
    return COLLECTIONS[activeCollection.value];
  });

  const isPendingTab = computed(function () {
    return activeTab.value === 'pending_remote';
  });

  const isDownloadsTab = computed(function () {
    return activeTab.value === 'downloads';
  });

  const totalPages = computed(function () {
    if (isPendingTab.value || isDownloadsTab.value) return 1;
    return Math.max(1, Math.ceil(totalRows.value / PAGE_SIZE));
  });

  const pageRows = computed(function () {
    return rows.value;
  });

  const downloads = computed(function () {
    const query = downloadSearch.value.trim().toLowerCase();
    const safeSort = normalizeDownloadSort(downloadSort.value);
    const safeStateFilters = normalizeDownloadStateFilters(downloadStateFilters.value);

    return downloadRecords.value
      .filter(function (record) {
        if (!matchesDownloadStateFilters(record, safeStateFilters)) return false;
        return !query || searchableDownloadText(record).indexOf(query) !== -1;
      })
      .slice()
      .sort(function (a, b) {
        return compareDownloadRecords(a, b, safeSort, downloadDirection.value);
      });
  });

  const countLabel = computed(function () {
    if (isPendingTab.value) return t('pendingRemote.count', { total: pendingGroups.value.length });
    if (isDownloadsTab.value) return t('downloadList.count', { total: downloads.value.length });
    return t('library.count', { total: totalRows.value, pageSize: PAGE_SIZE });
  });

  const pageLabel = computed(function () {
    return t('library.page', { current: currentPage.value, total: totalPages.value });
  });

  const fullSyncButtonLabel = computed(function () {
    const pending = fullSyncContinuation.value && fullSyncContinuation.value.collectionKey === activeCollection.value;
    return pending ? t('library.continueFullSync') : t('library.fullSync');
  });

  const batchDownloadSelectionSet = computed(function () {
    return new Set(batchDownloadSelection.value);
  });

  const selectedBatchDownloadVideos = computed(function () {
    const selected = batchDownloadSelectionSet.value;
    return pageRows.value.filter(function (video) {
      return selected.has(video.url);
    });
  });

  async function refreshPendingGroups() {
    const token = ++refreshToken;
    const groups = await api.listPendingRemoteOperationGroups();

    if (token !== refreshToken) return;

    pendingGroups.value = Array.isArray(groups) ? groups : [];
    if (activeTab.value === 'pending_remote' && pendingGroups.value.length === 0) {
      activeTab.value = activeCollection.value;
    }
  }

  async function refreshDownloads() {
    const token = ++downloadRefreshToken;
    const records = await api.listDownloads();

    if (token !== downloadRefreshToken) return;

    downloadRecords.value = Array.isArray(records) ? records : [];
  }

  async function refreshVideos() {
    if (isPendingTab.value) {
      await refreshPendingGroups();
      return;
    }
    if (isDownloadsTab.value) {
      const token = ++refreshToken;
      await refreshDownloads();

      if (token !== refreshToken) return;

      rows.value = [];
      totalRows.value = downloads.value.length;
      currentPage.value = 1;
      return;
    }

    const token = ++refreshToken;
    const safeSort = normalizeSort(sort.value);
    const safeSearchMode = normalizeSearchMode(searchMode.value);
    const safeCollectionDownloadFilter = normalizeCollectionDownloadFilter(collectionDownloadFilter.value);
    if (safeSort !== sort.value) sort.value = safeSort;
    if (safeSearchMode !== searchMode.value) searchMode.value = safeSearchMode;
    if (safeCollectionDownloadFilter !== collectionDownloadFilter.value) {
      collectionDownloadFilter.value = safeCollectionDownloadFilter;
    }

    const params: ListVideosOptions = {
      collectionKey: activeCollection.value,
      search: search.value,
      searchMode: safeSearchMode,
      sort: safeSort,
      direction: direction.value
    };
    if (safeCollectionDownloadFilter !== 'all') params.downloadFilter = safeCollectionDownloadFilter;
    const total = await api.countVideos(params);

    if (token !== refreshToken) return;

    totalRows.value = total;
    if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;

    const videos = await api.listVideos(
      Object.assign({}, params, {
        limit: PAGE_SIZE,
        offset: (currentPage.value - 1) * PAGE_SIZE
      })
    );

    if (token !== refreshToken) return;

    rows.value = videos;
  }

  async function selectCollection(collectionKey: string) {
    if (!isCollectionKey(collectionKey)) return;

    clearBatchDownloadSelection();
    activeTab.value = collectionKey;
    activeCollection.value = collectionKey;
    currentPage.value = 1;
    await refreshVideos();
  }

  async function selectTab(tabKey: string) {
    if (tabKey === 'downloads') {
      clearBatchDownloadSelection();
      activeTab.value = 'downloads';
      currentPage.value = 1;
      await refreshVideos();
      return;
    }

    if (tabKey === 'pending_remote') {
      clearBatchDownloadSelection();
      activeTab.value = 'pending_remote';
      currentPage.value = 1;
      await refreshPendingGroups();
      return;
    }

    await selectCollection(tabKey);
  }

  function resetPage() {
    currentPage.value = 1;
    clearBatchDownloadSelection();
  }

  async function goToPage(page: number) {
    if (isPendingTab.value || isDownloadsTab.value) return;

    const nextPage = Math.max(1, Math.min(totalPages.value, page));
    if (nextPage === currentPage.value) return;

    clearBatchDownloadSelection();
    currentPage.value = nextPage;
    await refreshVideos();
  }

  watch([search, searchMode, collectionDownloadFilter, sort, direction], function () {
    if (isPendingTab.value || isDownloadsTab.value) return;

    currentPage.value = 1;
    clearBatchDownloadSelection();
    refreshVideos();
  });

  watch([downloadSearch, downloadSort, downloadDirection, downloadStateFilters], function () {
    if (!isDownloadsTab.value) return;
    const safeSort = normalizeDownloadSort(downloadSort.value);
    const safeStateFilters = normalizeDownloadStateFilters(downloadStateFilters.value);
    if (safeSort !== downloadSort.value) downloadSort.value = safeSort;
    if (!arraysEqual(safeStateFilters, downloadStateFilters.value)) downloadStateFilters.value = safeStateFilters;
    currentPage.value = 1;
  });

  function toggleBatchDownloadSelection(videoUrl: string, selected: boolean) {
    const next = new Set(batchDownloadSelection.value);
    if (selected) next.add(videoUrl);
    else next.delete(videoUrl);
    batchDownloadSelection.value = Array.from(next);
  }

  function selectBatchDownloadVideos(videoUrls: string[]) {
    batchDownloadSelection.value = Array.from(new Set(videoUrls));
  }

  function clearBatchDownloadSelection() {
    if (!batchDownloadSelection.value.length) return;
    batchDownloadSelection.value = [];
  }

  return {
    activeTab: activeTab,
    activeCollection: activeCollection,
    currentCollection: currentCollection,
    isPendingTab: isPendingTab,
    isDownloadsTab: isDownloadsTab,
    currentPage: currentPage,
    rows: rows,
    downloadRecords: downloadRecords,
    downloads: downloads,
    downloadSearch: downloadSearch,
    downloadSort: downloadSort,
    downloadDirection: downloadDirection,
    downloadStateFilters: downloadStateFilters,
    batchDownloadSelection: batchDownloadSelection,
    batchDownloadSelectionSet: batchDownloadSelectionSet,
    selectedBatchDownloadVideos: selectedBatchDownloadVideos,
    pendingGroups: pendingGroups,
    totalRows: totalRows,
    pendingCount: computed(function () {
      return pendingGroups.value.length;
    }),
    pageRows: pageRows,
    totalPages: totalPages,
    countLabel: countLabel,
    pageLabel: pageLabel,
    search: search,
    searchMode: searchMode,
    collectionDownloadFilter: collectionDownloadFilter,
    sort: sort,
    direction: direction,
    fullSyncContinuation: fullSyncContinuation,
    fullSyncButtonLabel: fullSyncButtonLabel,
    refreshVideos: refreshVideos,
    refreshDownloads: refreshDownloads,
    refreshPendingGroups: refreshPendingGroups,
    selectCollection: selectCollection,
    selectTab: selectTab,
    resetPage: resetPage,
    goToPage: goToPage,
    toggleBatchDownloadSelection: toggleBatchDownloadSelection,
    selectBatchDownloadVideos: selectBatchDownloadVideos,
    clearBatchDownloadSelection: clearBatchDownloadSelection
  };
}
