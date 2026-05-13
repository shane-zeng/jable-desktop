import { computed, ref, watch } from 'vue';
import { COLLECTIONS, PAGE_SIZE, SEARCH_MODE_OPTIONS, SORT_OPTIONS } from '../constants';

var DEFAULT_SORT = 'site_order';
var SORT_VALUES = SORT_OPTIONS.map(function (option) {
  return option.value;
});
var DEFAULT_SEARCH_MODE = 'any';
var SEARCH_MODE_VALUES = SEARCH_MODE_OPTIONS.map(function (option) {
  return option.value;
});

function normalizeSort(value) {
  return SORT_VALUES.indexOf(value) === -1 ? DEFAULT_SORT : value;
}

function normalizeSearchMode(value) {
  return SEARCH_MODE_VALUES.indexOf(value) === -1 ? DEFAULT_SEARCH_MODE : value;
}

export function useLibraryState(api) {
  var activeCollection = ref('favourites');
  var currentPage = ref(1);
  var rows = ref([]);
  var totalRows = ref(0);
  var search = ref('');
  var searchMode = ref('any');
  var sort = ref('site_order');
  var direction = ref('asc');
  var fullSyncContinuation = ref(null);
  var refreshToken = 0;

  var currentCollection = computed(function () {
    return COLLECTIONS[activeCollection.value];
  });

  var totalPages = computed(function () {
    return Math.max(1, Math.ceil(totalRows.value / PAGE_SIZE));
  });

  var pageRows = computed(function () {
    return rows.value;
  });

  var countLabel = computed(function () {
    return totalRows.value + ' 筆 · 每頁 ' + PAGE_SIZE + ' 筆';
  });

  var pageLabel = computed(function () {
    return '第 ' + currentPage.value + ' / ' + totalPages.value + ' 頁';
  });

  var fullSyncButtonLabel = computed(function () {
    var pending = fullSyncContinuation.value && fullSyncContinuation.value.collectionKey === activeCollection.value;
    return pending ? '繼續完整同步' : '完整同步';
  });

  async function refreshVideos() {
    var token = ++refreshToken;
    var safeSort = normalizeSort(sort.value);
    var safeSearchMode = normalizeSearchMode(searchMode.value);
    if (safeSort !== sort.value) sort.value = safeSort;
    if (safeSearchMode !== searchMode.value) searchMode.value = safeSearchMode;

    var params = {
      collectionKey: activeCollection.value,
      search: search.value,
      searchMode: safeSearchMode,
      sort: safeSort,
      direction: direction.value
    };
    var total = await api.countVideos(params);

    if (token !== refreshToken) return;

    totalRows.value = total;
    if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;

    var videos = await api.listVideos(
      Object.assign({}, params, {
        limit: PAGE_SIZE,
        offset: (currentPage.value - 1) * PAGE_SIZE
      })
    );

    if (token !== refreshToken) return;

    rows.value = videos;
  }

  async function selectCollection(collectionKey) {
    if (!COLLECTIONS[collectionKey]) return;

    activeCollection.value = collectionKey;
    currentPage.value = 1;
    await refreshVideos();
  }

  function resetPage() {
    currentPage.value = 1;
  }

  async function goToPage(page) {
    var nextPage = Math.max(1, Math.min(totalPages.value, page));
    if (nextPage === currentPage.value) return;

    currentPage.value = nextPage;
    await refreshVideos();
  }

  watch([search, searchMode, sort, direction], function () {
    currentPage.value = 1;
    refreshVideos();
  });

  return {
    activeCollection: activeCollection,
    currentCollection: currentCollection,
    currentPage: currentPage,
    rows: rows,
    totalRows: totalRows,
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
    selectCollection: selectCollection,
    resetPage: resetPage,
    goToPage: goToPage
  };
}
