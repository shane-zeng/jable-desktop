<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  BROWSER_TABS_MODE_OPTIONS,
  DOWNLOAD_SPEED_MODE_OPTIONS,
  MAX_BROWSER_TABS_WARNING_THRESHOLD,
  MAX_CONCURRENT_DOWNLOADS_LIMITS
} from '../constants';
import { t, useI18n } from '../i18n';
import {
  SHORTCUT_CATALOG,
  SHORTCUT_CATEGORIES,
  formatShortcutCombo,
  formatShortcutKeyToken,
  isShortcutMacosToken,
  isShortcutSymbolToken,
  shortcutCombosForPlatform
} from '../shortcut-catalog';
import type { ShortcutCatalogItem, ShortcutCategory, ShortcutCombo, ShortcutKeyToken } from '../shortcut-catalog';
import type {
  AppSettings,
  AppSettingsPatch,
  AppPlatform,
  BrowserTabsMode,
  CollectionKey,
  DownloadRootInfo,
  DownloadSpeedMode,
  ExportResource,
  FfmpegStatus,
  SupportedLocale
} from '../../types/jable';

type ImportDetectionSource = 'metadata' | 'filename' | 'unknown';
type ImportDetection = {
  collectionKey: CollectionKey | null;
  source: ImportDetectionSource;
};

const props = defineProps<{
  active: boolean;
  busy: boolean;
  settings: AppSettings;
  ffmpegStatus: FfmpegStatus | null;
  downloadRoot: DownloadRootInfo | null;
  databasePath: string | null;
  platform: AppPlatform | null;
  appVersion: string | null;
}>();

const emit = defineEmits<{
  'update-settings': [patch: AppSettingsPatch];
  'change-locale': [locale: SupportedLocale];
  'reset-tabs-width': [];
  'refresh-ffmpeg': [];
  'choose-ffmpeg': [];
  'clear-ffmpeg': [];
  'choose-download-root': [];
  'clear-download-root': [];
  'open-download-root': [];
  'open-data-folder': [];
  'open-log-folder': [];
  'clear-diagnostics': [];
  'check-updates': [];
  'import-json': [payload: { collectionKey: CollectionKey; resource: ExportResource }];
  'export-json': [collectionKey: CollectionKey];
  'export-settings-backup': [];
  'export-full-backup': [];
  'import-app-backup': [];
}>();

const i18n = useI18n();
const importFile = ref<HTMLInputElement | null>(null);
const importFileName = ref('');
const importResource = ref<ExportResource | null>(null);
const importDetection = ref<ImportDetection>({ collectionKey: null, source: 'unknown' });
const importTargetCollection = ref<CollectionKey | ''>('');
const importTotal = ref<number | null>(null);
const importError = ref('');
const exportCollection = ref<CollectionKey>('favourites');
const activeSettingsSection = ref<SettingsSectionId>('settings-general');
const shortcutSearch = ref('');
const selectedShortcutId = ref(SHORTCUT_CATALOG[0] ? SHORTCUT_CATALOG[0].id : '');
const shortcutList = ref<HTMLElement | null>(null);

const speedOptions = [
  { value: 1, key: 'safe' },
  { value: 3, key: 'standard' },
  { value: 5, key: 'fast' }
];
const settingsSections = [
  { id: 'settings-general', labelKey: 'settings.general.title' },
  { id: 'settings-browser', labelKey: 'settings.browser.title' },
  { id: 'settings-shortcuts', labelKey: 'settings.shortcuts.title' },
  { id: 'settings-sync', labelKey: 'settings.sync.title' },
  { id: 'settings-downloads', labelKey: 'settings.downloads.title' },
  { id: 'settings-data', labelKey: 'settings.data.title' }
] as const;
const downloadSpeedModeHints: Record<DownloadSpeedMode, string> = {
  stable: 'stableHint',
  balanced: 'balancedHint',
  fast: 'fastHint'
};

type SettingsSectionId = (typeof settingsSections)[number]['id'];
type ShortcutDisplayKey = {
  combo: ShortcutCombo;
  label: string;
};
type ShortcutDisplayItem = {
  item: ShortcutCatalogItem;
  displayKeys: ShortcutDisplayKey[];
};

const showMaxTabsWarning = computed(function () {
  return props.settings.maxBrowserTabs > MAX_BROWSER_TABS_WARNING_THRESHOLD;
});

const showFastSyncWarning = computed(function () {
  return props.settings.fullSyncAjaxWindowSize >= 5;
});

const importDetectionLabel = computed(function () {
  const detection = importDetection.value;
  if (!detection.collectionKey) return t('settings.data.importDetectionUnknown');

  return detection.source === 'metadata'
    ? t('settings.data.importDetectionMetadata', { collection: t('collections.' + detection.collectionKey) })
    : t('settings.data.importDetectionFilename', { collection: t('collections.' + detection.collectionKey) });
});

