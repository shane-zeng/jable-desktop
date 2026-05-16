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
      <button
        class="min-h-[34px] min-w-[84px] font-bold"
        :class="{ primary: activeView === 'settings' }"
        type="button"
        data-test="settings-view-button"
        :aria-pressed="activeView === 'settings'"
        @click="emit('set-view', 'settings')"
      >
        {{ i18n.t('topBar.settings') }}
      </button>
      <button type="button" hidden @click="emit('diagnose')">{{ i18n.t('topBar.diagnose') }}</button>
    </div>
  </header>
</template>
