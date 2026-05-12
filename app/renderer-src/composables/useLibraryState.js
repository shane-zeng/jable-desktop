import { computed, ref, watch } from 'vue';
import { COLLECTIONS, PAGE_SIZE, SORT_OPTIONS } from '../constants';

var DEFAULT_SORT = 'site_order';
var SORT_VALUES = SORT_OPTIONS.map(function (option) {
  return option.value;
});

function normalizeSort(value) {
  return SORT_VALUES.indexOf(value) === -1 ? DEFAULT_SORT : value;
}

export function useLibraryState(api) {
  var activeCollection = ref('favourites');
  var currentPage = ref(1);
  var rows = ref([]);
  var search = ref('');
  var sort = ref('site_order');
  var direction = ref('asc');
  var fullSyncContinuation = ref(null);
  var refreshToken = 0;

  var currentCollection = computed(function () {
    return COLLECTIONS[activeCollection.value];
  });

  var totalPages = computed(function () {
    return Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE));
  });

  var pageRows = computed(function () {
    var start = (currentPage.value - 1) * PAGE_SIZE;
    return rows.value.slice(start, start + PAGE_SIZE);
  });

  var countLabel = computed(function () {
    return rows.value.length + ' 筆 · 每頁 ' + PAGE_SIZE + ' 筆';
  });

  var pageLabel = computed(function () {
    return '第 ' + currentPage.value + ' / ' + totalPages.value + ' 頁';
  });

  var fullSyncButtonLabel = computed(function () {
    var pending = fullSyncContinuation.value &&
      fullSyncContinuation.value.collectionKey === activeCollection.value;
    return pending ? '繼續完整同步' : '完整同步';
  });

  async function refreshVideos() {
    var token = ++refreshToken;
    var safeSort = normalizeSort(sort.value);
    if (safeSort !== sort.value) sort.value = safeSort;

    var videos = await api.listVideos({
      collectionKey: activeCollection.value,
      search: search.value,
      sort: safeSort,
      direction: direction.value
    });

    if (token !== refreshToken) return;

    rows.value = videos;
    if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;
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

  function goToPage(page) {
    var nextPage = Math.max(1, Math.min(totalPages.value, page));
    if (nextPage === currentPage.value) return;

    currentPage.value = nextPage;
  }

  watch([search, sort, direction], function () {
    currentPage.value = 1;
    refreshVideos();
  });

  return {
    activeCollection: activeCollection,
    currentCollection: currentCollection,
    currentPage: currentPage,
    rows: rows,
    pageRows: pageRows,
    totalPages: totalPages,
    countLabel: countLabel,
    pageLabel: pageLabel,
    search: search,
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
