<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { BROWSER_TABS_DEFAULT_WIDTH, BROWSER_TABS_MAX_WIDTH, BROWSER_TABS_MIN_WIDTH } from '../constants';

var COMPACT_TRIGGER_WIDTH = 18;
var COMPACT_DISMISS_WIDTH = 26;

var props = defineProps({
  active: {
    type: Boolean,
    required: true
  },
  tabs: {
    type: Array,
    required: true
  },
  activeTabId: {
    type: String,
    default: null
  },
  canCreateTab: {
    type: Boolean,
    required: true
  },
  compact: {
    type: Boolean,
    required: true
  },
  tabWidth: {
    type: Number,
    default: BROWSER_TABS_DEFAULT_WIDTH
  }
});

var emit = defineEmits([
  'host',
  'layout-change',
  'new-tab',
  'activate-tab',
  'close-tab',
  'set-tab-muted',
  'tab-context-menu',
  'resize-tabs'
]);
var browserHost = ref(null);
var compactTabsVisible = ref(false);
var resizing = ref(false);
var resizeStart = ref({
  x: 0,
  width: BROWSER_TABS_DEFAULT_WIDTH
});

var panelStyle = computed(function () {
  return {
    gridTemplateColumns: props.tabWidth + 'px 6px minmax(0, 1fr)'
  };
});

var floatingTabsStyle = computed(function () {
  return {
    width: props.tabWidth + 'px'
  };
});

var compactHostStyle = computed(function () {
  return {
    left: compactTabsVisible.value ? props.tabWidth + COMPACT_DISMISS_WIDTH + 'px' : COMPACT_TRIGGER_WIDTH + 'px'
  };
});

var compactDismissStyle = computed(function () {
  return {
    left: props.tabWidth + 8 + 'px',
    width: COMPACT_DISMISS_WIDTH - 8 + 'px'
  };
});

function displayTitle(tab) {
  return tab.title || '新分頁';
}

function tabInitial(tab) {
  var title = displayTitle(tab);
  return title ? title.slice(0, 1).toUpperCase() : 'J';
}

function audioButtonLabel(tab) {
  return tab.muted ? '取消分頁靜音' : '分頁靜音';
}

function hasAudioIndicator(tab) {
  return !!(tab.muted || tab.audible || tab.mediaPlaying);
}

function showCompactTabs() {
  if (!props.compact || compactTabsVisible.value) return;
  compactTabsVisible.value = true;
  emit('layout-change');
}

function hideCompactTabs() {
  if (!props.compact || !compactTabsVisible.value || resizing.value) return;
  compactTabsVisible.value = false;
  emit('layout-change');
}

function openTabMenu(event, tab) {
  emit('tab-context-menu', {
    tabId: tab.id,
    x: event.clientX,
    y: event.clientY
  });
}

function openRailMenu(event) {
  if (event.target.closest('.browser-tab-row')) return;

  emit('tab-context-menu', {
    tabId: props.activeTabId,
    x: event.clientX,
    y: event.clientY
  });
}

function clampWidth(width) {
  return Math.max(BROWSER_TABS_MIN_WIDTH, Math.min(BROWSER_TABS_MAX_WIDTH, width));
}

function startResize(event) {
  resizing.value = true;
  resizeStart.value = {
    x: event.clientX,
    width: props.tabWidth
  };
  event.preventDefault();
  window.addEventListener('pointermove', resizeTabs);
  window.addEventListener('pointerup', stopResize);
}

function resizeTabs(event) {
  if (!resizing.value) return;

  emit('resize-tabs', clampWidth(resizeStart.value.width + event.clientX - resizeStart.value.x));
}

function stopResize() {
  var wasResizing = resizing.value;
  resizing.value = false;
  window.removeEventListener('pointermove', resizeTabs);
  window.removeEventListener('pointerup', stopResize);

  if (wasResizing) emit('layout-change');
}

function resetWidth() {
  emit('resize-tabs', BROWSER_TABS_DEFAULT_WIDTH);
}

onMounted(function () {
  emit('host', browserHost.value);
});

onBeforeUnmount(function () {
  stopResize();
});
</script>

