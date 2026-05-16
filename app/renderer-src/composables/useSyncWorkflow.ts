import { computed, ref } from 'vue';
import type {
  CollectionKey,
  JableAppApi,
  SyncMode,
  SyncPagePayload,
  SyncProgressPayload,
  SyncQueueProgressPayload,
  SyncResult,
  SyncState
} from '../../types/jable';
import type { useLibraryState } from './useLibraryState';
import type { ToastTone } from './useToastStatus';

const SYNC_RETURNING_NOTICE_DELAY_MS = 450;

type LibraryState = ReturnType<typeof useLibraryState>;
type Translate = (key: string, params?: Record<string, string | number | null | undefined>) => string;
type SetStatus = (text: string, tone?: ToastTone, options?: { sticky?: boolean; queueProgress?: boolean }) => void;

function waitForSyncReturningNotice() {
  return new Promise(function (resolve) {
    setTimeout(resolve, SYNC_RETURNING_NOTICE_DELAY_MS);
  });
}

export function useSyncWorkflow(options: {
  api: JableAppApi;
  busy: { value: boolean };
  errorMessage(error: unknown): string;
  library: LibraryState;
  setActiveView(view: 'library'): void;
  setStatus: SetStatus;
  t: Translate;
}) {
  const syncing = ref(false);
  const activeSyncRunId = ref<string | null>(null);
  const syncQueueProgress = ref<SyncQueueProgressPayload | null>(null);

  const syncQueueProgressProcessed = computed(function () {
    const progress = syncQueueProgress.value;
    if (!progress) return 0;
    if (progress.phase === 'complete') return progress.total;
    return Math.max(0, Math.min(progress.total, progress.processed || progress.applied || 0));
  });

  const syncQueueProgressPercent = computed(function () {
    const progress = syncQueueProgress.value;
    if (!progress || progress.total <= 0) return 0;
    return Math.round((syncQueueProgressProcessed.value / progress.total) * 100);
  });

  function syncModeName(mode: SyncMode) {
    return mode === 'full' ? options.t('sync.full') : options.t('sync.quick');
  }

  function createSyncRunId(mode: SyncMode, collectionKey: CollectionKey) {
    return [mode, collectionKey, Date.now(), Math.random().toString(36).slice(2)].join(':');
  }

  function collectionName(collectionKey: CollectionKey) {
    return options.t('collections.' + collectionKey);
  }

  function updateSyncQueueProgress(progress: SyncQueueProgressPayload) {
    const collection = collectionName(progress.collectionKey);
    const processed = Math.max(0, Math.min(progress.total, progress.processed || 0));

    if (progress.phase === 'complete') {
      syncQueueProgress.value = null;
      options.setStatus(
        options.t('status.syncQueueProcessed', {
          collection: collection,
          applied: progress.applied || 0,
          failed: progress.failed || 0
        }),
        progress.failed ? 'warning' : 'success'
      );
      return;
    }

    syncQueueProgress.value = progress;
    options.setStatus(
      options.t('status.syncQueueProgress', {
        collection: collection,
        processed: processed,
        total: progress.total
      }),
      'info',
      { sticky: true, queueProgress: true }
    );
  }

  function handleSyncPage(payload: SyncPagePayload) {
    if (activeSyncRunId.value && payload.syncRunId !== activeSyncRunId.value) return;
    options.setStatus(options.t('status.syncPage', { page: payload.page, count: payload.rows.length }));
  }

  function handleSyncProgress(progress: SyncProgressPayload) {
    if (activeSyncRunId.value && progress.syncRunId && progress.syncRunId !== activeSyncRunId.value) return;
    if (progress.message === 'ajax-page-retry') {
      options.setStatus(
        options.t('status.syncAjaxRetry', {
          page: progress.page,
          attempt: progress.attempt || 1,
          maxRetries: progress.maxRetries || 1,
          delay: Math.round((progress.delayMs || 0) / 1000),
          reason: progress.reason || options.t('status.unknownError')
        }),
        'warning'
      );
      return;
    }
    if (progress.message === 'ajax-window-fallback') {
      options.setStatus(
        options.t('status.syncAjaxFallback', {
          reason: progress.reason || options.t('status.unknownError')
        }),
        'warning'
      );
      return;
    }
    options.setStatus(options.t('status.syncProgress', { page: progress.page }));
  }

  function handleSyncQueueProgress(progress: SyncQueueProgressPayload) {
    if (activeSyncRunId.value && progress.syncRunId && progress.syncRunId !== activeSyncRunId.value) return;
    updateSyncQueueProgress(progress);
  }

  function resultStatus(
    collectionKey: CollectionKey,
    mode: SyncMode,
    result: SyncResult,
    finishState: SyncState,
    visibleRows?: number
  ) {
    const name = syncModeName(mode);
    const collection = collectionName(collectionKey);
    const queuedFailures = result.queuedOperationsFailed || 0;
    const queuedSkipped = result.queuedOperationsSkipped || 0;
    const totalRows = typeof visibleRows === 'number' ? visibleRows : result.totalRows;

    function withAjaxFallback(status: string) {
      if (!result.ajaxFallbackReason) return status;

      return options.t('status.syncAjaxFallbackResult', {
        status: status,
        reason: result.ajaxFallbackReason,
        retries: result.ajaxRetryCount || 0
      });
    }

    if (queuedFailures > 0) {
      return withAjaxFallback(
        options.t('status.syncQueuedOperationsFailed', {
          collection: collection,
          count: queuedFailures
        })
      );
    }

    if (queuedSkipped > 0) {
      return withAjaxFallback(
        options.t('status.syncQueuedOperationsSkipped', {
          collection: collection,
          count: queuedSkipped
        })
      );
    }

    if (result.completed === false) {
      if (result.incompleteReason === 'login-required') {
        return options.t('status.loginRequired', { collection: collection });
      }

      if (result.incompleteReason === 'first-page-unavailable' || result.incompleteReason === 'first-page-unchanged') {
        return options.t('status.firstPageRequired', { collection: collection, mode: name });
      }

      if (result.incompleteReason === 'collection-mutated-during-sync') {
        return options.t('status.syncChangedDuringRun', {
          collection: collection,
          mode: name,
          count: (finishState && finishState.mutationsReconciled) || 0
        });
      }

      if (result.incompleteReason === 'batch-limit') {
        return options.t('status.fullSyncPaused', {
          collection: collection,
          mode: name,
          pages: result.totalPages,
          rows: result.totalRows
        });
      }

      if (result.ajaxFallbackReason) {
        return options.t('status.syncIncompleteAfterAjaxFallback', {
          collection: collection,
          mode: name,
          reason: result.incompleteReason || options.t('status.unknownError'),
          ajaxReason: result.ajaxFallbackReason
        });
      }

      return options.t('status.syncIncomplete', {
        collection: collection,
        mode: name,
        reason: result.incompleteReason || options.t('status.unknownError')
      });
    }

    if (mode === 'full') {
      return withAjaxFallback(
        options.t('status.fullSyncComplete', {
          collection: collection,
          rows: totalRows,
          hidden: (finishState && finishState.hidden) || 0
        })
      );
    }

    const reason = result.stoppedByKnownPage
      ? options.t('status.stoppedByKnownPage')
      : options.t('status.finishedVisiblePages');
    return withAjaxFallback(
      options.t('status.quickSyncComplete', {
        collection: collection,
        rows: totalRows,
        reason: reason
      })
    );
  }

  async function syncCollection(mode: SyncMode) {
    if (options.busy.value || syncing.value) return;

    syncing.value = true;
    activeSyncRunId.value = null;
    syncQueueProgress.value = null;
    let syncTabId: string | null = null;

    try {
      const collectionKey = options.library.activeCollection.value;
      const continuation =
        mode === 'full' &&
        options.library.fullSyncContinuation.value &&
        options.library.fullSyncContinuation.value.collectionKey === collectionKey
          ? options.library.fullSyncContinuation.value
          : null;
      const usedContinuation = Boolean(continuation && continuation.tabId);
      syncTabId = usedContinuation && continuation ? continuation.tabId : null;
      const syncRunId =
        usedContinuation && continuation ? continuation.syncRunId : createSyncRunId(mode, collectionKey);
      const siteOrderOffset = usedContinuation && continuation ? continuation.siteOrderOffset : 0;
      const startPage = usedContinuation && continuation ? continuation.lastScrapedPage : null;

      const syncOptions = {
        collectionKey: collectionKey,
        mode: mode,
        syncRunId: syncRunId,
        siteOrderOffset: siteOrderOffset,
        startPage: startPage,
        stopOnKnownPage: mode === 'quick',
        batchLimit: null
      };

      options.setStatus(
        options.t('status.syncStart', { mode: syncModeName(mode), collection: collectionName(collectionKey) })
      );
      activeSyncRunId.value = syncRunId;
      const result = await options.api.syncBrowserCollection({
        tabId: syncTabId,
        options: syncOptions
      });
      syncTabId = result.syncWorkerId || syncTabId;
      options.setStatus(
        options.t('status.syncFinalizingLocalData', { collection: collectionName(collectionKey) }),
        'info'
      );

      const finishState = await options.api.finishSync({
        collectionKey: collectionKey,
        mode: mode,
        syncRunId: syncRunId,
        result: result
      });

      if (mode === 'full' && result.completed === false && result.incompleteReason === 'batch-limit') {
        options.library.fullSyncContinuation.value = {
          collectionKey: collectionKey,
          syncRunId: syncRunId,
          tabId: result.syncWorkerId || syncTabId || '',
          siteOrderOffset: siteOrderOffset + result.totalRows,
          lastScrapedPage: result.lastScrapedPage
        };
      } else if (mode === 'full') {
        options.library.fullSyncContinuation.value = null;
      }

      const finalVisibleRows = await options.api.countVideos({ collectionKey: collectionKey });
      options.library.currentPage.value = 1;
      options.setStatus(
        options.t('status.syncReturningLibrary', { collection: collectionName(collectionKey) }),
        'info'
      );
      await waitForSyncReturningNotice();
      options.setActiveView('library');
      await options.library.refreshVideos();
      await options.library.refreshPendingGroups();

      options.setStatus(
        resultStatus(collectionKey, mode, result, finishState, finalVisibleRows),
        result.queuedOperationsFailed || result.queuedOperationsSkipped || result.ajaxFallbackReason
          ? 'warning'
          : undefined,
        {
          sticky: result.completed === false
        }
      );
    } catch (error) {
      console.error(error);
      syncQueueProgress.value = null;
      options.setStatus(
        options.t('status.syncFailed', { mode: syncModeName(mode), error: options.errorMessage(error) }),
        'error'
      );
    } finally {
      activeSyncRunId.value = null;
      syncing.value = false;
    }
  }

  return {
    activeSyncRunId: activeSyncRunId,
    syncing: syncing,
    syncQueueProgress: syncQueueProgress,
    syncQueueProgressProcessed: syncQueueProgressProcessed,
    syncQueueProgressPercent: syncQueueProgressPercent,
    handleSyncPage: handleSyncPage,
    handleSyncProgress: handleSyncProgress,
    handleSyncQueueProgress: handleSyncQueueProgress,
    syncCollection: syncCollection
  };
}
