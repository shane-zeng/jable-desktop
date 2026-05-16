# Userscript Specification

Last verified against implementation: 2026-05-16

This document specifies the current Tampermonkey userscript behavior in `jable-favourites-exporter.user.js`.

## Scope

The userscript is a self-contained browser script. It has no build step, no runtime dependency, and no desktop app dependency.

It runs on:

- `https://jable.tv/*`
- `https://fs1.app/*`

The floating export UI is only inserted on:

- `https://jable.tv/my/favourites/videos/`
- `https://jable.tv/my/favourites/videos-watch-later/`
- `https://fs1.app/my/favourites/videos/`
- `https://fs1.app/my/favourites/videos-watch-later/`

## User Interface

- The script injects a fixed floating control group in the lower-right corner.
- The control group contains an export button and a compact locale selector.
- The button text updates immediately when the selected locale changes.
- The button is disabled while export is running.
- Export errors are shown through the button text, then the normal localized label is restored.
- Supported UI locales are `zh-TW`, `en-US`, and `ja-JP`.
- Locale preference is stored in `localStorage` under `jable-favourites-exporter:locale`.
- Locale detection uses stored preference first, then browser language candidates, then `zh-TW`.

## Scraping Behavior

- The script scrapes visible `div.video-img-box` cards from the current collection page.
- The main title and URL are read from `div.detail h6.title a`.
- Thumbnail media is read from image `data-src`, `src`, and `data-preview` attributes.
- Views and likes are parsed from the card subtitle text where available.
- URLs are normalized to absolute URLs using the current page as base.
- Duplicate rows are removed by URL.
- The script discovers pagination from `ul.pagination a.page-link`.
- Page numbers may come from link text, element id, or Jable `data-parameters`.
- Pagination is advanced by simulating the next page link and waiting for the list signature to change.
- The list signature includes visible title links and sample URLs, so AJAX list replacement can be detected.

## Export Flow

- `EXPORT_FORMAT` controls output format and defaults to `json`.
- The script exports all pages reachable from the current collection pagination.
- Output base filename is selected from the current path:
  - favourites: `favourites_list`
  - watch-later: `watch_later_list`
- JSON output filename is `<base>.json`.
- CSV output filename is `<base>.csv`.
- CSV columns are `title,url,views,likes,img,preview`.
- JSON output uses a paged resource shape compatible with the desktop importer.
- JSON rows include `title`, `url`, `views`, `likes`, `img`, `preview`, and `site_order`.
- Export metadata includes source path, source URL, export time, completion state, page count, total count, last page, and last scraped page.

## Cache Behavior

- Large exports prefer IndexedDB.
- IndexedDB database name is `jable-favourites-exporter`.
- IndexedDB stores metadata and video rows separately.
- IndexedDB rows are keyed by collection and URL.
- The cache can load prior rows, detect known URLs, save progress, mark base rows, replace rows, and migrate from old localStorage data.
- If IndexedDB is unavailable, the script falls back to localStorage.
- Cache completion is tracked. A complete cache can be merged with newly scraped rows so unchanged older rows are preserved.
- Cached rows without media fields are treated conservatively, so old cache shapes do not hide newly scraped media data.

## Failure And Safety Rules

- The userscript does not call private Jable APIs directly.
- The userscript does not send data to third-party services.
- The userscript uses `@grant none`.
- Pagination waits have timeouts so the export does not wait forever when Jable fails to replace content.
- If IndexedDB migration or use fails, localStorage fallback is attempted.
- Exported data is downloaded locally through a generated Blob URL.

## Related Tests

- `test/node/userscript-i18n.test.js` verifies locale selector behavior, Japanese support, and busy-state label separation.
- Desktop import/export compatibility is covered by `test/node/database.test.js` and `test/node/data-engine-contract.test.js`.
