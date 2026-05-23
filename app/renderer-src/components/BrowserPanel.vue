<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BrowserTabRail from './BrowserTabRail.vue';
import { BROWSER_TABS_DEFAULT_WIDTH } from '../constants';
import { t } from '../i18n';
import type { BrowserTabMenuPayload, BrowserTabState } from '../../types/jable';

const COMPACT_TRIGGER_WIDTH = 18;
const COMPACT_DISMISS_WIDTH = 26;
const DOWNLOAD_SIDEBAR_COLLAPSED_WIDTH = 18;

const props = withDefaults(
  defineProps<{
    active: boolean;
    tabs: BrowserTabState[];
    activeTabId?: string | null;
    canCreateTab: boolean;
    compact: boolean;
    externalRail?: boolean;
    tabWidth?: number;
    showDownloadSidebar?: boolean;
    downloadSidebarCollapsed?: boolean;
    downloadSidebarWidth?: number;
  }>(),
  {
    activeTabId: null,
    externalRail: false,
    tabWidth: BROWSER_TABS_DEFAULT_WIDTH,
    showDownloadSidebar: false,
    downloadSidebarCollapsed: true,
    downloadSidebarWidth: 320
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

const downloadSidebarWidth = computed(function () {
  if (!props.showDownloadSidebar) return 0;
  return props.downloadSidebarCollapsed ? DOWNLOAD_SIDEBAR_COLLAPSED_WIDTH : props.downloadSidebarWidth;
});

const panelStyle = computed(function () {
  const columns = [];
  if (!props.externalRail) {
    columns.push(props.tabWidth + 'px');
    columns.push('6px');
  }
  columns.push('minmax(0, 1fr)');
  if (props.showDownloadSidebar) columns.push(downloadSidebarWidth.value + 'px');

  return {
    gridTemplateColumns: columns.join(' ')
  };
});

const compactHostStyle = computed(function () {
  return {
    left: compactTabsVisible.value ? props.tabWidth + COMPACT_DISMISS_WIDTH + 'px' : COMPACT_TRIGGER_WIDTH + 'px',
    right: downloadSidebarWidth.value + 'px'
  };
});

const downloadSidebarHostStyle = computed(function () {
  return {
    width: downloadSidebarWidth.value + 'px'
  };
});

onMounted(function () {
  emit('host', browserHost.value);
});
</script>

<template>
  <section
    class="relative min-h-0 min-w-0 overflow-hidden bg-[var(--browser-bg)]"
    :class="active ? (compact ? 'block h-full' : 'grid h-full') : 'hidden'"
    :style="active && !compact ? panelStyle : null"
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
      data-test="browser-host"
      :class="
        externalRail
          ? 'h-full min-h-0 w-full'
          : compact
            ? 'absolute inset-y-0 right-0 min-h-0'
            : 'h-full min-h-0 w-full'
      "
      :style="compact && !externalRail ? compactHostStyle : null"
    ></div>

    <div
      v-if="showDownloadSidebar"
      class="download-progress-sidebar-host"
      :class="compact ? 'absolute inset-y-0 right-0 min-h-0' : 'h-full min-h-0 w-full'"
      :style="compact ? downloadSidebarHostStyle : null"
      data-test="download-sidebar-host"
    >
      <slot name="download-sidebar"></slot>
    </div>
  </section>
</template>
