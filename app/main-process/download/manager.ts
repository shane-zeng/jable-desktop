'use strict';

import type * as Electron from 'electron';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { NativeDownloadEngineModule } from '../../download/native-download-engine';
import type { DiagnosticsLogger } from '../diagnostics/logger';
import type {
  AppSettings,
  AppSettingsPatch,
  BulkDownloadActionResult,
  CancelDownloadResult,
  DeleteDownloadResult,
  DeleteDownloadsResult,
  DownloadRecord,
  DownloadRecordPatch,
  DownloadRequestPayload,
  DownloadRootInfo,
  DownloadRootSelectionResult,
  DownloadSpeedMode,
  EnqueueDownloadResult,
  FfmpegPathSelectionResult,
  FfmpegStatus,
  LocalPlaybackSourceResult,
  OpenDownloadFileResult,
  PauseDownloadResult,
  RevealDownloadFileResult,
  VideoMetadataRefreshPayload
} from '../../types/jable';
import {
  DownloadCanceledError,
  DownloadFileSystemError,
  DownloadPausedError,
  downloadErrorMessage as formatDownloadErrorMessage
} from './errors';
import {
  createDownloadActiveRunner,
  type ActiveDownloadRuntime,
  type DownloadActiveRunner,
  type DownloadQueueSource
} from './active-runner';
import { createDownloadEnvironmentController, type DownloadEnvironmentController } from './environment';
import { createDownloadFileActionsController, type DownloadFileActionsController } from './file-actions';
import { downloadHlsSegmentsWithPlaylistRefresh as runDownloadHlsSegmentsWithPlaylistRefresh } from './hls-segments';
import {
  createDownloadHlsSourceResolver,
  type DownloadFailurePhase,
  type DownloadHlsHelpers,
  type DownloadHlsSourceResolver,
  type HlsPlaylist,
  type SourcePageChineseSubtitleNotice
} from './hls-source';
import { removeDownloadSegmentTempDirectory } from './segment-workspace';
import {
  createDownloadPlaybackCaptureController,
  type DownloadPlaybackCaptureController,
  type HlsPlaybackBackgroundCompletionPayload,
  type HlsPlaybackBackgroundCompletionWorker,
  type HlsPlaybackCaptureCompletePayload,
  type HlsPlaybackCapturePlan,
  type HlsPlaybackCapturePreparePayload,
  type HlsPlaybackCaptureSegmentPayload
} from './playback-capture';
import { createDownloadQueueActionsController, type DownloadQueueActionsController } from './queue-actions';
import {
  createDownloadRequestBoundary,
  isPathInsideDirectory,
  videoUrlSlug,
  type DownloadRequestBoundary
} from './request-boundary';
import { createDownloadRecordStateController, type DownloadRecordStateController } from './record-state';
import { createDownloadRuntimeProgressController, type DownloadRuntimeProgressController } from './runtime-progress';
import { createLocalPlaybackPreviewController, type LocalPlaybackFile } from '../local-playback/preview';
import { createLocalPlaybackServer } from '../local-playback/server';
import { createDownloadShutdownController, type DownloadShutdownController } from './shutdown';
import { cleanupQuarantinedDirectories } from '../safe-directory-removal';

export {
  downloadFailureCode,
  downloadHttpStatusFromMessage,
  isSegmentRefreshCandidate,
  sanitizeDownloadErrorDetail
} from './errors';
export { parseLocalPlaybackRangeHeader } from '../local-playback/range';
export { sourcePageChineseSubtitleNoticeTextFromHtml } from './request-boundary';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type DiagnosticsEventLogger = Pick<DiagnosticsLogger, 'event' | 'errorEvent'>;
type DownloadQueueItem = {
  source: DownloadQueueSource;
  videoUrl: string;
  worker?: HlsPlaybackBackgroundCompletionWorker;
};
type NativeDownloadEngineInstance = InstanceType<NativeDownloadEngineModule['JableDownloadEngine']>;
type DownloadDataStore = {
  listDownloadAssets(): DownloadRecord[];
  getDownloadAsset(videoUrl: string): DownloadRecord | null;
  upsertVideoMetadata(payload: VideoMetadataRefreshPayload): { updated: boolean; url: string };
  upsertDownloadAsset(patch: DownloadRecordPatch): DownloadRecord;
  removeDownloadAsset(videoUrl: string): boolean;
};
export type DownloadManagerContext = {
  app: Electron.App;
  dialog: typeof Electron.dialog;
  getAppSettings(): AppSettings;
  getDatabase(): DownloadDataStore;
  getMainWindow(): Electron.BrowserWindow | null;
  logger?: DiagnosticsEventLogger | null;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  sendToAllBrowserTabs(channel: string, payload: unknown): void;
  session: typeof Electron.session;
  shell: typeof Electron.shell;
  showAppDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue>;
  t(key: string, params?: TranslationParams | null): string;
  updateAppSettings(patch: AppSettingsPatch): AppSettings;
};

