# Jable Desktop

Unofficial local-first desktop app for syncing, browsing, searching, importing, and exporting Jable favourites and watch-later lists.

<p align="center">
  <img src="docs/images/local-data.png" width="900" alt="Jable Desktop local data view" />
</p>

<p align="center">
  <a href="docs/README.zh-TW.md">繁體中文</a>
  ·
  <a href="docs/README.en-US.md">English</a>
</p>

---

## Overview

Jable Desktop opens Jable inside an embedded browser and syncs your favourites and watch-later lists into a local SQLite database. It keeps browsing and sign-in directly between you and Jable, while the app provides local search, sorting, backup, and restore workflows.

The project also includes the original self-contained Tampermonkey exporter: [`jable-favourites-exporter.user.js`](jable-favourites-exporter.user.js).

## Highlights

- Sync favourites and watch-later lists
- Embedded multi-tab browser with persistent Jable session storage
- Local SQLite storage with FTS5 search
- Quick sync and full sync modes
- JSON import/export with legacy userscript compatibility
- Traditional Chinese and English UI
- macOS and Windows release targets

## Quick Start

Download the latest release from GitHub Releases, open Jable Desktop, sign in to Jable inside the embedded browser, then open Local Data and run Quick Sync.

Full usage guides:

- [繁體中文使用說明](docs/README.zh-TW.md)
- [English User Guide](docs/README.en-US.md)

## Development

Developer notes, architecture details, validation checklists, and packaging instructions live in [docs/development.md](docs/development.md).

```sh
npm install
fnm exec --using 24 npm run check
```

## License

MIT License. See [LICENSE](LICENSE).
