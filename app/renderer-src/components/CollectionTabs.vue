<script setup lang="ts">
import { computed } from 'vue';
import { COLLECTIONS } from '../constants';
import { t } from '../i18n';
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
      name: t('collections.' + key)
    };
  });
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
        'is-active': props.activeCollection === collection.key
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
