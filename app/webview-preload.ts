'use strict';

var electron = require('electron');
var contextBridge = electron.contextBridge;
var ipcRenderer = electron.ipcRenderer;
var chooseNextPagerLink = require('./sync-utils').chooseNextPagerLink;

var IS_MACOS = process.platform === 'darwin';
var SEL_LIST_CONTAINER = '#list_videos_my_favourite_videos';
var SEL_TITLES = 'div.detail h6.title a';
var SEL_PAGER = 'ul.pagination';
var SEL_PAGER_LINKS = 'ul.pagination a.page-link';
var SITE_PAGE_SIZE = 24;
var TRACKPAD_HISTORY_THRESHOLD = 180;
var TRACKPAD_HISTORY_COOLDOWN_MS = 700;
var TRACKPAD_HISTORY_RESET_MS = 180;
var COLLECTION_TOGGLE_CONFIRM_TIMEOUT_MS = 4000;
var COLLECTION_TOGGLE_CONFIRM_POLL_MS = 120;
var trackpadHistoryDeltaX = 0;
var trackpadHistoryLastSentAt = 0;
var trackpadHistoryResetTimer = null;

function absUrl(href, base?) {
  try {
    return new URL(href, base || location.href).href;
  } catch (error) {
    return href;
  }
}

function uniqByUrl(rows) {
  var seen = {};
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].url || seen[rows[i].url]) continue;
    seen[rows[i].url] = true;
    out.push(rows[i]);
  }

  return out;
}

function parseMetricNumber(value) {
  var number = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(number) && number > 0 ? number : null;
}