const ffmpegStateLabel = computed(function () {
  const state = props.ffmpegStatus ? props.ffmpegStatus.state : 'missing';
  return t('settings.downloads.ffmpeg.state.' + state);
});

const ffmpegSourceLabel = computed(function () {
  const source = props.ffmpegStatus ? props.ffmpegStatus.source : null;
  if (source === 'manual') return t('settings.downloads.ffmpeg.sourceManual');
  if (source === 'path') return t('settings.downloads.ffmpeg.sourcePath');
  return t('settings.downloads.ffmpeg.sourceNone');
});

const ffmpegStatusClass = computed(function () {
  return props.ffmpegStatus && props.ffmpegStatus.state === 'detected' ? 'intent-text-success' : 'intent-text-warning';
});

const downloadRootPath = computed(function () {
  if (props.downloadRoot && props.downloadRoot.path) return props.downloadRoot.path;
  if (props.settings.downloadRoot) return props.settings.downloadRoot;
  return t('settings.downloads.root.pathUnavailable');
});

const downloadRootSourceLabel = computed(function () {
  if (props.downloadRoot && props.downloadRoot.source === 'manual') return t('settings.downloads.root.sourceManual');
  return t('settings.downloads.root.sourceDefault');
});

const shortcutDisplayItems = computed<ShortcutDisplayItem[]>(function () {
  const query = shortcutSearch.value.trim().toLowerCase();
  const items: ShortcutDisplayItem[] = [];

  for (let i = 0; i < SHORTCUT_CATALOG.length; i++) {
    const item = SHORTCUT_CATALOG[i];
    const displayKeys = shortcutCombosForPlatform(item, props.platform).map(function (combo) {
      return {
        combo: combo,
        label: formatShortcutCombo(combo, props.platform)
      };
    });
    const searchable = [
      t('settings.shortcuts.categories.' + item.category),
      t(item.labelKey),
      t(item.descriptionKey),
      t(item.scopeKey),
      displayKeys
        .map(function (key) {
          return key.label;
        })
        .join(' ')
    ]
      .join(' ')
      .toLowerCase();

    if (!query || searchable.indexOf(query) !== -1) items.push({ item: item, displayKeys: displayKeys });
  }

  return items;
});

const shortcutGroups = computed(function () {
  return SHORTCUT_CATEGORIES.map(function (category) {
    return {
      category: category,
      items: shortcutDisplayItems.value.filter(function (displayItem) {
        return displayItem.item.category === category;
      })
    };
  }).filter(function (group) {
    return group.items.length > 0;
  });
});

const selectedShortcut = computed<ShortcutDisplayItem | null>(function () {
  for (let i = 0; i < shortcutDisplayItems.value.length; i++) {
    if (shortcutDisplayItems.value[i].item.id === selectedShortcutId.value) return shortcutDisplayItems.value[i];
  }

  return shortcutDisplayItems.value[0] || null;
});

function eventValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function eventChecked(event: Event) {
  return (event.target as HTMLInputElement).checked;
}

function updateSettings(patch: AppSettingsPatch) {
  emit('update-settings', patch);
}

function updateBrowserTabsMode(mode: BrowserTabsMode) {
  updateSettings({ browserTabsMode: mode });
}

function updateMaxBrowserTabs(event: Event) {
  updateSettings({ maxBrowserTabs: Number(eventValue(event)) });
}

function updateMaxConcurrentDownloads(event: Event) {
  updateSettings({ maxConcurrentDownloads: Number(eventValue(event)) });
}

function updateDownloadSpeedMode(mode: DownloadSpeedMode) {
  updateSettings({ downloadSpeedMode: mode });
}

function updateAutoDownloadOnPlayback(event: Event) {
  updateSettings({ autoDownloadOnPlayback: eventChecked(event) });
}

function updateDownloadSidebarEnabled(event: Event) {
  updateSettings({ downloadSidebarEnabled: eventChecked(event) });
}

function updateLocale(event: Event) {
  emit('change-locale', i18n.normalizeLocale(eventValue(event)));
}

function collectionFromText(value: unknown): CollectionKey | null {
  const text = String(value || '').toLowerCase();
  if (!text) return null;
  if (text.indexOf('videos-watch-later') !== -1 || text.indexOf('watch_later') !== -1) return 'watch_later';
  if (text.indexOf('/my/favourites/videos/') !== -1 || text.indexOf('favourites') !== -1) return 'favourites';
  if (text.indexOf('favorites') !== -1) return 'favourites';
  return null;
}

