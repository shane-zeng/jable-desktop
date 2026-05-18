import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { DownloadRecord } from '../../types/jable';

export const DOWNLOAD_ERROR_LOG_PREVIEW_LIMIT = 100;

const DOWNLOAD_ERROR_LOG_SEQUENCE = ['d', 'l', 'e'];
const DOWNLOAD_ERROR_LOG_SEQUENCE_TIMEOUT_MS = 2000;

type DownloadErrorLogRecords = Ref<DownloadRecord[]> | ComputedRef<DownloadRecord[]>;

export function downloadErrorLogSortTime(record: DownloadRecord) {
  return record.lastErrorAt || record.updatedAt || record.createdAt || '';
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

export function useDownloadErrorLog(options: {
  records: DownloadErrorLogRecords;
  isAvailable: () => boolean;
  target?: Window;
}) {
  const show = ref(false);
  const showAll = ref(false);
  let sequence: string[] = [];
  let sequenceTimer: ReturnType<typeof window.setTimeout> | null = null;
  const targetWindow = options.target || window;

  const allRecords = computed<DownloadRecord[]>(function () {
    return options.records.value
      .filter(function (record) {
        return record.state === 'failed' || record.state === 'missing';
      })
      .slice()
      .sort(function (left, right) {
        return downloadErrorLogSortTime(right).localeCompare(downloadErrorLogSortTime(left));
      });
  });

  const records = computed<DownloadRecord[]>(function () {
    if (showAll.value) return allRecords.value;
    return allRecords.value.slice(0, DOWNLOAD_ERROR_LOG_PREVIEW_LIMIT);
  });

  const total = computed(function () {
    return allRecords.value.length;
  });

  const shown = computed(function () {
    return records.value.length;
  });

  const canShowAll = computed(function () {
    return total.value > DOWNLOAD_ERROR_LOG_PREVIEW_LIMIT;
  });

  function open() {
    if (!options.isAvailable()) return;
    showAll.value = false;
    show.value = true;
  }

  function close() {
    show.value = false;
    showAll.value = false;
  }

  function toggleShowAll() {
    showAll.value = !showAll.value;
  }

  function clearSequenceTimer() {
    if (!sequenceTimer) return;
    targetWindow.clearTimeout(sequenceTimer);
    sequenceTimer = null;
  }

  function resetSequence() {
    sequence = [];
    clearSequenceTimer();
  }

  function startSequenceTimer() {
    clearSequenceTimer();
    sequenceTimer = targetWindow.setTimeout(resetSequence, DOWNLOAD_ERROR_LOG_SEQUENCE_TIMEOUT_MS);
  }

  function handleShortcut(event: KeyboardEvent) {
    if (event.defaultPrevented) return;

    if (show.value && event.key === 'Escape') {
      close();
      return;
    }

    if (!options.isAvailable() || isEditableKeyboardTarget(event.target)) {
      resetSequence();
      return;
    }

    const key = event.key.toLowerCase();
    const hasCommandModifier = event.ctrlKey || event.metaKey;
    if (hasCommandModifier && event.shiftKey && key === 'e') {
      event.preventDefault();
      resetSequence();
      open();
      return;
    }

    if (hasCommandModifier || event.altKey || key.length !== 1) return;

    const expectedKey = DOWNLOAD_ERROR_LOG_SEQUENCE[sequence.length];
    if (key === expectedKey) {
      sequence.push(key);
      if (sequence.length === 1) startSequenceTimer();
      if (sequence.length === DOWNLOAD_ERROR_LOG_SEQUENCE.length) {
        event.preventDefault();
        resetSequence();
        open();
      }
      return;
    }

    resetSequence();
    if (key === DOWNLOAD_ERROR_LOG_SEQUENCE[0]) {
      sequence = [key];
      startSequenceTimer();
    }
  }

  function registerShortcut() {
    targetWindow.addEventListener('keydown', handleShortcut);
  }

  function unregisterShortcut() {
    targetWindow.removeEventListener('keydown', handleShortcut);
    resetSequence();
  }

  return {
    show: show,
    showAll: showAll,
    records: records,
    allRecords: allRecords,
    total: total,
    shown: shown,
    canShowAll: canShowAll,
    previewLimit: DOWNLOAD_ERROR_LOG_PREVIEW_LIMIT,
    open: open,
    close: close,
    toggleShowAll: toggleShowAll,
    resetSequence: resetSequence,
    handleShortcut: handleShortcut,
    registerShortcut: registerShortcut,
    unregisterShortcut: unregisterShortcut
  };
}
