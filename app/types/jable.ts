export type CollectionKey = 'favourites' | 'watch_later';
export type SortKey = 'site_order' | 'title' | 'views' | 'likes';
export type SortDirection = 'asc' | 'desc';
export type SearchMode = 'any' | 'all' | 'phrase';
export type SyncMode = 'quick' | 'full';
export type BrowserTabKind = 'normal' | 'sync';
export type AppView = 'browser' | 'library' | 'settings';
export type SupportedLocale = 'zh-TW' | 'en-US' | 'ja-JP';
export type LibraryTabKey = CollectionKey | 'downloads' | 'pending_remote';
export type DownloadSortKey = 'updated_at' | 'title' | 'state' | 'file_size';
export type CollectionAction = 'add' | 'remove';
export type PendingRemoteOperationState = 'failed' | 'blocked' | 'pending';
export type FfmpegStatusState = 'detected' | 'missing' | 'invalid_path' | 'unsupported';
export type FfmpegStatusSource = 'path' | 'manual' | null;
export type DownloadRootSource = 'default' | 'manual';
export type DownloadState = 'queued' | 'downloading' | 'failed' | 'ready' | 'missing';

export interface CollectionDefinition {
  url: string;
  filename: string;
}

export interface VideoRow {
  title: string | null;
  url: string;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  created_at?: string;
  updated_at?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  site_order?: number | null;
  is_visible?: number | boolean;
  missing_at?: string | null;
  last_sync_run_id?: string | null;
}

export interface ScrapedVideoRow {
  title: string | null;
  url: string;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  siteOrder?: number | null;
  site_order?: number | null;
  sort_order?: number | null;
}

export interface ListVideosOptions {
  collectionKey: CollectionKey;
  search?: string;
  searchMode?: SearchMode;
  sort?: SortKey;
  direction?: SortDirection;
  includeHidden?: boolean;
  limit?: number;
  offset?: number;
}

export interface ExportVideoRow {
  title: string | null;
  url: string;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  site_order: number | null;
}

export interface ExportPage {
  data: ExportVideoRow[];
  meta: {
    current_page: number;
    per_page: number;
    count: number;
    first_url: string | null;
    last_url: string | null;
    exported_at: string;
  };
}

export interface ExportResource {
  data: ExportPage[];
  meta: {
    format_version: number;
    source_path: string;
    source_url: string;
    exported_at: string;
    completed: boolean;
    per_page: number;
    page_count: number;
    total: number;
    last_page: number | null;
    last_scraped_page: number | null;
  };
}

