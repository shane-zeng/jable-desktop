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
- ダウンロード一覧とローカル動画ファイル管理
- 繁體中文、English、日本語 UI
- macOS と Windows をサポート

## 技術ハイライト

- Electron desktop architecture
- Vue 3 + TypeScript renderer
- SQLite persistence with FTS5 full-text search
- Incremental sync と full reconciliation sync workflow
- Embedded browser session persistence
- Shared IPC wire types
- renderer と Electron native menu をカバーする軽量 i18n architecture
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

大きなリストは background の bounded concurrent AJAX prefetch で高速化されます。サイトの応答を検証できない場合は、通常の逐次ページングへ自動的に fallback します。

## 同期待ち

同期中に Jable ページ上で追加または削除を行った場合、App はその操作をいったんローカル outbox に保存し、通常のローカルリストは先に変更しません。既定では自動送信せず、「同期待ち」に残して手動確認できるようにします。設定で「同期後に変更を自動送信」を有効にした場合は、ページ取得が終わった後で元の操作順に Jable へ送信します。ローカルデータは Jable が成功を返した後にのみ更新されます。

同期後に outbox を処理している間は、右上の status toast が進捗バー付きで表示され続け、キュー済み操作が完了するか最初の再送失敗で停止するまで進捗を確認できます。

その送信に失敗した場合、または自動送信がオフの場合、ローカルデータ画面に全体共通の「同期待ち」タブが表示されます。このタブは database の raw operation rows をそのまま表示せず、最終状態も推論しません。未確認の同期操作を動画ごとにまとめ、リスト、同期状態、最新エラー、操作履歴の概要を表示します。

同期待ちの各動画では「追加」または「削除」を押すと、Jable AJAX で対応するリストへ明示的な操作を送信します。成功するとローカルデータを更新し、その同期待ち項目を消します。すでに Jable 側で自分で処理した場合、または App から送信しない場合は「解決済み」を押すとローカルの同期待ち状態だけを消します。通常のローカルリストは次回のフル同期でサイトと収束します。

後続のフル同期が新しい送信失敗なしで完了した場合、前回までに残っていた同期待ち項目はフル同期結果で置き換えられたものとして扱われ、タブは自動的に非表示になります。同じ同期中に新しく作られた同期待ち項目はいったん保持されます。

## ダウンロード一覧と FFmpeg

ダウンロード機能にはローカルにインストールされた FFmpeg が必要です。

FFmpeg をインストールした後、設定 > ダウンロードを開きます。

- 「再確認」で `PATH` 上の FFmpeg を再検出
- または「FFmpeg を選択」で `ffmpeg` 実行ファイルを手動指定
- 必要に応じて同じセクションでダウンロードフォルダーを選択
- ダウンロード速度モードは Stable、Balanced、Fast から選択できます。これは各動画の segment ダウンロード速度を制御し、同時に実行する動画数は変更しません。

### macOS

Homebrew を使う場合:

```zsh
brew install ffmpeg
```

インストール後、アプリの設定画面に戻って「再確認」を押します。それでも検出できない場合は、Homebrew がインストールした `ffmpeg` 実行ファイルを手動で選択してください。

### Windows

winget を使う場合:

```powershell
winget install Gyan.FFmpeg
```

FFmpeg build を自分でダウンロードして展開し、`bin` フォルダーを `PATH` に追加することもできます。アプリ設定画面で `ffmpeg.exe` を手動選択しても構いません。

ダウンロード済み動画はローカルデータの「ダウンロード一覧」タブに表示されます。ダウンロード項目のタイトル、カバー、preview は Jable の元ページを開き、コレクションカードと同じ新規タブ操作と右クリックメニューを利用できます。完了した項目は「再生」でシステム既定のプレイヤーで開く、ファイルの場所を表示する、またはローカルファイルを明示的に削除できます。失敗項目は再試行できます。ダウンロード一覧では、保持される複数選択の状態フィルター、失敗項目の一括再試行、キュー操作からのすべて一時停止/すべて再開/待機中のキャンセル、選択項目の削除も利用できます。

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
- WebView 拡張モード。既定ではオフで、有効にすると追加の WebView 読み込みと画面整理ルールを適用
- Jable ログイン状態やローカル再生サムネイルキャッシュに影響しないブラウザー HTTP キャッシュ消去
- フル同期の加速: 保守、標準、高速。高速モードは大きなリスト向けに同時先読みページ数を増やし、timeout、403、429 が発生した場合は保守的なページ単位同期へ fallback します
- 同期中に発生したお気に入りと後で見るの変更を同期後に元の操作順で自動送信するか
- FFmpeg の状態、再確認、FFmpeg の手動選択、ダウンロードフォルダーの場所、同時ダウンロード数、ダウンロード速度モード
- JSON Import、JSON Export、設定バックアップ、完全 App バックアップ、ローカルデータベースの場所、ローカルデータフォルダー表示、Log フォルダー表示、診断記録の削除
- 手動で更新を確認

## Import と Export

- 設定 > データ から単一リストの JSON backup を Export / Import
- 設定 > データ から設定バックアップ、または全ローカルリスト、非表示状態、同期状態、ダウンロード記録を含む完全 App バックアップを Export
- 完全 App バックアップには Jable cookies / login session、Log、ブラウザータブ復元状態、ウィンドウ位置、ダウンロード済み動画ファイルは含まれません
- 完全 App バックアップを Import するとデータを merge し、古い操作が後で Jable に送信されないよう同期待ち項目を消去します。待機中またはダウンロード中の記録は一時停止として復元されます
- `site_order` を保持
- JSON に source metadata が含まれる場合はお気に入りまたは後で見るを自動選択します。判定できない場合は Import 先を手動で選択してください

## データとログイン状態

同期データはユーザーのコンピューターにローカル保存されます。

アプリはリストデータを外部サービスへアップロードしません。閲覧とサインインは引き続き Jable 公式サイトと直接通信します。

`https://jable.tv` を読み込めない場合、デスクトップアプリは現在の session で公式代替サイト `https://fs1.app` に自動切り替えします。ローカルデータは引き続き primary URL を canonical URL として扱うため、同じ動画がドメイン違いで重複しません。

ログイン状態は分離された Electron session partition に保存されます。ただし、Jable 公式側の session が期限切れになった場合は再ログインが必要になることがあります。

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

## 免責事項

> **このツールは学習および技術研究のみを目的として提供されています。** ユーザーは各地域の法令を遵守し、コンテンツの著作権を尊重する責任があります。このツールの使用により発生した法的責任について、開発者は責任を負いません。違法または権利侵害となる目的でこのツールを使用しないでください。

## 謝辞

ダウンロード機能およびダウンロード workflow の設計は [hcjohn463/JableDownload](https://github.com/hcjohn463/JableDownload) を参考にしています。本プロジェクトは同プロジェクトの fork ではありません。関連実装は Jable Desktop の Electron / Rust architecture に合わせて再統合されています。

## ライセンス

Apache License 2.0。

詳しくは [LICENSE](../LICENSE) を参照してください。