export type DownloadManager = {
  cancelDownload(value: unknown): CancelDownloadResult;
  cancelQueuedDownloads(): BulkDownloadActionResult;
  chooseDownloadRoot(): Promise<DownloadRootSelectionResult>;
  chooseFfmpegPath(): Promise<FfmpegPathSelectionResult>;
  clearDownloadRoot(): DownloadRootInfo;
  clearFfmpegPath(): Promise<FfmpegStatus>;
  confirmPauseDownloadsBeforeClose(): Promise<boolean>;
  deleteDownload(value: unknown): Promise<DeleteDownloadResult>;
  deleteDownloads(value: unknown): Promise<DeleteDownloadsResult>;
  getDownloadRoot(): DownloadRootInfo;
  getFfmpegStatus(): Promise<FfmpegStatus>;
  handleLocalPlaybackRequest(request: Request): Promise<Response>;
  hasQueuedOrActiveDownloads(): boolean;
  localPlaybackSource(value: unknown): LocalPlaybackSourceResult;
  listDownloads(): DownloadRecord[];
  openDownloadFile(value: unknown): Promise<OpenDownloadFileResult>;
  openDownloadRoot(): Promise<{ opened: boolean; path: string }>;
  pauseDownload(value: unknown): PauseDownloadResult;
  pauseAllDownloads(): BulkDownloadActionResult;
  pausePlaybackAutoDownloadsForSettingDisable(): BulkDownloadActionResult;
  completeHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): void;
  prepareHlsPlaybackCapture(value: HlsPlaybackCapturePreparePayload): HlsPlaybackCapturePlan | null;
  pauseDownloadsForShutdown(): Promise<void>;
  processQueue(): void;
  queueHlsPlaybackBackgroundCompletion(value: HlsPlaybackBackgroundCompletionPayload): void;
  recordHlsPlaybackCaptureSegment(value: HlsPlaybackCaptureSegmentPayload): void;
  shouldProxyHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): boolean;
  shouldContinueHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): boolean;
  resumeDownload(value: unknown): Promise<EnqueueDownloadResult>;
  resumePausedDownloads(): Promise<BulkDownloadActionResult>;
  retryDownload(value: unknown): Promise<EnqueueDownloadResult>;
  retryFailedDownloads(): Promise<BulkDownloadActionResult>;
  revealDownloadFile(value: unknown): RevealDownloadFileResult;
  setDownloadRoot(value: unknown): DownloadRootInfo;
  setFfmpegPath(value: unknown): Promise<FfmpegStatus>;
  enqueueDownload(value: unknown): Promise<EnqueueDownloadResult>;
};

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');
const downloadHelpers = require('../../download/download-helpers') as DownloadHlsHelpers;
const nativeDownloadEngineModule = require('../../download/native-download-engine') as {
  loadNativeDownloadEngine(): NativeDownloadEngineModule;
};
const urlPolicy = require('../../browser/url-policy') as {
  canonicalJableVideoUrl(value: unknown): string | null;
};

const JABLE_SESSION_PARTITION = 'persist:jable-session';
export const LOCAL_PLAYBACK_SCHEME = 'jable-local-video';
const DOWNLOAD_PROGRESS_NOTIFY_INTERVAL_MS = 1000;
const DOWNLOAD_SEGMENT_SAMPLE_COUNT = 3;
const DOWNLOAD_SEGMENT_RETRY_LIMIT = 3;
const DOWNLOAD_SPEED_MODE_SEGMENT_CONCURRENCY: Record<DownloadSpeedMode, { min: number; max: number }> = {
  stable: { min: 4, max: 8 },
  balanced: { min: 8, max: 32 },
  fast: { min: 16, max: 32 }
};

let getAppSettings: () => AppSettings;
let getDatabase: () => DownloadDataStore;
let diagnosticsLogger: DiagnosticsEventLogger | null = null;
let forwardBrowserMessage: (channel: string, payload: unknown) => void;
let sendToAllBrowserTabs: (channel: string, payload: unknown) => void;
let translate: (key: string, params?: TranslationParams | null) => string;
let downloadEnvironmentController: DownloadEnvironmentController;
let downloadFileActionsController: DownloadFileActionsController;
let downloadHlsSourceResolver: DownloadHlsSourceResolver;
let downloadRequestBoundary: DownloadRequestBoundary;
let downloadPlaybackCaptureController: DownloadPlaybackCaptureController;
let downloadQueueActionsController: DownloadQueueActionsController;
let downloadRecordStateController: DownloadRecordStateController;
let downloadActiveRunner: DownloadActiveRunner;
let downloadShutdownController: DownloadShutdownController;
let downloadRuntimeProgressController: DownloadRuntimeProgressController;
let downloadEngine: NativeDownloadEngineInstance | null = null;
const downloadQueue: DownloadQueueItem[] = [];
const canceledDownloadUrls = new Set<string>();
const deletedDownloadUrls = new Set<string>();
const pausedDownloadUrls = new Set<string>();
const resumedDownloadUrls = new Set<string>();
const activeDownloads = new Map<string, ActiveDownloadRuntime>();
const activeDownloadTasks = new Map<string, Promise<void>>();
const localPlaybackPreviewController = createLocalPlaybackPreviewController({
  ffmpegCommandForDownload: ffmpegCommandForDownload,
  localPlaybackReadyFile: localPlaybackReadyFile,
  localPlaybackScheme: LOCAL_PLAYBACK_SCHEME,
  notifyDownloadsChanged: notifyDownloadsChanged,
  reportError: logDownloadError,
  resolveManagedDownloadPath: resolveManagedDownloadPath
});
const localPlaybackServer = createLocalPlaybackServer({
  canonicalVideoUrl: urlPolicy.canonicalJableVideoUrl,
  getPersistedDownload: getPersistedDownload,
  localPlaybackScheme: LOCAL_PLAYBACK_SCHEME,
  previewController: localPlaybackPreviewController,
  readyFile: localPlaybackReadyFile,
  reconcileDownloadRecordFileState: reconcileDownloadRecordFileState
});

function t(key: string, params?: TranslationParams | null): string {
  return translate(key, params);
}

