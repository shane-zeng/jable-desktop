<script setup lang="ts">
import { computed, ref } from 'vue';
import { MAX_BROWSER_TABS_WARNING_THRESHOLD } from '../constants';
import { t, useI18n } from '../i18n';
import type { AppSettings, AppSettingsPatch, CollectionKey, ExportResource, SupportedLocale } from '../../types/jable';

type ImportDetectionSource = 'metadata' | 'filename' | 'unknown';
type ImportDetection = {
  collectionKey: CollectionKey | null;
  source: ImportDetectionSource;
};

const props = defineProps<{
  active: boolean;
  busy: boolean;
  settings: AppSettings;
  databasePath: string | null;
}>();

const emit = defineEmits<{
  'update-settings': [patch: AppSettingsPatch];
  'change-locale': [locale: SupportedLocale];
  'reset-tabs-width': [];
  'import-json': [payload: { collectionKey: CollectionKey; resource: ExportResource }];
  'export-json': [collectionKey: CollectionKey];
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

const speedOptions = [
  { value: 1, key: 'safe' },
  { value: 3, key: 'standard' },
  { value: 5, key: 'fast' }
];

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

function eventValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function eventChecked(event: Event) {
  return (event.target as HTMLInputElement).checked;
}

function updateSettings(patch: AppSettingsPatch) {
  emit('update-settings', patch);
}

function updateMaxBrowserTabs(event: Event) {
  updateSettings({ maxBrowserTabs: Number(eventValue(event)) });
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
</script>

<template>
  <section
    class="h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--panel)]"
    :class="active ? 'block' : 'hidden'"
    :aria-label="t('settings.aria')"
    data-test="settings-panel"
  >
    <div class="h-full overflow-auto">
      <div class="mx-auto grid max-w-[980px] gap-5 px-4 py-5">
        <header class="grid gap-1">
          <h1 class="text-xl font-bold">{{ t('settings.title') }}</h1>
          <p class="m-0 text-sm leading-6 text-[var(--muted)]">{{ t('settings.subtitle') }}</p>
        </header>

        <section class="grid gap-3 border-t border-[var(--panel-border)] pt-4">
          <h2 class="text-base font-bold">{{ t('settings.general.title') }}</h2>
          <div
            class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] items-center gap-3 max-[760px]:grid-cols-1"
          >
            <label for="settings-locale" class="text-sm font-semibold">{{ t('locale.label') }}</label>
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
        </section>

        <section class="grid gap-3 border-t border-[var(--panel-border)] pt-4">
          <h2 class="text-base font-bold">{{ t('settings.browser.title') }}</h2>
          <div class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] gap-3 max-[760px]:grid-cols-1">
            <label for="settings-max-tabs" class="pt-1 text-sm font-semibold">
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
              <p
                v-if="showMaxTabsWarning"
                class="m-0 max-w-[680px] text-xs leading-5 text-[#f2b35d]"
                data-test="settings-max-tabs-warning"
              >
                {{ t('settings.browser.maxTabsWarning') }}
              </p>
            </div>
          </div>

          <div
            class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] items-center gap-3 max-[760px]:grid-cols-1"
          >
            <span class="text-sm font-semibold">{{ t('settings.browser.compactTabs') }}</span>
            <label class="flex min-h-[34px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-test="settings-compact-tabs"
                :checked="settings.compactBrowserTabs"
                :disabled="busy"
                @change="updateSettings({ compactBrowserTabs: eventChecked($event) })"
              />
              <span>{{ t('settings.browser.compactTabsDescription') }}</span>
            </label>
          </div>

          <div
            class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] items-center gap-3 max-[760px]:grid-cols-1"
          >
            <span class="text-sm font-semibold">{{ t('settings.browser.tabWidth') }}</span>
            <button type="button" class="w-fit" :disabled="busy" @click="emit('reset-tabs-width')">
              {{ t('settings.browser.resetTabWidth') }}
            </button>
          </div>
        </section>

        <section class="grid gap-3 border-t border-[var(--panel-border)] pt-4">
          <h2 class="text-base font-bold">{{ t('settings.sync.title') }}</h2>
          <div class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] gap-3 max-[760px]:grid-cols-1">
            <span class="pt-1 text-sm font-semibold">{{ t('settings.sync.acceleration') }}</span>
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
              <p class="m-0 max-w-[680px] text-xs leading-5 text-[var(--muted)]">
                {{ t('settings.sync.accelerationDescription') }}
              </p>
              <p v-if="showFastSyncWarning" class="m-0 max-w-[680px] text-xs leading-5 text-[#f2b35d]">
                {{ t('settings.sync.fastWarning') }}
              </p>
            </div>
          </div>

          <div
            class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] items-center gap-3 max-[760px]:grid-cols-1"
          >
            <span class="text-sm font-semibold">{{ t('settings.sync.autoReplay') }}</span>
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

        <section class="grid gap-3 border-t border-[var(--panel-border)] pt-4">
          <h2 class="text-base font-bold">{{ t('settings.data.title') }}</h2>
          <div class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] gap-3 max-[760px]:grid-cols-1">
            <span class="pt-1 text-sm font-semibold">{{ t('settings.data.importJson') }}</span>
            <div class="grid gap-3">
              <div class="flex flex-wrap items-center gap-2">
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

              <p v-if="importError" class="m-0 text-sm leading-5 text-[#ff8794]">
                {{ t('settings.data.importParseFailed', { error: importError }) }}
              </p>

              <div v-if="importResource" class="grid gap-2">
                <p class="m-0 text-sm text-[var(--muted)]">
                  {{ importDetectionLabel }}
                  <span v-if="importTotal !== null">
                    · {{ t('settings.data.importRows', { count: importTotal }) }}
                  </span>
                </p>
                <div class="flex flex-wrap items-center gap-2">
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

          <div
            class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] items-center gap-3 max-[760px]:grid-cols-1"
          >
            <span class="text-sm font-semibold">{{ t('settings.data.exportJson') }}</span>
            <div class="flex flex-wrap items-center gap-2">
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

          <div class="grid grid-cols-[minmax(190px,260px)_minmax(220px,1fr)] gap-3 max-[760px]:grid-cols-1">
            <span class="text-sm font-semibold">{{ t('settings.data.databasePath') }}</span>
            <code class="min-w-0 break-all rounded-md bg-[var(--control)] px-2 py-1 text-xs text-[var(--muted)]">
              {{ databasePath || t('settings.data.databasePathUnavailable') }}
            </code>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>
