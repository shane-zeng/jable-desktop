'use strict';

import type * as Electron from 'electron';
import type {
  BrowserDiagnosis,
  CollectionKey,
  ScrapedVideoRow,
  SyncBrowserCollectionOptions,
  SyncMode,
  SyncResult
} from './types/jable';

type CollectionAction = 'add' | 'remove';
type TrackpadHistoryDirection = 'back' | 'forward';
type ActiveSyncLock = {
  mode: SyncMode;
  syncRunId: string;
};
type DeferredSyncOperation = {
  id: number;
  action: CollectionAction;
  videoUrl?: string | null;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};
type PendingCollectionOperation = {
  action: CollectionAction;
  videoUrl: string;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};
type PagerLink = {
  el: HTMLAnchorElement;
  id: string;
  label: string;
  pageNumber: number | null;
};
type SendToHostIpcRenderer = Electron.IpcRenderer & {
  sendToHost?: (channel: string, ...args: unknown[]) => void;
};
type ChooseFirstPagerLink = (links: PagerLink[]) => PagerLink | null;
type ChooseNextPagerLink = (links: PagerLink[], currentPage: number | null) => PagerLink | null;
type UrlPolicyModule = {
  isTrustedJableUrl(value: unknown): boolean;
};
type AdBlockerModule = {
  isAdBlockDebugEnabledByEnv(env?: Record<string, string | undefined> | null): boolean;
  isAdBlockEnabledByEnv(env?: Record<string, string | undefined> | null): boolean;
  shouldBlockAdNavigation(value: unknown): boolean;
};
type AdCosmeticPolicyModule = {
  removeCosmeticAds(root: Document | Element, isBlockedAdUrl: (value: unknown) => boolean): number;
};

const electron: typeof Electron = require('electron');
const ipcRenderer = electron.ipcRenderer as SendToHostIpcRenderer;
const adBlocker = require('./ad-blocker') as AdBlockerModule;
const adCosmeticPolicy = require('./ad-cosmetic-policy') as AdCosmeticPolicyModule;
const syncUtils = require('./sync-utils') as {
  chooseFirstPagerLink: ChooseFirstPagerLink;
  chooseNextPagerLink: ChooseNextPagerLink;
};
const chooseFirstPagerLink = syncUtils.chooseFirstPagerLink;
const chooseNextPagerLink = syncUtils.chooseNextPagerLink;
const urlPolicy = require('./url-policy') as UrlPolicyModule;

const IS_MACOS = process.platform === 'darwin';
const SEL_LIST_CONTAINER = '#list_videos_my_favourite_videos';
const SEL_TITLES = 'div.detail h6.title a';
const SEL_PAGER = 'ul.pagination';
const SEL_PAGER_LINKS = 'ul.pagination a.page-link';
const SITE_PAGE_SIZE = 24;
const TRACKPAD_HISTORY_THRESHOLD = 180;
const TRACKPAD_HISTORY_COOLDOWN_MS = 700;
const TRACKPAD_HISTORY_RESET_MS = 180;
const COLLECTION_TOGGLE_CONFIRM_TIMEOUT_MS = 4000;
const COLLECTION_TOGGLE_CONFIRM_POLL_MS = 120;
const AD_COSMETIC_SCAN_DELAY_MS = 0;
let trackpadHistoryDeltaX = 0;
let trackpadHistoryLastSentAt = 0;
let trackpadHistoryResetTimer: ReturnType<typeof setTimeout> | null = null;
let adCosmeticScanTimer: ReturnType<typeof setTimeout> | null = null;
let activeSyncLocks: Partial<Record<CollectionKey, ActiveSyncLock>> = {};
let pendingCollectionOperations: Partial<Record<CollectionKey, PendingCollectionOperation[]>> = {};
let pendingCollectionOverlayTimer: ReturnType<typeof setTimeout> | null = null;

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;
  return null;
}

function absUrl(href: string, base?: string) {
  try {
    return new URL(href, base || location.href).href;
  } catch (error) {
    return href;
  }
}

