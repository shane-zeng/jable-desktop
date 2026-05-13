<script setup lang="ts">
import { computed } from 'vue';
import { COLLECTIONS } from '../constants';
import type { CollectionKey } from '../../types/jable';

var props = defineProps<{
  activeCollection: CollectionKey;
}>();

var emit = defineEmits<{
  select: [collectionKey: CollectionKey];
}>();

var collectionEntries = computed(function () {
  return (Object.keys(COLLECTIONS) as CollectionKey[]).map(function (key) {
    return {
      key: key,
      name: COLLECTIONS[key].name
    };
  });
});
</script>

<template>
  <div
    class="flex items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--segmented)] p-[3px]"
    role="tablist"
    aria-label="Collections"
  >
    <button
      v-for="collection in collectionEntries"
      :key="collection.key"
      class="min-h-8 border-0 bg-transparent text-[var(--muted)]"
      :class="{
        '!bg-[var(--control)] !font-bold !text-[var(--text)] shadow-[var(--shadow)]':
          props.activeCollection === collection.key
      }"
      type="button"
      role="tab"
      :aria-selected="props.activeCollection === collection.key"
      @click="emit('select', collection.key)"
    >
      {{ collection.name }}
    </button>
  </div>
</template>
