<script setup lang="ts">
import { useI18n } from '../i18n';
import type { AppView, BrowserNavigationState } from '../../types/jable';

defineProps<{
  activeView: AppView;
  busy: boolean;
  navigation: BrowserNavigationState;
}>();

const emit = defineEmits<{
  'set-view': [view: AppView];
  back: [];
  forward: [];
  reload: [];
  diagnose: [];
}>();

const i18n = useI18n();

function updateLocale(event: Event) {
  i18n.setLocale((event.target as HTMLSelectElement).value);
}
</script>

<template>
  <header
    class="grid grid-cols-[minmax(240px,1fr)_auto_minmax(240px,1fr)] items-center gap-4 border-b border-[var(--panel-border)] bg-[var(--panel)] px-3.5 max-[1180px]:grid-cols-[minmax(180px,1fr)_auto]"
  >
    <div class="flex min-w-0 items-center gap-2">
      <button
        class="w-[34px] px-0 text-xl leading-none"
        type="button"
        :title="i18n.t('topBar.back')"
        :aria-label="i18n.t('topBar.back')"
        :disabled="activeView !== 'browser' || navigation.locked || !navigation.canGoBack"
        @click="emit('back')"
      >
        ‹
      </button>
      <button
        class="w-[34px] px-0 text-xl leading-none"
        type="button"
        :title="i18n.t('topBar.next')"
        :aria-label="i18n.t('topBar.next')"
        :disabled="activeView !== 'browser' || navigation.locked || !navigation.canGoForward"
        @click="emit('forward')"
      >
        ›
      </button>
      <button
        class="w-[34px] px-0 text-xl leading-none"
        type="button"
        :title="i18n.t('topBar.reload')"
        :aria-label="i18n.t('topBar.reload')"
        :disabled="activeView !== 'browser' || navigation.locked"
        @click="emit('reload')"
      >
        ↻
      </button>
    </div>

    <div
      class="segmented-tabs flex items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--segmented)] p-[3px] max-[1180px]:justify-self-start"
      role="tablist"
      :aria-label="i18n.t('topBar.mainViews')"
    >
      <button
        class="segmented-tab min-h-[30px]"
        :class="{
          'is-active': activeView === 'browser'
        }"
        type="button"
        role="tab"
        :aria-selected="activeView === 'browser'"
        @click="emit('set-view', 'browser')"
      >
        {{ i18n.t('topBar.browser') }}
      </button>
      <button
        class="segmented-tab min-h-[30px]"
        :class="{
          'is-active': activeView === 'library'
        }"
        type="button"
        role="tab"
        :aria-selected="activeView === 'library'"
        @click="emit('set-view', 'library')"
      >
        {{ i18n.t('topBar.library') }}
      </button>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 max-[1180px]:col-span-full max-[1180px]:justify-start">
      <label class="sr-only" for="app-locale-select">{{ i18n.t('locale.label') }}</label>
      <select
        id="app-locale-select"
        class="h-[34px] w-[132px] text-sm"
        :aria-label="i18n.t('locale.label')"
        :value="i18n.locale.value"
        @change="updateLocale"
      >
        <option v-for="option in i18n.localeOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <button type="button" hidden @click="emit('diagnose')">{{ i18n.t('topBar.diagnose') }}</button>
    </div>
  </header>
</template>
