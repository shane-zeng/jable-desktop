'use strict';

import type { CollectionKey, ScrapedVideoRow, SyncMode } from '../../types/jable';
import { parseMetricNumber, videoPathKey } from '../webview-preload-helpers';

export type CollectionAction = 'add' | 'remove';

type ActiveSyncLock = {
  mode: SyncMode;
  syncRunId: string;
};

type PendingCollectionOperation = {
  action: CollectionAction;
  videoUrl: string;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};

type CollectionActionIpc = {
  invoke(channel: 'db:apply-collection-toggle', payload: unknown): Promise<unknown>;
};
type DiagnosticsReporter = (level: 'debug' | 'info' | 'warn' | 'error', event: string, details?: unknown) => void;

type CollectionActionControllerOptions = {
  buttonHasIcon(button: Element | null, iconId: string): boolean;
  collectionKeyForCurrentLocation(): CollectionKey | null;
  ipcRenderer: CollectionActionIpc;
  readCurrentVideoDetails(): ScrapedVideoRow | null;
  reportDiagnostics?: DiagnosticsReporter;
  scrapeVideoBox(box: Element | null): ScrapedVideoRow | null;
  siteOrderForVideoBox(box: Element | null): number | null;
};

type CollectionActionController = {
  install(): void;
  schedulePendingOverlay(): void;
  updateActiveSyncLocks(payload: unknown): void;
  updatePendingCollectionOperations(payload: unknown): void;
};

const COLLECTION_TOGGLE_CONFIRM_TIMEOUT_MS = 4000;
const COLLECTION_TOGGLE_CONFIRM_POLL_MS = 120;

