// ==UserScript==
// @name         Jable Favourites Exporter
// @namespace    shane.tools
// @version      1.0.0
// @description  Export titles, URLs, views, and likes from Jable favourites pages by simulating pagination clicks (no direct crawling).
// @license      MIT
// @author       shane
// @match        https://jable.tv/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ---------------------------------------
   * Configuration
   * ------------------------------------- */
  // 可選：'json' 或 'csv'
  var EXPORT_FORMAT = 'json';
  var PAGE_SIZE = 24;
  var STORAGE_PREFIX = 'jable-favourites-exporter:';

  /* ---------------------------------------
   * Selectors
   * ------------------------------------- */
  var SEL_LIST_CONTAINER = '#list_videos_my_favourite_videos'; // 清單容器
  var SEL_TITLES = 'div.detail h6.title a';                 // 標題 <a>
  var SEL_PAGER = 'ul.pagination';                          // 分頁容器
  var SEL_PAGER_LINKS = 'ul.pagination a.page-link';        // 可點擊的分頁
  var BTN_ID = 'fav-export-all-btn';                        // 匯出按鈕 ID

  function isExportPage() {
    return /\/my\/favourites\/videos(?:-watch-later)?\/?$/.test(location.pathname);
  }

  /* ---------------------------------------
   * File naming by current path
   * ------------------------------------- */
  function fileBaseByPath() {
    var url = location.pathname.replace(/[?#].*$/, '');
    if (/\/my\/favourites\/videos-watch-later\/?$/.test(url)) return 'watch_later_list';
    if (/\/my\/favourites\/videos\/?$/.test(url)) return 'favourites_list';
    return 'export_list';
  }

  /* ---------------------------------------
   * Utilities
   * ------------------------------------- */
  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[FavExporter]');
    console.log.apply(console, args);
  }

  function escCsv(s) {
    s = (s == null ? '' : String(s));
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function uniqByUrl(rows) {
    var seen = {};
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var u = rows[i].url;
      if (!u) continue;
      if (!seen[u]) {
        seen[u] = 1;
        out.push(rows[i]);
      }
    }
    return out;
  }

  function toCSV(rows) {
    var lines = ['title,url,views,likes,img,preview'];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push(
        escCsv(r.title) + ',' +
        escCsv(r.url) + ',' +
        (r.views || '') + ',' +
        (r.likes || '') + ',' +
        escCsv(r.img) + ',' +
        escCsv(r.preview)
      );
    }
    return lines.join('\n');
  }

  function flattenPages(resource) {
    var rows = [];
    if (!resource || !resource.data) return rows;

    for (var i = 0; i < resource.data.length; i++) {
      var page = resource.data[i];
      if (page && page.data) rows = rows.concat(page.data);
    }

    return rows;
  }

  function rowsByPage(rows) {
    var pages = [];
    var exportedAt = new Date().toISOString();

    for (var i = 0; i < rows.length; i += PAGE_SIZE) {
      var chunk = rows.slice(i, i + PAGE_SIZE);
      var pageNumber = Math.floor(i / PAGE_SIZE) + 1;

      pages.push({
        data: chunk,
        meta: {
          current_page: pageNumber,
          per_page: PAGE_SIZE,
          count: chunk.length,
          first_url: chunk.length ? chunk[0].url : null,
          last_url: chunk.length ? chunk[chunk.length - 1].url : null,
          exported_at: exportedAt
        }
      });
    }

    return pages;
  }

  function buildExportResource(rows, completed, lastScrapedPage) {
    var pages = rowsByPage(rows);
    var exportedAt = new Date().toISOString();

    return {
      data: pages,
      meta: {
        format_version: 2,
        source_path: location.pathname,
        source_url: location.href,
        exported_at: exportedAt,
        completed: !!completed,
        per_page: PAGE_SIZE,
        page_count: pages.length,
        total: rows.length,
        last_page: pages.length ? pages[pages.length - 1].meta.current_page : null,
        last_scraped_page: lastScrapedPage || null
      }
    };
  }

  function storageKey() {
    return STORAGE_PREFIX + fileBaseByPath();
  }

  function loadCachedResource() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return null;

      var resource = JSON.parse(raw);
      if (!resource || !resource.data || !resource.meta) return null;

      return resource;
    } catch (e) {
      log('failed to load cache', e);
      return null;
    }
  }

  function saveCachedResource(resource) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(resource));
    } catch (e) {
      log('failed to save cache', e);
    }
  }

  function urlMap(rows) {
    var out = {};
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].url) out[rows[i].url] = true;
    }
    return out;
  }

  function allRowsKnown(rows, known) {
    if (!rows.length) return false;

    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].url || !known[rows[i].url]) return false;
    }

    return true;
  }

  function rowsHaveMediaFields(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (typeof rows[i].img === 'undefined' || typeof rows[i].preview === 'undefined') {
        return false;
      }
    }

    return true;
  }

  function mergeRows(newRows, cachedRows) {
    return uniqByUrl(newRows.concat(cachedRows));
  }

  function downloadBlob(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function downloadCsv(name, text) {
    downloadBlob(name, new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  }

  function downloadJson(name, data) {
    downloadBlob(name, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  }

  function absUrl(href, base) {
    try {
      return new URL(href, base || location.href).href;
    } catch (e) {
      return href;
    }
  }

  /* ---------------------------------------
   * Scraping helpers
   * ------------------------------------- */
  // 擷取當前頁面 { title, url, views, likes, img, preview }
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
            var t = node.textContent.replace(/\s+/g, ' ').trim();
            if (t) texts.push(t);
          }
        }
        if (texts.length >= 1) {
          views = parseInt(texts[0].replace(/[^\d]/g, ''), 10) || null;
        }
        if (texts.length >= 2) {
          likes = parseInt(texts[1].replace(/[^\d]/g, ''), 10) || null;
        }
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

  /* ---------------------------------------
   * Pagination helpers
   * ------------------------------------- */
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
    if (!timeoutMs) timeoutMs = 12000;
    var target = document.querySelector(SEL_LIST_CONTAINER) || document.body;
    var deadline = Date.now() + timeoutMs;

    return new Promise(function (resolve) {
      var done = false;

      function check() {
        var cur = signature();
        if (cur && cur !== oldSig) {
          done = true;
          resolve(true);
        } else if (Date.now() > deadline) {
          done = true;
          resolve(false);
        }
      }

      var mo = new MutationObserver(function () { check(); });
      mo.observe(target, { childList: true, subtree: true });

      (function poll() {
        if (done) { mo.disconnect(); return; }
        check();
        if (!done) setTimeout(poll, 300);
        else mo.disconnect();
      })();
    });
  }

  function readPagerLinks() {
    var pager = document.querySelector(SEL_PAGER);
    if (!pager) return [];

    var anchors = pager.querySelectorAll(SEL_PAGER_LINKS);
    var out = [];

    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var txt = (a.textContent || '').replace(/\s+/g, ' ').trim();

      var params = a.getAttribute('data-parameters') || '';
      var m = params.match(/(?:^|;)from(?:_my_fav_videos)?:\s*(\d+)/);

      var pid = null;
      if (m) pid = m[1];
      else if (/^\d+$/.test(txt)) pid = txt;
      else pid = txt || ('a_' + i);

      out.push({ el: a, id: pid, label: txt });
    }

    return out;
  }

  /* ---------------------------------------
   * Main flow
   * ------------------------------------- */
  function exportAllByClick() {
    setBtnBusy(true, '準備中…');

    var cache = loadCachedResource();
    var cachedRows = flattenPages(cache);
    var cacheHasMedia = rowsHaveMediaFields(cachedRows);
    var cacheComplete = !!(cache && cache.meta && cache.meta.completed && cacheHasMedia);
    if (!cacheHasMedia) cachedRows = [];

    var knownUrls = urlMap(cachedRows);
    var newRows = [];
    var visited = {};
    var safety = 100;
    var lastScrapedPage = null;

    var active = document.querySelector('ul.pagination span.page-link.active');
    if (active) {
      var t = (active.textContent || '').trim();
      if (t) visited[t] = true;
    }

    function rowsForProgress() {
      return cacheComplete ? mergeRows(newRows, cachedRows) : mergeRows(cachedRows, newRows);
    }

    function recordCurrentPage() {
      var rows = uniqByUrl(scrapeCurrentPage());
      lastScrapedPage = currentPageNumber();

      if (cacheComplete && allRowsKnown(rows, knownUrls)) {
        log('known page reached, stop at page', lastScrapedPage);
        return true;
      }

      for (var i = 0; i < rows.length; i++) {
        var url = rows[i].url;
        if (!url || knownUrls[url]) continue;

        knownUrls[url] = true;
        newRows.push(rows[i]);
      }

      saveCachedResource(buildExportResource(rowsForProgress(), false, lastScrapedPage));
      return false;
    }

    if (recordCurrentPage()) return finish();

    function step() {
      if (safety-- <= 0) return finish();

      var links = readPagerLinks();
      var candidates = [];

      for (var i = 0; i < links.length; i++) {
        if (!visited[links[i].id]) candidates.push(links[i]);
      }

      if (!candidates.length) return finish();

      candidates.sort(function (a, b) {
        var na = parseInt(a.id, 10);
        var nb = parseInt(b.id, 10);
        if (isFinite(na) && isFinite(nb)) return na - nb;
        return String(a.id).localeCompare(String(b.id));
      });

      var next = candidates[0];
      var oldSig = signature();

      try { next.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}

      setTimeout(function () {
        log('click page', next.id, '(' + next.label + ')');
        try { next.el.click(); } catch (e) {}

        waitForContainerChange(oldSig, 15000).then(function () {
          visited[next.id] = true;

          if (recordCurrentPage()) return finish();

          log('page', next.id, 'new rows', newRows.length, 'total', rowsForProgress().length);
          setBtnBusy(true, '已擷取 ' + rowsForProgress().length + ' 筆，前往下一頁…');
          setTimeout(step, 500 + Math.random() * 500);
        });
      }, 200);
    }

    function finish() {
      setBtnBusy(false, '完成，匯出中…');
      var base = fileBaseByPath();
      var resource = buildExportResource(rowsForProgress(), true, lastScrapedPage);
      saveCachedResource(resource);

      if (EXPORT_FORMAT === 'csv') {
        downloadCsv(base + '.csv', toCSV(flattenPages(resource)));
      } else {
        downloadJson(base + '.json', resource);
      }

      log('done, total:', resource.meta.total);
    }

    step();
  }

  /* ---------------------------------------
   * UI: add export button
   * ------------------------------------- */
  function setBtnBusy(busy, text) {
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;

    if (!btn.getAttribute('data-label')) {
      btn.setAttribute('data-label', btn.textContent);
    }

    btn.disabled = !!busy;
    btn.textContent = busy ? (text || '處理中…') : btn.getAttribute('data-label');
    btn.style.opacity = busy ? '0.7' : '1';
  }

  function addNavButton() {
    if (document.getElementById(BTN_ID)) return true;
    if (!isExportPage() || !document.body) return false;

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '📦 匯出所有分頁影片';

    btn.style.setProperty('position', 'fixed', 'important');
    btn.style.setProperty('right', '16px', 'important');
    btn.style.setProperty('bottom', '16px', 'important');
    btn.style.setProperty('z-index', '2147483647', 'important');
    btn.style.setProperty('display', 'inline-flex', 'important');
    btn.style.setProperty('align-items', 'center', 'important');
    btn.style.setProperty('justify-content', 'center', 'important');
    btn.style.setProperty('background', '#f36', 'important');
    btn.style.setProperty('color', '#fff', 'important');
    btn.style.setProperty('border', 'none', 'important');
    btn.style.setProperty('border-radius', '8px', 'important');
    btn.style.setProperty('padding', '8px 12px', 'important');
    btn.style.setProperty('cursor', 'pointer', 'important');
    btn.style.setProperty('font-size', '14px', 'important');
    btn.style.setProperty('font-weight', '600', 'important');
    btn.style.setProperty('line-height', '1.4', 'important');
    btn.style.setProperty('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.35)', 'important');
    btn.addEventListener('click', exportAllByClick);

    document.body.appendChild(btn);
    log('floating button inserted');
    return true;
  }

  // 嘗試插入按鈕
  (function waitAndInsert() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (addNavButton()) clearInterval(t);
      else if (tries > 40) {
        clearInterval(t);
        addNavButton();
      }
    }, 500);
  })();

  // SPA 變動時補插
  var mo = new MutationObserver(function () {
    if (!document.getElementById(BTN_ID)) addNavButton();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
