# Jable Desktop

Unofficial local-first desktop app for syncing, browsing, searching, importing, and exporting Jable favourites and watch-later lists.

<p align="center">
  <img src="docs/images/local-data.png" width="900" alt="Jable Desktop local data view" />
</p>

<p align="center">
  <a href="docs/README.zh-TW.md">繁體中文</a>
  ·
  <a href="docs/README.en-US.md">English</a>
  ·
  <a href="docs/README.ja-JP.md">日本語</a>
</p>

---

## Overview

Jable Desktop opens Jable inside an embedded browser and syncs your favourites and watch-later lists into a local SQLite database. It keeps browsing and sign-in directly between you and Jable, while the app provides local search, sorting, backup, and restore workflows.

The project also includes the original self-contained Tampermonkey exporter: [`jable-favourites-exporter.user.js`](jable-favourites-exporter.user.js).

## Highlights

- Sync favourites and watch-later lists
- Embedded multi-tab browser with persistent Jable session storage
- Automatic fallback from `jable.tv` to `fs1.app` when the primary site fails to load
- Local SQLite storage with FTS5 search
- Quick sync and full sync modes
- JSON import/export with legacy userscript compatibility
- Download List and local video file management
- Lightweight Traditional Chinese / English / Japanese localization across desktop and userscript UI
- macOS and Windows release targets

## Quick Start

Download the latest release from GitHub Releases, open Jable Desktop, sign in to Jable inside the embedded browser, then open Local Data and run Quick Sync.

Full usage guides:

- [繁體中文使用說明](docs/README.zh-TW.md)
- [English User Guide](docs/README.en-US.md)
- [日本語ユーザーガイド](docs/README.ja-JP.md)

## Development

Developer notes, architecture details, validation checklists, and packaging instructions live in [docs/development.md](docs/development.md).

```sh
npm install
fnm exec --using 24 npm run check
```

## 免責聲明

> **本工具僅供學習與技術研究用途。** 使用者應遵守當地法律法規，尊重內容版權。開發者不對任何因使用本工具而產生的法律責任負責。請勿將本工具用於任何非法或侵權用途。

## 致謝

下載功能與下載流程設計參考 [hcjohn463/JableDownload](https://github.com/hcjohn463/JableDownload)。本專案並非該專案的 fork；相關實作已依 Jable Desktop 的 Electron / Rust 架構重新整合。

## License

Copyright 2026 shane-zeng.

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).
