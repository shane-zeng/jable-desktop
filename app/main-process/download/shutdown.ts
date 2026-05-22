'use strict';

import type * as Electron from 'electron';
import type { DownloadRecord, DownloadRecordPatch } from '../../types/jable';
import { terminateChildProcess } from '../child-process-termination';
import type { ActiveDownloadRuntime, DownloadQueueSource } from './active-runner';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type DownloadShutdownQueueItem = {
  source: DownloadQueueSource;
  videoUrl: string;
};

export type DownloadShutdownController = {
  confirmPauseDownloadsBeforeClose(): Promise<boolean>;
  pauseDownloadsForShutdown(): Promise<void>;
};

type DownloadShutdownControllerOptions = {
  activeDownloadTasks(): Promise<void>[];
  activeRuntimeEntries(): Array<[string, ActiveDownloadRuntime]>;
  cancelNativeDownloadIfLoaded(nativeId: string): void;
  drainQueuedItems(): DownloadShutdownQueueItem[];
  getPersistedDownload(videoUrl: string): DownloadRecord | null;
  notifyDownloadsChanged(): void;
  setPaused(videoUrl: string): void;
  showAppDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue>;
  t(key: string, params?: TranslationParams | null): string;
  upsertPersistedDownload(patch: DownloadRecordPatch): DownloadRecord;
};

export function createDownloadShutdownController(
  options: DownloadShutdownControllerOptions
): DownloadShutdownController {
  let closePromptInFlight = false;

  function waitForActiveDownloadTasks(): Promise<void> {
    const tasks = options.activeDownloadTasks();
    if (!tasks.length) return Promise.resolve();

    return Promise.all(
      tasks.map(function (task) {
        return task.catch(function () {});
      })
    ).then(function () {});
  }

  function pauseDownloadRecord(videoUrl: string, playbackAutoResumeBlocked: boolean) {
    options.setPaused(videoUrl);
    options.upsertPersistedDownload({
      videoUrl: videoUrl,
      state: 'paused',
      progress: null,
      playbackAutoResumeBlocked: playbackAutoResumeBlocked,
      error: options.t('status.downloadPaused'),
      failurePhase: null,
      failureCode: null,
      lastErrorAt: null,
      completedAt: null
    });
  }

  function pauseQueuedDownload(item: DownloadShutdownQueueItem) {
    const record = options.getPersistedDownload(item.videoUrl);
    if (!record) return;

    pauseDownloadRecord(item.videoUrl, item.source === 'normal' ? true : record.playbackAutoResumeBlocked);
  }

  function pauseActiveDownload(videoUrl: string, runtime: ActiveDownloadRuntime) {
    const record = options.getPersistedDownload(videoUrl);
    if (!record) return;

    pauseDownloadRecord(videoUrl, runtime.source === 'normal' ? true : record.playbackAutoResumeBlocked);
    runtime.abortController.abort();
    if (runtime.nativeId) options.cancelNativeDownloadIfLoaded(runtime.nativeId);
    if (runtime.process) terminateChildProcess(runtime.process);
  }

  function pauseDownloadsForShutdown(): Promise<void> {
    const queuedItems = options.drainQueuedItems();
    const activeEntries = options.activeRuntimeEntries();

    for (const item of queuedItems) {
      pauseQueuedDownload(item);
    }

    for (const [videoUrl, runtime] of activeEntries) {
      pauseActiveDownload(videoUrl, runtime);
    }

    if (queuedItems.length || activeEntries.length) options.notifyDownloadsChanged();
    return waitForActiveDownloadTasks();
  }

  function confirmPauseDownloadsBeforeClose(): Promise<boolean> {
    if (closePromptInFlight) return Promise.resolve(false);
    closePromptInFlight = true;

    return options
      .showAppDialog({
        type: 'warning',
        buttons: [options.t('dialog.pauseDownloadsAndClose'), options.t('dialog.returnToApp')],
        defaultId: 0,
        cancelId: 1,
        title: options.t('dialog.pauseDownloadsBeforeQuitTitle'),
        message: options.t('dialog.pauseDownloadsBeforeQuitMessage')
      })
      .then(function (dialogResult: Electron.MessageBoxReturnValue) {
        return dialogResult.response === 0;
      })
      .finally(function () {
        closePromptInFlight = false;
      });
  }

  return {
    confirmPauseDownloadsBeforeClose: confirmPauseDownloadsBeforeClose,
    pauseDownloadsForShutdown: pauseDownloadsForShutdown
  };
}
