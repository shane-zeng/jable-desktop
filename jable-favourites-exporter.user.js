// ==UserScript==
// @name         Jable Favourites Exporter
// @namespace    shane.tools
// @version      1.0.0
// @description  Export titles, URLs, views, and likes from Jable favourites pages by simulating pagination clicks (no direct crawling).
// @license      Apache-2.0
// @author       shane
// @match        https://jable.tv/*
// @match        https://fs1.app/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ---------------------------------------
   * Configuration
   * ------------------------------------- */
  // 可選：'json' 或 'csv'
  const EXPORT_FORMAT = 'json';
  const PAGE_SIZE = 24;
  const STORAGE_PREFIX = 'jable-favourites-exporter:';
  const IDB_DB_NAME = 'jable-favourites-exporter';
  const IDB_DB_VERSION = 1;
  const IDB_META_STORE = 'meta';
  const IDB_VIDEOS_STORE = 'videos';
  const IDB_COLLECTION_INDEX = 'collectionKey';
  const IDB_KEY_SEPARATOR = '\u001f';

  /* ---------------------------------------
   * Selectors
   * ------------------------------------- */
  const SEL_LIST_CONTAINER = '#list_videos_my_favourite_videos'; // 清單容器
  const SEL_TITLES = 'div.detail h6.title a'; // 標題 <a>
  const SEL_PAGER = 'ul.pagination'; // 分頁容器
  const SEL_PAGER_LINKS = 'ul.pagination a.page-link'; // 可點擊的分頁
  const BTN_ID = 'fav-export-all-btn'; // 匯出按鈕 ID
  const WRAP_ID = 'fav-export-all-wrap';
  const LOCALE_SELECT_ID = 'fav-export-locale-select';
  const LOCALE_STORAGE_KEY = STORAGE_PREFIX + 'locale';

  const I18N_MESSAGES = {
    'zh-TW': {
      preparing: '準備中…',
      exporting: '完成，匯出中…',
      progress: '已擷取 {count} 筆，前往下一頁…',
      cacheFailed: '暫存失敗，請查看 console',
      processing: '處理中…',
      exportButton: '📦 匯出所有分頁影片',
      localeSelectLabel: '匯出工具語言'
    },
    'en-US': {
      preparing: 'Preparing...',
      exporting: 'Complete, exporting...',
      progress: 'Captured {count} items, moving to the next page...',
      cacheFailed: 'Cache failed. Check the console.',
      processing: 'Processing...',
      exportButton: '📦 Export all pages',
      localeSelectLabel: 'Exporter language'
    },
    'ja-JP': {
      preparing: '準備中...',
      exporting: '完了しました。Export 中...',
      progress: '{count} 件取得しました。次のページへ移動します...',
      cacheFailed: '一時保存に失敗しました。console を確認してください。',
      processing: '処理中...',
      exportButton: '📦 全ページを Export',
      localeSelectLabel: 'Export ツールの言語'
    }
  };
  let CURRENT_LOCALE = detectLocale();

  function normalizeLocale(value) {
    const locale = String(value || '').toLowerCase();

    if (locale === 'en' || locale.indexOf('en-') === 0) return 'en-US';
    if (locale === 'ja' || locale.indexOf('ja-') === 0) return 'ja-JP';
    if (
      locale === 'zh' ||
      locale === 'zh-tw' ||
      locale === 'zh-hk' ||
      locale === 'zh-mo' ||
      locale.indexOf('zh-hant') === 0
    ) {
      return 'zh-TW';
    }

    return 'zh-TW';
  }

  function readStoredLocale() {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      return stored ? normalizeLocale(stored) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStoredLocale(locale) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch (e) {}
  }

  function detectLocale() {
    const stored = readStoredLocale();
    if (stored) return stored;

    let languages = [];

    if (navigator.languages && navigator.languages.length) languages = languages.concat(navigator.languages);
    if (navigator.language) languages.push(navigator.language);

    for (let i = 0; i < languages.length; i++) {
      const normalized = normalizeLocale(languages[i]);
      if (normalized !== 'zh-TW' || /^zh/i.test(String(languages[i] || ''))) return normalized;
    }

    return 'zh-TW';
  }

  function setLocale(value) {
    CURRENT_LOCALE = normalizeLocale(value);
    writeStoredLocale(CURRENT_LOCALE);
    refreshExportUiText();
  }

  function t(key, params) {
    const messages = I18N_MESSAGES[CURRENT_LOCALE] || I18N_MESSAGES['zh-TW'];
    const template = messages[key] || I18N_MESSAGES['zh-TW'][key] || key;

    params = params || {};
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, name) {
      if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
      if (params[name] === null || typeof params[name] === 'undefined') return '';
      return String(params[name]);
    });
  }

  function refreshExportUiText() {
    const btn = document.getElementById(BTN_ID);
    const select = document.getElementById(LOCALE_SELECT_ID);

    if (btn) {
      btn.setAttribute('data-label', t('exportButton'));
      if (btn.getAttribute('data-busy') !== 'true') btn.textContent = t('exportButton');
    }

    if (select) {
      select.value = CURRENT_LOCALE;
      select.setAttribute('aria-label', t('localeSelectLabel'));
      select.setAttribute('title', t('localeSelectLabel'));
    }
  }

  function isExportPage() {
    return /\/my\/favourites\/videos(?:-watch-later)?\/?$/.test(location.pathname);
  }

  /* ---------------------------------------
   * File naming by current path
   * ------------------------------------- */
  function fileBaseByPath() {
    const url = location.pathname.replace(/[?#].*$/, '');
    if (/\/my\/favourites\/videos-watch-later\/?$/.test(url)) return 'watch_later_list';
    if (/\/my\/favourites\/videos\/?$/.test(url)) return 'favourites_list';
    return 'export_list';
  }

  /* ---------------------------------------
   * Utilities
   * ------------------------------------- */
  function log() {
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[FavExporter]');
    console.log.apply(console, args);
  }

  function escCsv(s) {
    s = s === null || typeof s === 'undefined' ? '' : String(s);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function uniqByUrl(rows) {
    const seen = {};
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const u = rows[i].url;
      if (!u) continue;
      if (!seen[u]) {
        seen[u] = 1;
        out.push(rows[i]);
      }
    }
    return out;
  }

  function toCSV(rows) {
    const lines = ['title,url,views,likes,img,preview'];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      lines.push(
        escCsv(r.title) +
          ',' +
          escCsv(r.url) +
          ',' +
          (r.views || '') +
          ',' +
          (r.likes || '') +
          ',' +
          escCsv(r.img) +
          ',' +
          escCsv(r.preview)
      );
    }
    return lines.join('\n');
  }

  function flattenPages(resource) {
    let rows = [];
    if (!resource || !resource.data) return rows;

    for (let i = 0; i < resource.data.length; i++) {
      const page = resource.data[i];
      if (page && page.data) rows = rows.concat(page.data);
    }

    return rows;
  }

  function rowsByPage(rows) {
    const pages = [];
    const exportedAt = new Date().toISOString();

    for (let i = 0; i < rows.length; i += PAGE_SIZE) {
      const chunk = rows.slice(i, i + PAGE_SIZE);
      const pageNumber = Math.floor(i / PAGE_SIZE) + 1;

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
    const pages = rowsByPage(rows);
    const exportedAt = new Date().toISOString();

    return {
      data: pages,
      meta: {
        format_version: 2,
        source_path: location.pathname,
        source_url: location.href,
        exported_at: exportedAt,
        completed: Boolean(completed),
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
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;

      const resource = JSON.parse(raw);
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

  function idbCacheKey(collectionKey, url) {
    return collectionKey + IDB_KEY_SEPARATOR + url;
  }

  function idbRequest(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error('IndexedDB request failed'));
      };
    });
  }

  function openIndexedDb() {
    if (!window.indexedDB) {
      return Promise.reject(new Error('IndexedDB is not available'));
    }

    return new Promise(function (resolve, reject) {
      const request = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);

      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        let videos = null;

        if (!db.objectStoreNames.contains(IDB_META_STORE)) {
          db.createObjectStore(IDB_META_STORE, { keyPath: 'collectionKey' });
        }

        if (!db.objectStoreNames.contains(IDB_VIDEOS_STORE)) {
          videos = db.createObjectStore(IDB_VIDEOS_STORE, { keyPath: 'cacheKey' });
          videos.createIndex(IDB_COLLECTION_INDEX, 'collectionKey', { unique: false });
        } else {
          videos = event.target.transaction.objectStore(IDB_VIDEOS_STORE);
          if (!videos.indexNames.contains(IDB_COLLECTION_INDEX)) {
            videos.createIndex(IDB_COLLECTION_INDEX, 'collectionKey', { unique: false });
          }
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error('IndexedDB open failed'));
      };
      request.onblocked = function () {
        reject(new Error('IndexedDB upgrade is blocked by another tab'));
      };
    });
  }

  function exportMetaFromResource(resource, collectionKey, rowCount) {
    const meta = (resource && resource.meta) || {};

    return {
      collectionKey: collectionKey,
      completed: Boolean(meta.completed),
      lastScrapedPage: meta.last_scraped_page || null,
      rowCount: rowCount || 0,
      sourcePath: meta.source_path || location.pathname,
      sourceUrl: meta.source_url || location.href,
      updatedAt: new Date().toISOString()
    };
  }

  function rowRecord(collectionKey, row, order, orderGroup) {
    return {
      cacheKey: idbCacheKey(collectionKey, row.url),
      collectionKey: collectionKey,
      orderGroup: orderGroup || 0,
      order: order,
      title: row.title,
      url: row.url,
      views: row.views,
      likes: row.likes,
      img: typeof row.img === 'undefined' ? null : row.img,
      preview: typeof row.preview === 'undefined' ? null : row.preview
    };
  }

  function rowFromRecord(record) {
    return {
      title: record.title,
      url: record.url,
      views: record.views,
      likes: record.likes,
      img: typeof record.img === 'undefined' ? null : record.img,
      preview: typeof record.preview === 'undefined' ? null : record.preview
    };
  }

  function IndexedDbCacheAdapter(db) {
    this.db = db;
  }

  IndexedDbCacheAdapter.prototype.getMeta = function (collectionKey) {
    const tx = this.db.transaction(IDB_META_STORE, 'readonly');
    return idbRequest(tx.objectStore(IDB_META_STORE).get(collectionKey));
  };

  IndexedDbCacheAdapter.prototype.loadRows = function (collectionKey) {
    const tx = this.db.transaction(IDB_VIDEOS_STORE, 'readonly');
    const store = tx.objectStore(IDB_VIDEOS_STORE);
    const request = store.index(IDB_COLLECTION_INDEX).getAll(collectionKey);

    return idbRequest(request).then(function (records) {
      records.sort(function (a, b) {
        const groupDiff = (a.orderGroup || 0) - (b.orderGroup || 0);
        if (groupDiff) return groupDiff;

        return (a.order || 0) - (b.order || 0);
      });

      return records.map(rowFromRecord);
    });
  };

  IndexedDbCacheAdapter.prototype.knownUrlMap = function (collectionKey, urls) {
    const tx = this.db.transaction(IDB_VIDEOS_STORE, 'readonly');
    const store = tx.objectStore(IDB_VIDEOS_STORE);
    const known = {};
    const checks = [];

    for (let i = 0; i < urls.length; i++) {
      (function (url) {
        checks.push(
          idbRequest(store.get(idbCacheKey(collectionKey, url))).then(function (record) {
            known[url] = Boolean(record);
          })
        );
      })(urls[i]);
    }

    return Promise.all(checks).then(function () {
      return known;
    });
  };

  IndexedDbCacheAdapter.prototype.saveProgress = function (
    collectionKey,
    rows,
    lastScrapedPage,
    currentCount,
    orderStart,
    orderGroup
  ) {
    const tx = this.db.transaction([IDB_META_STORE, IDB_VIDEOS_STORE], 'readwrite');
    const metaStore = tx.objectStore(IDB_META_STORE);
    const videosStore = tx.objectStore(IDB_VIDEOS_STORE);
    const nextCount = currentCount + rows.length;
    const completed = false;
    const firstOrder = typeof orderStart === 'number' ? orderStart : currentCount;
    const group = orderGroup || 0;

    for (let i = 0; i < rows.length; i++) {
      videosStore.put(rowRecord(collectionKey, rows[i], firstOrder + i + 1, group));
    }

    metaStore.put({
      collectionKey: collectionKey,
      completed: completed,
      lastScrapedPage: lastScrapedPage || null,
      rowCount: nextCount,
      sourcePath: location.pathname,
      sourceUrl: location.href,
      updatedAt: new Date().toISOString()
    });

    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () {
        resolve({ rowCount: nextCount });
      };
      tx.onerror = function () {
        reject(tx.error || new Error('IndexedDB progress save failed'));
      };
      tx.onabort = function () {
        reject(tx.error || new Error('IndexedDB progress save aborted'));
      };
    });
  };

  IndexedDbCacheAdapter.prototype.markRowsAsBase = function (collectionKey) {
    const tx = this.db.transaction(IDB_VIDEOS_STORE, 'readwrite');
    const videosStore = tx.objectStore(IDB_VIDEOS_STORE);
    const index = videosStore.index(IDB_COLLECTION_INDEX);

    index.openCursor(IDBKeyRange.only(collectionKey)).onsuccess = function (event) {
      const cursor = event.target.result;
      let record = null;

      if (!cursor) return;

      record = cursor.value;
      record.orderGroup = 1;
      cursor.update(record);
      cursor.continue();
    };

    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error || new Error('IndexedDB base row update failed'));
      };
      tx.onabort = function () {
        reject(tx.error || new Error('IndexedDB base row update aborted'));
      };
    });
  };

  IndexedDbCacheAdapter.prototype.replaceRows = function (collectionKey, rows, completed, lastScrapedPage) {
    const tx = this.db.transaction([IDB_META_STORE, IDB_VIDEOS_STORE], 'readwrite');
    const metaStore = tx.objectStore(IDB_META_STORE);
    const videosStore = tx.objectStore(IDB_VIDEOS_STORE);
    const index = videosStore.index(IDB_COLLECTION_INDEX);

    index.openCursor(IDBKeyRange.only(collectionKey)).onsuccess = function (event) {
      const cursor = event.target.result;

      if (cursor) {
        cursor.delete();
        cursor.continue();
        return;
      }

      for (let i = 0; i < rows.length; i++) {
        videosStore.put(rowRecord(collectionKey, rows[i], i + 1, 0));
      }

      metaStore.put({
        collectionKey: collectionKey,
        completed: Boolean(completed),
        lastScrapedPage: lastScrapedPage || null,
        rowCount: rows.length,
        sourcePath: location.pathname,
        sourceUrl: location.href,
        updatedAt: new Date().toISOString()
      });
    };

    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () {
        resolve({ rowCount: rows.length });
      };
      tx.onerror = function () {
        reject(tx.error || new Error('IndexedDB cache replace failed'));
      };
      tx.onabort = function () {
        reject(tx.error || new Error('IndexedDB cache replace aborted'));
      };
    });
  };

  IndexedDbCacheAdapter.prototype.ensureMigrated = function (collectionKey) {
    const adapter = this;

    return adapter.getMeta(collectionKey).then(function (meta) {
      let cache = null;
      let cachedRows = null;

      if (meta) return meta;

      cache = loadCachedResource();
      cachedRows = flattenPages(cache);

      if (!cache || !cache.meta || !rowsHaveMediaFields(cachedRows)) return null;

      return adapter
        .replaceRows(collectionKey, cachedRows, Boolean(cache.meta.completed), cache.meta.last_scraped_page)
        .then(function () {
          return exportMetaFromResource(cache, collectionKey, cachedRows.length);
        });
    });
  };

  function createIndexedDbCacheAdapter() {
    return openIndexedDb().then(function (db) {
      return new IndexedDbCacheAdapter(db);
    });
  }

  function urlMap(rows) {
    const out = {};
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].url) out[rows[i].url] = true;
    }
    return out;
  }

  function allRowsKnown(rows, known) {
    if (!rows.length) return false;

    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].url || !known[rows[i].url]) return false;
    }

    return true;
  }

  function rowsHaveMediaFields(rows) {
    for (let i = 0; i < rows.length; i++) {
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
    const a = document.createElement('a');
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
    const out = [];
    const boxes = document.querySelectorAll('div.video-img-box');

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const a = box.querySelector('div.detail h6.title a');
      if (!a) continue;

      const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
      const href = a.getAttribute('href') || '';
      const img = box.querySelector('div.img-box img');
      const imgSrc = img ? img.getAttribute('data-src') || img.getAttribute('src') || '' : '';
      const previewSrc = img ? img.getAttribute('data-preview') || '' : '';

      let views = null;
      let likes = null;

      const sub = box.querySelector('div.detail p.sub-title');
      if (sub) {
        const texts = [];
        for (let n = 0; n < sub.childNodes.length; n++) {
          const node = sub.childNodes[n];
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.replace(/\s+/g, ' ').trim();
            if (text) texts.push(text);
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
    const n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
    return isFinite(n) && n > 0 ? n : 1;
  }

  function currentPageNumber() {
    const active = document.querySelector('ul.pagination span.page-link.active');
    return active ? normalizePageNumber(active.textContent) : 1;
  }

  function signature() {
    const list = document.querySelectorAll(SEL_TITLES);
    const count = list.length;
    const first = count ? list[0].getAttribute('href') || '' : '';
    return count + '|' + first;
  }

  function waitForContainerChange(oldSig, timeoutMs) {
    if (!timeoutMs) timeoutMs = 12000;
    const target = document.querySelector(SEL_LIST_CONTAINER) || document.body;
    const deadline = Date.now() + timeoutMs;

    return new Promise(function (resolve) {
      let done = false;

      function check() {
        const cur = signature();
        if (cur && cur !== oldSig) {
          done = true;
          resolve(true);
        } else if (Date.now() > deadline) {
          done = true;
          resolve(false);
        }
      }

      const mo = new MutationObserver(function () {
        check();
      });
      mo.observe(target, { childList: true, subtree: true });

      (function poll() {
        if (done) {
          mo.disconnect();
          return;
        }
        check();
        if (!done) setTimeout(poll, 300);
        else mo.disconnect();
      })();
    });
  }

  function readPagerLinks() {
    const pager = document.querySelector(SEL_PAGER);
    if (!pager) return [];

    const anchors = pager.querySelectorAll(SEL_PAGER_LINKS);
    const out = [];

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const txt = (a.textContent || '').replace(/\s+/g, ' ').trim();

      const params = a.getAttribute('data-parameters') || '';
      const m = params.match(/(?:^|;)from(?:_my_fav_videos)?:\s*(\d+)/);

      let pid = null;
      if (m) pid = m[1];
      else if (/^\d+$/.test(txt)) pid = txt;
      else pid = txt || 'a_' + i;

      out.push({ el: a, id: pid, label: txt });
    }

    return out;
  }

  /* ---------------------------------------
   * Main flow
   * ------------------------------------- */
  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function urlsFromRows(rows) {
    const out = [];

    for (let i = 0; i < rows.length; i++) {
      if (rows[i].url) out.push(rows[i].url);
    }

    return out;
  }

  function showExportError(message) {
    const btn = document.getElementById(BTN_ID);

    setBtnBusy(false);

    if (!btn) return;

    btn.textContent = message;
    setTimeout(function () {
      if (btn && btn.getAttribute('data-label')) btn.textContent = btn.getAttribute('data-label');
    }, 4500);
  }

  function mergeFinalRows(cacheComplete, newRows, cachedRows) {
    const newUrls = urlMap(newRows);
    const oldRows = [];

    for (let i = 0; i < cachedRows.length; i++) {
      if (!newUrls[cachedRows[i].url]) oldRows.push(cachedRows[i]);
    }

    return cacheComplete ? mergeRows(newRows, oldRows) : mergeRows(oldRows, newRows);
  }

  async function exportAllByClickWithIndexedDb(adapter) {
    setBtnBusy(true, t('preparing'));

    const collectionKey = fileBaseByPath();
    const meta = await adapter.ensureMigrated(collectionKey);
    const cacheComplete = Boolean(meta && meta.completed);
    let cachedCount = meta && meta.rowCount ? Number(meta.rowCount) : 0;
    const newRows = [];
    const visited = {};
    let safety = 100;
    let lastScrapedPage = null;
    let baseRowsMarked = false;

    const active = document.querySelector('ul.pagination span.page-link.active');
    if (active) {
      const activePageText = (active.textContent || '').trim();
      if (activePageText) visited[activePageText] = true;
    }

    async function recordCurrentPage() {
      const rows = uniqByUrl(scrapeCurrentPage());
      const knownUrls = await adapter.knownUrlMap(collectionKey, urlsFromRows(rows));
      const rowsToSave = [];
      const orderStart = cacheComplete ? newRows.length : cachedCount;
      const orderGroup = 0;
      let saved = null;

      lastScrapedPage = currentPageNumber();

      if (cacheComplete && allRowsKnown(rows, knownUrls)) {
        log('known page reached, stop at page', lastScrapedPage);
        return true;
      }

      for (let i = 0; i < rows.length; i++) {
        const url = rows[i].url;
        if (!url || knownUrls[url]) continue;

        knownUrls[url] = true;
        newRows.push(rows[i]);
        rowsToSave.push(rows[i]);
      }

      if (cacheComplete && rowsToSave.length && !baseRowsMarked && cachedCount) {
        await adapter.markRowsAsBase(collectionKey);
        baseRowsMarked = true;
      }

      saved = await adapter.saveProgress(
        collectionKey,
        rowsToSave,
        lastScrapedPage,
        cachedCount,
        orderStart,
        orderGroup
      );
      cachedCount = saved.rowCount;
      return false;
    }

    async function finish() {
      const base = fileBaseByPath();
      const cachedRows = await adapter.loadRows(collectionKey);
      const finalRows = mergeFinalRows(cacheComplete, newRows, cachedRows);
      const resource = buildExportResource(finalRows, true, lastScrapedPage);

      await adapter.replaceRows(collectionKey, finalRows, true, lastScrapedPage);

      setBtnBusy(false, t('exporting'));

      if (EXPORT_FORMAT === 'csv') {
        downloadCsv(base + '.csv', toCSV(flattenPages(resource)));
      } else {
        downloadJson(base + '.json', resource);
      }

      log('done, total:', resource.meta.total);
    }

    if (await recordCurrentPage()) return finish();

    while (true) {
      let links = null;
      const candidates = [];
      let next = null;
      let oldSig = null;
      let changed = false;

      if (safety-- <= 0) return finish();

      links = readPagerLinks();

      for (let i = 0; i < links.length; i++) {
        if (!visited[links[i].id]) candidates.push(links[i]);
      }

      if (!candidates.length) return finish();

      candidates.sort(function (a, b) {
        const na = parseInt(a.id, 10);
        const nb = parseInt(b.id, 10);
        if (isFinite(na) && isFinite(nb)) return na - nb;
        return String(a.id).localeCompare(String(b.id));
      });

      next = candidates[0];
      oldSig = signature();

      try {
        next.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {}

      await delay(200);

      log('click page', next.id, '(' + next.label + ')');
      try {
        next.el.click();
      } catch (e) {}

      changed = await waitForContainerChange(oldSig, 15000);
      visited[next.id] = true;

      if (!changed) {
        log('page did not change before timeout', next.id);
      }

      if (await recordCurrentPage()) return finish();

      log('page', next.id, 'new rows', newRows.length, 'total', cachedCount);
      setBtnBusy(true, t('progress', { count: cachedCount }));
      await delay(500 + Math.random() * 500);
    }
  }

  async function exportAllByClick() {
    let adapter = null;

    try {
      adapter = await createIndexedDbCacheAdapter();
    } catch (e) {
      log('IndexedDB cache unavailable, fallback to localStorage', e);
      exportAllByClickWithLocalStorage();
      return;
    }

    try {
      await exportAllByClickWithIndexedDb(adapter);
    } catch (e) {
      log('export failed', e);
      showExportError(t('cacheFailed'));
    }
  }

  function exportAllByClickWithLocalStorage() {
    setBtnBusy(true, t('preparing'));

    const cache = loadCachedResource();
    let cachedRows = flattenPages(cache);
    const cacheHasMedia = rowsHaveMediaFields(cachedRows);
    const cacheComplete = Boolean(cache && cache.meta && cache.meta.completed && cacheHasMedia);
    if (!cacheHasMedia) cachedRows = [];

    const knownUrls = urlMap(cachedRows);
    const newRows = [];
    const visited = {};
    let safety = 100;
    let lastScrapedPage = null;

    const active = document.querySelector('ul.pagination span.page-link.active');
    if (active) {
      const activePageText = (active.textContent || '').trim();
      if (activePageText) visited[activePageText] = true;
    }

    function rowsForProgress() {
      return cacheComplete ? mergeRows(newRows, cachedRows) : mergeRows(cachedRows, newRows);
    }

    function recordCurrentPage() {
      const rows = uniqByUrl(scrapeCurrentPage());
      lastScrapedPage = currentPageNumber();

      if (cacheComplete && allRowsKnown(rows, knownUrls)) {
        log('known page reached, stop at page', lastScrapedPage);
        return true;
      }

      for (let i = 0; i < rows.length; i++) {
        const url = rows[i].url;
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

      const links = readPagerLinks();
      const candidates = [];

      for (let i = 0; i < links.length; i++) {
        if (!visited[links[i].id]) candidates.push(links[i]);
      }

      if (!candidates.length) return finish();

      candidates.sort(function (a, b) {
        const na = parseInt(a.id, 10);
        const nb = parseInt(b.id, 10);
        if (isFinite(na) && isFinite(nb)) return na - nb;
        return String(a.id).localeCompare(String(b.id));
      });

      const next = candidates[0];
      const oldSig = signature();

      try {
        next.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {}

      setTimeout(function () {
        log('click page', next.id, '(' + next.label + ')');
        try {
          next.el.click();
        } catch (e) {}

        waitForContainerChange(oldSig, 15000).then(function () {
          visited[next.id] = true;

          if (recordCurrentPage()) return finish();

          log('page', next.id, 'new rows', newRows.length, 'total', rowsForProgress().length);
          setBtnBusy(true, t('progress', { count: rowsForProgress().length }));
          setTimeout(step, 500 + Math.random() * 500);
        });
      }, 200);
    }

    function finish() {
      setBtnBusy(false, t('exporting'));
      const base = fileBaseByPath();
      const resource = buildExportResource(rowsForProgress(), true, lastScrapedPage);
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
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    if (!btn.getAttribute('data-label')) {
      btn.setAttribute('data-label', btn.textContent);
    }

    btn.disabled = Boolean(busy);
    btn.setAttribute('data-busy', busy ? 'true' : 'false');
    btn.textContent = busy ? text || t('processing') : btn.getAttribute('data-label');
    btn.style.opacity = busy ? '0.7' : '1';
  }

  function addNavButton() {
    const existingBtn = document.getElementById(BTN_ID);
    const existingWrap = document.getElementById(WRAP_ID);

    if (existingBtn && existingWrap) {
      refreshExportUiText();
      return true;
    }
    if (existingBtn && existingBtn.parentNode) existingBtn.parentNode.removeChild(existingBtn);
    if (existingWrap && existingWrap.parentNode) existingWrap.parentNode.removeChild(existingWrap);
    if (!isExportPage() || !document.body) return false;

    const wrap = document.createElement('div');
    const btn = document.createElement('button');
    const select = document.createElement('select');

    wrap.id = WRAP_ID;

    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = t('exportButton');
    btn.setAttribute('data-label', t('exportButton'));
    btn.setAttribute('data-busy', 'false');

    select.id = LOCALE_SELECT_ID;
    select.setAttribute('aria-label', t('localeSelectLabel'));
    select.setAttribute('title', t('localeSelectLabel'));
    select.innerHTML =
      '<option value="zh-TW">繁中</option>' +
      '<option value="en-US">EN</option>' +
      '<option value="ja-JP">日本語</option>';
    select.value = CURRENT_LOCALE;
    select.addEventListener('change', function () {
      setLocale(select.value);
    });

    wrap.style.setProperty('position', 'fixed', 'important');
    wrap.style.setProperty('right', '16px', 'important');
    wrap.style.setProperty('bottom', '16px', 'important');
    wrap.style.setProperty('z-index', '2147483647', 'important');
    wrap.style.setProperty('display', 'inline-flex', 'important');
    wrap.style.setProperty('align-items', 'center', 'important');
    wrap.style.setProperty('gap', '6px', 'important');
    wrap.style.setProperty('padding', '6px', 'important');
    wrap.style.setProperty('border-radius', '10px', 'important');
    wrap.style.setProperty('background', 'rgba(0, 0, 0, 0.56)', 'important');
    wrap.style.setProperty('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.35)', 'important');
    wrap.style.setProperty('backdrop-filter', 'blur(8px)', 'important');

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
    btn.addEventListener('click', exportAllByClick);

    select.style.setProperty('height', '34px', 'important');
    select.style.setProperty('min-width', '56px', 'important');
    select.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.28)', 'important');
    select.style.setProperty('border-radius', '8px', 'important');
    select.style.setProperty('background', '#111827', 'important');
    select.style.setProperty('color', '#fff', 'important');
    select.style.setProperty('padding', '0 6px', 'important');
    select.style.setProperty('font-size', '12px', 'important');
    select.style.setProperty('font-weight', '700', 'important');
    select.style.setProperty('cursor', 'pointer', 'important');

    wrap.appendChild(btn);
    wrap.appendChild(select);
    document.body.appendChild(wrap);
    log('floating button inserted');
    return true;
  }

  // 嘗試插入按鈕
  (function waitAndInsert() {
    let tries = 0;
    const insertTimer = setInterval(function () {
      tries++;
      if (addNavButton()) clearInterval(insertTimer);
      else if (tries > 40) {
        clearInterval(insertTimer);
        addNavButton();
      }
    }, 500);
  })();

  // SPA 變動時補插
  const mo = new MutationObserver(function () {
    if (!document.getElementById(BTN_ID) || !document.getElementById(WRAP_ID)) addNavButton();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
