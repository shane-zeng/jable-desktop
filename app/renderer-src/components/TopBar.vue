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
    class="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--panel-border)] bg-[var(--panel)] px-3.5 max-[640px]:gap-2 max-[640px]:px-2.5"
  >
    <div class="flex min-w-0 items-center gap-2 max-[640px]:gap-1.5">
      <button
        class="w-[34px] px-0 text-xl leading-none max-[640px]:w-[30px]"
        type="button"
        :title="i18n.t('topBar.back')"
        :aria-label="i18n.t('topBar.back')"
        :disabled="activeView !== 'browser' || navigation.locked || !navigation.canGoBack"
        @click="emit('back')"
      >
        ‹
      </button>
      <button
        class="w-[34px] px-0 text-xl leading-none max-[640px]:w-[30px]"
        type="button"
        :title="i18n.t('topBar.next')"
        :aria-label="i18n.t('topBar.next')"
        :disabled="activeView !== 'browser' || navigation.locked || !navigation.canGoForward"
        @click="emit('forward')"
      >
        ›
      </button>
      <button
        class="w-[34px] px-0 text-xl leading-none max-[640px]:w-[30px]"
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
      class="segmented-tabs topbar-view-tabs flex min-w-0 items-center justify-self-end rounded-lg border border-[var(--panel-border)] bg-[var(--segmented)] p-[3px]"
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

    <button
      class="topbar-settings-button min-h-[34px] font-bold max-[640px]:min-h-[30px]"
      :class="{ primary: activeView === 'settings' }"
      type="button"
      data-test="settings-view-button"
      :aria-pressed="activeView === 'settings'"
      @click="emit('set-view', 'settings')"
    >
      {{ i18n.t('topBar.settings') }}
    </button>
    <button type="button" hidden @click="emit('diagnose')">{{ i18n.t('topBar.diagnose') }}</button>
  </header>
</template>
