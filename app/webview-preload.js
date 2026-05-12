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
var trackpadHistoryDeltaX = 0;
var trackpadHistoryLastSentAt = 0;
var trackpadHistoryResetTimer = null;

function absUrl(href, base) {
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

function allRowsKnown(rows, knownUrls) {
  if (!rows.length) return false;

  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].url || !knownUrls[rows[i].url]) return false;
  }

  return true;
}

function scrapeCurrentPage() {
  var out = [];
  var boxes = document.querySelectorAll('div.video-img-box');

  for (var i = 0; i < boxes.length; i++) {
    var box = boxes[i];
    var a = box.querySelector('div.detail h6.title a');
    if (!a) continue;

    var title = (a.textContent || '').replace(/\s+/g, ' ').trim();
    var href = a.getAttribute('href') || '';
    var img = box.querySelector('div.img-box img');
    var imgSrc = img ? img.getAttribute('data-src') || img.getAttribute('src') || '' : '';
    var previewSrc = img ? img.getAttribute('data-preview') || '' : '';
    var views = null;
    var likes = null;
    var sub = box.querySelector('div.detail p.sub-title');

    if (sub) {
      var texts = [];
      for (var n = 0; n < sub.childNodes.length; n++) {
        var node = sub.childNodes[n];
        if (node.nodeType === Node.TEXT_NODE) {
          var text = node.textContent.replace(/\s+/g, ' ').trim();
          if (text) texts.push(text);
        }
      }

      if (texts.length >= 1) views = parseInt(texts[0].replace(/[^\d]/g, ''), 10) || null;
      if (texts.length >= 2) likes = parseInt(texts[1].replace(/[^\d]/g, ''), 10) || null;
    }

    if (!href) continue;
    out.push({
      title: title,
      url: absUrl(href),
      views: views,
      likes: likes,
      img: imgSrc ? absUrl(imgSrc) : null,
      preview: previewSrc ? absUrl(previewSrc) : null
    });
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

if (IS_MACOS) {
  window.addEventListener('wheel', handleTrackpadHistoryWheel, { capture: true, passive: false });
}

async function syncCollection(options) {
  options = options || {};

  var collectionKey = options.collectionKey;
  var mode = options.mode || 'quick';
  var syncRunId = options.syncRunId || null;
  var siteOrderOffset = Number(options.siteOrderOffset) || 0;
  var startPage = Number(options.startPage) || null;
  var batchLimit = Number(options.batchLimit) || null;
  var knownUrls = {};
  var knownList = Array.isArray(options.knownUrls) ? options.knownUrls : [];

  for (var i = 0; i < knownList.length; i++) {
    knownUrls[knownList[i]] = true;
  }

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

  function recordCurrentPage(pageNumber) {
    var rows = uniqByUrl(scrapeCurrentPage());
    lastScrapedPage = pageNumber || logicalPage || currentPageNumber();
    logicalPage = lastScrapedPage;

    for (var r = 0; r < rows.length; r++) {
      rows[r].siteOrder = siteOrderOffset + totalRows + r + 1;
    }

    totalRows += rows.length;
    totalPages++;

    if (rows.length) lastKnownUrl = rows[rows.length - 1].url;

    sendProgress('sync-page', {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: lastScrapedPage,
      rows: rows,
      url: location.href
    });

    if (options.stopOnKnownPage && allRowsKnown(rows, knownUrls)) {
      stoppedByKnownPage = true;
      return true;
    }

    for (var n = 0; n < rows.length; n++) {
      if (rows[n].url) knownUrls[rows[n].url] = true;
    }

    return false;
  }

  if (recordCurrentPage()) {
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

    if (recordCurrentPage(logicalPage)) return result(true);
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
