<script setup lang="ts">
import { ref } from 'vue';
import CollectionTabs from './CollectionTabs.vue';
import PaginationControls from './PaginationControls.vue';
import VideoCard from './VideoCard.vue';
import { DIRECTION_OPTIONS, SEARCH_MODE_OPTIONS, SORT_OPTIONS } from '../constants';
import { t } from '../i18n';
import type {
  CollectionKey,
  LibraryVideoMenuPayload,
  SearchMode,
  SortDirection,
  SortKey,
  VideoRow
} from '../../types/jable';

defineProps<{
  active: boolean;
  activeCollection: CollectionKey;
  busy: boolean;
  fullSyncLabel: string;
  search: string;
  searchMode: SearchMode;
  sort: SortKey;
  direction: SortDirection;
  countLabel: string;
  pageLabel: string;
  rows: VideoRow[];
  currentPage: number;
  totalPages: number;
}>();

var emit = defineEmits<{
  'select-collection': [collectionKey: string];
  'quick-sync': [];
  'full-sync': [];
  'import-file': [file: File];
  'export-json': [];
  'update:search': [value: string];
  'update:search-mode': [value: SearchMode];
  'update:sort': [value: SortKey];
  'update:direction': [value: SortDirection];
  'prev-page': [];
  'next-page': [];
  'open-video': [url: string];
  'open-video-new-tab': [url: string];
  'video-context-menu': [payload: LibraryVideoMenuPayload];
}>();

var importFile = ref<HTMLInputElement | null>(null);

function chooseImportFile() {
  if (importFile.value) importFile.value.click();
}

function handleImportFile(event: Event) {
  var target = event.target as HTMLInputElement;
  var file = target.files ? target.files[0] : null;
  if (file) emit('import-file', file);
  target.value = '';
}

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
      <CollectionTabs :active-collection="activeCollection" @select="emit('select-collection', $event)" />

      <div class="flex flex-wrap justify-end gap-2">
        <button class="primary" type="button" :disabled="busy" @click="emit('quick-sync')">
          {{ t('library.quickSync') }}
        </button>
        <button type="button" :disabled="busy" @click="emit('full-sync')">
          {{ fullSyncLabel }}
        </button>
        <button type="button" :disabled="busy" @click="chooseImportFile">{{ t('library.importJson') }}</button>
        <button type="button" :disabled="busy" @click="emit('export-json')">{{ t('library.exportJson') }}</button>
        <input ref="importFile" type="file" accept="application/json,.json" hidden @change="handleImportFile" />
      </div>
    </div>

    <div
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
      class="flex items-center justify-between gap-2 border-b border-[var(--panel-border)] px-3 py-2.5 text-xs text-[var(--muted)]"
    >
      <span>{{ countLabel }}</span>
    </div>

    <div
      class="grid min-h-0 content-start gap-3 overflow-auto p-3.5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]"
    >
      <div v-if="!rows.length" class="col-span-full px-3 py-8 text-center text-[var(--muted)]">
        {{ t('library.empty') }}
      </div>
      <template v-else>
        <VideoCard
          v-for="video in rows"
          :key="video.url"
          :video="video"
          @open="emit('open-video', $event)"
          @open-new="emit('open-video-new-tab', $event)"
          @context-menu="emit('video-context-menu', $event)"
        />
      </template>
    </div>

    <PaginationControls
      :busy="busy"
      :current-page="currentPage"
      :total-pages="totalPages"
      :page-label="pageLabel"
      @prev="emit('prev-page')"
      @next="emit('next-page')"
    />
  </section>
</template>