function videoPathKey(value: unknown) {
  if (!value) return '';

  try {
    const parsed = new URL(String(value), location.href);
    // Match pending operations across the primary and fallback Jable origins.
    if (!/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return '';
    if (!/\/$/.test(parsed.pathname)) parsed.pathname += '/';
    return parsed.pathname;
  } catch (error) {
    return '';
  }
}

function uniqByUrl(rows: ScrapedVideoRow[]) {
  const seen: Record<string, boolean> = {};
  const out: ScrapedVideoRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].url || seen[rows[i].url]) continue;
    seen[rows[i].url] = true;
    out.push(rows[i]);
  }

  return out;
}

function runAdCosmeticFilter() {
  adCosmeticScanTimer = null;

  const removed = adCosmeticPolicy.removeCosmeticAds(document, adBlocker.shouldBlockAdNavigation);
  if (removed && adBlocker.isAdBlockDebugEnabledByEnv(process.env)) {
    console.info('[ad-blocker] removed ' + removed + ' ad container(s)');
  }
}

function scheduleAdCosmeticFilter() {
  if (adCosmeticScanTimer) return;

  adCosmeticScanTimer = setTimeout(runAdCosmeticFilter, AD_COSMETIC_SCAN_DELAY_MS);
}

function installAdCosmeticFilter() {
  if (!adBlocker.isAdBlockEnabledByEnv(process.env)) return;

  scheduleAdCosmeticFilter();

  document.addEventListener('DOMContentLoaded', scheduleAdCosmeticFilter, { once: true });

  if (typeof MutationObserver === 'undefined') return;

  const target = document.documentElement || document;
  const observer = new MutationObserver(scheduleAdCosmeticFilter);
  observer.observe(target, {
    attributes: true,
    attributeFilter: ['href', 'src', 'data-src'],
    childList: true,
    subtree: true
  });
}

function parseMetricNumber(value: unknown) {
  const number = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(number) && number > 0 ? number : null;
}

function inferPreviewFromImageUrl(value: string | null | undefined) {
  if (!value) return null;

  const url = absUrl(value);
  const match = url.match(
    /^(https?:\/\/[^?#]+\/contents\/videos_screenshots\/\d+\/(\d+)\/)(?:preview\.jpg|320x180\/1\.jpg|[^?#]+)(?:[?#].*)?$/
  );

  return match ? match[1] + match[2] + '_preview.mp4' : null;
}

function canonicalVideoHrefFromBox(box: Element | null, fallbackAnchor: HTMLAnchorElement | null) {
  const anchors = box
    ? box.querySelectorAll<HTMLAnchorElement>('div.img-box a[href], div.detail h6.title a[href]')
    : [];

  for (let i = 0; i < anchors.length; i++) {
    const href = anchors[i].getAttribute('href') || '';

    try {
      const parsed = new URL(href, anchors[i].baseURI || location.href);
      if (/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return parsed.href;
    } catch (error) {}
  }

  return fallbackAnchor
    ? absUrl(fallbackAnchor.getAttribute('href') || '', fallbackAnchor.baseURI || location.href)
    : '';
}

function scrapeVideoBox(box: Element | null): ScrapedVideoRow | null {
  if (!box) return null;

  const a = box.querySelector<HTMLAnchorElement>('div.detail h6.title a');
  if (!a) return null;

  const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
  const href = canonicalVideoHrefFromBox(box, a);
  const img = box.querySelector<HTMLImageElement>('div.img-box img');
  const imgSrc = img ? img.getAttribute('data-src') || img.getAttribute('src') || '' : '';
  const previewSrc = img ? img.getAttribute('data-preview') || '' : '';
  let views: number | null = null;
  let likes: number | null = null;
  const sub = box.querySelector('div.detail p.sub-title');

  if (sub) {
    const texts: string[] = [];
    for (let n = 0; n < sub.childNodes.length; n++) {
      const node = sub.childNodes[n];
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) texts.push(text);
      }
    }

    if (texts.length >= 1) views = parseMetricNumber(texts[0]);
    if (texts.length >= 2) likes = parseMetricNumber(texts[1]);
  }

  if (!href) return null;

  return {
    title: title,
    url: absUrl(href),
    views: views,
    likes: likes,
    img: imgSrc ? absUrl(imgSrc) : null,
    preview: previewSrc ? absUrl(previewSrc) : inferPreviewFromImageUrl(imgSrc)
  };
}

function scrapeCurrentPage() {
  const out: ScrapedVideoRow[] = [];
  const boxes = document.querySelectorAll('div.video-img-box');

  for (let i = 0; i < boxes.length; i++) {
    const row = scrapeVideoBox(boxes[i]);
    if (row) out.push(row);
  }

  return out;
}

function siteOrderForVideoBox(box: Element | null) {
  if (!box) return null;

  const boxes = document.querySelectorAll('div.video-img-box');
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i] !== box) continue;
    return ((currentPageNumber() || 1) - 1) * SITE_PAGE_SIZE + i + 1;
  }

  return null;
}

