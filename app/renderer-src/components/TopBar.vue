<script setup>
defineProps({
  activeView: {
    type: String,
    required: true
  },
  busy: {
    type: Boolean,
    required: true
  },
  navigation: {
    type: Object,
    required: true
  },
  status: {
    type: String,
    required: true
  },
  theme: {
    type: String,
    required: true
  }
});

var emit = defineEmits(['set-view', 'update:theme', 'back', 'forward', 'reload', 'diagnose']);

function updateTheme(event) {
  emit('update:theme', event.target.value);
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
        title="上一頁"
        aria-label="上一頁"
        :disabled="activeView !== 'browser' || navigation.locked || !navigation.canGoBack"
        @click="emit('back')"
      >
        ‹
      </button>
      <button
        class="w-[34px] px-0 text-xl leading-none"
        type="button"
        title="下一頁"
        aria-label="下一頁"
        :disabled="activeView !== 'browser' || navigation.locked || !navigation.canGoForward"
        @click="emit('forward')"
      >
        ›
      </button>
      <button
        class="w-[34px] px-0 text-xl leading-none"
        type="button"
        title="重新整理"
        aria-label="重新整理"
        :disabled="activeView !== 'browser' || navigation.locked"
        @click="emit('reload')"
      >
        ↻
      </button>
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[var(--muted)]">
        {{ status }}
      </span>
    </div>

    <div
      class="flex items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--segmented)] p-[3px] max-[1180px]:justify-self-start"
      role="tablist"
      aria-label="Main views"
    >
      <button
        class="min-h-[30px] border-0 bg-transparent text-[var(--muted)]"
        :class="{
          '!bg-[var(--control)] !font-bold !text-[var(--text)] shadow-[var(--shadow)]': activeView === 'browser'
        }"
        type="button"
        role="tab"
        :aria-selected="activeView === 'browser'"
        @click="emit('set-view', 'browser')"
      >
        瀏覽器
      </button>
      <button
        class="min-h-[30px] border-0 bg-transparent text-[var(--muted)]"
        :class="{
          '!bg-[var(--control)] !font-bold !text-[var(--text)] shadow-[var(--shadow)]': activeView === 'library'
        }"
        type="button"
        role="tab"
        :aria-selected="activeView === 'library'"
        @click="emit('set-view', 'library')"
      >
        本機資料
      </button>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 max-[1180px]:col-span-full max-[1180px]:justify-start">
      <select class="min-h-[34px]" aria-label="主題" :value="theme" @change="updateTheme">
        <option value="system">系統</option>
        <option value="dark">深色</option>
        <option value="light">淺色</option>
      </select>
      <button type="button" hidden @click="emit('diagnose')">診斷</button>
    </div>
  </header>
</template>
