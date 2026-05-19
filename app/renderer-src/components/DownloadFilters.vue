<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { DIRECTION_OPTIONS, DOWNLOAD_SORT_OPTIONS, DOWNLOAD_STATE_FILTER_OPTIONS } from '../constants';
import { t } from '../i18n';
import type { DownloadSortKey, DownloadStateFilter, DownloadStateFilters, SortDirection } from '../../types/jable';

const props = withDefaults(
  defineProps<{
    downloadSearch: string;
    downloadSort: DownloadSortKey;
    downloadDirection: SortDirection;
    downloadStateFilters?: DownloadStateFilters;
  }>(),
  {
    downloadStateFilters: function () {
      return ['all'];
    }
  }
);

const emit = defineEmits<{
  'update:download-search': [value: string];
  'update:download-sort': [value: DownloadSortKey];
  'update:download-direction': [value: SortDirection];
  'update:download-state-filters': [value: DownloadStateFilters];
}>();

const downloadStateFiltersRef = ref<HTMLDetailsElement | null>(null);
const downloadStateFiltersSummaryRef = ref<HTMLElement | null>(null);

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

function inputValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

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

function closeDropdownOnOutsideClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;

  const stateFilters = downloadStateFiltersRef.value;
  if (stateFilters && stateFilters.open && !stateFilters.contains(target)) stateFilters.open = false;
}

function closeDownloadStateFiltersWithFocus() {
  const stateFilters = downloadStateFiltersRef.value;
  if (!stateFilters || !stateFilters.open) return;

  stateFilters.open = false;
  downloadStateFiltersSummaryRef.value?.focus();
}

onMounted(function () {
  document.addEventListener('click', closeDropdownOnOutsideClick);
});

onBeforeUnmount(function () {
  document.removeEventListener('click', closeDropdownOnOutsideClick);
});
</script>

<template>
  <div
    class="grid grid-cols-[minmax(220px,1fr)_minmax(190px,220px)_minmax(140px,160px)_minmax(110px,120px)] gap-2 border-b border-[var(--panel-border)] px-3.5 py-3 max-[980px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[620px]:grid-cols-1"
    data-test="download-filters"
  >
    <input
      class="w-full min-w-0"
      type="search"
      :placeholder="t('downloadList.searchPlaceholder')"
      :value="downloadSearch"
      @input="emit('update:download-search', inputValue($event))"
    />
    <details
      ref="downloadStateFiltersRef"
      class="relative min-w-0"
      data-test="download-state-filters"
      @keydown.esc.prevent.stop="closeDownloadStateFiltersWithFocus"
    >
      <summary
        ref="downloadStateFiltersSummaryRef"
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
    <select
      class="w-full min-w-0"
      :aria-label="t('downloadList.sort')"
      :value="downloadSort"
      @change="emit('update:download-sort', inputValue($event) as DownloadSortKey)"
    >
      <option v-for="option in DOWNLOAD_SORT_OPTIONS" :key="option.value" :value="option.value">
        {{ t('options.downloadSort.' + option.value) }}
      </option>
    </select>
    <select
      class="w-full min-w-0"
      :aria-label="t('downloadList.sortDirection')"
      :value="downloadDirection"
      @change="emit('update:download-direction', inputValue($event) as SortDirection)"
    >
      <option v-for="option in DIRECTION_OPTIONS" :key="option.value" :value="option.value">
        {{ t('options.direction.' + option.value) }}
      </option>
    </select>
  </div>
</template>
