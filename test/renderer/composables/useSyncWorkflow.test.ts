import { describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useSyncWorkflow } from '@/composables/useSyncWorkflow';
import type { JableAppApi, SyncProgressPayload, SyncQueueProgressPayload } from '../../../app/types/jable';

function createWorkflow(setStatus = vi.fn()) {
  const scope = effectScope();
  const state = scope.run(function () {
    return useSyncWorkflow({
      api: {} as JableAppApi,
      busy: { value: false },
      errorMessage: function (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      },
      library: {} as never,
      setActiveView: vi.fn(),
      setStatus: setStatus,
      t: function (key: string, params?: Record<string, string | number | null | undefined>) {
        return params ? key + ':' + JSON.stringify(params) : key;
      }
    });
  });

  if (!state) throw new Error('Failed to create sync workflow');

  return {
    state: state,
    stop: function () {
      scope.stop();
    }
  };
}

describe('useSyncWorkflow', function () {
  it('ignores stale sync progress from a previous run', function () {
    const setStatus = vi.fn();
    const setup = createWorkflow(setStatus);

    try {
      setup.state.activeSyncRunId.value = 'run-current';
      setup.state.handleSyncProgress({
        collectionKey: 'favourites',
        mode: 'full',
        syncRunId: 'run-old',
        page: 3
      } as SyncProgressPayload);

      expect(setStatus).not.toHaveBeenCalled();
    } finally {
      setup.stop();
    }
  });

  it('tracks queue progress and exposes percent for the toast progress bar', function () {
    const setStatus = vi.fn();
    const setup = createWorkflow(setStatus);

    try {
      setup.state.handleSyncQueueProgress({
        collectionKey: 'favourites',
        mode: 'full',
        syncRunId: 'run-current',
        phase: 'progress',
        total: 4,
        processed: 2
      } as SyncQueueProgressPayload);

      expect(setup.state.syncQueueProgressProcessed.value).toBe(2);
      expect(setup.state.syncQueueProgressPercent.value).toBe(50);
      expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('status.syncQueueProgress'), 'info', {
        sticky: true,
        queueProgress: true
      });
    } finally {
      setup.stop();
    }
  });
});
