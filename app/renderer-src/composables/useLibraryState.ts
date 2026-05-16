import { computed, ref, watch } from 'vue';
import { COLLECTIONS, PAGE_SIZE, SEARCH_MODE_OPTIONS, SORT_OPTIONS } from '../constants';
import { t } from '../i18n';
import type {
  CollectionKey,
  DownloadRecord,
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

function normalizeSort(value: string): SortKey {
  return SORT_VALUES.indexOf(value as SortKey) === -1 ? DEFAULT_SORT : (value as SortKey);
}

function normalizeSearchMode(value: string): SearchMode {
  return SEARCH_MODE_VALUES.indexOf(value as SearchMode) === -1 ? DEFAULT_SEARCH_MODE : (value as SearchMode);
}

function isCollectionKey(value: string): value is CollectionKey {
  return Object.prototype.hasOwnProperty.call(COLLECTIONS, value);
}

export function useLibraryState(api: JableAppApi) {
  const activeTab = ref<LibraryTabKey>('favourites');
  const activeCollection = ref<CollectionKey>('favourites');
  const currentPage = ref(1);
  const rows = ref<VideoRow[]>([]);
  const downloads = ref<DownloadRecord[]>([]);
  const pendingGroups = ref<PendingRemoteOperationGroup[]>([]);
  const totalRows = ref(0);
  const search = ref('');
  const searchMode = ref<SearchMode>('any');
  const sort = ref<SortKey>('site_order');
  const direction = ref<SortDirection>('asc');
  const fullSyncContinuation = ref<FullSyncContinuation | null>(null);
  let refreshToken = 0;

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

  async function refreshPendingGroups() {
    const token = ++refreshToken;
    const groups = await api.listPendingRemoteOperationGroups();

    if (token !== refreshToken) return;

    pendingGroups.value = Array.isArray(groups) ? groups : [];
    if (activeTab.value === 'pending_remote' && pendingGroups.value.length === 0) {
      activeTab.value = activeCollection.value;
    }
  }

  async function refreshVideos() {
    if (isPendingTab.value) {
      await refreshPendingGroups();
      return;
    }
    if (isDownloadsTab.value) {
      const token = ++refreshToken;
      const records = await api.listDownloads();

      if (token !== refreshToken) return;

      downloads.value = Array.isArray(records) ? records : [];
      rows.value = [];
      totalRows.value = downloads.value.length;
      currentPage.value = 1;
      return;
    }

    const token = ++refreshToken;
    const safeSort = normalizeSort(sort.value);
    const safeSearchMode = normalizeSearchMode(searchMode.value);
    if (safeSort !== sort.value) sort.value = safeSort;
    if (safeSearchMode !== searchMode.value) searchMode.value = safeSearchMode;

    const params: ListVideosOptions = {
      collectionKey: activeCollection.value,
      search: search.value,
      searchMode: safeSearchMode,
      sort: safeSort,
      direction: direction.value
    };
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

    activeTab.value = collectionKey;
    activeCollection.value = collectionKey;
    currentPage.value = 1;
    await refreshVideos();
  }

  async function selectTab(tabKey: string) {
    if (tabKey === 'downloads') {
      activeTab.value = 'downloads';
      currentPage.value = 1;
      await refreshVideos();
      return;
    }

    if (tabKey === 'pending_remote') {
      activeTab.value = 'pending_remote';
      currentPage.value = 1;
      await refreshPendingGroups();
      return;
    }

    await selectCollection(tabKey);
  }

  function resetPage() {
    currentPage.value = 1;
  }

  async function goToPage(page: number) {
    if (isPendingTab.value || isDownloadsTab.value) return;

    const nextPage = Math.max(1, Math.min(totalPages.value, page));
    if (nextPage === currentPage.value) return;

    currentPage.value = nextPage;
    await refreshVideos();
  }

  watch([search, searchMode, sort, direction], function () {
    if (isPendingTab.value || isDownloadsTab.value) return;

    currentPage.value = 1;
    refreshVideos();
  });

  return {
    activeTab: activeTab,
    activeCollection: activeCollection,
    currentCollection: currentCollection,
    isPendingTab: isPendingTab,
    isDownloadsTab: isDownloadsTab,
    currentPage: currentPage,
    rows: rows,
    downloads: downloads,
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
    sort: sort,
    direction: direction,
    fullSyncContinuation: fullSyncContinuation,
    fullSyncButtonLabel: fullSyncButtonLabel,
    refreshVideos: refreshVideos,
    refreshPendingGroups: refreshPendingGroups,
    selectCollection: selectCollection,
    selectTab: selectTab,
    resetPage: resetPage,
    goToPage: goToPage
  };
}
