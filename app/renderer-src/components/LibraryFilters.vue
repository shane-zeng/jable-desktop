<script setup lang="ts">
import { COLLECTION_DOWNLOAD_FILTER_OPTIONS, DIRECTION_OPTIONS, SEARCH_MODE_OPTIONS, SORT_OPTIONS } from '../constants';
import { t } from '../i18n';
import type { CollectionDownloadFilter, SearchMode, SortDirection, SortKey } from '../../types/jable';

defineProps<{
  search: string;
  searchMode: SearchMode;
  collectionDownloadFilter: CollectionDownloadFilter;
  sort: SortKey;
  direction: SortDirection;
}>();

const emit = defineEmits<{
  'update:search': [value: string];
  'update:search-mode': [value: SearchMode];
  'update:collection-download-filter': [value: CollectionDownloadFilter];
  'update:sort': [value: SortKey];
  'update:direction': [value: SortDirection];
}>();

function inputValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}
</script>

<template>
  <div
    class="grid grid-cols-[minmax(132px,180px)_minmax(220px,1fr)_minmax(132px,180px)_minmax(140px,160px)_minmax(110px,120px)] gap-2 border-b border-[var(--panel-border)] px-3.5 py-3 max-[980px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[620px]:grid-cols-1"
    data-test="library-filters"
  >
    <select
      class="w-full min-w-0"
      :aria-label="t('library.searchMode')"
      :value="searchMode"
      @change="emit('update:search-mode', inputValue($event) as SearchMode)"
    >
      <option v-for="option in SEARCH_MODE_OPTIONS" :key="option.value" :value="option.value">
        {{ t('options.searchMode.' + option.value) }}
      </option>
    </select>
    <input
      class="w-full min-w-0"
      type="search"
      :placeholder="t('library.searchPlaceholder')"
      :value="search"
      @input="emit('update:search', inputValue($event))"
    />
    <select
      class="w-full min-w-0"
      :aria-label="t('library.downloadFilter')"
      :value="collectionDownloadFilter"
      @change="emit('update:collection-download-filter', inputValue($event) as CollectionDownloadFilter)"
    >
      <option v-for="option in COLLECTION_DOWNLOAD_FILTER_OPTIONS" :key="option.value" :value="option.value">
        {{ t('options.collectionDownloadFilter.' + option.value) }}
      </option>
    </select>
    <select
      class="w-full min-w-0"
      :aria-label="t('library.sort')"
      :value="sort"
      @change="emit('update:sort', inputValue($event) as SortKey)"
    >
      <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
        {{ t('options.sort.' + option.value) }}
      </option>
    </select>
    <select
      class="w-full min-w-0"
      :aria-label="t('library.sortDirection')"
      :value="direction"
      @change="emit('update:direction', inputValue($event) as SortDirection)"
    >
      <option v-for="option in DIRECTION_OPTIONS" :key="option.value" :value="option.value">
        {{ t('options.direction.' + option.value) }}
      </option>
    </select>
  </div>
</template>
