<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BrowserTabRail from './BrowserTabRail.vue';
import { BROWSER_TABS_DEFAULT_WIDTH } from '../constants';
import { t } from '../i18n';
import type { BrowserTabMenuPayload, BrowserTabState } from '../../types/jable';

const COMPACT_TRIGGER_WIDTH = 18;
const COMPACT_DISMISS_WIDTH = 26;

const props = withDefaults(
  defineProps<{
    active: boolean;
    tabs: BrowserTabState[];
    activeTabId?: string | null;
    canCreateTab: boolean;
    compact: boolean;
    externalRail?: boolean;
    tabWidth?: number;
  }>(),
  {
    activeTabId: null,
    externalRail: false,
    tabWidth: BROWSER_TABS_DEFAULT_WIDTH
  }
);

const emit = defineEmits<{
  host: [element: HTMLElement | null];
  'layout-change': [];
  'new-tab': [];
  'activate-tab': [tabId: string];
  'close-tab': [tabId: string];
  'set-tab-muted': [payload: { tabId: string; muted: boolean }];
  'tab-context-menu': [payload: BrowserTabMenuPayload];
  'resize-tabs': [width: number];
}>();
const browserHost = ref<HTMLElement | null>(null);
const compactTabsVisible = ref(false);

const panelStyle = computed(function () {
  return {
    gridTemplateColumns: props.tabWidth + 'px 6px minmax(0, 1fr)'
  };
});

const compactHostStyle = computed(function () {
  return {
    left: compactTabsVisible.value ? props.tabWidth + COMPACT_DISMISS_WIDTH + 'px' : COMPACT_TRIGGER_WIDTH + 'px'
  };
});

onMounted(function () {
  emit('host', browserHost.value);
});
</script>

<template>
  <section
    class="relative min-h-0 min-w-0 overflow-hidden bg-[var(--browser-bg)]"
    :class="active ? (externalRail ? 'block h-full' : [compact ? 'block h-full' : 'grid h-full']) : 'hidden'"
    :style="active && !compact && !externalRail ? panelStyle : null"
    :aria-label="t('browser.aria')"
  >
    <BrowserTabRail
      v-if="!externalRail"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :can-create-tab="canCreateTab"
      :compact="compact"
      :tab-width="tabWidth"
      @new-tab="emit('new-tab')"
      @activate-tab="emit('activate-tab', $event)"
      @close-tab="emit('close-tab', $event)"
      @set-tab-muted="emit('set-tab-muted', $event)"
      @tab-context-menu="emit('tab-context-menu', $event)"
      @resize-tabs="emit('resize-tabs', $event)"
      @layout-change="emit('layout-change')"
      @compact-visibility-change="compactTabsVisible = $event"
    />

    <div
      ref="browserHost"
      class="block"
      :class="
        externalRail
          ? 'h-full min-h-0 w-full'
          : compact
            ? 'absolute inset-y-0 right-0 min-h-0'
            : 'h-full min-h-0 w-full'
      "
      :style="compact && !externalRail ? compactHostStyle : null"
    ></div>
  </section>
</template>
