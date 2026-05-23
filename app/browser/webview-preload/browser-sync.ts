'use strict';

import type {
  CollectionKey,
  ScrapedVideoRow,
  SyncBrowserCollectionOptions,
  SyncMode,
  SyncResult
} from '../../types/jable';
import type { AjaxPagerTemplate, AjaxSyncPage, AjaxSyncRetryEvent } from '../webview-preload-helpers';
import {
  ajaxFailureDetail,
  fetchAjaxPagesWithWindow,
  lastPagerPageNumberFrom,
  normalizeAjaxWindowSize,
  validateAjaxFirstPage,
  validateAjaxPages
} from '../webview-preload-helpers';

type CollectionAction = 'add' | 'remove';

type DeferredSyncOperation = {
  id: number;
  action: CollectionAction;
  videoUrl?: string | null;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};

type DeferredSyncOperationApplyFailure = {
  id: number;
  url: string;
  message: string;
  blocked: boolean;
};

export type BrowserSyncPagerLink = AjaxPagerTemplate & {
  el: HTMLAnchorElement;
  href: string;
  id: string;
  label: string;
  pageNumber: number | null;
};

type ChooseFirstPagerLink = (links: BrowserSyncPagerLink[]) => BrowserSyncPagerLink | null;
type ChooseNextPagerLink = (links: BrowserSyncPagerLink[], currentPage: number | null) => BrowserSyncPagerLink | null;

type BrowserSyncIpc = {
  invoke(channel: 'db:collection-urls-known' | 'db:save-sync-page', payload: unknown): Promise<unknown>;
};
type DiagnosticsReporter = (level: 'debug' | 'info' | 'warn' | 'error', event: string, details?: unknown) => void;

type BrowserSyncControllerOptions = {
  clickOrFetchPagerLink(link: BrowserSyncPagerLink, preferFetch: boolean): Promise<boolean>;
  currentPageNumber(): number | null;
  fetchAjaxSyncPageForTemplate(
    template: BrowserSyncPagerLink,
    pageNumber: number,
    expectedLastPage: number,
    onRetry?: (event: AjaxSyncRetryEvent) => void
  ): Promise<AjaxSyncPage>;
  ipcRenderer: BrowserSyncIpc;
  readPagerLinks(): BrowserSyncPagerLink[];
  reportDiagnostics?: DiagnosticsReporter;
  scrapeCurrentPage(): ScrapedVideoRow[];
  sendProgress(channel: string, payload: unknown): void;
  signature(): string;
  uniqByUrl(rows: ScrapedVideoRow[]): ScrapedVideoRow[];
};

type BrowserSyncController = {
  applyDeferredSyncOperations(operations: DeferredSyncOperation[]): Promise<{
    applied: number[];
    failed: DeferredSyncOperationApplyFailure[];
  }>;
  syncCollection(options?: Partial<SyncBrowserCollectionOptions> | null): Promise<SyncResult>;
};

const syncUtils = require('../../sync/sync-utils') as {
  chooseFirstPagerLink: ChooseFirstPagerLink;
  chooseNextPagerLink: ChooseNextPagerLink;
};
const chooseFirstPagerLink = syncUtils.chooseFirstPagerLink;
const chooseNextPagerLink = syncUtils.chooseNextPagerLink;