function collectionKeyForCurrentLocation(): CollectionKey | null {
  const path = location.pathname.replace(/\/?$/, '/');
  if (/^\/my\/favourites\/videos\/(?:\d+\/)?$/.test(path)) return 'favourites';
  if (/^\/my\/favourites\/videos-watch-later\/(?:\d+\/)?$/.test(path)) return 'watch_later';
  return null;
}

function normalizePageNumber(value: unknown) {
  const n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(n) && n > 0 ? n : 1;
}

function readPageNumber(value: unknown): number | null {
  const n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(n) && n > 0 ? n : null;
}

function samePageUrl(left: unknown, right: unknown) {
  const leftUrl = absUrl(String(left || ''));
  const rightUrl = absUrl(String(right || ''));

  return leftUrl.replace(/\/?$/, '/') === rightUrl.replace(/\/?$/, '/');
}

function hasVisibleActiveBackground(el: Element | null) {
  if (!el) return false;

  try {
    const color = window.getComputedStyle(el).backgroundColor;
    return Boolean(color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)');
  } catch (error) {
    return false;
  }
}

function currentPageNumber(): number | null {
  const active = document.querySelector<Element>(
    [
      'ul.pagination span.page-link.active',
      'ul.pagination a.page-link.active',
      'ul.pagination .page-item.active .page-link',
      'ul.pagination [aria-current="page"]'
    ].join(', ')
  );
  const activePageNumber = active ? readPageNumber(active.textContent) : null;
  if (activePageNumber) return activePageNumber;

  const anchors = document.querySelectorAll<HTMLAnchorElement>(SEL_PAGER_LINKS);

  for (let i = 0; i < anchors.length; i++) {
    const pageNumber = readPageNumber(anchors[i].textContent);
    if (pageNumber && samePageUrl(anchors[i].getAttribute('href'), location.href)) return pageNumber;
  }

  for (let i = 0; i < anchors.length; i++) {
    const pageNumber = readPageNumber(anchors[i].textContent);
    if (!pageNumber) continue;
    if (hasVisibleActiveBackground(anchors[i]) || hasVisibleActiveBackground(anchors[i].parentElement)) {
      return pageNumber;
    }
  }

  return null;
}

function signature() {
  const list = document.querySelectorAll<HTMLAnchorElement>(SEL_TITLES);
  const count = list.length;
  const first = count ? list[0].getAttribute('href') || '' : '';
  return count + '|' + first;
}

function waitForContainerChange(oldSig: string, timeoutMs: number): Promise<boolean> {
  const timeout = timeoutMs || 12000;
  const target = document.querySelector(SEL_LIST_CONTAINER) || document.body;
  const deadline = Date.now() + timeout;

  return new Promise(function (resolve) {
    let done = false;
    const observer = new MutationObserver(function () {
      check();
    });

    function finish(changed: boolean) {
      if (done) return;
      done = true;
      observer.disconnect();
      resolve(changed);
    }

    function check() {
      const cur = signature();
      if (cur && cur !== oldSig) finish(true);
      else if (Date.now() > deadline) finish(false);
    }

    observer.observe(target, { childList: true, subtree: true });

    (function poll() {
      if (done) return;
      check();
      if (!done) setTimeout(poll, 300);
    })();
  });
}

