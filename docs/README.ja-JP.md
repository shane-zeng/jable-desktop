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
- ローカルデータが空の場合は先にフル同期を使用

### フル同期

- 1 ページ目から最終ページまで実行
- サイト上の完全な並び順を再構築
- 表示中の動画をすべて更新
- サイト上に存在しなくなったローカル行を非表示にする

大きなリストは background の bounded AJAX window で高速化されます。サイトの応答を検証できない場合は、通常の逐次ページングへ自動的に fallback します。

## 同期待ち

同期中に Jable ページ上で追加または削除を行った場合、App はその操作をいったんローカル outbox に保存し、通常のローカルリストは先に変更しません。既定では自動送信せず、「同期待ち」に残して手動確認できるようにします。設定で「同期後に変更を自動送信」を有効にした場合は、ページ取得が終わった後で元の操作順に Jable へ送信します。ローカルデータは Jable が成功を返した後にのみ更新されます。

同期後に outbox を処理している間は、右上の status toast が進捗バー付きで表示され続け、キュー済み操作が完了するか最初の再送失敗で停止するまで進捗を確認できます。

その送信に失敗した場合、または自動送信がオフの場合、ローカルデータ画面に全体共通の「同期待ち」タブが表示されます。このタブは database の raw operation rows をそのまま表示せず、最終状態も推論しません。未確認の同期操作を動画ごとにまとめ、リスト、同期状態、最新エラー、操作履歴の概要を表示します。

同期待ちの各動画では「追加」または「削除」を押すと、Jable AJAX で対応するリストへ明示的な操作を送信します。成功するとローカルデータを更新し、その同期待ち項目を消します。すでに Jable 側で自分で処理した場合、または App から送信しない場合は「解決済み」を押すとローカルの同期待ち状態だけを消します。通常のローカルリストは次回のフル同期でサイトと収束します。

後続のフル同期が新しい送信失敗なしで完了した場合、前回までに残っていた同期待ち項目はフル同期結果で置き換えられたものとして扱われ、タブは自動的に非表示になります。同じ同期中に新しく作られた同期待ち項目はいったん保持されます。

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
4. フル同期をクリック
5. 同期された動画がローカルリストに表示されます

初回のフル同期後は、日常的な更新にクイック同期を使用できます。

## 設定

設定画面では以下を調整できます。

- 表示言語
- 最大タブ数。推奨値を超えるとメモリ使用量と再生性能への注意を表示
- フル同期の加速: 保守、標準、高速
- 同期中に発生したお気に入りと後で見るの変更を同期後に元の操作順で自動送信するか
- JSON Import、JSON Export、ローカルデータベースの場所

高速モードは同時に先読みするページ数を増やすため、大きなリストに向いています。timeout、403、429 が発生した場合は保守的なページ単位同期へ fallback します。

## Import と Export

- 設定 > データ から JSON backup を Export
- 設定 > データ から JSON backup を Import
- `site_order` を保持
- 旧 Tampermonkey export files と互換
- JSON に source metadata が含まれる場合はお気に入りまたは後で見るを自動選択します。判定できない場合は Import 先を手動で選択してください

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