function logDownloadEvent(level: 'debug' | 'info' | 'warn' | 'error', event: string, details?: unknown) {
  if (diagnosticsLogger) diagnosticsLogger.event(level, 'download', event, details);
}

function logDownloadError(event: string, error: unknown, details?: unknown) {
  if (diagnosticsLogger) diagnosticsLogger.errorEvent('download', event, error, details);
}

function maxConcurrentDownloads() {
  return getAppSettings().maxConcurrentDownloads;
}

function queuedDownloadIndex(videoUrl: string): number {
  return downloadQueue.findIndex(function (item) {
    return item.videoUrl === videoUrl;
  });
}

function queuedDownloadItem(videoUrl: string): DownloadQueueItem | null {
  const index = queuedDownloadIndex(videoUrl);
  return index === -1 ? null : downloadQueue[index];
}

function isPlaybackBackgroundQueuedOrActive(videoUrl: string): boolean {
  const runtime = activeDownloads.get(videoUrl);
  if (runtime && runtime.source === 'playback_background') return true;

  const queued = queuedDownloadItem(videoUrl);
  return Boolean(queued && queued.source === 'playback_background');
}

function createActiveDownloadRuntime(source: DownloadQueueSource): ActiveDownloadRuntime {
  return {
    abortController: new AbortController(),
    source: source,
    process: null,
    nativeId: null
  };
}

export function downloadSegmentConcurrencyForSpeedMode(mode: DownloadSpeedMode | string | null | undefined): {
  min: number;
  max: number;
} {
  if (mode === 'stable' || mode === 'fast') return DOWNLOAD_SPEED_MODE_SEGMENT_CONCURRENCY[mode];
  return DOWNLOAD_SPEED_MODE_SEGMENT_CONCURRENCY.balanced;
}

function currentDownloadSegmentConcurrency() {
  return downloadSegmentConcurrencyForSpeedMode(getAppSettings().downloadSpeedMode);
}

function downloadCanceledError() {
  return new DownloadCanceledError(t('status.downloadCanceled'));
}

function downloadPausedError() {
  return new DownloadPausedError(t('status.downloadPaused'));
}

function throwIfDownloadCanceled(videoUrl: string) {
  if (pausedDownloadUrls.has(videoUrl)) throw downloadPausedError();
  if (canceledDownloadUrls.has(videoUrl)) throw downloadCanceledError();
}

function downloadFileSystemError(error: unknown) {
  return new DownloadFileSystemError(error);
}

function downloadErrorMessage(error: unknown): string {
  return formatDownloadErrorMessage(error, t, getDownloadRoot().path);
}

function getDownloadRoot(): DownloadRootInfo {
  return downloadEnvironmentController.getDownloadRoot();
}

function cleanupQuarantinedDownloadDirectories(rootInfo: DownloadRootInfo = getDownloadRoot()) {
  cleanupQuarantinedDirectories(rootInfo.path, logDownloadError);
}

async function chooseDownloadRoot(): Promise<DownloadRootSelectionResult> {
  const result = await downloadEnvironmentController.chooseDownloadRoot();
  logDownloadEvent('info', 'download-root-selected', {
    canceled: result.canceled,
    source: result.source
  });
  cleanupQuarantinedDownloadDirectories(result);
  return result;
}

function setDownloadRoot(value: unknown): DownloadRootInfo {
  const result = downloadEnvironmentController.setDownloadRoot(value);
  logDownloadEvent('info', 'download-root-set', {
    path: result.path
  });
  cleanupQuarantinedDownloadDirectories(result);
  return result;
}

function clearDownloadRoot(): DownloadRootInfo {
  const result = downloadEnvironmentController.clearDownloadRoot();
  logDownloadEvent('info', 'download-root-cleared', {
    path: result.path
  });
  cleanupQuarantinedDownloadDirectories(result);
  return result;
}

function ensureDownloadRootReady() {
  downloadEnvironmentController.ensureDownloadRootReady();
}

function openShellPath(filePath: string): Promise<void> {
  return downloadEnvironmentController.openShellPath(filePath);
}

function revealShellPath(filePath: string) {
  downloadEnvironmentController.revealShellPath(filePath);
}

function listPersistedDownloads(): DownloadRecord[] {
  return getDatabase().listDownloadAssets();
}

function getPersistedDownload(videoUrl: string): DownloadRecord | null {
  return getDatabase().getDownloadAsset(videoUrl);
}

function upsertPersistedDownload(patch: DownloadRecordPatch): DownloadRecord {
  return getDatabase().upsertDownloadAsset(patch);
}

function upsertDownloadVideoMetadata(payload: DownloadRequestPayload) {
  getDatabase().upsertVideoMetadata({
    url: payload.video.url,
    title: payload.video.title,
    views: payload.video.views,
    likes: payload.video.likes,
    img: payload.video.img,
    preview: payload.video.preview
  });
}

function removePersistedDownload(videoUrl: string): boolean {
  return getDatabase().removeDownloadAsset(videoUrl);
}

function downloadRecordWithRuntimeState(record: DownloadRecord): DownloadRecord {
  return downloadRecordStateController.recordWithRuntimeState(record);
}

function downloadRecordWithRuntimeProgress(record: DownloadRecord): DownloadRecord {
  return downloadRecordStateController.recordWithRuntimeProgress(record);
}

function reconcileDownloadRecordFileState(record: DownloadRecord): DownloadRecord {
  return downloadRecordStateController.reconcileDownloadRecordFileState(record);
}