function readPagerLinks() {
  const pager = document.querySelector(SEL_PAGER);
  if (!pager) return [];

  const anchors = pager.querySelectorAll<HTMLAnchorElement>(SEL_PAGER_LINKS);
  const out: PagerLink[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    let pageNumber = /^\d+$/.test(text) ? normalizePageNumber(text) : null;
    const params = anchor.getAttribute('data-parameters') || '';
    const match = params.match(/(?:^|;)from(?:_my_fav_videos)?:\s*(\d+)/);
    let id: string;

    if (match) id = match[1];
    else if (/^\d+$/.test(text)) id = text;
    else id = text || 'a_' + i;

    if (!pageNumber && match) {
      pageNumber = Math.floor(parseInt(match[1], 10) / SITE_PAGE_SIZE) + 1;
    }

    out.push({ el: anchor, id: id, label: text, pageNumber: pageNumber });
  }

  return out;
}

function sendProgress(channel: string, payload: unknown) {
  try {
    if (typeof ipcRenderer.sendToHost === 'function') {
      ipcRenderer.sendToHost(channel, payload);
    }
  } catch (error) {}

  ipcRenderer.send('browser:' + channel, payload);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestIdFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return typeof payload.requestId === 'string' ? payload.requestId : null;
}

function syncOptionsFromPayload(payload: unknown): Partial<SyncBrowserCollectionOptions> | null {
  if (!isRecord(payload)) return null;
  return isRecord(payload.options) ? (payload.options as Partial<SyncBrowserCollectionOptions>) : null;
}

function updateActiveSyncLocks(payload: unknown) {
  const nextLocks: Partial<Record<CollectionKey, ActiveSyncLock>> = {};
  const runs = isRecord(payload) && isRecord(payload.runs) ? payload.runs : {};

  if (isRecord(runs.favourites)) {
    const run = runs.favourites;
    if (typeof run.syncRunId === 'string' && (run.mode === 'quick' || run.mode === 'full')) {
      nextLocks.favourites = { mode: run.mode, syncRunId: run.syncRunId };
    }
  }

  if (isRecord(runs.watch_later)) {
    const run = runs.watch_later;
    if (typeof run.syncRunId === 'string' && (run.mode === 'quick' || run.mode === 'full')) {
      nextLocks.watch_later = { mode: run.mode, syncRunId: run.syncRunId };
    }
  }

  activeSyncLocks = nextLocks;
}

function normalizePendingCollectionOperation(value: unknown): PendingCollectionOperation | null {
  if (!isRecord(value)) return null;

  const action = value.action === 'remove' ? 'remove' : value.action === 'add' ? 'add' : null;
  const videoUrl = typeof value.videoUrl === 'string' ? value.videoUrl : '';
  if (!action || !videoPathKey(videoUrl)) return null;

  return {
    action: action,
    videoUrl: videoUrl,
    remoteVideoId: typeof value.remoteVideoId === 'string' ? value.remoteVideoId : null,
    remoteFavType: typeof value.remoteFavType === 'string' ? value.remoteFavType : null
  };
}

