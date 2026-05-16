<script setup lang="ts">
import CollectionTabs from './CollectionTabs.vue';
import DownloadRecordCard from './DownloadRecordCard.vue';
import PaginationControls from './PaginationControls.vue';
import PendingRemoteOperationCard from './PendingRemoteOperationCard.vue';
import VideoCard from './VideoCard.vue';
import { DIRECTION_OPTIONS, SEARCH_MODE_OPTIONS, SORT_OPTIONS } from '../constants';
import { t } from '../i18n';
import type {
  CollectionKey,
  DownloadRecord,
  LibraryTabKey,
  LibraryVideoMenuPayload,
  PendingRemoteOperationGroup,
  SearchMode,
  SortDirection,
  SortKey,
  VideoRow
} from '../../types/jable';

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
  countLabel: string;
  pageLabel: string;
  downloads: DownloadRecord[];
  rows: VideoRow[];
  currentPage: number;
  totalPages: number;
}>();

const emit = defineEmits<{
  'select-tab': [tabKey: string];
  'quick-sync': [];
  'full-sync': [];
  'update:search': [value: string];
  'update:search-mode': [value: SearchMode];
  'update:sort': [value: SortKey];
  'update:direction': [value: SortDirection];
  'prev-page': [];
  'next-page': [];
  'go-page': [page: number];
  'open-download': [videoUrl: string];
  'reveal-download': [videoUrl: string];
  'retry-download': [videoUrl: string];
  'delete-download': [videoUrl: string];
  'download-video': [video: VideoRow];
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
            ? '[grid-template-columns:minmax(0,1fr)]'
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
            @reveal="emit('reveal-download', $event)"
            @retry="emit('retry-download', $event)"
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
          @open="emit('open-video', $event)"
          @open-new="emit('open-video-new-tab', $event)"
          @download="emit('download-video', $event)"
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