function detectImportCollection(resource: ExportResource, fileName: string): ImportDetection {
  const meta = resource && resource.meta ? resource.meta : null;
  const metadataMatch = collectionFromText(
    [meta && meta.source_path, meta && meta.source_url].filter(Boolean).join(' ')
  );
  if (metadataMatch) return { collectionKey: metadataMatch, source: 'metadata' };

  const filenameMatch = collectionFromText(fileName);
  if (filenameMatch) return { collectionKey: filenameMatch, source: 'filename' };

  return { collectionKey: null, source: 'unknown' };
}

function countImportRows(resource: ExportResource) {
  if (resource && resource.meta && Number.isFinite(Number(resource.meta.total))) return Number(resource.meta.total);
  if (!resource || !Array.isArray(resource.data)) return 0;

  let total = 0;
  for (let i = 0; i < resource.data.length; i++) {
    total += Array.isArray(resource.data[i].data) ? resource.data[i].data.length : 0;
  }
  return total;
}

function isAppBackupResource(value: unknown) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ((value as { kind?: unknown }).kind === 'jable-desktop-settings-backup' ||
      (value as { kind?: unknown }).kind === 'jable-desktop-full-backup')
  );
}

function chooseImportFile() {
  if (importFile.value) importFile.value.click();
}

async function handleImportFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files ? target.files[0] : null;
  target.value = '';
  if (!file) return;

  try {
    const resource = JSON.parse(await file.text()) as ExportResource;
    if (isAppBackupResource(resource)) throw new Error(t('settings.data.importJsonIsAppBackup'));
    const detection = detectImportCollection(resource, file.name);
    importFileName.value = file.name;
    importResource.value = resource;
    importDetection.value = detection;
    importTargetCollection.value = detection.collectionKey || '';
    importTotal.value = countImportRows(resource);
    importError.value = '';
  } catch (error) {
    importFileName.value = file.name;
    importResource.value = null;
    importDetection.value = { collectionKey: null, source: 'unknown' };
    importTargetCollection.value = '';
    importTotal.value = null;
    importError.value = error instanceof Error ? error.message : String(error);
  }
}

function updateImportTarget(event: Event) {
  const value = eventValue(event);
  importTargetCollection.value = value === 'watch_later' ? 'watch_later' : value === 'favourites' ? 'favourites' : '';
}

function confirmImport() {
  if (!importResource.value || !importTargetCollection.value) return;
  emit('import-json', {
    collectionKey: importTargetCollection.value,
    resource: importResource.value
  });
}

function selectSettingsSection(sectionId: SettingsSectionId) {
  activeSettingsSection.value = sectionId;
}

function selectShortcut(itemId: string) {
  selectedShortcutId.value = itemId;
}

function shortcutIndex(itemId: string) {
  for (let i = 0; i < shortcutDisplayItems.value.length; i++) {
    if (shortcutDisplayItems.value[i].item.id === itemId) return i;
  }

  return -1;
}

function focusShortcutRow(itemId: string) {
  void nextTick(function () {
    const listElement = shortcutList.value;
    if (!listElement) return;

    const rows = Array.from(listElement.querySelectorAll<HTMLElement>('[data-shortcut-id]'));
    const row = rows.find(function (element) {
      return element.dataset.shortcutId === itemId;
    });
    if (row) row.focus();
  });
}

function moveShortcutSelection(targetIndex: number) {
  const items = shortcutDisplayItems.value;
  if (!items.length) return;

  const boundedIndex = Math.max(0, Math.min(items.length - 1, targetIndex));
  const nextId = items[boundedIndex].item.id;
  selectedShortcutId.value = nextId;
  focusShortcutRow(nextId);
}