function updatePendingCollectionOperations(payload: unknown) {
  const nextOperations: Partial<Record<CollectionKey, PendingCollectionOperation[]>> = {};
  const collections = isRecord(payload) && isRecord(payload.collections) ? payload.collections : {};
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

function sendPreloadResponse(requestId: string, result: unknown) {
  ipcRenderer.send('browser:preload-response', {
    requestId: requestId,
    ok: true,
    result: result
  });
}

function sendPreloadError(requestId: string, error: unknown) {
  ipcRenderer.send('browser:preload-response', {
    requestId: requestId,
    ok: false,
    error: errorMessage(error)
  });
}

function diagnosePage(): BrowserDiagnosis {
  const documentElement = document.documentElement;
  const body = document.body;

  return {
    url: location.href,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientHeight: documentElement.clientHeight,
    scrollHeight: Math.max(documentElement.scrollHeight, body ? body.scrollHeight : 0)
  };
}

function canElementScrollHorizontally(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (!(el instanceof HTMLElement)) return false;

  const style = window.getComputedStyle(el);
  const overflowX = style ? style.overflowX : '';
  const scrollableOverflow = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';

  return scrollableOverflow && el.scrollWidth > el.clientWidth + 1;
}

function canTargetContinueHorizontalScroll(target: EventTarget | null, direction: TrackpadHistoryDirection) {
  let el = elementFromTarget(target);

  while (el && el !== document.body && el !== document.documentElement) {
    if (canElementScrollHorizontally(el)) {
      if (direction === 'back' && el.scrollLeft > 0) return true;
      if (direction === 'forward' && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
    }

    el = el.parentElement;
  }

  return false;
}

function resetTrackpadHistoryDelta() {
  trackpadHistoryDeltaX = 0;
  trackpadHistoryResetTimer = null;
}

function handleTrackpadHistoryWheel(event: WheelEvent) {
  const deltaX = Number(event.deltaX) || 0;
  const deltaY = Number(event.deltaY) || 0;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (event.defaultPrevented || absX < 1 || absX < absY * 1.5) return;
  if (Date.now() - trackpadHistoryLastSentAt < TRACKPAD_HISTORY_COOLDOWN_MS) return;

  trackpadHistoryDeltaX += deltaX;

  if (trackpadHistoryResetTimer) clearTimeout(trackpadHistoryResetTimer);
  trackpadHistoryResetTimer = setTimeout(resetTrackpadHistoryDelta, TRACKPAD_HISTORY_RESET_MS);

  if (Math.abs(trackpadHistoryDeltaX) < TRACKPAD_HISTORY_THRESHOLD) return;

  // macOS natural horizontal scrolling reports negative deltaX for the back gesture.
  const direction: TrackpadHistoryDirection = trackpadHistoryDeltaX < 0 ? 'back' : 'forward';

  if (canTargetContinueHorizontalScroll(event.target, direction)) {
    resetTrackpadHistoryDelta();
    return;
  }

  event.preventDefault();
  resetTrackpadHistoryDelta();
  trackpadHistoryLastSentAt = Date.now();
  ipcRenderer.send('browser:trackpad-history', direction);
}

function closestAnchor(target: EventTarget | null) {
  let el = elementFromTarget(target);

  while (el && el !== document.documentElement) {
    if (el instanceof HTMLAnchorElement && el.href) return el;
    el = el.parentElement;
  }

  return null;
}

function handleMiddleClickNewTab(event: MouseEvent) {
  if (!event.isTrusted || event.defaultPrevented || event.button !== 1) return;

  const anchor = closestAnchor(event.target);
  if (!anchor) return;

  const href = anchor.getAttribute('href') || anchor.href || '';
  const url = absUrl(href, anchor.baseURI || location.href);

  if (!url || /^javascript:/i.test(url)) return;

  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.send('browser:open-url-new-tab', { url: url });
}

if (IS_MACOS) {
  window.addEventListener('wheel', handleTrackpadHistoryWheel, { capture: true, passive: false });
}

window.addEventListener('auxclick', handleMiddleClickNewTab, { capture: true });

function closestCollectionActionElement(target: EventTarget | null) {
  let el = elementFromTarget(target);

  while (el && el !== document.documentElement) {
    if (el.tagName === 'BUTTON' && el.classList && el.classList.contains('btn-action')) return el;
    if (el.classList && el.classList.contains('action') && el.hasAttribute('data-fav-video-id')) return el;
    el = el.parentElement;
  }

  return null;
}

function buttonHasIcon(button: Element | null, iconId: string) {
  if (!button) return false;

  const uses = button.querySelectorAll<SVGUseElement>('use');

  for (let i = 0; i < uses.length; i++) {
    const href =
      uses[i].getAttribute('href') ||
      uses[i].getAttribute('xlink:href') ||
      (uses[i].href && uses[i].href.baseVal) ||
      '';
    if (href === iconId) return true;
  }

  return false;
}

function collectionKeyForActionElement(el: Element | null): CollectionKey | null {
  if (!el || !el.classList) return null;

  const favType = el.getAttribute('data-fav-type');
  if (favType === '0') return 'favourites';
  if (favType === '1') return 'watch_later';

  if (el.classList.contains('fav') || buttonHasIcon(el, '#icon-heart')) return 'favourites';
  if (buttonHasIcon(el, '#icon-bookmark-inline')) return 'watch_later';
  if (collectionListActionForElement(el)) return collectionKeyForCurrentLocation();

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

  if (el.classList.contains('fav-remove') || buttonHasIcon(el, '#icon-close')) return 'remove';
  if (el.classList.contains('fav-restore') || buttonHasIcon(el, '#icon-rotate-back')) return 'add';

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

function isJablePage() {
  return urlPolicy.isTrustedJableUrl(location.href);
}

function currentVideoUrl() {
  if (!isJablePage()) return null;

  try {
    const parsed = new URL(location.href);
    if (!/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return null;
    if (!/\/$/.test(parsed.pathname)) parsed.pathname += '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return null;
  }
}

function normalizePageText(value: unknown) {
  const text = value === null || typeof value === 'undefined' ? '' : String(value);
  return text.replace(/\s+/g, ' ').trim();
}

function readMetaContent(selector: string) {
  const el = document.querySelector<HTMLMetaElement>(selector);
  return el ? normalizePageText(el.getAttribute('content')) : '';
}

function readFirstText(selectors: string[]) {
  for (let i = 0; i < selectors.length; i++) {
    const el = document.querySelector(selectors[i]);
    const text = el ? normalizePageText(el.textContent) : '';
    if (text) return text;
  }

  return '';
}

function cleanVideoTitle(value: unknown) {
  let text = normalizePageText(value);
  if (!text) return null;

  text = text.replace(/\s*[-|]\s*Jable\.TV\s*$/i, '').trim();
  return text || null;
}

function readNumberAfterIcon(container: Element | null, iconId: string) {
  if (!container) return null;

  const svgs = container.querySelectorAll('svg');

  for (let i = 0; i < svgs.length; i++) {
    if (!buttonHasIcon(svgs[i], iconId)) continue;

    let node = svgs[i].nextSibling;

    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textNumber = parseMetricNumber(node.textContent);
        if (textNumber !== null) return textNumber;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const elementNumber = parseMetricNumber(node.textContent);
        if (elementNumber !== null) return elementNumber;
      }

      node = node.nextSibling;
    }
  }

  return null;
}

function readCurrentVideoViews() {
  return readNumberAfterIcon(document.querySelector('.video-info .info-header h6'), '#icon-eye');
}

function readCurrentVideoLikes() {
  const count = document.querySelector('button[data-fav-type="0"] .count, button.fav .count');
  return count ? parseMetricNumber(count.textContent) : null;
}

function readCurrentVideoDetails(): ScrapedVideoRow | null {
  const url = currentVideoUrl();
  if (!url) return null;

  const title =
    readMetaContent('meta[property="og:title"]') ||
    readMetaContent('meta[name="twitter:title"]') ||
    readFirstText(['.video-info .info-header h4', 'section.video-info h4', 'h1', 'h4', '.video-title', '.title']) ||
    document.title;
  const img =
    readMetaContent('meta[property="og:image"]') ||
    readMetaContent('meta[name="twitter:image"]') ||
    (document.querySelector('video[poster]') as HTMLVideoElement | null)?.poster ||
    '' ||
    '';

  return {
    title: cleanVideoTitle(title),
    url: url,
    views: readCurrentVideoViews(),
    likes: readCurrentVideoLikes(),
    img: img ? absUrl(img) : null,
    preview: inferPreviewFromImageUrl(img)
  };
}

function readVideoDetailsForActionElement(
  el: Element | null,
  collectionKey?: CollectionKey | null
): ScrapedVideoRow | null {
  const box = el && typeof el.closest === 'function' ? el.closest('div.video-img-box') : null;
  const row = scrapeVideoBox(box);
  if (row && collectionKeyForCurrentLocation() === collectionKey) row.siteOrder = siteOrderForVideoBox(box);

  return row || readCurrentVideoDetails();
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
  return row ? videoPathKey(row.url) === videoPathKey(operation.videoUrl) : false;
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
    await ipcRenderer.invoke('db:apply-collection-toggle', {
      collectionKey: collectionKey,
      action: action,
      video: video,
      sourceUrl: location.href
    });
  } catch (error) {
    console.warn('[JableDesktopScraper] collection toggle sync failed', error);
  }
}

async function queueCollectionToggle(
  collectionKey: CollectionKey,
  action: CollectionAction,
  video: ScrapedVideoRow,
  actionElement: Element | null,
  syncLock: ActiveSyncLock
) {
  const rollbackAction = action === 'add' ? 'remove' : 'add';
  applyQueuedCollectionVisualState(collectionKey, actionElement, action);

  try {
    return await ipcRenderer.invoke('db:apply-collection-toggle', {
      collectionKey: collectionKey,
      action: action,
      deferRemote: true,
      remoteVideoId: remoteVideoIdForActionElement(actionElement),
      remoteFavType: remoteFavTypeForActionElement(actionElement, collectionKey),
      syncRunId: syncLock.syncRunId,
      video: video,
      sourceUrl: location.href
    });
  } catch (error) {
    applyQueuedCollectionVisualState(collectionKey, actionElement, rollbackAction);
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
    await applyCollectionToggle(
      collectionKey,
      action,
      readVideoDetailsForActionElement(actionElement, collectionKey) || video
    );
  }
}

document.addEventListener('click', handleCollectionButtonClick, { capture: true });

async function syncCollection(options?: Partial<SyncBrowserCollectionOptions> | null): Promise<SyncResult> {
  const syncOptions = options || {};

  const collectionKey = syncOptions.collectionKey as CollectionKey;
  const mode: SyncMode = syncOptions.mode || 'quick';
  const syncRunId = syncOptions.syncRunId || '';
  const siteOrderOffset = Number(syncOptions.siteOrderOffset) || 0;
  const startPage = Number(syncOptions.startPage) || null;
  const batchLimit = Number(syncOptions.batchLimit) || null;
  let totalRows = 0;
  let totalPages = 0;
  let logicalPage = currentPageNumber() || startPage || 1;
  let lastScrapedPage: number | null = null;
  let lastKnownUrl: string | null = null;
  let stoppedByKnownPage = false;
  let incompleteReason: string | null = null;

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
      lastKnownUrl: lastKnownUrl
    };
  }

  async function checkRowsKnown(rows: ScrapedVideoRow[]) {
    if (!syncOptions.stopOnKnownPage || !rows.length) return false;

    const urls: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      urls.push(rows[i].url);
    }

    try {
      return await ipcRenderer.invoke('db:collection-urls-known', {
        collectionKey: collectionKey,
        urls: urls
      });
    } catch (error) {
      console.warn('[JableDesktopScraper] known URL check failed; continuing sync', error);
      return false;
    }
  }

  async function recordCurrentPage(pageNumber?: number | null) {
    const rows = uniqByUrl(scrapeCurrentPage());
    lastScrapedPage = pageNumber || logicalPage || currentPageNumber() || 1;
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
      url: location.href
    };

    await ipcRenderer.invoke('db:save-sync-page', payload);
    sendProgress('sync-page', payload);

    if (allKnown) {
      stoppedByKnownPage = true;
      return true;
    }

    return false;
  }

  async function loadNextPage() {
    const links = readPagerLinks();
    const next = chooseNextPagerLink(links, logicalPage);
    if (!next) return 'done';

    const oldSig = signature();

    try {
      next.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {}

    await new Promise(function (resolve) {
      setTimeout(resolve, 200);
    });
    next.el.click();
    const changed = await waitForContainerChange(oldSig, 15000);

    if (!changed || signature() === oldSig) {
      incompleteReason = 'page-unchanged';
      return 'failed';
    }

    logicalPage = next.pageNumber || currentPageNumber() || logicalPage;

    sendProgress('sync-progress', {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: logicalPage,
      message: 'page-loaded'
    });

    return 'loaded';
  }

  async function ensureFirstPage() {
    const pageNumber = currentPageNumber();
    logicalPage = pageNumber || logicalPage || 1;

    if (pageNumber === 1) return true;

    const first = chooseFirstPagerLink(readPagerLinks());
    if (!first) {
      incompleteReason = 'first-page-unavailable';
      return false;
    }

    const oldSig = signature();

    try {
      first.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {}

    await new Promise(function (resolve) {
      setTimeout(resolve, 200);
    });
    first.el.click();

    const changed = await waitForContainerChange(oldSig, 15000);
    if (!changed || signature() === oldSig) {
      if (currentPageNumber() === 1) {
        logicalPage = 1;
        return true;
      }

      incompleteReason = 'first-page-unchanged';
      return false;
    }

    logicalPage = 1;

    sendProgress('sync-progress', {
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

  if (await recordCurrentPage()) {
    return result(true);
  }

  if (batchLimit && totalPages >= batchLimit) {
    if (chooseNextPagerLink(readPagerLinks(), logicalPage)) {
      incompleteReason = 'batch-limit';
      return result(false);
    }

    return result(true);
  }

  while (true) {
    const nextState = await loadNextPage();
    if (nextState === 'done') break;
    if (nextState === 'failed') return result(false);

    if (await recordCurrentPage(logicalPage)) return result(true);
    if (batchLimit && totalPages >= batchLimit) {
      if (chooseNextPagerLink(readPagerLinks(), logicalPage)) {
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

async function applyDeferredSyncOperations(operations: DeferredSyncOperation[]) {
  const applied: number[] = [];
  const failed: Array<{ id: number; message: string }> = [];
  const baseUrl = String(location.href || '').split('#')[0];

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];

    try {
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

      applied.push(operation.id);
    } catch (error) {
      failed.push({
        id: operation.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    applied: applied,
    failed: failed
  };
}

ipcRenderer.on('browser:sync-collection-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  syncCollection(syncOptionsFromPayload(payload))
    .then(function (result) {
      sendPreloadResponse(requestId, result);
    })
    .catch(function (error) {
      sendPreloadError(requestId, error);
    });
});

ipcRenderer.on('browser:apply-deferred-sync-operations-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  const operations = isRecord(payload) && Array.isArray(payload.operations) ? payload.operations : [];

  applyDeferredSyncOperations(operations as DeferredSyncOperation[])
    .then(function (result) {
      sendPreloadResponse(requestId, result);
    })
    .catch(function (error) {
      sendPreloadError(requestId, error);
    });
});

ipcRenderer.on('browser:sync-lock-state', function (_event, payload: unknown) {
  updateActiveSyncLocks(payload);
});

ipcRenderer.on('browser:pending-collection-operations', function (_event, payload: unknown) {
  updatePendingCollectionOperations(payload);
});

ipcRenderer
  .invoke('browser:active-sync-runs')
  .then(updateActiveSyncLocks)
  .catch(function () {});

ipcRenderer
  .invoke('browser:pending-collection-operations')
  .then(updatePendingCollectionOperations)
  .catch(function () {});

ipcRenderer.on('browser:diagnose-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  try {
    sendPreloadResponse(requestId, diagnosePage());
  } catch (error) {
    sendPreloadError(requestId, error);
  }
});

installPendingCollectionOperationOverlay();
installAdCosmeticFilter();