function inferPreviewFromImageUrl(value) {
  if (!value) return null;

  var url = absUrl(value);
  var match = url.match(
    /^(https?:\/\/[^?#]+\/contents\/videos_screenshots\/\d+\/(\d+)\/)(?:preview\.jpg|320x180\/1\.jpg|[^?#]+)(?:[?#].*)?$/
  );

  return match ? match[1] + match[2] + '_preview.mp4' : null;
}

function canonicalVideoHrefFromBox(box, fallbackAnchor) {
  var anchors = box ? box.querySelectorAll('div.img-box a[href], div.detail h6.title a[href]') : [];

  for (var i = 0; i < anchors.length; i++) {
    var href = anchors[i].getAttribute('href') || '';

    try {
      var parsed = new URL(href, anchors[i].baseURI || location.href);
      if (/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return parsed.href;
    } catch (error) {}
  }

  return fallbackAnchor
    ? absUrl(fallbackAnchor.getAttribute('href') || '', fallbackAnchor.baseURI || location.href)
    : '';
}

function scrapeVideoBox(box) {
  if (!box) return null;

  var a = box.querySelector('div.detail h6.title a');
  if (!a) return null;

  var title = (a.textContent || '').replace(/\s+/g, ' ').trim();
  var href = canonicalVideoHrefFromBox(box, a);
  var img = box.querySelector('div.img-box img');
  var imgSrc = img ? img.getAttribute('data-src') || img.getAttribute('src') || '' : '';
  var previewSrc = img ? img.getAttribute('data-preview') || '' : '';
  var views = null;
  var likes = null;
  var sub = box.querySelector('div.detail p.sub-title');

  if (sub) {
    var texts: string[] = [];
    for (var n = 0; n < sub.childNodes.length; n++) {
      var node = sub.childNodes[n];
      if (node.nodeType === Node.TEXT_NODE) {
        var text = node.textContent.replace(/\s+/g, ' ').trim();
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
  var out = [];
  var boxes = document.querySelectorAll('div.video-img-box');

  for (var i = 0; i < boxes.length; i++) {
    var row = scrapeVideoBox(boxes[i]);
    if (row) out.push(row);
  }

  return out;
}

function normalizePageNumber(value) {
  var n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(n) && n > 0 ? n : 1;
}

function currentPageNumber() {
  var active = document.querySelector(
    [
      'ul.pagination span.page-link.active',
      'ul.pagination a.page-link.active',
      'ul.pagination .page-item.active .page-link',
      'ul.pagination [aria-current="page"]'
    ].join(', ')
  );
  return active ? normalizePageNumber(active.textContent) : 1;
}

function signature() {
  var list = document.querySelectorAll(SEL_TITLES);
  var count = list.length;
  var first = count ? list[0].getAttribute('href') || '' : '';
  return count + '|' + first;
}

function waitForContainerChange(oldSig, timeoutMs) {
  var timeout = timeoutMs || 12000;
  var target = document.querySelector(SEL_LIST_CONTAINER) || document.body;
  var deadline = Date.now() + timeout;

  return new Promise(function (resolve) {
    var done = false;
    var observer = new MutationObserver(function () {
      check();
    });

    function finish(changed) {
      if (done) return;
      done = true;
      observer.disconnect();
      resolve(changed);
    }

    function check() {
      var cur = signature();
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
  var pager = document.querySelector(SEL_PAGER);
  if (!pager) return [];

  var anchors = pager.querySelectorAll(SEL_PAGER_LINKS);
  var out = [];

  for (var i = 0; i < anchors.length; i++) {
    var anchor = anchors[i];
    var text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    var pageNumber = /^\d+$/.test(text) ? normalizePageNumber(text) : null;
    var params = anchor.getAttribute('data-parameters') || '';
    var match = params.match(/(?:^|;)from(?:_my_fav_videos)?:\s*(\d+)/);
    var id = null;

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

function sendProgress(channel, payload) {
  try {
    if (typeof ipcRenderer.sendToHost === 'function') {
      ipcRenderer.sendToHost(channel, payload);
    }
  } catch (error) {}

  ipcRenderer.send('browser:' + channel, payload);
}

function canElementScrollHorizontally(el) {
  if (!el || el === document || el === window) return false;

  var style = window.getComputedStyle(el);
  var overflowX = style ? style.overflowX : '';
  var scrollableOverflow = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';

  return scrollableOverflow && el.scrollWidth > el.clientWidth + 1;
}

function canTargetContinueHorizontalScroll(target, direction) {
  var el = null;

  if (target && target.nodeType === Node.ELEMENT_NODE) el = target;
  else if (target && target.parentElement) el = target.parentElement;

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

function handleTrackpadHistoryWheel(event) {
  var deltaX = Number(event.deltaX) || 0;
  var deltaY = Number(event.deltaY) || 0;
  var absX = Math.abs(deltaX);
  var absY = Math.abs(deltaY);

  if (event.defaultPrevented || absX < 1 || absX < absY * 1.5) return;
  if (Date.now() - trackpadHistoryLastSentAt < TRACKPAD_HISTORY_COOLDOWN_MS) return;

  trackpadHistoryDeltaX += deltaX;

  if (trackpadHistoryResetTimer) clearTimeout(trackpadHistoryResetTimer);
  trackpadHistoryResetTimer = setTimeout(resetTrackpadHistoryDelta, TRACKPAD_HISTORY_RESET_MS);

  if (Math.abs(trackpadHistoryDeltaX) < TRACKPAD_HISTORY_THRESHOLD) return;

  // macOS natural horizontal scrolling reports negative deltaX for the back gesture.
  var direction = trackpadHistoryDeltaX < 0 ? 'back' : 'forward';

  if (canTargetContinueHorizontalScroll(event.target, direction)) {
    resetTrackpadHistoryDelta();
    return;
  }

  event.preventDefault();
  resetTrackpadHistoryDelta();
  trackpadHistoryLastSentAt = Date.now();
  ipcRenderer.send('browser:trackpad-history', direction);
}

function closestAnchor(target) {
  var el = null;

  if (target && target.nodeType === Node.ELEMENT_NODE) el = target;
  else if (target && target.parentElement) el = target.parentElement;

  while (el && el !== document.documentElement) {
    if (el.tagName === 'A' && el.href) return el;
    el = el.parentElement;
  }

  return null;
}

function handleMiddleClickNewTab(event) {
  if (!event.isTrusted || event.defaultPrevented || event.button !== 1) return;

  var anchor = closestAnchor(event.target);
  if (!anchor) return;

  var href = anchor.getAttribute('href') || anchor.href || '';
  var url = absUrl(href, anchor.baseURI || location.href);

  if (!url || /^javascript:/i.test(url)) return;

  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.send('browser:open-url-new-tab', { url: url });
}

if (IS_MACOS) {
  window.addEventListener('wheel', handleTrackpadHistoryWheel, { capture: true, passive: false });
}

window.addEventListener('auxclick', handleMiddleClickNewTab, { capture: true });

function closestCollectionActionElement(target) {
  var el = null;

  if (target && target.nodeType === Node.ELEMENT_NODE) el = target;
  else if (target && target.parentElement) el = target.parentElement;

  while (el && el !== document.documentElement) {
    if (el.tagName === 'BUTTON' && el.classList && el.classList.contains('btn-action')) return el;
    if (el.classList && el.classList.contains('action') && el.hasAttribute('data-fav-video-id')) return el;
    el = el.parentElement;
  }

  return null;
}

function buttonHasIcon(button, iconId) {
  if (!button) return false;

  var uses = button.querySelectorAll('use');

  for (var i = 0; i < uses.length; i++) {
    var href =
      uses[i].getAttribute('href') ||
      uses[i].getAttribute('xlink:href') ||
      (uses[i].href && uses[i].href.baseVal) ||
      '';
    if (href === iconId) return true;
  }

  return false;
}

function collectionKeyForActionElement(el) {
  if (!el || !el.classList) return null;

  var favType = el.getAttribute('data-fav-type');
  if (favType === '0') return 'favourites';
  if (favType === '1') return 'watch_later';

  if (el.classList.contains('fav') || buttonHasIcon(el, '#icon-heart')) return 'favourites';
  if (buttonHasIcon(el, '#icon-bookmark-inline')) return 'watch_later';

  return null;
}

function collectionListActionForElement(el) {
  if (!el || !el.classList) return null;

  if (el.classList.contains('fav-remove') || buttonHasIcon(el, '#icon-close')) return 'remove';
  if (el.classList.contains('fav-restore') || buttonHasIcon(el, '#icon-rotate-back')) return 'add';

  return null;
}

function collectionActionForElement(el) {
  var listAction = collectionListActionForElement(el);
  if (listAction) return listAction;

  return el && el.classList && el.classList.contains('active') ? 'remove' : 'add';
}

function actionRequiresLogin(el) {
  var actionUrl = el ? el.getAttribute('data-href') || el.getAttribute('href') || '' : '';
  return /\/login-required\/?/.test(actionUrl);
}

function isJablePage() {
  return /(^|\.)jable\.tv$/i.test(location.hostname || '');
}

function currentVideoUrl() {
  if (!isJablePage()) return null;

  try {
    var parsed = new URL(location.href);
    if (!/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return null;
    if (!/\/$/.test(parsed.pathname)) parsed.pathname += '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return null;
  }
}

function normalizePageText(value) {
  var text = value == null ? '' : String(value);
  return text.replace(/\s+/g, ' ').trim();
}

function readMetaContent(selector) {
  var el = document.querySelector(selector);
  return el ? normalizePageText(el.getAttribute('content')) : '';
}

function readFirstText(selectors) {
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    var text = el ? normalizePageText(el.textContent) : '';
    if (text) return text;
  }

  return '';
}

function cleanVideoTitle(value) {
  var text = normalizePageText(value);
  if (!text) return null;

  text = text.replace(/\s*[-|]\s*Jable\.TV\s*$/i, '').trim();
  return text || null;
}

function readNumberAfterIcon(container, iconId) {
  if (!container) return null;

  var svgs = container.querySelectorAll('svg');

  for (var i = 0; i < svgs.length; i++) {
    if (!buttonHasIcon(svgs[i], iconId)) continue;

    var node = svgs[i].nextSibling;

    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        var textNumber = parseMetricNumber(node.textContent);
        if (textNumber !== null) return textNumber;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        var elementNumber = parseMetricNumber(node.textContent);
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
  var count = document.querySelector('button[data-fav-type="0"] .count, button.fav .count');
  return count ? parseMetricNumber(count.textContent) : null;
}

function readCurrentVideoDetails() {
  var url = currentVideoUrl();
  if (!url) return null;

  var title =
    readMetaContent('meta[property="og:title"]') ||
    readMetaContent('meta[name="twitter:title"]') ||
    readFirstText(['.video-info .info-header h4', 'section.video-info h4', 'h1', 'h4', '.video-title', '.title']) ||
    document.title;
  var img =
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

function readVideoDetailsForActionElement(el) {
  var box = el && typeof el.closest === 'function' ? el.closest('div.video-img-box') : null;
  var row = scrapeVideoBox(box);

  return row || readCurrentVideoDetails();
}

function findCollectionActionElement(collectionKey) {
  var elements = document.querySelectorAll('button.btn-action, .action[data-fav-video-id]');

  for (var i = 0; i < elements.length; i++) {
    if (collectionKeyForActionElement(elements[i]) === collectionKey) return elements[i];
  }

  return null;
}

function collectionActionActiveState(collectionKey, originalElement) {
  var el =
    originalElement && document.documentElement.contains(originalElement)
      ? originalElement
      : findCollectionActionElement(collectionKey);

  return el ? el.classList.contains('active') : null;
}

function findMatchingCollectionActionElement(originalElement) {
  if (!originalElement) return null;

  var videoId = originalElement.getAttribute('data-fav-video-id') || '';
  var favType = originalElement.getAttribute('data-fav-type') || '';
  if (!videoId) return null;

  var elements = document.querySelectorAll('.action[data-fav-video-id]');

  for (var i = 0; i < elements.length; i++) {
    if (elements[i].getAttribute('data-fav-video-id') !== videoId) continue;
    if (favType && elements[i].getAttribute('data-fav-type') !== favType) continue;
    return elements[i];
  }

  return null;
}

function collectionListRemovedState(originalElement) {
  var el =
    originalElement && document.documentElement.contains(originalElement)
      ? originalElement
      : findMatchingCollectionActionElement(originalElement);
  var imgBox = el && typeof el.closest === 'function' ? el.closest('div.img-box') : null;

  return imgBox ? imgBox.classList.contains('removed') : null;
}

function collectionActionMatchesState(collectionKey, originalElement, action) {
  if (collectionListActionForElement(originalElement)) {
    return collectionListRemovedState(originalElement) === (action === 'remove');
  }

  return collectionActionActiveState(collectionKey, originalElement) === (action === 'add');
}

function waitForCollectionActionState(collectionKey, originalElement, action) {
  return new Promise(function (resolve) {
    var target = document.body || document.documentElement;
    var deadline = Date.now() + COLLECTION_TOGGLE_CONFIRM_TIMEOUT_MS;
    var observer = null;
    var pollTimer = null;
    var done = false;

    function finish(ok) {
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

async function applyCollectionToggle(collectionKey, action, video) {
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

async function handleCollectionButtonClick(event) {
  if (!event.isTrusted || event.defaultPrevented) return;

  var actionElement = closestCollectionActionElement(event.target);
  var collectionKey = collectionKeyForActionElement(actionElement);
  if (!collectionKey || actionRequiresLogin(actionElement)) return;

  var video = readVideoDetailsForActionElement(actionElement);
  if (!video) return;

  var action = collectionActionForElement(actionElement);

  if (await waitForCollectionActionState(collectionKey, actionElement, action)) {
    await applyCollectionToggle(collectionKey, action, readVideoDetailsForActionElement(actionElement) || video);
  }
}

document.addEventListener('click', handleCollectionButtonClick, { capture: true });

async function syncCollection(options) {
  options = options || {};

  var collectionKey = options.collectionKey;
  var mode = options.mode || 'quick';
  var syncRunId = options.syncRunId || null;
  var siteOrderOffset = Number(options.siteOrderOffset) || 0;
  var startPage = Number(options.startPage) || null;
  var batchLimit = Number(options.batchLimit) || null;
  var totalRows = 0;
  var totalPages = 0;
  var logicalPage = startPage || currentPageNumber();
  var lastScrapedPage = null;
  var lastKnownUrl = null;
  var stoppedByKnownPage = false;
  var incompleteReason = null;

  function result(completed) {
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

  async function checkRowsKnown(rows) {
    if (!options.stopOnKnownPage || !rows.length) return false;

    var urls = [];
    for (var i = 0; i < rows.length; i++) {
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

  async function recordCurrentPage(pageNumber?) {
    var rows = uniqByUrl(scrapeCurrentPage());
    lastScrapedPage = pageNumber || logicalPage || currentPageNumber();
    logicalPage = lastScrapedPage;

    for (var r = 0; r < rows.length; r++) {
      rows[r].siteOrder = siteOrderOffset + totalRows + r + 1;
    }

    totalRows += rows.length;
    totalPages++;

    if (rows.length) lastKnownUrl = rows[rows.length - 1].url;

    var allKnown = await checkRowsKnown(rows);

    sendProgress('sync-page', {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: lastScrapedPage,
      rows: rows,
      url: location.href
    });

    if (allKnown) {
      stoppedByKnownPage = true;
      return true;
    }

    return false;
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
    var links = readPagerLinks();
    var next = chooseNextPagerLink(links, logicalPage);
    if (!next) break;

    var oldSig = signature();

    try {
      next.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {}

    await new Promise(function (resolve) {
      setTimeout(resolve, 200);
    });
    next.el.click();
    var changed = await waitForContainerChange(oldSig, 15000);

    if (!changed || signature() === oldSig) {
      incompleteReason = 'page-unchanged';
      return result(false);
    }

    logicalPage = next.pageNumber || currentPageNumber();

    sendProgress('sync-progress', {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: logicalPage,
      message: 'page-loaded'
    });

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

contextBridge.exposeInMainWorld('jableDesktopScraper', {
  syncCollection: syncCollection
});
