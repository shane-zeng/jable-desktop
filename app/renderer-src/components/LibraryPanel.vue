<script setup>
import { ref } from 'vue';
import CollectionTabs from './CollectionTabs.vue';
import PaginationControls from './PaginationControls.vue';
import VideoCard from './VideoCard.vue';
import { DIRECTION_OPTIONS, SORT_OPTIONS } from '../constants';

defineProps({
  active: {
    type: Boolean,
    required: true
  },
  activeCollection: {
    type: String,
    required: true
  },
  busy: {
    type: Boolean,
    required: true
  },
  fullSyncLabel: {
    type: String,
    required: true
  },
  search: {
    type: String,
    required: true
  },
  sort: {
    type: String,
    required: true
  },
  direction: {
    type: String,
    required: true
  },
  countLabel: {
    type: String,
    required: true
  },
  pageLabel: {
    type: String,
    required: true
  },
  rows: {
    type: Array,
    required: true
  },
  currentPage: {
    type: Number,
    required: true
  },
  totalPages: {
    type: Number,
    required: true
  }
});

var emit = defineEmits([
  'select-collection',
  'quick-sync',
  'full-sync',
  'import-file',
  'export-json',
  'update:search',
  'update:sort',
  'update:direction',
  'prev-page',
  'next-page',
  'open-video'
]);

var importFile = ref(null);

function chooseImportFile() {
  if (importFile.value) importFile.value.click();
}

function handleImportFile(event) {
  var file = event.target.files[0];
  if (file) emit('import-file', file);
  event.target.value = '';
}
</script>

<template>
  <section
    class="h-full min-h-0 w-full min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--panel)]"
    :class="active ? 'grid' : 'hidden'"
    aria-label="Local library"
  >
    <div
      class="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] px-3.5 py-2.5 max-[1180px]:flex-wrap"
    >
      <CollectionTabs :active-collection="activeCollection" @select="emit('select-collection', $event)" />

      <div class="flex flex-wrap justify-end gap-2">
        <button class="primary" type="button" :disabled="busy" @click="emit('quick-sync')">快速同步</button>
        <button type="button" :disabled="busy" @click="emit('full-sync')">
          {{ fullSyncLabel }}
        </button>
        <button type="button" :disabled="busy" @click="chooseImportFile">匯入 JSON</button>
        <button type="button" :disabled="busy" @click="emit('export-json')">匯出 JSON</button>
        <input ref="importFile" type="file" accept="application/json,.json" hidden @change="handleImportFile" />
      </div>
    </div>

    <div
      class="grid grid-cols-[minmax(260px,1fr)_160px_120px] gap-2 border-b border-[var(--panel-border)] px-3.5 py-3 max-[1180px]:grid-cols-1"
    >
      <input
        type="search"
        placeholder="搜尋標題或 URL"
        :value="search"
        @input="emit('update:search', $event.target.value)"
      />
      <select aria-label="排序" :value="sort" @change="emit('update:sort', $event.target.value)">
        <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <select aria-label="排序方向" :value="direction" @change="emit('update:direction', $event.target.value)">
        <option v-for="option in DIRECTION_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
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
      <div v-if="!rows.length" class="col-span-full px-3 py-8 text-center text-[var(--muted)]">目前沒有本機資料</div>
      <template v-else>
        <VideoCard v-for="video in rows" :key="video.url" :video="video" @open="emit('open-video', $event)" />
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