function listDownloads(): DownloadRecord[] {
  return downloadRecordStateController.listDownloads();
}

function notifyDownloadsChanged() {
  const records = listDownloads();
  forwardBrowserMessage('downloads-changed', records);
  sendToAllBrowserTabs('downloads-changed', records);
}

function downloadTimestamp() {
  return new Date().toISOString();
}

function normalizeDownloadVideoUrl(value: unknown, field: string, channel: string): string {
  return downloadRequestBoundary.normalizeDownloadVideoUrl(value, field, channel);
}

function normalizeDownloadVideoUrls(value: unknown, channel: string): string[] {
  return downloadRequestBoundary.normalizeDownloadVideoUrls(value, channel);
}

function normalizeDownloadRequestPayload(value: unknown): DownloadRequestPayload {
  return downloadRequestBoundary.normalizeDownloadRequestPayload(value);
}

function downloadOutputRelativePath(payload: DownloadRequestPayload): string {
  return downloadRequestBoundary.downloadOutputRelativePath(payload);
}

function resolveManagedDownloadPath(fileRelativePath: string | null): string | null {
  return downloadRequestBoundary.resolveManagedDownloadPath(fileRelativePath);
}

function localPlaybackReadyFile(videoUrl: string): LocalPlaybackFile | null {
  const record = getPersistedDownload(videoUrl);
  const readyRecord = record ? reconcileDownloadRecordFileState(record) : null;
  if (!readyRecord || readyRecord.state !== 'ready' || !readyRecord.localPath) return null;

  const filePath = resolveManagedDownloadPath(readyRecord.localPath);
  if (!filePath) return null;

  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) return null;
    return {
      record: readyRecord,
      filePath: filePath,
      stats: stats
    };
  } catch (error) {
    return null;
  }
}

function localPlaybackSource(value: unknown): LocalPlaybackSourceResult {
  return localPlaybackServer.source(value);
}

async function handleLocalPlaybackRequest(request: Request): Promise<Response> {
  return localPlaybackServer.handleRequest(request);
}

async function ffmpegCommandForDownload(): Promise<string> {
  return downloadEnvironmentController.ffmpegCommandForDownload();
}

function removePartialDownloadFile(outputPath: string) {
  try {
    fs.unlinkSync(outputPath + '.part');
  } catch (error) {}
}

function updateDownloadRuntimeProgress(videoUrl: string, downloadedBytes: number) {
  downloadRuntimeProgressController.update(videoUrl, downloadedBytes);
}

function suppressHlsPlaybackCapture(videoUrl: string) {
  downloadPlaybackCaptureController.suppress(videoUrl);
}

function allowHlsPlaybackCapture(videoUrl: string) {
  downloadPlaybackCaptureController.allow(videoUrl);
}

function prepareHlsPlaybackCapture(value: HlsPlaybackCapturePreparePayload): HlsPlaybackCapturePlan | null {
  return downloadPlaybackCaptureController.prepareHlsPlaybackCapture(value);
}

function recordHlsPlaybackCaptureSegment(value: HlsPlaybackCaptureSegmentPayload) {
  downloadPlaybackCaptureController.recordHlsPlaybackCaptureSegment(value);
}

function completeHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload) {
  downloadPlaybackCaptureController.completeHlsPlaybackCapture(value);
}

function queueHlsPlaybackBackgroundCompletion(value: HlsPlaybackBackgroundCompletionPayload) {
  downloadPlaybackCaptureController.queueHlsPlaybackBackgroundCompletion(value);
}

function shouldContinueHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload) {
  return downloadPlaybackCaptureController.shouldContinueHlsPlaybackCapture(value);
}

function shouldProxyHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload) {
  return downloadPlaybackCaptureController.shouldProxyHlsPlaybackCapture(value);
}

function removeDownloadWorkingFiles(record: DownloadRecord) {
  const outputPath = resolveManagedDownloadPath(record.localPath);
  if (!outputPath) return;
  removePartialDownloadFile(outputPath);
  removeDownloadSegmentTempDirectory(outputPath, logDownloadError);
}

function removePartialDownloadFileForRecord(record: DownloadRecord) {
  const outputPath = resolveManagedDownloadPath(record.localPath);
  if (!outputPath) return;
  removePartialDownloadFile(outputPath);
}

async function resolveDownloadHlsSource(
  videoUrl: string,
  signal: AbortSignal,
  setFailurePhase?: (phase: DownloadFailurePhase) => void,
  updateSourcePageNotice?: (notice: SourcePageChineseSubtitleNotice) => void
): Promise<
  {
    cookieHeader: string;
    playlist: HlsPlaylist;
  } & SourcePageChineseSubtitleNotice
> {
  return downloadHlsSourceResolver.resolveDownloadHlsSource(videoUrl, signal, setFailurePhase, updateSourcePageNotice);
}