export function createCollectionActionController(
  options: CollectionActionControllerOptions
): CollectionActionController {
  let activeSyncLocks: Partial<Record<CollectionKey, ActiveSyncLock>> = {};
  let pendingCollectionOperations: Partial<Record<CollectionKey, PendingCollectionOperation[]>> = {};
  let pendingCollectionOverlayTimer: ReturnType<typeof setTimeout> | null = null;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

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

  function reportCollectionFailure(event: string, error: unknown, details?: unknown) {
    if (!options.reportDiagnostics) return;

    options.reportDiagnostics('warn', event, {
      error: serializedError(error),
      details: details
    });
  }

  function updateActiveSyncLocks(payload: unknown) {
    if (!isRecord(payload) || !isRecord(payload.runs)) {
      activeSyncLocks = {};
      return;
    }

    const runs = payload.runs;
    const nextLocks: Partial<Record<CollectionKey, ActiveSyncLock>> = {};

    if (isRecord(runs.favourites)) {
      const run = runs.favourites;
      if ((run.mode === 'quick' || run.mode === 'full') && typeof run.syncRunId === 'string') {
        nextLocks.favourites = { mode: run.mode, syncRunId: run.syncRunId };
      }
    }

    if (isRecord(runs.watch_later)) {
      const run = runs.watch_later;
      if ((run.mode === 'quick' || run.mode === 'full') && typeof run.syncRunId === 'string') {
        nextLocks.watch_later = { mode: run.mode, syncRunId: run.syncRunId };
      }
    }

    activeSyncLocks = nextLocks;
  }

  function normalizePendingCollectionOperation(value: unknown): PendingCollectionOperation | null {
    if (!isRecord(value)) return null;

    const action = value.action === 'remove' ? 'remove' : value.action === 'add' ? 'add' : null;
    const videoUrl = typeof value.videoUrl === 'string' ? value.videoUrl : '';
    if (!action || !videoPathKey(videoUrl, location.href)) return null;

    return {
      action: action,
      videoUrl: videoUrl,
      remoteVideoId: typeof value.remoteVideoId === 'string' ? value.remoteVideoId : null,
      remoteFavType: typeof value.remoteFavType === 'string' ? value.remoteFavType : null
    };
  }

  function updatePendingCollectionOperations(payload: unknown) {
    if (!isRecord(payload) || !isRecord(payload.collections)) {
      pendingCollectionOperations = {};
      return;
    }

    const collections = payload.collections;
    const nextOperations: Partial<Record<CollectionKey, PendingCollectionOperation[]>> = {};
    const keys: CollectionKey[] = ['favourites', 'watch_later'];

    for (let i = 0; i < keys.length; i++) {
      const collectionKey = keys[i];
      const rawOperations = Array.isArray(collections[collectionKey]) ? collections[collectionKey] : [];
      const operations: PendingCollectionOperation[] = [];

      for (let n = 0; n < rawOperations.length; n++) {
        const operation = normalizePendingCollectionOperation(rawOperations[n]);
        if (operation) operations.push(operation);
      }

      if (operations.length) nextOperations[collectionKey] = operations;
    }

    pendingCollectionOperations = nextOperations;
    scheduleApplyPendingCollectionOperations();
  }

  function activeSyncLockForCollection(collectionKey: CollectionKey): ActiveSyncLock | null {
    return activeSyncLocks[collectionKey] || null;
  }

  function closestCollectionActionElement(target: EventTarget | null) {
    let el =
      target instanceof Element ? target : target instanceof Node && target.parentElement ? target.parentElement : null;

    while (el && el !== document.documentElement) {
      if (el.tagName === 'BUTTON' && el.classList && el.classList.contains('btn-action')) return el;
      if (el.classList && el.classList.contains('action') && el.hasAttribute('data-fav-video-id')) return el;
      el = el.parentElement;
    }

    return null;
  }

  function collectionKeyForActionElement(el: Element | null): CollectionKey | null {
    if (!el || !el.classList) return null;

    const favType = el.getAttribute('data-fav-type');
    if (favType === '0') return 'favourites';
    if (favType === '1') return 'watch_later';

    if (el.classList.contains('fav') || options.buttonHasIcon(el, '#icon-heart')) return 'favourites';
    if (options.buttonHasIcon(el, '#icon-bookmark-inline')) return 'watch_later';
    if (collectionListActionForElement(el)) return options.collectionKeyForCurrentLocation();

    return null;
  }

  function remoteFavTypeForCollection(collectionKey: CollectionKey) {
    return collectionKey === 'watch_later' ? '1' : '0';
  }

  function remoteVideoIdForActionElement(el: Element | null) {
    return el ? el.getAttribute('data-fav-video-id') || '' : '';
  }

  function remoteFavTypeForActionElement(el: Element | null, collectionKey: CollectionKey) {
    return (el ? el.getAttribute('data-fav-type') || '' : '') || remoteFavTypeForCollection(collectionKey);
  }

  function collectionListActionForElement(el: Element | null): CollectionAction | null {
    if (!el || !el.classList) return null;

    if (el.classList.contains('fav-remove') || options.buttonHasIcon(el, '#icon-close')) return 'remove';
    if (el.classList.contains('fav-restore') || options.buttonHasIcon(el, '#icon-rotate-back')) return 'add';

    return null;
  }

  function collectionActionForElement(el: Element | null): CollectionAction {
    const listAction = collectionListActionForElement(el);
    if (listAction) return listAction;

    return el && el.classList && el.classList.contains('active') ? 'remove' : 'add';
  }

  function addUniqueElement(list: Element[], el: Element | null) {
    if (!el || list.indexOf(el) >= 0) return;
    list.push(el);
  }

  function addCountDelta(counts: Element[], deltas: number[], count: Element | null, delta: number) {
    if (!count || !delta || counts.indexOf(count) >= 0) return;
    counts.push(count);
    deltas.push(delta);
  }

  function collectionActionElementMatchesFavType(el: Element, collectionKey: CollectionKey, favType: string) {
    const elementFavType = el.getAttribute('data-fav-type') || '';
    if (elementFavType) return elementFavType === favType;
    return collectionKeyForActionElement(el) === collectionKey;
  }

  function matchingCollectionActionElements(originalElement: Element | null, collectionKey: CollectionKey) {
    const out: Element[] = [];
    const videoId = originalElement ? originalElement.getAttribute('data-fav-video-id') || '' : '';
    const favType = remoteFavTypeForActionElement(originalElement, collectionKey);

    if (originalElement && document.documentElement.contains(originalElement)) addUniqueElement(out, originalElement);

    if (videoId) {
      const elements = document.querySelectorAll<Element>('.action[data-fav-video-id], button[data-fav-video-id]');

      for (let i = 0; i < elements.length; i++) {
        if (elements[i].getAttribute('data-fav-video-id') !== videoId) continue;
        if (!collectionActionElementMatchesFavType(elements[i], collectionKey, favType)) continue;
        addUniqueElement(out, elements[i]);
      }
    }

    if (!out.length) addUniqueElement(out, findCollectionActionElement(collectionKey));

    return out;
  }

  function applyQueuedCollectionVisualState(
    collectionKey: CollectionKey,
    originalElement: Element | null,
    action: CollectionAction
  ) {
    const targets = matchingCollectionActionElements(originalElement, collectionKey);
    const counts: Element[] = [];
    const countDeltas: number[] = [];

    // This can be replayed after AJAX pagination, so count changes must stay idempotent.
    for (let i = 0; i < targets.length; i++) {
      const el = targets[i];
      const count = el.querySelector('.count');

      if (collectionListActionForElement(el) || collectionListActionForElement(originalElement)) {
        const imgBox = el && typeof el.closest === 'function' ? el.closest('div.img-box') : null;
        const shouldBeRemoved = action === 'remove';

        if (imgBox) {
          const wasRemoved = imgBox.classList.contains('removed');
          if (wasRemoved !== shouldBeRemoved) addCountDelta(counts, countDeltas, count, action === 'add' ? 1 : -1);
          imgBox.classList.toggle('removed', shouldBeRemoved);
        }

        continue;
      }

      const shouldBeActive = action === 'add';
      const wasActive = el.classList.contains('active');

      if (wasActive !== shouldBeActive) addCountDelta(counts, countDeltas, count, action === 'add' ? 1 : -1);
      el.classList.toggle('active', shouldBeActive);
      el.setAttribute('aria-pressed', shouldBeActive ? 'true' : 'false');
    }

    for (let i = 0; i < counts.length; i++) {
      const current = parseMetricNumber(counts[i].textContent) || 0;
      const next = Math.max(0, current + countDeltas[i]);
      counts[i].textContent = String(next);
    }
  }

  function actionRequiresLogin(el: Element | null) {
    const actionUrl = el ? el.getAttribute('data-href') || el.getAttribute('href') || '' : '';
    return /\/login-required\/?/.test(actionUrl);
  }

  function readVideoDetailsForActionElement(
    el: Element | null,
    collectionKey?: CollectionKey | null
  ): ScrapedVideoRow | null {
    const box = el && typeof el.closest === 'function' ? el.closest('div.video-img-box') : null;
    const row = options.scrapeVideoBox(box);
    if (row && options.collectionKeyForCurrentLocation() === collectionKey) {
      row.siteOrder = options.siteOrderForVideoBox(box);
    }

    return row || options.readCurrentVideoDetails();
  }

  function findCollectionActionElement(collectionKey: CollectionKey) {
    const elements = document.querySelectorAll<Element>('button.btn-action, .action[data-fav-video-id]');

    for (let i = 0; i < elements.length; i++) {
      if (collectionKeyForActionElement(elements[i]) === collectionKey) return elements[i];
    }

    return null;
  }

  function hasPendingCollectionOperations() {
    return Boolean(
      (pendingCollectionOperations.favourites && pendingCollectionOperations.favourites.length) ||
      (pendingCollectionOperations.watch_later && pendingCollectionOperations.watch_later.length)
    );
  }

  function pendingOperationMatchesActionElement(
    operation: PendingCollectionOperation,
    collectionKey: CollectionKey,
    actionElement: Element
  ) {
    const remoteVideoId = remoteVideoIdForActionElement(actionElement);
    if (remoteVideoId && operation.remoteVideoId === remoteVideoId) {
      const remoteFavType = remoteFavTypeForActionElement(actionElement, collectionKey);
      return !operation.remoteFavType || operation.remoteFavType === remoteFavType;
    }

    const row = readVideoDetailsForActionElement(actionElement, collectionKey);
    return row ? videoPathKey(row.url, location.href) === videoPathKey(operation.videoUrl, location.href) : false;
  }

  function pendingCollectionOperationForActionElement(collectionKey: CollectionKey, actionElement: Element) {
    const operations = pendingCollectionOperations[collectionKey] || [];

    for (let i = operations.length - 1; i >= 0; i--) {
      if (pendingOperationMatchesActionElement(operations[i], collectionKey, actionElement)) return operations[i];
    }

    return null;
  }

  function applyPendingCollectionOperationsToPage() {
    pendingCollectionOverlayTimer = null;
    if (!hasPendingCollectionOperations()) return;

    const actionElements = document.querySelectorAll<Element>('button.btn-action, .action[data-fav-video-id]');

    for (let i = 0; i < actionElements.length; i++) {
      const collectionKey = collectionKeyForActionElement(actionElements[i]);
      if (!collectionKey) continue;

      const operation = pendingCollectionOperationForActionElement(collectionKey, actionElements[i]);
      if (!operation) continue;

      applyQueuedCollectionVisualState(collectionKey, actionElements[i], operation.action);
    }
  }

  function scheduleApplyPendingCollectionOperations() {
    if (!hasPendingCollectionOperations()) return;
    if (pendingCollectionOverlayTimer) return;
    pendingCollectionOverlayTimer = setTimeout(applyPendingCollectionOperationsToPage, 0);
  }

  function installPendingCollectionOperationOverlay() {
    scheduleApplyPendingCollectionOperations();
    document.addEventListener('DOMContentLoaded', scheduleApplyPendingCollectionOperations, { once: true });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleApplyPendingCollectionOperations();
    });
    window.addEventListener('focus', scheduleApplyPendingCollectionOperations);
    window.addEventListener('pageshow', scheduleApplyPendingCollectionOperations);
    window.addEventListener('load', scheduleApplyPendingCollectionOperations, { once: true });

    if (typeof MutationObserver === 'undefined') return;

    const target = document.documentElement || document;
    const observer = new MutationObserver(function (records) {
      for (let i = 0; i < records.length; i++) {
        if (records[i].type === 'childList' && (records[i].addedNodes.length || records[i].removedNodes.length)) {
          scheduleApplyPendingCollectionOperations();
          return;
        }
      }
    });
    observer.observe(target, {
      childList: true,
      subtree: true
    });
  }

  function collectionActionActiveState(collectionKey: CollectionKey, originalElement: Element | null) {
    const el =
      originalElement && document.documentElement.contains(originalElement)
        ? originalElement
        : findCollectionActionElement(collectionKey);

    return el ? el.classList.contains('active') : null;
  }

  function findMatchingCollectionActionElement(originalElement: Element | null) {
    if (!originalElement) return null;

    const videoId = originalElement.getAttribute('data-fav-video-id') || '';
    const favType = originalElement.getAttribute('data-fav-type') || '';
    if (!videoId) return null;

    const elements = document.querySelectorAll<Element>('.action[data-fav-video-id]');

    for (let i = 0; i < elements.length; i++) {
      if (elements[i].getAttribute('data-fav-video-id') !== videoId) continue;
      if (favType && elements[i].getAttribute('data-fav-type') !== favType) continue;
      return elements[i];
    }

    return null;
  }

  function collectionListRemovedState(originalElement: Element | null) {
    const el =
      originalElement && document.documentElement.contains(originalElement)
        ? originalElement
        : findMatchingCollectionActionElement(originalElement);
    const imgBox = el && typeof el.closest === 'function' ? el.closest('div.img-box') : null;

    return imgBox ? imgBox.classList.contains('removed') : null;
  }

  function collectionActionMatchesState(
    collectionKey: CollectionKey,
    originalElement: Element | null,
    action: CollectionAction
  ) {
    if (collectionListActionForElement(originalElement)) {
      return collectionListRemovedState(originalElement) === (action === 'remove');
    }

    return collectionActionActiveState(collectionKey, originalElement) === (action === 'add');
  }

  function waitForCollectionActionState(
    collectionKey: CollectionKey,
    originalElement: Element | null,
    action: CollectionAction
  ) {
    return new Promise<boolean>(function (resolve) {
      const target = document.body || document.documentElement;
      const deadline = Date.now() + COLLECTION_TOGGLE_CONFIRM_TIMEOUT_MS;
      let observer: MutationObserver | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let done = false;

      function finish(ok: boolean) {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        if (pollTimer) clearTimeout(pollTimer);
        resolve(ok);
      }

      function check() {
        if (done) return;

        if (collectionActionMatchesState(collectionKey, originalElement, action)) {
          finish(true);
          return;
        }

        if (Date.now() > deadline) {
          finish(false);
          return;
        }

        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(check, COLLECTION_TOGGLE_CONFIRM_POLL_MS);
      }

      observer = new MutationObserver(check);
      observer.observe(target, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
      });
      setTimeout(check, 0);
    });
  }

  async function applyCollectionToggle(collectionKey: CollectionKey, action: CollectionAction, video: ScrapedVideoRow) {
    try {
      await options.ipcRenderer.invoke('db:apply-collection-toggle', {
        collectionKey: collectionKey,
        action: action,
        video: video,
        sourceUrl: location.href
      });
    } catch (error) {
      reportCollectionFailure('collection-toggle-sync-failed', error, {
        collectionKey: collectionKey,
        action: action,
        videoUrl: video.url
      });
      console.warn('[JableDesktopScraper] collection toggle sync failed', error);
    }
  }

  function videoForCollectionToggleOperation(
    video: ScrapedVideoRow,
    actionElement: Element | null,
    action: CollectionAction
  ) {
    if (action === 'add' && collectionListActionForElement(actionElement) === 'add') {
      return Object.assign({}, video, { siteOrder: null });
    }

    return video;
  }

  async function queueCollectionToggle(
    collectionKey: CollectionKey,
    action: CollectionAction,
    video: ScrapedVideoRow,
    actionElement: Element | null,
    syncLock: ActiveSyncLock
  ) {
    const rollbackAction = action === 'add' ? 'remove' : 'add';
    const queuedVideo = videoForCollectionToggleOperation(video, actionElement, action);
    applyQueuedCollectionVisualState(collectionKey, actionElement, action);

    try {
      return await options.ipcRenderer.invoke('db:apply-collection-toggle', {
        collectionKey: collectionKey,
        action: action,
        deferRemote: true,
        remoteVideoId: remoteVideoIdForActionElement(actionElement),
        remoteFavType: remoteFavTypeForActionElement(actionElement, collectionKey),
        syncRunId: syncLock.syncRunId,
        video: queuedVideo,
        sourceUrl: location.href
      });
    } catch (error) {
      applyQueuedCollectionVisualState(collectionKey, actionElement, rollbackAction);
      reportCollectionFailure('collection-toggle-queue-failed', error, {
        collectionKey: collectionKey,
        action: action,
        syncRunId: syncLock.syncRunId,
        videoUrl: video.url
      });
      console.warn('[JableDesktopScraper] collection toggle queue failed', error);
      return null;
    }
  }

  async function handleCollectionButtonClick(event: MouseEvent) {
    if (!event.isTrusted || event.defaultPrevented) return;

    const actionElement = closestCollectionActionElement(event.target);
    const collectionKey = collectionKeyForActionElement(actionElement);
    if (!collectionKey || actionRequiresLogin(actionElement)) return;

    const video = readVideoDetailsForActionElement(actionElement, collectionKey);
    if (!video) return;

    const action = collectionActionForElement(actionElement);
    const syncLock = activeSyncLockForCollection(collectionKey);

    if (syncLock) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      await queueCollectionToggle(collectionKey, action, video, actionElement, syncLock);
      return;
    }

    if (await waitForCollectionActionState(collectionKey, actionElement, action)) {
      const toggledVideo = readVideoDetailsForActionElement(actionElement, collectionKey) || video;
      await applyCollectionToggle(
        collectionKey,
        action,
        videoForCollectionToggleOperation(toggledVideo, actionElement, action)
      );
    }
  }

  function install() {
    document.addEventListener('click', handleCollectionButtonClick, { capture: true });
    installPendingCollectionOperationOverlay();
  }

  return {
    install: install,
    schedulePendingOverlay: scheduleApplyPendingCollectionOperations,
    updateActiveSyncLocks: updateActiveSyncLocks,
    updatePendingCollectionOperations: updatePendingCollectionOperations
  };
}
