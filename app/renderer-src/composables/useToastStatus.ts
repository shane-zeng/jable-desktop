import { ref } from 'vue';

export type ToastTone = 'error' | 'warning' | 'success' | 'info';
export type ToastState = {
  text: string;
  tone: ToastTone;
  showQueueProgress?: boolean;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldSkipStatus(text: string) {
  return (
    !text ||
    text === '準備中' ||
    text === '就緒' ||
    text === '已新增分頁' ||
    text === '開啟影片中…' ||
    text === 'Preparing...' ||
    text === 'Ready' ||
    text === 'New tab added' ||
    text === 'Opening video...'
  );
}

function statusTone(text: string): ToastTone {
  if (/失敗|錯誤|未知|failed|error|unknown/i.test(text)) return 'error';
  if (/暫停|未完整|請先|paused|did not complete|please log in/i.test(text)) return 'warning';
  if (/完成|已匯出|已匯入|complete|exported|imported/i.test(text)) return 'success';
  return 'info';
}

export function useToastStatus() {
  const toast = ref<ToastState | null>(null);
  let toastTimer: number | null = null;

  function hideToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    toast.value = null;
  }

  function setStatus(text: string, tone?: ToastTone, options?: { sticky?: boolean; queueProgress?: boolean }) {
    if (shouldSkipStatus(text)) return;

    if (toastTimer) clearTimeout(toastTimer);
    toast.value = {
      text: text,
      tone: tone || statusTone(text),
      showQueueProgress: Boolean(options && options.queueProgress)
    };
    if (options && options.sticky) {
      toastTimer = null;
      return;
    }

    toastTimer = setTimeout(function () {
      toast.value = null;
      toastTimer = null;
    }, 4200);
  }

  return {
    toast: toast,
    hideToast: hideToast,
    setStatus: setStatus
  };
}