async function downloadHlsSegmentsWithPlaylistRefresh(
  playlist: HlsPlaylist,
  videoUrl: string,
  cookieHeader: string,
  outputPath: string,
  signal: AbortSignal,
  runtime: ActiveDownloadRuntime,
  reuseExistingSegments: boolean
): Promise<string> {
  const startedAt = Date.now();
  logDownloadEvent('info', 'native-segments-started', {
    videoUrl: videoUrl,
    segmentCount: playlist.segments.length,
    reuseExistingSegments: reuseExistingSegments,
    concurrency: currentDownloadSegmentConcurrency()
  });

  try {
    const localPlaylistPath = await runDownloadHlsSegmentsWithPlaylistRefresh(
      playlist,
      videoUrl,
      cookieHeader,
      outputPath,
      signal,
      runtime,
      reuseExistingSegments,
      {
        currentDownloadSegmentConcurrency: currentDownloadSegmentConcurrency,
        downloadCanceledError: downloadCanceledError,
        downloadFileSystemError: downloadFileSystemError,
        downloadPausedError: downloadPausedError,
        getDownloadEngine: getDownloadEngine,
        helpers: downloadHelpers,
        isCanceled: function (candidateVideoUrl) {
          return canceledDownloadUrls.has(candidateVideoUrl);
        },
        isPaused: function (candidateVideoUrl) {
          return pausedDownloadUrls.has(candidateVideoUrl);
        },
        progressNotifyIntervalMs: DOWNLOAD_PROGRESS_NOTIFY_INTERVAL_MS,
        resolveDownloadHlsSource: resolveDownloadHlsSource,
        retryLimit: DOWNLOAD_SEGMENT_RETRY_LIMIT,
        reportError: logDownloadError,
        sampleSegmentCount: DOWNLOAD_SEGMENT_SAMPLE_COUNT,
        throwIfDownloadCanceled: throwIfDownloadCanceled,
        updateDownloadRuntimeProgress: updateDownloadRuntimeProgress
      }
    );
    logDownloadEvent('info', 'native-segments-complete', {
      videoUrl: videoUrl,
      segmentCount: playlist.segments.length,
      durationMs: Date.now() - startedAt
    });
    return localPlaylistPath;
  } catch (error) {
    logDownloadError('native-segments-failed', error, {
      videoUrl: videoUrl,
      segmentCount: playlist.segments.length,
      durationMs: Date.now() - startedAt
    });
    throw error;
  }
}

async function runQueuedDownload(record: DownloadRecord) {
  const runtime = createActiveDownloadRuntime('normal');
  activeDownloads.set(record.videoUrl, runtime);
  await downloadActiveRunner.runActiveDownload(record, runtime, resumedDownloadUrls.has(record.videoUrl));
}

async function runQueuedPlaybackBackgroundDownload(
  record: DownloadRecord,
  worker: HlsPlaybackBackgroundCompletionWorker
) {
  const runtime = createActiveDownloadRuntime('playback_background');
  activeDownloads.set(record.videoUrl, runtime);
  await downloadActiveRunner.runActiveDownload(record, runtime, true, function () {
    return worker(runtime.abortController.signal);
  });
}

function processDownloadQueue() {
  while (activeDownloads.size < maxConcurrentDownloads()) {
    const nextItem = downloadQueue[0];
    if (!nextItem) return;

    const record = getPersistedDownload(nextItem.videoUrl);
    if (!record || record.state !== 'queued') {
      downloadQueue.shift();
      continue;
    }
    if (nextItem.source === 'playback_background' && !getAppSettings().autoDownloadOnPlayback) {
      if (!pausePlaybackAutoDownload(nextItem.videoUrl)) downloadQueue.shift();
      continue;
    }
    downloadQueue.shift();

    if (nextItem.source === 'playback_background' && !nextItem.worker) continue;
    const task =
      nextItem.source === 'playback_background' && nextItem.worker
        ? runQueuedPlaybackBackgroundDownload(record, nextItem.worker)
        : runQueuedDownload(record);
    task
      .catch(function (error) {
        logDownloadError('download-task-failed', error, {
          videoUrl: record.videoUrl,
          source: nextItem.source
        });
      })
      .finally(function () {
        activeDownloadTasks.delete(record.videoUrl);
        processDownloadQueue();
      });
    activeDownloadTasks.set(record.videoUrl, task);
  }
}

function queueDownloadRecord(
  record: DownloadRecord,
  source: DownloadQueueSource = 'normal',
  worker?: HlsPlaybackBackgroundCompletionWorker
) {
  const queueIndex = queuedDownloadIndex(record.videoUrl);
  if (queueIndex !== -1) {
    if (source === 'playback_background' && worker) {
      downloadQueue[queueIndex] = {
        source: source,
        videoUrl: record.videoUrl,
        worker: worker
      };
    }
  } else if (!activeDownloads.has(record.videoUrl)) {
    downloadQueue.push({
      source: source,
      videoUrl: record.videoUrl,
      worker: worker
    });
  }
  notifyDownloadsChanged();
  processDownloadQueue();
}

async function enqueueDownload(value: unknown): Promise<EnqueueDownloadResult> {
  return downloadQueueActionsController.enqueueDownload(value);
}

async function retryDownload(value: unknown): Promise<EnqueueDownloadResult> {
  return downloadQueueActionsController.retryDownload(value);
}

async function retryFailedDownloads(): Promise<BulkDownloadActionResult> {
  return downloadQueueActionsController.retryFailedDownloads();
}

function removeQueuedDownload(videoUrl: string): boolean {
  const queueIndex = queuedDownloadIndex(videoUrl);
  if (queueIndex === -1) return false;
  downloadQueue.splice(queueIndex, 1);
  return true;
}

async function resumeDownload(value: unknown): Promise<EnqueueDownloadResult> {
  return downloadQueueActionsController.resumeDownload(value);
}

async function resumePausedDownloads(): Promise<BulkDownloadActionResult> {
  return downloadQueueActionsController.resumePausedDownloads();
}

function pauseDownload(value: unknown): PauseDownloadResult {
  return downloadQueueActionsController.pauseDownload(value);
}

function pauseAllDownloads(): BulkDownloadActionResult {
  return downloadQueueActionsController.pauseAllDownloads();
}

