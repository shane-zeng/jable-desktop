import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useSyncWorkflow } from '@/composables/useSyncWorkflow';
import type {
  CollectionKey,
  JableAppApi,
  SyncProgressPayload,
  SyncQueueProgressPayload
} from '../../../app/types/jable';

type SetActiveView = (view: 'library') => void;

function createWorkflow(
  setStatus = vi.fn(),
  overrides: {
    api?: Partial<JableAppApi>;
    library?: Record<string, unknown>;
    setActiveView?: SetActiveView;
  } = {}
) {
  const scope = effectScope();
  const library = Object.assign(
    {
      activeCollection: ref<CollectionKey>('favourites'),
      currentPage: ref(1),
      fullSyncContinuation: ref(null),
      refreshPendingGroups: vi.fn().mockResolvedValue(undefined),
      refreshVideos: vi.fn().mockResolvedValue(undefined)
    },
    overrides.library || {}
  );
  const setActiveView =
    overrides.setActiveView ||
    function (_view: 'library') {
      return;
    };
  const state = scope.run(function () {
    return useSyncWorkflow({
      api: (overrides.api || {}) as JableAppApi,
      busy: { value: false },
      errorMessage: function (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      },
      library: library as never,
      setActiveView: setActiveView,
      setStatus: setStatus,
      t: function (key: string, params?: Record<string, string | number | null | undefined>) {
        return params ? key + ':' + JSON.stringify(params) : key;
      }
    });
  });

  if (!state) throw new Error('Failed to create sync workflow');

  return {
    library: library,
    setActiveView: setActiveView,
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

  it('reports scanned row count for quick sync completion', async function () {
    vi.useFakeTimers();
    const setStatus = vi.fn();
    const setup = createWorkflow(setStatus, {
      api: {
        countVideos: vi.fn().mockResolvedValue(999),
        finishSync: vi.fn().mockResolvedValue({
          collection_key: 'favourites',
          completed: true,
          hidden: 0,
          last_known_url: 'https://jable.tv/videos/known/',
          last_scraped_page: 1,
          mutationsReconciled: 0,
          updated_at: '2026-05-16T00:00:00Z'
        }),
        syncBrowserCollection: vi.fn().mockResolvedValue({
          completed: true,
          incompleteReason: null,
          lastKnownUrl: 'https://jable.tv/videos/known/',
          lastScrapedPage: 1,
          mode: 'quick',
          stoppedByKnownPage: true,
          syncRunId: 'quick-run',
          totalPages: 1,
          totalRows: 24
        })
      }
    });

    try {
      const promise = setup.state.syncCollection('quick');
      await vi.runAllTimersAsync();
      await promise;

      const finalStatus = setStatus.mock.calls[setStatus.mock.calls.length - 1][0];
      expect(finalStatus).toContain('status.quickSyncComplete');
      expect(finalStatus).toContain('"rows":24');
      expect(finalStatus).not.toContain('"rows":999');
    } finally {
      vi.useRealTimers();
      setup.stop();
    }
  });
});
