# Jable Desktop ユーザーガイド

Jable Desktop は非公式のデスクトップツールであり、Jable 公式とは関係ありません。

アプリ内で Jable を開き、お気に入りと後で見るリストをローカルに同期して、閲覧、検索、並び替え、Import、Export バックアップを行えます。

[プロジェクトホームに戻る](../README.md) · [繁體中文](README.zh-TW.md) · [English](README.en-US.md)

## 機能

- お気に入りと後で見るリストを同期
- 内蔵 multi-tab browser
- ローカル SQLite ストレージ
- クイック同期とフル同期
- SQLite FTS5 ローカル検索
- JSON Import / Export
- 繁體中文、English、日本語 UI
- macOS と Windows をサポート

## 技術ハイライト

- Electron desktop architecture
- Vue 3 + TypeScript renderer
- SQLite persistence with FTS5 full-text search
- Incremental sync と full reconciliation sync workflow
- Embedded browser session persistence
- Shared IPC wire types
- renderer、Electron native menu、userscript UI をカバーする軽量 i18n architecture
- lint、type-check、test、release packaging を実行する GitHub Actions quality gates

## アーキテクチャ概要

Jable Desktop は非公式 API に依存せず、embedded browser architecture を採用しています。

サインインと閲覧は引き続き Jable 公式サイトと直接通信します。アプリはリストデータをローカル SQLite database に同期し、ローカル閲覧、検索、並び替え、バックアップ、復元 workflow を提供します。

主な構成:

- Electron main process
- Embedded browser / webview layer
- Vue renderer UI
- SQLite persistence layer
- Sync / scraping pipeline

## ローカル検索

ローカル検索は SQLite FTS5 を使用します。

アプリはタイトルと URL から正規化された検索 index を作成し、次をサポートします。

- CJK 対応検索
- punctuation-normalized phrase matching
- URL fragment search
- any / all / phrase search modes

同期後は、サイトのページを何度も読み込まずにローカルで検索と並び替えができます。

## 同期モード

### クイック同期

- 1 ページ目から開始
- 1 ページ全体が既知のデータだった時点で停止
- 日常的な増分更新向け

### フル同期

- 1 ページ目から最終ページまで実行
- サイト上の完全な並び順を再構築
- 表示中の動画をすべて更新
- サイト上に存在しなくなったローカル行を非表示にする

大きなリストは batch で処理され、後から再開できます。

## インストール

1. GitHub Releases から最新 release をダウンロード
2. macOS は `.dmg` または `.zip` を使用
3. Windows は `.exe` または `.zip` を使用
4. Jable Desktop を開く

現在の release は未署名です。

- macOS では Gatekeeper warning が表示される場合があります
- Windows では SmartScreen warning が表示される場合があります

ダウンロード元がこのプロジェクトの GitHub Releases であることを確認してください。

## 初回利用

1. 内蔵 browser で Jable にサインイン
2. ローカルデータタブを開く
3. お気に入りまたは後で見るを選択
4. クイック同期をクリック
5. 同期された動画がローカルリストに表示されます

## Import と Export

- JSON backup を Export
- JSON backup を Import
- `site_order` を保持
- 旧 Tampermonkey export files と互換

## データとログイン状態

同期データはユーザーのコンピューターにローカル保存されます。

アプリはリストデータを外部サービスへアップロードしません。閲覧とサインインは引き続き Jable 公式サイトと直接通信します。

`https://jable.tv` を読み込めない場合、デスクトップアプリは現在の session で公式代替サイト `https://fs1.app` に自動切り替えします。ローカルデータは引き続き primary URL を canonical URL として扱うため、同じ動画がドメイン違いで重複しません。

ログイン状態は分離された Electron session partition に保存されます。ただし、Jable 公式側の session が期限切れになった場合は再ログインが必要になることがあります。

## Tampermonkey Userscript

元の userscript は引き続き単体で利用できます: [`jable-favourites-exporter.user.js`](../jable-favourites-exporter.user.js)。

対応ページ:

- `https://jable.tv/my/favourites/videos/`
- `https://jable.tv/my/favourites/videos-watch-later/`
- `https://fs1.app/my/favourites/videos/`
- `https://fs1.app/my/favourites/videos-watch-later/`

対象ページを開いた後、右下の floating export button をクリックすると全ページを Export できます。隣の compact language selector で **繁中**、**EN**、**日本語** を選択できます。

## 開発ドキュメント

[docs/development.md](development.md) を参照してください。

Development notes には次が含まれます。

- Architecture overview
- SQLite schema and migrations
- Search architecture
- Sync pipeline
- Electron process design
- Packaging and release workflow
- Testing and validation checklist

## ライセンス

MIT License。

詳しくは [LICENSE](../LICENSE) を参照してください。