export interface BrowserTabState {
  id: string;
  kind: BrowserTabKind;
  title: string;
  url: string;
  favicon: string;
  loading: boolean;
  locked: boolean;
  muted: boolean;
  audible: boolean;
  mediaPlaying: boolean;
  pictureInPicture: boolean;
  discarded: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserTabsState {
  activeTabId: string | null;
  maxTabs: number;
  tabs: BrowserTabState[];
}

export interface AppSettings {
  maxBrowserTabs: number;
  compactBrowserTabs: boolean;
  fullSyncAjaxWindowSize: number;
  autoReplayDeferredSyncOperations: boolean;
  ffmpegPath: string | null;
  downloadRoot: string | null;
}

export type AppSettingsPatch = Partial<AppSettings>;

export interface FfmpegStatus {
  state: FfmpegStatusState;
  source: FfmpegStatusSource;
  path: string | null;
  version: string | null;
  error: string | null;
}

export interface FfmpegPathSelectionResult extends FfmpegStatus {
  canceled?: boolean;
}

export interface DownloadRootInfo {
  source: DownloadRootSource;
  path: string;
  exists: boolean;
}

export interface DownloadRootSelectionResult extends DownloadRootInfo {
  canceled?: boolean;
}

export interface DownloadRecord {
  videoUrl: string;
  collectionKey: CollectionKey | null;
  title: string | null;
  img: string | null;
  localPath: string | null;
  state: DownloadState;
  progress: number | null;
  fileSizeBytes: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type DownloadRecordPatch = Partial<DownloadRecord> & { videoUrl: string };

export interface OpenDownloadFileResult {
  opened: boolean;
  path: string;
}

export interface RevealDownloadFileResult {
  revealed: boolean;
  path: string;
}

export interface DeleteDownloadResult {
  deleted: boolean;
  removed: boolean;
  canceled?: boolean;
}

export interface CancelDownloadResult {
  canceled: boolean;
  record: DownloadRecord;
}

export interface DownloadRequestPayload {
  collectionKey: CollectionKey;
  video: VideoRow;
}

export interface EnqueueDownloadResult {
  record: DownloadRecord;
  queued: boolean;
}

export interface BrowserNavigationState {
  tabId?: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  locked: boolean;
  reloaded?: boolean;
}

export interface BrowserBounds {
  visible: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface CreateBrowserTabPayload {
  url?: string | null;
  active?: boolean;
  kind?: BrowserTabKind;
  title?: string;
  locked?: boolean;
  muted?: boolean;
  favicon?: string;
  forceReload?: boolean;
}

export interface BrowserTabPayload {
  tabId?: string | null;
}

export interface BrowserTabLockedPayload extends BrowserTabPayload {
  locked: boolean;
}

export interface BrowserTabMutedPayload extends BrowserTabPayload {
  muted: boolean;
}

export interface BrowserNavigatePayload extends BrowserTabPayload {
  url: string;
  forceReload?: boolean;
}

export interface BrowserTabMenuPayload extends BrowserTabPayload {
  x?: number;
  y?: number;
  compactMode?: boolean;
}

export interface LibraryVideoMenuPayload {
  url: string;
  title?: string;
  x?: number;
  y?: number;
}

export interface LibraryVideoMenuAction {
  action: 'open-current' | 'open-new';
  url: string;
}

export interface SyncBrowserCollectionOptions {
  collectionKey: CollectionKey;
  mode: SyncMode;
  syncRunId: string;
  siteOrderOffset: number;
  startPage: number | null;
  stopOnKnownPage: boolean;
  batchLimit: number | null;
  ajaxWindowSize?: number;
}

export interface SyncPagePayload {
  tabId?: string | null;
  collectionKey: CollectionKey;
  mode: SyncMode;
  syncRunId: string;
  page: number;
  rows: ScrapedVideoRow[];
  url: string;
}

export interface SyncProgressPayload {
  tabId?: string | null;
  collectionKey: CollectionKey;
  mode: SyncMode;
  syncRunId: string;
  page: number;
  message?: string;
  reason?: string;
  attempt?: number;
  maxRetries?: number;
  delayMs?: number;
}

export interface SyncQueueProgressPayload {
  collectionKey: CollectionKey;
  mode: SyncMode;
  syncRunId: string;
  phase: 'start' | 'progress' | 'complete';
  total: number;
  processed?: number;
  applied?: number;
  failed?: number;
}

export interface SyncQueuedOperationFailure {
  id?: number;
  url: string;
  message: string;
  blocked: boolean;
}

export interface PendingRemoteOperationStep {
  id: number;
  action: CollectionAction;
  state: PendingRemoteOperationState;
  error: string | null;
}

export interface PendingRemoteOperationGroup {
  groupId: string;
  collectionKey: CollectionKey;
  videoUrl: string;
  title: string | null;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  state: PendingRemoteOperationState;
  error: string | null;
  operationCount: number;
  sequence: PendingRemoteOperationStep[];
}

export interface PendingRemoteOperationActionResult {
  groupId: string;
  collectionKey: CollectionKey;
  videoUrl: string;
  id?: number;
  remoteVideoId?: string | null;
  remoteFavType?: string | null;
  resolved: boolean;
  error?: string | null;
}

export interface CollectionToggleResult {
  tabId?: string | null;
  collectionKey: CollectionKey;
  action: 'add' | 'remove';
  changed: boolean;
  url: string;
  visible: boolean;
  queued?: boolean;
}

export interface SyncResult {
  completed: boolean;
  mode: SyncMode;
  syncRunId: string;
  syncWorkerId?: string | null;
  incompleteReason: string | null;
  stoppedByKnownPage: boolean;
  totalPages: number;
  totalRows: number;
  lastScrapedPage: number | null;
  lastKnownUrl: string | null;
  ajaxFallbackReason?: string | null;
  ajaxRetryCount?: number;
  queuedOperationsApplied?: number;
  queuedOperationsFailed?: number;
  queuedOperationsSkipped?: number;
  queuedOperationFailures?: SyncQueuedOperationFailure[];
}

export interface FullSyncContinuation {
  collectionKey: CollectionKey;
  syncRunId: string;
  tabId: string;
  siteOrderOffset: number;
  lastScrapedPage: number | null;
}

export interface SyncState {
  collection_key: CollectionKey;
  completed: boolean;
  last_scraped_page: number | null;
  last_known_url: string | null;
  updated_at: string;
  hidden?: number;
  mutationsReconciled?: number;
}

export interface FinishSyncPayload {
  collectionKey: CollectionKey;
  mode: SyncMode;
  syncRunId: string;
  result: SyncResult;
}

export interface AppInfo {
  databasePath: string | null;
  locale: SupportedLocale;
  systemLocale: string;
}

export interface OpenLocalDataFolderResult {
  opened: boolean;
  path: string;
}

export interface UpdateCheckResult {
  available?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  releaseUrl?: string;
  error?: string;
  reason?: string;
}

export interface ImportJsonPayload {
  collectionKey: CollectionKey;
  resource: ExportResource;
}

export type ExportJsonFileResult =
  | { canceled: true }
  | {
      canceled: false;
      filename: string;
      total: number;
    };

export interface BrowserDiagnosis {
  url?: string;
  innerWidth?: number;
  innerHeight?: number;
  clientHeight?: number;
  scrollHeight?: number;
  error?: string;
}

export interface BrowserMessage {
  channel: string;
  args: unknown[];
}

export interface JableAppApi {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: AppSettingsPatch): Promise<AppSettings>;
  setLocale(locale: string): Promise<{ locale: SupportedLocale }>;
  getFfmpegStatus(): Promise<FfmpegStatus>;
  refreshFfmpegStatus(): Promise<FfmpegStatus>;
  chooseFfmpegPath(): Promise<FfmpegPathSelectionResult>;
  setFfmpegPath(filePath: string | null): Promise<FfmpegStatus>;
  clearFfmpegPath(): Promise<FfmpegStatus>;
  getDownloadRoot(): Promise<DownloadRootInfo>;
  chooseDownloadRoot(): Promise<DownloadRootSelectionResult>;
  setDownloadRoot(filePath: string | null): Promise<DownloadRootInfo>;
  clearDownloadRoot(): Promise<DownloadRootInfo>;
  openDownloadRoot(): Promise<OpenLocalDataFolderResult>;
  listDownloads(): Promise<DownloadRecord[]>;
  enqueueDownload(payload: DownloadRequestPayload): Promise<EnqueueDownloadResult>;
  retryDownload(videoUrl: string): Promise<EnqueueDownloadResult>;
  cancelDownload(videoUrl: string): Promise<CancelDownloadResult>;
  openDownloadFile(videoUrl: string): Promise<OpenDownloadFileResult>;
  revealDownloadFile(videoUrl: string): Promise<RevealDownloadFileResult>;
  deleteDownload(videoUrl: string): Promise<DeleteDownloadResult>;
  openLocalDataFolder(): Promise<OpenLocalDataFolderResult>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  listVideos(options: ListVideosOptions): Promise<VideoRow[]>;
  countVideos(options: ListVideosOptions): Promise<number>;
  getCollectionUrls(collectionKey: CollectionKey): Promise<string[]>;
  saveSyncPage(payload: SyncPagePayload): Promise<{ saved: number; collectionKey: CollectionKey; page: number | null }>;
  finishSync(payload: FinishSyncPayload): Promise<SyncState>;
  clearSyncState(collectionKey: CollectionKey): Promise<{ collectionKey: CollectionKey; cleared: boolean }>;
  importJson(payload: ImportJsonPayload): Promise<{ imported: number; collectionKey: CollectionKey }>;
  exportJson(collectionKey: CollectionKey): Promise<ExportResource>;
  exportJsonFile(collectionKey: CollectionKey): Promise<ExportJsonFileResult>;
  listPendingRemoteOperationGroups(): Promise<PendingRemoteOperationGroup[]>;
  addPendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult>;
  removePendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult>;
  resolvePendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult>;
  listBrowserTabs(): Promise<BrowserTabsState>;
  showBrowserTabMenu(payload: BrowserTabMenuPayload): Promise<{ shown: boolean }>;
  showLibraryVideoMenu(payload: LibraryVideoMenuPayload): Promise<{ shown: boolean }>;
  createBrowserTab(payload: CreateBrowserTabPayload): Promise<BrowserTabsState>;
  activateBrowserTab(tabId: string | null): Promise<BrowserTabsState>;
  closeBrowserTab(tabId: string | null): Promise<BrowserTabsState>;
  setBrowserTabLocked(payload: BrowserTabLockedPayload): Promise<BrowserTabsState>;
  setBrowserTabMuted(payload: BrowserTabMutedPayload): Promise<BrowserTabsState>;
  setBrowserBounds(bounds: BrowserBounds): Promise<BrowserBounds | null>;
  navigateBrowser(payload: BrowserNavigatePayload): Promise<string>;
  reloadBrowser(payload: BrowserTabPayload): Promise<BrowserNavigationState>;
  goBackBrowser(payload: BrowserTabPayload): Promise<BrowserNavigationState>;
  goForwardBrowser(payload: BrowserTabPayload): Promise<BrowserNavigationState>;
  getBrowserNavigationState(payload: BrowserTabPayload): Promise<BrowserNavigationState>;
  getBrowserUrl(payload: BrowserTabPayload): Promise<string>;
  syncBrowserCollection(payload: { tabId: string | null; options: SyncBrowserCollectionOptions }): Promise<SyncResult>;
  diagnoseBrowser(payload: BrowserTabPayload): Promise<BrowserDiagnosis>;
  onBrowserMessage(callback: (message: BrowserMessage) => void): void;
}