function pausePlaybackAutoDownload(videoUrl: string): boolean {
  return downloadQueueActionsController.pausePlaybackAutoDownload(videoUrl);
}

function pausePlaybackAutoDownloadsForSettingDisable(): BulkDownloadActionResult {
  return downloadQueueActionsController.pausePlaybackAutoDownloadsForSettingDisable();
}

function cancelDownload(value: unknown): CancelDownloadResult {
  return downloadQueueActionsController.cancelDownload(value);
}

function cancelQueuedDownloads(): BulkDownloadActionResult {
  return downloadQueueActionsController.cancelQueuedDownloads();
}

async function deleteDownload(value: unknown): Promise<DeleteDownloadResult> {
  return downloadFileActionsController.deleteDownload(value);
}

async function deleteDownloads(value: unknown): Promise<DeleteDownloadsResult> {
  return downloadFileActionsController.deleteDownloads(value);
}

function openDownloadFile(value: unknown): Promise<OpenDownloadFileResult> {
  return downloadFileActionsController.openDownloadFile(value);
}

function revealDownloadFile(value: unknown): RevealDownloadFileResult {
  return downloadFileActionsController.revealDownloadFile(value);
}

function getDownloadEngine(): NativeDownloadEngineInstance {
  if (!downloadEngine) {
    logDownloadEvent('info', 'native-download-engine-load-started');
    try {
      const nativeModule = nativeDownloadEngineModule.loadNativeDownloadEngine();
      downloadEngine = new nativeModule.JableDownloadEngine();
      logDownloadEvent('info', 'native-download-engine-load-complete');
    } catch (error) {
      logDownloadError('native-download-engine-load-failed', error);
      throw error;
    }
  }

  return downloadEngine;
}

function hasQueuedOrActiveDownloads(): boolean {
  return downloadQueue.length > 0 || activeDownloads.size > 0;
}

function pauseDownloadsForShutdown(): Promise<void> {
  return downloadShutdownController.pauseDownloadsForShutdown();
}

function confirmPauseDownloadsBeforeClose(): Promise<boolean> {
  return downloadShutdownController.confirmPauseDownloadsBeforeClose();
}

