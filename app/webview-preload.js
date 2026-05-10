'use strict';

var electron = require('electron');
var contextBridge = electron.contextBridge;
var ipcRenderer = electron.ipcRenderer;

var SEL_LIST_CONTAINER = '#list_videos_my_favourite_videos';
var SEL_TITLES = 'div.detail h6.title a';
var SEL_PAGER = 'ul.pagination';
var SEL_PAGER_LINKS = 'ul.pagination a.page-link';

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
    var imgSrc = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
    var previewSrc = img ? (img.getAttribute('data-preview') || '') : '';
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
  var active = document.querySelector('ul.pagination span.page-link.active');
  return active ? normalizePageNumber(active.textContent) : 1;
}

function signature() {
  var list = document.querySelectorAll(SEL_TITLES);
  var count = list.length;
  var first = count ? (list[0].getAttribute('href') || '') : '';
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
    var params = anchor.getAttribute('data-parameters') || '';
    var match = params.match(/(?:^|;)from(?:_my_fav_videos)?:\s*(\d+)/);
    var id = null;

    if (match) id = match[1];
    else if (/^\d+$/.test(text)) id = text;
    else id = text || ('a_' + i);

    out.push({ el: anchor, id: id, label: text });
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

async function syncCollection(options) {
  options = options || {};

  var collectionKey = options.collectionKey;
  var knownUrls = {};
  var knownList = Array.isArray(options.knownUrls) ? options.knownUrls : [];

  for (var i = 0; i < knownList.length; i++) {
    knownUrls[knownList[i]] = true;
  }

  var visited = {};
  var active = document.querySelector('ul.pagination span.page-link.active');
  if (active) {
    var activeText = (active.textContent || '').trim();
    if (activeText) visited[activeText] = true;
  }

  var safety = 100;
  var totalRows = 0;
  var totalPages = 0;
  var lastScrapedPage = null;
  var lastKnownUrl = null;
  var stoppedByKnownPage = false;

  function recordCurrentPage() {
    var rows = uniqByUrl(scrapeCurrentPage());
    lastScrapedPage = currentPageNumber();
    totalRows += rows.length;
    totalPages++;

    if (rows.length) lastKnownUrl = rows[rows.length - 1].url;

    sendProgress('sync-page', {
      collectionKey: collectionKey,
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
    return {
      completed: true,
      stoppedByKnownPage: stoppedByKnownPage,
      totalPages: totalPages,
      totalRows: totalRows,
      lastScrapedPage: lastScrapedPage,
      lastKnownUrl: lastKnownUrl
    };
  }

  while (safety-- > 0) {
    var links = readPagerLinks();
    var candidates = [];

    for (var c = 0; c < links.length; c++) {
      if (!visited[links[c].id]) candidates.push(links[c]);
    }

    if (!candidates.length) break;

    candidates.sort(function (a, b) {
      var na = parseInt(a.id, 10);
      var nb = parseInt(b.id, 10);
      if (isFinite(na) && isFinite(nb)) return na - nb;
      return String(a.id).localeCompare(String(b.id));
    });

    var next = candidates[0];
    var oldSig = signature();

    try {
      next.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {}

    await new Promise(function (resolve) { setTimeout(resolve, 200); });
    next.el.click();
    await waitForContainerChange(oldSig, 15000);

    visited[next.id] = true;
    sendProgress('sync-progress', {
      collectionKey: collectionKey,
      page: currentPageNumber(),
      message: 'page-loaded'
    });

    if (recordCurrentPage()) break;
    await new Promise(function (resolve) { setTimeout(resolve, 500 + Math.random() * 500); });
  }

  return {
    completed: true,
    stoppedByKnownPage: stoppedByKnownPage,
    totalPages: totalPages,
    totalRows: totalRows,
    lastScrapedPage: lastScrapedPage,
    lastKnownUrl: lastKnownUrl
  };
}

contextBridge.exposeInMainWorld('jableDesktopScraper', {
  syncCollection: syncCollection
});