export function createBrowserSyncController(options: BrowserSyncControllerOptions): BrowserSyncController {
  function serializedError(error: unknown) {
    if (!(error instanceof Error)) {
      return {
        message: String(error)
      };
    }

    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null
    };
  }

  function reportSyncFailure(event: string, error: unknown, details?: unknown) {
    if (!options.reportDiagnostics) return;

    options.reportDiagnostics('warn', event, {
      error: serializedError(error),
      details: details
    });
  }

  async function syncCollection(
    syncRequestOptions?: Partial<SyncBrowserCollectionOptions> | null
  ): Promise<SyncResult> {
    const syncOptions = syncRequestOptions || {};

    const collectionKey = syncOptions.collectionKey as CollectionKey;
    const mode: SyncMode = syncOptions.mode || 'quick';
    const syncRunId = syncOptions.syncRunId || '';
    const siteOrderOffset = Number(syncOptions.siteOrderOffset) || 0;
    const startPage = Number(syncOptions.startPage) || null;
    const batchLimit = Number(syncOptions.batchLimit) || null;
    const ajaxWindowSize = normalizeAjaxWindowSize(syncOptions.ajaxWindowSize);
    let totalRows = 0;
    let totalPages = 0;
    let logicalPage = options.currentPageNumber() || startPage || 1;
    let lastScrapedPage: number | null = null;
    let lastKnownUrl: string | null = null;
    let stoppedByKnownPage = false;
    let incompleteReason: string | null = null;
    let ajaxFallbackReason: string | null = null;
    let ajaxRetryCount = 0;
    let preferFetchPager = false;

    function result(completed: boolean): SyncResult {
      return {
        completed: completed,
        mode: mode,
        syncRunId: syncRunId,
        incompleteReason: completed ? null : incompleteReason,
        stoppedByKnownPage: stoppedByKnownPage,
        totalPages: totalPages,
        totalRows: totalRows,
        lastScrapedPage: lastScrapedPage,
        lastKnownUrl: lastKnownUrl,
        ajaxFallbackReason: ajaxFallbackReason,
        ajaxRetryCount: ajaxRetryCount
      };
    }

    async function checkRowsKnown(rows: ScrapedVideoRow[]) {
      if (!syncOptions.stopOnKnownPage || !rows.length) return false;

      const urls: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        urls.push(rows[i].url);
      }

      try {
        return await options.ipcRenderer.invoke('db:collection-urls-known', {
          collectionKey: collectionKey,
          urls: urls
        });
      } catch (error) {
        reportSyncFailure('sync-known-url-check-failed', error, {
          collectionKey: collectionKey,
          mode: mode,
          syncRunId: syncRunId
        });
        return false;
      }
    }

    async function saveRowsForPage(rows: ScrapedVideoRow[], pageNumber: number | null | undefined, pageUrl: string) {
      rows = options.uniqByUrl(rows);
      lastScrapedPage = pageNumber || logicalPage || options.currentPageNumber() || 1;
      logicalPage = lastScrapedPage;

      for (let r = 0; r < rows.length; r++) {
        rows[r].siteOrder = siteOrderOffset + totalRows + r + 1;
      }

      totalRows += rows.length;
      totalPages++;

      if (rows.length) lastKnownUrl = rows[rows.length - 1].url;

      const allKnown = await checkRowsKnown(rows);

      const payload = {
        collectionKey: collectionKey,
        mode: mode,
        syncRunId: syncRunId,
        page: lastScrapedPage,
        rows: rows,
        url: pageUrl
      };

      await options.ipcRenderer.invoke('db:save-sync-page', payload);
      options.sendProgress('sync-page', payload);

      if (allKnown) {
        stoppedByKnownPage = true;
        return true;
      }

      return false;
    }

    async function recordCurrentPage(pageNumber?: number | null) {
      return saveRowsForPage(options.scrapeCurrentPage(), pageNumber, location.href);
    }

    async function syncRemainingPagesWithAjaxPrefetch(firstPageRows: ScrapedVideoRow[], firstPageSignature: string) {
      if (mode !== 'full' || startPage || batchLimit || syncOptions.stopOnKnownPage) return false;
      if ((logicalPage || 1) !== 1) return false;

      const links = options.readPagerLinks();
      const next = chooseNextPagerLink(links, logicalPage);
      const lastPage = lastPagerPageNumberFrom(document);
      if (!next || !next.ajaxUrl || !next.pageParamName || !lastPage || lastPage <= (logicalPage || 1)) return false;

      try {
        // AJAX prefetch is an optimization only. Validate page 1 and page shape
        // before trusting offscreen responses over normal pagination.
        const pages = await fetchAjaxPagesWithWindow({
          end: lastPage,
          fetchPage: function (pageNumber) {
            return options.fetchAjaxSyncPageForTemplate(next, pageNumber, lastPage, function (retry) {
              ajaxRetryCount++;
              options.sendProgress('sync-progress', {
                collectionKey: collectionKey,
                mode: mode,
                syncRunId: syncRunId,
                page: retry.pageNumber,
                message: 'ajax-page-retry',
                reason: retry.reason,
                attempt: retry.attempt,
                maxRetries: retry.maxRetries,
                delayMs: retry.delayMs
              });
            });
          },
          onPageStart: function (pageNumber) {
            options.sendProgress('sync-progress', {
              collectionKey: collectionKey,
              mode: mode,
              syncRunId: syncRunId,
              page: pageNumber,
              message: 'ajax-page-loading'
            });
          },
          start: (logicalPage || 1) + 1,
          windowSize: ajaxWindowSize
        });
        const firstPageCheck = await options.fetchAjaxSyncPageForTemplate(next, 1, lastPage, function (retry) {
          ajaxRetryCount++;
          options.sendProgress('sync-progress', {
            collectionKey: collectionKey,
            mode: mode,
            syncRunId: syncRunId,
            page: retry.pageNumber,
            message: 'ajax-page-retry',
            reason: retry.reason,
            attempt: retry.attempt,
            maxRetries: retry.maxRetries,
            delayMs: retry.delayMs
          });
        });

        validateAjaxFirstPage(firstPageRows, firstPageSignature, firstPageCheck);
        validateAjaxPages(firstPageRows, pages);

        for (let i = 0; i < pages.length; i++) {
          await saveRowsForPage(pages[i].rows, pages[i].pageNumber, pages[i].url);
        }

        return true;
      } catch (error) {
        ajaxFallbackReason = ajaxFailureDetail(error);
        reportSyncFailure('sync-ajax-prefetch-fallback', error, {
          collectionKey: collectionKey,
          mode: mode,
          syncRunId: syncRunId,
          reason: ajaxFallbackReason,
          page: logicalPage || 1
        });
        options.sendProgress('sync-progress', {
          collectionKey: collectionKey,
          mode: mode,
          syncRunId: syncRunId,
          page: logicalPage || 1,
          message: 'ajax-prefetch-fallback',
          reason: ajaxFallbackReason
        });
        return false;
      }
    }

    async function loadNextPage() {
      const links = options.readPagerLinks();
      const next = chooseNextPagerLink(links, logicalPage);
      if (!next) return 'done';

      const changed = await options.clickOrFetchPagerLink(next, preferFetchPager);

      if (!changed) {
        incompleteReason = 'page-unchanged';
        return 'failed';
      }

      preferFetchPager = Boolean(next.ajaxUrl);
      logicalPage = next.pageNumber || options.currentPageNumber() || logicalPage;

      options.sendProgress('sync-progress', {
        collectionKey: collectionKey,
        mode: mode,
        syncRunId: syncRunId,
        page: logicalPage,
        message: 'page-loaded'
      });

      return 'loaded';
    }

    async function ensureFirstPage() {
      const pageNumber = options.currentPageNumber();
      logicalPage = pageNumber || logicalPage || 1;

      if (pageNumber === 1) return true;

      const first = chooseFirstPagerLink(options.readPagerLinks());
      if (!first) {
        incompleteReason = 'first-page-unavailable';
        return false;
      }

      const changed = await options.clickOrFetchPagerLink(first, preferFetchPager);
      if (!changed) {
        if (options.currentPageNumber() === 1) {
          logicalPage = 1;
          return true;
        }

        incompleteReason = 'first-page-unchanged';
        return false;
      }

      preferFetchPager = Boolean(first.ajaxUrl);
      logicalPage = 1;

      options.sendProgress('sync-progress', {
        collectionKey: collectionKey,
        mode: mode,
        syncRunId: syncRunId,
        page: logicalPage,
        message: 'first-page-loaded'
      });

      return true;
    }

    if (!startPage && !(await ensureFirstPage())) {
      return result(false);
    }

    if (startPage && logicalPage <= startPage) {
      const nextState = await loadNextPage();
      if (nextState === 'failed') return result(false);
      if (nextState === 'done') return result(true);
    }

    const firstPageRows = options.uniqByUrl(options.scrapeCurrentPage());
    const firstPageSignature = options.signature();
    if (await saveRowsForPage(firstPageRows, null, location.href)) {
      return result(true);
    }

    if (batchLimit && totalPages >= batchLimit) {
      if (chooseNextPagerLink(options.readPagerLinks(), logicalPage)) {
        incompleteReason = 'batch-limit';
        return result(false);
      }

      return result(true);
    }

    if (await syncRemainingPagesWithAjaxPrefetch(firstPageRows, firstPageSignature)) {
      return result(true);
    }

    while (true) {
      const nextState = await loadNextPage();
      if (nextState === 'done') break;
      if (nextState === 'failed') return result(false);

      if (await recordCurrentPage(logicalPage)) return result(true);
      if (batchLimit && totalPages >= batchLimit) {
        if (chooseNextPagerLink(options.readPagerLinks(), logicalPage)) {
          incompleteReason = 'batch-limit';
          return result(false);
        }

        break;
      }

      await new Promise(function (resolve) {
        setTimeout(resolve, 500 + Math.random() * 500);
      });
    }

    return result(true);
  }

  async function applyDeferredSyncOperationOnce(operation: DeferredSyncOperation, baseUrl: string) {
    if (!operation.remoteVideoId) throw new Error('Missing remote video id');

    const params = new URLSearchParams();
    params.set('mode', 'async');
    params.set('format', 'json');
    params.set('action', operation.action === 'remove' ? 'delete_from_favourites' : 'add_to_favourites');
    params.set('video_id', operation.remoteVideoId);
    params.append('video_ids[]', operation.remoteVideoId);
    params.set('fav_type', operation.remoteFavType || '0');
    params.set('playlist_id', '0');

    const response = await fetch(baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + params.toString(), {
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'GET'
    });
    const text = await response.text();
    let body: { status?: unknown; errors?: Array<{ code?: unknown }> } | null = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch (error) {}

    if (!response.ok) throw new Error('HTTP ' + response.status);
    if (body && body.status === 'failure') {
      const code = body.errors && body.errors[0] && body.errors[0].code;
      throw new Error(String(code || 'Remote operation failed'));
    }
  }

  async function applyDeferredSyncOperationWithSingleRetry(operation: DeferredSyncOperation, baseUrl: string) {
    try {
      await applyDeferredSyncOperationOnce(operation, baseUrl);
    } catch (error) {
      await applyDeferredSyncOperationOnce(operation, baseUrl);
    }
  }

  function deferredSyncOperationFailure(
    operation: DeferredSyncOperation,
    message: string,
    blocked: boolean
  ): DeferredSyncOperationApplyFailure {
    return {
      id: operation.id,
      url: String(operation.videoUrl || ''),
      message: message,
      blocked: blocked
    };
  }

  async function applyDeferredSyncOperations(operations: DeferredSyncOperation[]) {
    const applied: number[] = [];
    const failed: DeferredSyncOperationApplyFailure[] = [];
    const baseUrl = String(location.href || '').split('#')[0];

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];

      try {
        // Replay one operation at a time to preserve Jable's remote sequence and
        // keep the first failing item as the durable blocker.
        await applyDeferredSyncOperationWithSingleRetry(operation, baseUrl);
        applied.push(operation.id);
      } catch (error) {
        reportSyncFailure('deferred-sync-operation-failed', error, {
          operationId: operation.id,
          action: operation.action,
          blockedCount: operations.length - i - 1
        });
        failed.push(
          deferredSyncOperationFailure(operation, error instanceof Error ? error.message : String(error), false)
        );

        // Later operations may depend on the failed remote state; report them as
        // blocked instead of attempting to infer a new final intent.
        for (let blocked = i + 1; blocked < operations.length; blocked++) {
          failed.push(deferredSyncOperationFailure(operations[blocked], 'Blocked by earlier failed operation', true));
        }

        break;
      }
    }

    return {
      applied: applied,
      failed: failed
    };
  }

  return {
    applyDeferredSyncOperations: applyDeferredSyncOperations,
    syncCollection: syncCollection
  };
}
