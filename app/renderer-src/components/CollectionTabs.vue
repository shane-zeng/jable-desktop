<script setup lang="ts">
import { computed } from 'vue';
import { COLLECTIONS } from '../constants';
import { t } from '../i18n';
import type { CollectionKey, LibraryTabKey } from '../../types/jable';

const props = defineProps<{
  activeCollection: CollectionKey;
  activeTab?: LibraryTabKey;
  pendingCount?: number;
}>();

const emit = defineEmits<{
  select: [tabKey: LibraryTabKey];
}>();

const collectionEntries = computed(function () {
  return (Object.keys(COLLECTIONS) as CollectionKey[]).map(function (key) {
    return {
      key: key,
      name: t('collections.' + key)
    };
  });
});

const activeTabKey = computed(function () {
  return props.activeTab || props.activeCollection;
});
</script>

<template>
  <div
    class="segmented-tabs flex items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--segmented)] p-[3px]"
    role="tablist"
    :aria-label="t('library.collections')"
  >
    <button
      v-for="collection in collectionEntries"
      :key="collection.key"
      class="segmented-tab min-h-8"
      :class="{
        'is-active': activeTabKey === collection.key
      }"
      type="button"
      role="tab"
      :aria-selected="activeTabKey === collection.key"
      @click="emit('select', collection.key)"
    >
      {{ collection.name }}
    </button>
    <button
      v-if="props.pendingCount"
      class="segmented-tab min-h-8"
      :class="{ 'is-active': activeTabKey === 'pending_remote' }"
      type="button"
      role="tab"
      :aria-selected="activeTabKey === 'pending_remote'"
      @click="emit('select', 'pending_remote')"
    >
      {{ t('pendingRemote.tab') }}
      <span
        class="pending-count-badge inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold leading-none text-white"
      >
        {{ props.pendingCount }}
      </span>
    </button>
  </div>
</template>