<template>
  <section
    class="relative min-h-0 min-w-0 overflow-hidden bg-[var(--browser-bg)]"
    :class="
      active
        ? [
            compact
              ? 'block h-[calc(100vh-52px)] max-[1180px]:h-[calc(100vh-88px)]'
              : 'grid h-[calc(100vh-52px)] max-[1180px]:h-[calc(100vh-88px)]'
          ]
        : 'hidden'
    "
    :style="active && !compact ? panelStyle : null"
    aria-label="Jable browser"
  >
    <div
      v-if="compact"
      class="absolute inset-y-0 left-0 z-30 w-[18px]"
      data-test="compact-tab-trigger"
      @pointerenter="showCompactTabs"
    ></div>

    <aside
      v-show="!compact || compactTabsVisible"
      class="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-visible"
      :class="
        compact
          ? 'absolute inset-y-0 left-0 z-40 border-r border-[var(--panel-border)] bg-[var(--floating-panel)] shadow-[var(--floating-shadow)] backdrop-blur-md'
          : 'relative border-r border-[var(--panel-border)] bg-[var(--panel)]'
      "
      :style="compact ? floatingTabsStyle : null"
      aria-label="Browser tabs"
      @pointerenter="showCompactTabs"
      @mouseleave="hideCompactTabs"
    >
      <div
        class="min-h-0 overflow-auto"
        :class="compact ? 'p-2.5 pt-3' : 'p-2.5'"
        role="tablist"
        aria-label="Browser pages"
        @contextmenu.prevent.stop="openRailMenu"
      >
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="browser-tab-row group relative mb-1 h-11 rounded-[13px] border border-transparent"
          :class="{ 'is-active': tab.id === activeTabId, 'has-audio': hasAudioIndicator(tab) }"
          @contextmenu.prevent.stop="openTabMenu($event, tab)"
        >
          <button
            class="browser-tab-main grid h-full w-full items-center gap-2 border-0 bg-transparent px-2.5 py-0 pr-10 text-left hover:bg-transparent"
            :class="hasAudioIndicator(tab) ? 'has-audio' : 'grid-cols-[28px_minmax(0,1fr)]'"
            type="button"
            role="tab"
            :title="displayTitle(tab)"
            :aria-selected="tab.id === activeTabId"
            @click="emit('activate-tab', tab.id)"
          >
            <img v-if="tab.favicon" class="h-6 w-6 rounded-md" :src="tab.favicon" alt="" draggable="false" />
            <span
              v-else
              class="grid h-6 w-6 place-items-center rounded-md text-xs font-bold text-[var(--text)]"
              :class="tab.locked ? 'bg-[var(--accent)] text-white' : 'bg-[var(--control)]'"
            >
              {{ tab.loading ? '...' : tabInitial(tab) }}
            </span>
            <span
              v-if="hasAudioIndicator(tab)"
              class="browser-tab-audio grid h-6 w-6 place-items-center text-[14px] leading-none"
              :class="{
                'is-muted': tab.muted,
                'is-audible': tab.audible && !tab.muted
              }"
              role="button"
              tabindex="-1"
              :aria-label="audioButtonLabel(tab)"
              @click.stop.prevent="emit('set-tab-muted', { tabId: tab.id, muted: !tab.muted })"
            >
              <svg v-if="tab.muted" class="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M4 9v6h4l5 4V5L8 9H4Zm13.6 3 2.7-2.7-1.6-1.6-2.7 2.7-2.7-2.7-1.6 1.6 2.7 2.7-2.7 2.7 1.6 1.6 2.7-2.7 2.7 2.7 1.6-1.6L17.6 12Z"
                />
              </svg>
              <svg v-else class="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4Z" />
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-width="2"
                  d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
                />
              </svg>
            </span>
            <span class="browser-tab-title min-w-0 text-[14px] font-semibold leading-[1.25] text-[var(--text)]">
              {{ displayTitle(tab) }}
            </span>
          </button>
          <button
            class="browser-tab-close absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center border-0 bg-transparent px-0 text-[24px] leading-none"
            type="button"
            title="關閉分頁"
            aria-label="關閉分頁"
            :disabled="tab.locked"
            @click.stop="emit('close-tab', tab.id)"
          >
            ×
          </button>
        </div>

        <button
          class="browser-new-tab mt-2 grid h-11 w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent px-2.5 py-0 text-left text-[var(--muted)]"
          type="button"
          title="新增分頁"
          aria-label="新增分頁"
          :disabled="!canCreateTab"
          @click="emit('new-tab')"
        >
          <span class="text-2xl leading-none">+</span>
          <span class="min-w-0 truncate text-[15px] font-semibold">新增分頁</span>
        </button>
      </div>

      <div
        v-if="compact"
        class="absolute bottom-0 right-[-6px] top-0 z-50 w-3 cursor-col-resize rounded-full bg-transparent hover:bg-[var(--segmented)]"
        role="separator"
        aria-orientation="vertical"
        title="拖曳調整分頁列寬度"
        @pointerdown="startResize"
        @dblclick="resetWidth"
      ></div>
    </aside>

    <div
      v-if="compact && compactTabsVisible"
      class="absolute inset-y-0 z-30"
      :style="compactDismissStyle"
      data-test="compact-dismiss-zone"
      @pointerenter="hideCompactTabs"
      @pointermove="hideCompactTabs"
    ></div>

    <div
      v-if="!compact"
      class="relative cursor-col-resize border-r border-[var(--panel-border)] bg-[var(--browser-bg)] hover:bg-[var(--segmented)]"
      role="separator"
      aria-orientation="vertical"
      title="拖曳調整分頁列寬度"
      @pointerdown="startResize"
      @dblclick="resetWidth"
    ></div>

    <div
      ref="browserHost"
      class="block"
      :class="
        compact
          ? 'absolute inset-y-0 right-0 min-h-0'
          : 'h-[calc(100vh-52px)] min-h-[calc(100vh-52px)] w-full max-[1180px]:h-[calc(100vh-88px)] max-[1180px]:min-h-[calc(100vh-88px)]'
      "
      :style="compact ? compactHostStyle : null"
    ></div>
  </section>
</template>