export function createDownloadManager(context: DownloadManagerContext): DownloadManager {
  getAppSettings = context.getAppSettings;
  getDatabase = context.getDatabase;
  diagnosticsLogger = context.logger || null;
  forwardBrowserMessage = context.forwardBrowserMessage;
  sendToAllBrowserTabs = context.sendToAllBrowserTabs;
  translate = context.t;
  downloadEnvironmentController = createDownloadEnvironmentController({
    app: context.app,
    dialog: context.dialog,
    getAppSettings: context.getAppSettings,
    getMainWindow: context.getMainWindow,
    shell: context.shell,
    t: context.t,
    updateAppSettings: context.updateAppSettings
  });
  downloadHlsSourceResolver = createDownloadHlsSourceResolver({
    helpers: downloadHelpers,
    session: context.session,
    sessionPartition: JABLE_SESSION_PARTITION,
    throwIfDownloadCanceled: throwIfDownloadCanceled
  });
  downloadRequestBoundary = createDownloadRequestBoundary({
    canonicalVideoUrl: urlPolicy.canonicalJableVideoUrl,
    downloadRootPath: function () {
      return getDownloadRoot().path;
    },
    listPersistedDownloads: listPersistedDownloads,
    t: context.t
  });
  downloadPlaybackCaptureController = createDownloadPlaybackCaptureController({
    canonicalVideoUrl: urlPolicy.canonicalJableVideoUrl,
    downloadOutputRelativePath: downloadOutputRelativePath,
    downloadRecordWithRuntimeProgress: downloadRecordWithRuntimeProgress,
    downloadRecordWithRuntimeState: downloadRecordWithRuntimeState,
    ensureDownloadRootReady: ensureDownloadRootReady,
    getAppSettings: context.getAppSettings,
    getPersistedDownload: getPersistedDownload,
    hasQueuedOrActiveDownload: function (videoUrl: string) {
      return queuedDownloadIndex(videoUrl) !== -1 || activeDownloads.has(videoUrl);
    },
    isPathInsideDirectory: isPathInsideDirectory,
    isPlaybackBackgroundQueuedOrActive: isPlaybackBackgroundQueuedOrActive,
    markResumedDownload: function (videoUrl: string) {
      resumedDownloadUrls.add(videoUrl);
    },
    notifyDownloadsChanged: notifyDownloadsChanged,
    parseHlsPlaylist: downloadHelpers.parseHlsPlaylist,
    queueDownloadRecord: queueDownloadRecord,
    reportError: logDownloadError,
    resolveManagedDownloadPath: resolveManagedDownloadPath,
    upsertDownloadVideoMetadata: upsertDownloadVideoMetadata,
    upsertPersistedDownload: upsertPersistedDownload,
    videoUrlSlug: videoUrlSlug
  });
  downloadRuntimeProgressController = createDownloadRuntimeProgressController({
    notifyDownloadsChanged: notifyDownloadsChanged,
    progressNotifyIntervalMs: DOWNLOAD_PROGRESS_NOTIFY_INTERVAL_MS
  });
  downloadRecordStateController = createDownloadRecordStateController({
    fs: fs,
    hasActiveDownload: function (videoUrl: string) {
      return activeDownloads.has(videoUrl);
    },
    hasQueuedDownload: function (videoUrl: string) {
      return queuedDownloadIndex(videoUrl) !== -1;
    },
    isPlaybackCaptureActive: function (videoUrl: string) {
      return downloadPlaybackCaptureController.isActiveDownload(videoUrl);
    },
    listPersistedDownloads: listPersistedDownloads,
    notifyDownloadsChanged: notifyDownloadsChanged,
    playbackCaptureRuntimeProgress: function (videoUrl: string) {
      return downloadPlaybackCaptureController.runtimeProgress(videoUrl);
    },
    resolveManagedDownloadPath: resolveManagedDownloadPath,
    runtimeProgress: function (videoUrl: string) {
      return downloadRuntimeProgressController.get(videoUrl);
    },
    t: context.t,
    upsertPersistedDownload: upsertPersistedDownload
  });
  downloadActiveRunner = createDownloadActiveRunner({
    clearActiveDownload: function (videoUrl: string) {
      activeDownloads.delete(videoUrl);
    },
    clearDownloadFlags: function (videoUrl: string) {
      canceledDownloadUrls.delete(videoUrl);
      deletedDownloadUrls.delete(videoUrl);
      pausedDownloadUrls.delete(videoUrl);
      resumedDownloadUrls.delete(videoUrl);
    },
    clearPlaybackCaptureAfterActiveDownload: function (videoUrl: string) {
      downloadPlaybackCaptureController.clearAfterActiveDownload(videoUrl);
    },
    clearRuntimeProgress: function (videoUrl: string) {
      downloadRuntimeProgressController.clear(videoUrl);
    },
    downloadCanceledError: downloadCanceledError,
    downloadErrorMessage: downloadErrorMessage,
    downloadFileSystemError: downloadFileSystemError,
    downloadHlsSegmentsWithPlaylistRefresh: downloadHlsSegmentsWithPlaylistRefresh,
    downloadPausedError: downloadPausedError,
    downloadTimestamp: downloadTimestamp,
    ffmpegCommandForDownload: ffmpegCommandForDownload,
    isCanceled: function (videoUrl: string) {
      return canceledDownloadUrls.has(videoUrl);
    },
    isDeleted: function (videoUrl: string) {
      return deletedDownloadUrls.has(videoUrl);
    },
    isPaused: function (videoUrl: string) {
      return pausedDownloadUrls.has(videoUrl);
    },
    localPlaybackReadyFile: localPlaybackReadyFile,
    logger: diagnosticsLogger,
    notifyDownloadsChanged: notifyDownloadsChanged,
    path: path,
    removePartialDownloadFile: removePartialDownloadFile,
    resolveDownloadHlsSource: resolveDownloadHlsSource,
    resolveManagedDownloadPath: resolveManagedDownloadPath,
    schedulePreviewGeneration: localPlaybackPreviewController.scheduleGeneration,
    statFile: function (filePath: string) {
      return fs.statSync(filePath);
    },
    t: context.t,
    updateDownloadRuntimeProgress: updateDownloadRuntimeProgress,
    upsertPersistedDownload: upsertPersistedDownload,
    writeDirectory: function (directoryPath: string) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  });
  downloadFileActionsController = createDownloadFileActionsController({
    activeRuntime: function (videoUrl: string) {
      return activeDownloads.get(videoUrl) || null;
    },
    cancelNativeDownload: function (nativeId: string) {
      getDownloadEngine().cancelDownload(nativeId);
    },
    clearDownloadFlags: function (videoUrl: string) {
      canceledDownloadUrls.delete(videoUrl);
      pausedDownloadUrls.delete(videoUrl);
      resumedDownloadUrls.delete(videoUrl);
    },
    getPersistedDownload: getPersistedDownload,
    hasActiveRuntime: function (videoUrl: string) {
      return activeDownloads.has(videoUrl);
    },
    isPlaybackCaptureActive: function (videoUrl: string) {
      return downloadPlaybackCaptureController.isActiveDownload(videoUrl);
    },
    markDeleted: function (videoUrl: string) {
      deletedDownloadUrls.add(videoUrl);
    },
    normalizeDownloadVideoUrl: normalizeDownloadVideoUrl,
    normalizeDownloadVideoUrls: normalizeDownloadVideoUrls,
    notifyDownloadsChanged: notifyDownloadsChanged,
    openShellPath: openShellPath,
    reconcileDownloadRecordFileState: reconcileDownloadRecordFileState,
    reportError: logDownloadError,
    removeDownloadWorkingFiles: removeDownloadWorkingFiles,
    removePersistedDownload: removePersistedDownload,
    removePreviewFiles: localPlaybackPreviewController.removeFiles,
    removeQueuedDownload: removeQueuedDownload,
    removeQueuedPreviewGeneration: localPlaybackPreviewController.removeQueuedGeneration,
    resolveManagedDownloadPath: resolveManagedDownloadPath,
    revealShellPath: revealShellPath,
    runtimeRecord: downloadRecordWithRuntimeState,
    showAppDialog: context.showAppDialog,
    suppressPlaybackCapture: suppressHlsPlaybackCapture,
    t: context.t
  });
  downloadQueueActionsController = createDownloadQueueActionsController({
    activePlaybackCaptureUrls: function () {
      return downloadPlaybackCaptureController.activeDownloadUrls();
    },
    activeRuntime: function (videoUrl: string) {
      return activeDownloads.get(videoUrl) || null;
    },
    activeRuntimeEntries: function () {
      return Array.from(activeDownloads.entries());
    },
    allowPlaybackCapture: allowHlsPlaybackCapture,
    canonicalVideoUrl: urlPolicy.canonicalJableVideoUrl,
    cancelNativeDownload: function (nativeId: string) {
      getDownloadEngine().cancelDownload(nativeId);
    },
    clearCanceled: function (videoUrl: string) {
      canceledDownloadUrls.delete(videoUrl);
    },
    clearPaused: function (videoUrl: string) {
      pausedDownloadUrls.delete(videoUrl);
    },
    clearResumed: function (videoUrl: string) {
      resumedDownloadUrls.delete(videoUrl);
    },
    downloadOutputRelativePath: downloadOutputRelativePath,
    downloadTimestamp: downloadTimestamp,
    ensureDownloadRootReady: ensureDownloadRootReady,
    ffmpegCommandForDownload: ffmpegCommandForDownload,
    getPersistedDownload: getPersistedDownload,
    isPlaybackCaptureActive: function (videoUrl: string) {
      return downloadPlaybackCaptureController.isActiveDownload(videoUrl);
    },
    listDownloads: listDownloads,
    listPersistedDownloads: listPersistedDownloads,
    normalizeDownloadRequestPayload: normalizeDownloadRequestPayload,
    normalizeDownloadVideoUrl: normalizeDownloadVideoUrl,
    notifyDownloadsChanged: notifyDownloadsChanged,
    queueDownloadRecord: queueDownloadRecord,
    queuedItems: function () {
      return downloadQueue.slice();
    },
    queuedItem: queuedDownloadItem,
    recordWithRuntimeState: downloadRecordWithRuntimeState,
    reportError: logDownloadError,
    removeDownloadWorkingFiles: removeDownloadWorkingFiles,
    removePartialDownloadFileForRecord: removePartialDownloadFileForRecord,
    removeQueuedDownload: removeQueuedDownload,
    setCanceled: function (videoUrl: string) {
      canceledDownloadUrls.add(videoUrl);
    },
    setPaused: function (videoUrl: string) {
      pausedDownloadUrls.add(videoUrl);
    },
    setResumed: function (videoUrl: string) {
      resumedDownloadUrls.add(videoUrl);
    },
    suppressPlaybackCapture: suppressHlsPlaybackCapture,
    t: context.t,
    upsertDownloadVideoMetadata: upsertDownloadVideoMetadata,
    upsertPersistedDownload: upsertPersistedDownload
  });
  downloadShutdownController = createDownloadShutdownController({
    activeDownloadTasks: function () {
      return Array.from(activeDownloadTasks.values());
    },
    activeRuntimeEntries: function () {
      return Array.from(activeDownloads.entries());
    },
    cancelNativeDownloadIfLoaded: function (nativeId: string) {
      if (downloadEngine) downloadEngine.cancelDownload(nativeId);
    },
    drainQueuedItems: function () {
      return downloadQueue.splice(0);
    },
    getPersistedDownload: getPersistedDownload,
    notifyDownloadsChanged: notifyDownloadsChanged,
    setPaused: function (videoUrl: string) {
      pausedDownloadUrls.add(videoUrl);
    },
    showAppDialog: context.showAppDialog,
    t: context.t,
    upsertPersistedDownload: upsertPersistedDownload
  });
  cleanupQuarantinedDownloadDirectories();

  return {
    cancelDownload: cancelDownload,
    cancelQueuedDownloads: cancelQueuedDownloads,
    chooseDownloadRoot: chooseDownloadRoot,
    chooseFfmpegPath: downloadEnvironmentController.chooseFfmpegPath,
    clearDownloadRoot: clearDownloadRoot,
    clearFfmpegPath: downloadEnvironmentController.clearFfmpegPath,
    confirmPauseDownloadsBeforeClose: confirmPauseDownloadsBeforeClose,
    deleteDownload: deleteDownload,
    deleteDownloads: deleteDownloads,
    getDownloadRoot: getDownloadRoot,
    getFfmpegStatus: downloadEnvironmentController.getFfmpegStatus,
    handleLocalPlaybackRequest: handleLocalPlaybackRequest,
    hasQueuedOrActiveDownloads: hasQueuedOrActiveDownloads,
    localPlaybackSource: localPlaybackSource,
    listDownloads: listDownloads,
    openDownloadFile: openDownloadFile,
    openDownloadRoot: downloadEnvironmentController.openDownloadRoot,
    pauseDownload: pauseDownload,
    pauseAllDownloads: pauseAllDownloads,
    pausePlaybackAutoDownloadsForSettingDisable: pausePlaybackAutoDownloadsForSettingDisable,
    completeHlsPlaybackCapture: completeHlsPlaybackCapture,
    prepareHlsPlaybackCapture: prepareHlsPlaybackCapture,
    pauseDownloadsForShutdown: pauseDownloadsForShutdown,
    processQueue: processDownloadQueue,
    queueHlsPlaybackBackgroundCompletion: queueHlsPlaybackBackgroundCompletion,
    recordHlsPlaybackCaptureSegment: recordHlsPlaybackCaptureSegment,
    shouldProxyHlsPlaybackCapture: shouldProxyHlsPlaybackCapture,
    shouldContinueHlsPlaybackCapture: shouldContinueHlsPlaybackCapture,
    resumeDownload: resumeDownload,
    resumePausedDownloads: resumePausedDownloads,
    retryDownload: retryDownload,
    retryFailedDownloads: retryFailedDownloads,
    revealDownloadFile: revealDownloadFile,
    setDownloadRoot: setDownloadRoot,
    setFfmpegPath: downloadEnvironmentController.setFfmpegPath,
    enqueueDownload: enqueueDownload
  };
}
