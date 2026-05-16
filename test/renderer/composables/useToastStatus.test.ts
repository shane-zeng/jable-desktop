import { describe, expect, it, vi } from 'vitest';
import { useToastStatus } from '@/composables/useToastStatus';

describe('useToastStatus', function () {
  it('skips noise statuses and infers tones without changing toast text', function () {
    const toast = useToastStatus();

    toast.setStatus('Ready');
    expect(toast.toast.value).toBe(null);

    toast.setStatus('Export complete');
    expect(toast.toast.value).toEqual({
      text: 'Export complete',
      tone: 'success',
      showQueueProgress: false
    });
  });

  it('auto-hides non-sticky toasts and keeps sticky toasts visible', function () {
    vi.useFakeTimers();
    try {
      const toast = useToastStatus();

      toast.setStatus('Sync running', 'info');
      vi.advanceTimersByTime(4200);
      expect(toast.toast.value).toBe(null);

      toast.setStatus('Please log in', 'warning', { sticky: true });
      vi.advanceTimersByTime(10000);
      expect(toast.toast.value?.text).toBe('Please log in');

      toast.hideToast();
      expect(toast.toast.value).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });
});