function handleShortcutRowKeydown(event: KeyboardEvent, itemId: string) {
  const currentIndex = shortcutIndex(itemId);
  if (currentIndex === -1) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveShortcutSelection(currentIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveShortcutSelection(currentIndex - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    moveShortcutSelection(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    moveShortcutSelection(shortcutDisplayItems.value.length - 1);
  }
}

function shortcutCategoryLabel(category: ShortcutCategory) {
  return t('settings.shortcuts.categories.' + category);
}

function shortcutTokenLabel(token: ShortcutKeyToken) {
  return formatShortcutKeyToken(token, props.platform);
}

function shortcutTokenClass(token: ShortcutKeyToken) {
  return {
    'is-macos': isShortcutMacosToken(token, props.platform),
    'is-symbol': isShortcutSymbolToken(token, props.platform)
  };
}

function shortcutTokenSeparator(tokenIndex: number) {
  return props.platform === 'macos' || tokenIndex === 0 ? '' : '+';
}
</script>

<template>
  <section
    class="h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--panel)]"
    :class="active ? 'block' : 'hidden'"
    :aria-label="t('settings.aria')"
    data-test="settings-panel"
  >
    <div class="h-full overflow-auto">
      <div class="settings-page">
        <header class="grid gap-1">
          <h1 class="text-xl font-bold">{{ t('settings.title') }}</h1>
          <p class="m-0 text-sm leading-6 text-[var(--muted)]">{{ t('settings.subtitle') }}</p>
        </header>

        <div class="settings-layout">
          <nav class="settings-section-nav" :aria-label="t('settings.navigation')" data-test="settings-section-nav">
            <button
              v-for="section in settingsSections"
              :key="section.id"
              type="button"
              class="settings-section-nav-link"
              :class="{ 'is-active': activeSettingsSection === section.id }"
              :aria-current="activeSettingsSection === section.id ? 'page' : undefined"
              :data-test="'settings-section-link-' + section.id"
              @click="selectSettingsSection(section.id)"
            >
              {{ t(section.labelKey) }}
            </button>
          </nav>

          <div class="settings-section-content">
            <section
              v-show="activeSettingsSection === 'settings-general'"
              id="settings-general"
              class="settings-section"
            >
              <h2 class="text-base font-bold">{{ t('settings.general.title') }}</h2>
              <div class="settings-row settings-row-center">
                <label for="settings-locale" class="settings-label">{{ t('locale.label') }}</label>
                <select
                  id="settings-locale"
                  class="w-full max-w-[260px]"
                  :aria-label="t('locale.label')"
                  :value="i18n.locale.value"
                  @change="updateLocale"
                >
                  <option v-for="option in i18n.localeOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </div>
              <div v-if="appVersion" class="settings-row settings-row-center">
                <span class="settings-label">{{ t('settings.general.version') }}</span>
                <code class="settings-code" data-test="settings-app-version">{{ appVersion }}</code>
              </div>
              <div class="settings-row settings-row-center">
                <span class="settings-label">{{ t('settings.general.updates') }}</span>
                <button
                  type="button"
                  class="w-fit"
                  data-test="settings-check-updates"
                  :disabled="busy"
                  @click="emit('check-updates')"
                >
                  {{ t('settings.general.checkForUpdates') }}
                </button>
              </div>
            </section>

            <section
              v-show="activeSettingsSection === 'settings-browser'"
              id="settings-browser"
              class="settings-section"
            >
              <h2 class="text-base font-bold">{{ t('settings.browser.title') }}</h2>
              <div class="settings-row">
                <label for="settings-max-tabs" class="settings-label">
                  {{ t('settings.browser.maxTabs') }}
                </label>
                <div class="grid gap-2">
                  <input
                    id="settings-max-tabs"
                    class="w-[120px]"
                    data-test="settings-max-tabs"
                    type="number"
                    min="4"
                    max="30"
                    step="1"
                    :value="settings.maxBrowserTabs"
                    :disabled="busy"
                    @change="updateMaxBrowserTabs"
                  />
                  <p v-if="showMaxTabsWarning" class="settings-warning" data-test="settings-max-tabs-warning">
                    {{ t('settings.browser.maxTabsWarning') }}
                  </p>
                </div>
              </div>

              <div class="settings-row">
                <span class="settings-label">{{ t('settings.browser.tabsMode') }}</span>
                <div class="grid gap-2">
                  <div
                    class="segmented-tabs flex w-fit flex-wrap items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--segmented)] p-[3px]"
                  >
                    <button
                      v-for="option in BROWSER_TABS_MODE_OPTIONS"
                      :key="option.value"
                      class="segmented-tab min-h-[30px]"
                      :class="{ 'is-active': settings.browserTabsMode === option.value }"
                      type="button"
                      :data-test="'settings-browser-tabs-mode-' + option.value"
                      :aria-pressed="settings.browserTabsMode === option.value"
                      :disabled="busy"
                      @click="updateBrowserTabsMode(option.value)"
                    >
                      {{ t('settings.browser.tabsModeOptions.' + option.value) }}
                    </button>
                  </div>
                  <p class="settings-help">
                    {{ t('settings.browser.tabsModeDescription') }}
                  </p>
                </div>
              </div>

              <div class="settings-row settings-row-center">
                <span class="settings-label">{{ t('settings.browser.restoreTabsOnStartup') }}</span>
                <label class="flex min-h-[34px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-test="settings-restore-browser-tabs-on-startup"
                    :checked="settings.restoreBrowserTabsOnStartup"
                    :disabled="busy"
                    @change="updateSettings({ restoreBrowserTabsOnStartup: eventChecked($event) })"
                  />
                  <span>{{ t('settings.browser.restoreTabsOnStartupDescription') }}</span>
                </label>
              </div>

              <div class="settings-row settings-row-center">
                <span class="settings-label">{{ t('settings.browser.webViewEnhancementMode') }}</span>
                <label class="flex min-h-[34px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-test="settings-webview-enhancement-mode"
                    :checked="settings.webViewEnhancementMode"
                    :disabled="busy"
                    @change="updateSettings({ webViewEnhancementMode: eventChecked($event) })"
                  />
                  <span>{{ t('settings.browser.webViewEnhancementModeDescription') }}</span>
                </label>
              </div>

              <div class="settings-row settings-row-center">
                <span class="settings-label">{{ t('settings.browser.tabWidth') }}</span>
                <button type="button" class="w-fit" :disabled="busy" @click="emit('reset-tabs-width')">
                  {{ t('settings.browser.resetTabWidth') }}
                </button>
              </div>
            </section>

            <section
              v-show="activeSettingsSection === 'settings-shortcuts'"
              id="settings-shortcuts"
              class="settings-section"
            >
              <h2 class="text-base font-bold">{{ t('settings.shortcuts.title') }}</h2>
              <div class="settings-shortcuts-layout">
                <div class="grid min-w-0 gap-3">
                  <label for="settings-shortcut-search" class="sr-only">
                    {{ t('settings.shortcuts.searchLabel') }}
                  </label>
                  <input
                    id="settings-shortcut-search"
                    v-model="shortcutSearch"
                    class="settings-shortcut-search"
                    data-test="settings-shortcut-search"
                    type="search"
                    :placeholder="t('settings.shortcuts.searchPlaceholder')"
                    :aria-label="t('settings.shortcuts.searchLabel')"
                  />

                  <div ref="shortcutList" class="settings-shortcut-list" data-test="settings-shortcut-list">
                    <template v-for="group in shortcutGroups" :key="group.category">
                      <h3 class="settings-shortcut-category">{{ shortcutCategoryLabel(group.category) }}</h3>
                      <button
                        v-for="shortcut in group.items"
                        :key="shortcut.item.id"
                        type="button"
                        class="settings-shortcut-row"
                        :class="{ 'is-active': selectedShortcut && selectedShortcut.item.id === shortcut.item.id }"
                        :data-test="'settings-shortcut-row-' + shortcut.item.id"
                        :data-shortcut-id="shortcut.item.id"
                        :aria-current="
                          selectedShortcut && selectedShortcut.item.id === shortcut.item.id ? 'true' : undefined
                        "
                        @click="selectShortcut(shortcut.item.id)"
                        @keydown="handleShortcutRowKeydown($event, shortcut.item.id)"
                      >
                        <span class="settings-shortcut-row-copy">
                          <span class="settings-shortcut-name">{{ t(shortcut.item.labelKey) }}</span>
                          <span class="settings-shortcut-scope">{{ t(shortcut.item.scopeKey) }}</span>
                        </span>
                        <span class="settings-shortcut-keys" :data-test="'settings-shortcut-keys-' + shortcut.item.id">
                          <kbd
                            v-for="key in shortcut.displayKeys"
                            :key="key.label"
                            class="settings-shortcut-key"
                            :aria-label="key.label"
                          >
                            <template v-for="(token, tokenIndex) in key.combo" :key="token + '-' + tokenIndex">
                              <span v-if="shortcutTokenSeparator(tokenIndex)" class="settings-shortcut-key-separator">
                                {{ shortcutTokenSeparator(tokenIndex) }}
                              </span>
                              <span class="settings-shortcut-key-token" :class="shortcutTokenClass(token)">
                                {{ shortcutTokenLabel(token) }}
                              </span>
                            </template>
                          </kbd>
                        </span>
                      </button>
                    </template>

                    <p
                      v-if="shortcutDisplayItems.length === 0"
                      class="settings-help p-4"
                      data-test="settings-shortcut-empty"
                    >
                      {{ t('settings.shortcuts.noResults') }}
                    </p>
                  </div>
                </div>

                <aside v-if="selectedShortcut" class="settings-shortcut-detail" data-test="settings-shortcut-detail">
                  <p class="settings-shortcut-detail-eyebrow">{{ t(selectedShortcut.item.scopeKey) }}</p>
                  <h3 class="m-0 text-lg font-bold">{{ t(selectedShortcut.item.labelKey) }}</h3>
                  <p class="settings-help">{{ t(selectedShortcut.item.descriptionKey) }}</p>
                  <div class="settings-shortcut-detail-keys">
                    <kbd
                      v-for="key in selectedShortcut.displayKeys"
                      :key="key.label"
                      class="settings-shortcut-key"
                      :aria-label="key.label"
                    >
                      <template v-for="(token, tokenIndex) in key.combo" :key="token + '-' + tokenIndex">
                        <span v-if="shortcutTokenSeparator(tokenIndex)" class="settings-shortcut-key-separator">
                          {{ shortcutTokenSeparator(tokenIndex) }}
                        </span>
                        <span class="settings-shortcut-key-token" :class="shortcutTokenClass(token)">
                          {{ shortcutTokenLabel(token) }}
                        </span>
                      </template>
                    </kbd>
                  </div>
                </aside>
              </div>
            </section>

            <section v-show="activeSettingsSection === 'settings-sync'" id="settings-sync" class="settings-section">
              <h2 class="text-base font-bold">{{ t('settings.sync.title') }}</h2>
              <div class="settings-row">
                <span class="settings-label">{{ t('settings.sync.acceleration') }}</span>
                <div class="grid gap-2">
                  <div
                    class="segmented-tabs flex w-fit items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--segmented)] p-[3px]"
                  >
                    <button
                      v-for="option in speedOptions"
                      :key="option.value"
                      class="segmented-tab min-h-[30px]"
                      :class="{ 'is-active': settings.fullSyncAjaxWindowSize === option.value }"
                      type="button"
                      :data-test="'settings-speed-' + option.key"
                      :aria-pressed="settings.fullSyncAjaxWindowSize === option.value"
                      :disabled="busy"
                      @click="updateSettings({ fullSyncAjaxWindowSize: option.value })"
                    >
                      {{ t('settings.sync.speed.' + option.key) }}
                    </button>
                  </div>
                  <p class="settings-help">
                    {{ t('settings.sync.accelerationDescription') }}
                  </p>
                  <p v-if="showFastSyncWarning" class="settings-warning">
                    {{ t('settings.sync.fastWarning') }}
                  </p>
                </div>
              </div>

              <div class="settings-row settings-row-center">
                <span class="settings-label">{{ t('settings.sync.autoReplay') }}</span>
                <label class="flex min-h-[34px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-test="settings-auto-replay"
                    :checked="settings.autoReplayDeferredSyncOperations"
                    :disabled="busy"
                    @change="updateSettings({ autoReplayDeferredSyncOperations: eventChecked($event) })"
                  />
                  <span>{{ t('settings.sync.autoReplayDescription') }}</span>
                </label>
              </div>
            </section>

            <section
              v-show="activeSettingsSection === 'settings-downloads'"
              id="settings-downloads"
              class="settings-section"
            >
              <h2 class="text-base font-bold">{{ t('settings.downloads.title') }}</h2>
              <div class="settings-row">
                <span class="settings-label">{{ t('settings.downloads.ffmpeg.label') }}</span>
                <div class="grid gap-2">
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <span class="font-semibold" :class="ffmpegStatusClass" data-test="settings-ffmpeg-state">
                      {{ ffmpegStateLabel }}
                    </span>
                    <span class="text-[var(--muted)]">{{ ffmpegSourceLabel }}</span>
                  </div>
                  <code class="settings-code" data-test="settings-ffmpeg-path">
                    {{
                      (ffmpegStatus && ffmpegStatus.path) ||
                      settings.ffmpegPath ||
                      t('settings.downloads.ffmpeg.pathUnavailable')
                    }}
                  </code>
                  <p v-if="ffmpegStatus && ffmpegStatus.version" class="settings-help">
                    {{ ffmpegStatus.version }}
                  </p>
                  <p
                    v-if="ffmpegStatus && ffmpegStatus.error && ffmpegStatus.state !== 'missing'"
                    class="settings-warning"
                  >
                    {{ ffmpegStatus.error }}
                  </p>
                  <p class="settings-help">
                    {{ t('settings.downloads.ffmpeg.description') }}
                  </p>
                  <div class="settings-actions">
                    <button
                      type="button"
                      data-test="settings-ffmpeg-refresh"
                      :disabled="busy"
                      @click="emit('refresh-ffmpeg')"
                    >
                      {{ t('settings.downloads.ffmpeg.checkAgain') }}
                    </button>
                    <button
                      type="button"
                      data-test="settings-ffmpeg-choose"
                      :disabled="busy"
                      @click="emit('choose-ffmpeg')"
                    >
                      {{ t('settings.downloads.ffmpeg.chooseBinary') }}
                    </button>
                    <button
                      type="button"
                      data-test="settings-ffmpeg-clear"
                      :disabled="busy || !settings.ffmpegPath"
                      @click="emit('clear-ffmpeg')"
                    >
                      {{ t('settings.downloads.ffmpeg.usePath') }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="settings-row">
                <label for="settings-max-concurrent-downloads" class="settings-label">
                  {{ t('settings.downloads.concurrent.label') }}
                </label>
                <div class="grid gap-2">
                  <input
                    id="settings-max-concurrent-downloads"
                    class="w-[120px]"
                    data-test="settings-max-concurrent-downloads"
                    type="number"
                    :min="MAX_CONCURRENT_DOWNLOADS_LIMITS.min"
                    :max="MAX_CONCURRENT_DOWNLOADS_LIMITS.max"
                    step="1"
                    :value="settings.maxConcurrentDownloads"
                    :disabled="busy"
                    @change="updateMaxConcurrentDownloads"
                  />
                  <p class="settings-help">
                    {{ t('settings.downloads.concurrent.description') }}
                  </p>
                </div>
              </div>

              <div class="settings-row">
                <span class="settings-label">{{ t('settings.downloads.speed.label') }}</span>
                <div class="grid gap-2">
                  <div
                    class="segmented-tabs flex w-fit items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--segmented)] p-[3px]"
                  >
                    <button
                      v-for="option in DOWNLOAD_SPEED_MODE_OPTIONS"
                      :key="option.value"
                      class="segmented-tab min-h-[30px]"
                      :class="{ 'is-active': settings.downloadSpeedMode === option.value }"
                      type="button"
                      :data-test="'settings-download-speed-' + option.value"
                      :aria-pressed="settings.downloadSpeedMode === option.value"
                      :disabled="busy"
                      @click="updateDownloadSpeedMode(option.value)"
                    >
                      {{ t('options.downloadSpeedMode.' + option.value) }}
                    </button>
                  </div>
                  <p class="settings-help">
                    {{ t('settings.downloads.speed.description') }}
                  </p>
                  <p class="settings-warning">
                    {{ t('settings.downloads.speed.' + downloadSpeedModeHints[settings.downloadSpeedMode]) }}
                  </p>
                </div>
              </div>

              <div class="settings-row">
                <span class="settings-label">{{ t('settings.downloads.playback.label') }}</span>
                <label class="flex max-w-[680px] items-start gap-3 text-sm leading-6 text-[var(--muted)]">
                  <input
                    class="mt-1"
                    data-test="settings-auto-download-on-playback"
                    type="checkbox"
                    :checked="settings.autoDownloadOnPlayback"
                    :disabled="busy"
                    @change="updateAutoDownloadOnPlayback"
                  />
                  <span>{{ t('settings.downloads.playback.description') }}</span>
                </label>
              </div>

              <div class="settings-row">
                <span class="settings-label">{{ t('settings.downloads.sidebar.label') }}</span>
                <label class="flex max-w-[680px] items-start gap-3 text-sm leading-6 text-[var(--muted)]">
                  <input
                    class="mt-1"
                    data-test="settings-download-sidebar-enabled"
                    type="checkbox"
                    :checked="settings.downloadSidebarEnabled"
                    :disabled="busy"
                    @change="updateDownloadSidebarEnabled"
                  />
                  <span>{{ t('settings.downloads.sidebar.description') }}</span>
                </label>
              </div>

              <div class="settings-row">
                <span class="settings-label">{{ t('settings.downloads.root.label') }}</span>
                <div class="grid gap-2">
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <span class="font-semibold text-[var(--text)]">{{ downloadRootSourceLabel }}</span>
                  </div>
                  <code class="settings-code" data-test="settings-download-root-path">
                    {{ downloadRootPath }}
                  </code>
                  <p class="settings-help">
                    {{ t('settings.downloads.root.description') }}
                  </p>
                  <p v-if="downloadRoot && !downloadRoot.exists" class="settings-help">
                    {{ t('settings.downloads.root.missingHint') }}
                  </p>
                  <div class="settings-actions">
                    <button
                      type="button"
                      data-test="settings-download-root-choose"
                      :disabled="busy"
                      @click="emit('choose-download-root')"
                    >
                      {{ t('settings.downloads.root.chooseFolder') }}
                    </button>
                    <button
                      type="button"
                      data-test="settings-download-root-clear"
                      :disabled="busy || !settings.downloadRoot"
                      @click="emit('clear-download-root')"
                    >
                      {{ t('settings.downloads.root.useDefault') }}
                    </button>
                    <button
                      type="button"
                      data-test="settings-download-root-open"
                      :disabled="busy"
                      @click="emit('open-download-root')"
                    >
                      {{ t('settings.downloads.root.openFolder') }}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section v-show="activeSettingsSection === 'settings-data'" id="settings-data" class="settings-section">
              <h2 class="text-base font-bold">{{ t('settings.data.title') }}</h2>
              <div class="settings-row">
                <span class="settings-label">{{ t('settings.data.importJson') }}</span>
                <div class="grid gap-3">
                  <div class="settings-actions">
                    <button type="button" :disabled="busy" @click="chooseImportFile">
                      {{ t('settings.data.chooseJson') }}
                    </button>
                    <span v-if="importFileName" class="text-sm text-[var(--muted)]">{{ importFileName }}</span>
                    <input
                      ref="importFile"
                      data-test="settings-import-file"
                      type="file"
                      accept="application/json,.json"
                      hidden
                      @change="handleImportFile"
                    />
                  </div>

                  <p v-if="importError" class="intent-text-danger m-0 text-sm leading-5">
                    {{ t('settings.data.importParseFailed', { error: importError }) }}
                  </p>

                  <div v-if="importResource" class="grid gap-2">
                    <p class="m-0 text-sm text-[var(--muted)]">
                      {{ importDetectionLabel }}
                      <span v-if="importTotal !== null">
                        · {{ t('settings.data.importRows', { count: importTotal }) }}
                      </span>
                    </p>
                    <div class="settings-actions">
                      <label for="settings-import-target" class="text-sm font-semibold">
                        {{ t('settings.data.importTarget') }}
                      </label>
                      <select
                        id="settings-import-target"
                        data-test="settings-import-target"
                        :value="importTargetCollection"
                        :disabled="busy"
                        @change="updateImportTarget"
                      >
                        <option value="" disabled>{{ t('settings.data.importTargetPlaceholder') }}</option>
                        <option value="favourites">{{ t('collections.favourites') }}</option>
                        <option value="watch_later">{{ t('collections.watch_later') }}</option>
                      </select>
                      <button
                        type="button"
                        class="primary"
                        data-test="settings-import-confirm"
                        :disabled="busy || !importTargetCollection"
                        @click="confirmImport"
                      >
                        {{ t('settings.data.confirmImport') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="settings-row settings-row-center">
                <span class="settings-label">{{ t('settings.data.exportJson') }}</span>
                <div class="settings-actions">
                  <select v-model="exportCollection" :disabled="busy" :aria-label="t('settings.data.exportTarget')">
                    <option value="favourites">{{ t('collections.favourites') }}</option>
                    <option value="watch_later">{{ t('collections.watch_later') }}</option>
                  </select>
                  <button
                    type="button"
                    data-test="settings-export-button"
                    :disabled="busy"
                    @click="emit('export-json', exportCollection)"
                  >
                    {{ t('settings.data.exportAction') }}
                  </button>
                </div>
              </div>

              <div class="settings-row">
                <span class="settings-label">{{ t('settings.data.appBackup') }}</span>
                <div class="settings-actions">
                  <button
                    type="button"
                    data-test="settings-export-settings-backup"
                    :disabled="busy"
                    @click="emit('export-settings-backup')"
                  >
                    {{ t('settings.data.exportSettingsBackup') }}
                  </button>
                  <button
                    type="button"
                    data-test="settings-export-full-backup"
                    :disabled="busy"
                    @click="emit('export-full-backup')"
                  >
                    {{ t('settings.data.exportFullBackup') }}
                  </button>
                  <button
                    type="button"
                    class="primary"
                    data-test="settings-import-app-backup"
                    :disabled="busy"
                    @click="emit('import-app-backup')"
                  >
                    {{ t('settings.data.importAppBackup') }}
                  </button>
                </div>
              </div>

              <div class="settings-row">
                <span class="settings-label">{{ t('settings.data.databasePath') }}</span>
                <div class="grid gap-2">
                  <code class="settings-code">
                    {{ databasePath || t('settings.data.databasePathUnavailable') }}
                  </code>
                  <button
                    type="button"
                    class="w-fit"
                    data-test="settings-open-data-folder"
                    :disabled="busy || !databasePath"
                    @click="emit('open-data-folder')"
                  >
                    {{ t('settings.data.openFolder') }}
                  </button>
                </div>
              </div>

              <div class="settings-row">
                <span class="settings-label">{{ t('settings.data.diagnostics') }}</span>
                <div class="grid gap-2">
                  <p class="settings-help">{{ t('settings.data.diagnosticsDescription') }}</p>
                  <div class="settings-actions">
                    <button
                      type="button"
                      class="w-fit"
                      data-test="settings-open-log-folder"
                      :disabled="busy"
                      @click="emit('open-log-folder')"
                    >
                      {{ t('settings.data.openLogFolder') }}
                    </button>
                    <button
                      type="button"
                      class="w-fit"
                      data-test="settings-clear-diagnostics"
                      :disabled="busy"
                      @click="emit('clear-diagnostics')"
                    >
                      {{ t('settings.data.clearDiagnostics') }}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
