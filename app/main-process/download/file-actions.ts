'use strict';

import type * as Electron from 'electron';
import type * as NodeChildProcess from 'node:child_process';
import type * as NodeFs from 'node:fs';
import { terminateChildProcess } from '../child-process-termination';
import type {
  DeleteDownloadResult,
  DeleteDownloadsResult,
  DownloadRecord,
  OpenDownloadFileResult,
  RevealDownloadFileResult
} from '../../types/jable';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type DownloadFileActionRuntime = {
  source: 'normal' | 'playback_background';
  abortController: AbortController;
  nativeId: string | null;
  process: NodeChildProcess.ChildProcess | null;
};

export type DownloadFileActionsController = {
  deleteDownload(value: unknown): Promise<DeleteDownloadResult>;
  deleteDownloads(value: unknown): Promise<DeleteDownloadsResult>;
  openDownloadFile(value: unknown): Promise<OpenDownloadFileResult>;
  revealDownloadFile(value: unknown): RevealDownloadFileResult;
};

type DownloadFileActionsControllerOptions = {
  activeRuntime(videoUrl: string): DownloadFileActionRuntime | null;
  cancelNativeDownload(nativeId: string): void;
  clearDownloadFlags(videoUrl: string): void;
  getPersistedDownload(videoUrl: string): DownloadRecord | null;
  hasActiveRuntime(videoUrl: string): boolean;
  isPlaybackCaptureActive(videoUrl: string): boolean;
  markDeleted(videoUrl: string): void;
  normalizeDownloadVideoUrl(value: unknown, field: string, channel: string): string;
  normalizeDownloadVideoUrls(value: unknown, channel: string): string[];
  notifyDownloadsChanged(): void;
  openShellPath(filePath: string): Promise<void>;
  reconcileDownloadRecordFileState(record: DownloadRecord): DownloadRecord;
  reportError?(event: string, error: unknown, details?: unknown): void;
  removeDownloadWorkingFiles(record: DownloadRecord): void;
  removePersistedDownload(videoUrl: string): boolean;
  removePreviewFiles(record: DownloadRecord): void;
  removeQueuedDownload(videoUrl: string): boolean;
  removeQueuedPreviewGeneration(videoUrl: string): void;
  resolveManagedDownloadPath(fileRelativePath: string | null): string | null;
  revealShellPath(filePath: string): void;
  runtimeRecord(record: DownloadRecord): DownloadRecord;
  showAppDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue>;
  suppressPlaybackCapture(videoUrl: string): void;
  t(key: string, params?: TranslationParams | null): string;
};

const fs: typeof NodeFs = require('node:fs');

function fileBusyErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isFileBusyError(error: unknown): boolean {
  const code = fileBusyErrorCode(error);
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

export function createDownloadFileActionsController(
  options: DownloadFileActionsControllerOptions
): DownloadFileActionsController {
  function deleteManagedDownloadFile(record: DownloadRecord): boolean {
    if (!record.localPath) return false;
    const filePath = options.resolveManagedDownloadPath(record.localPath);
    if (!filePath) throw new Error(options.t('status.downloadFileOutsideRoot'));

    let stats: NodeFs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch (error) {
      return false;
    }

    if (!stats.isFile()) throw new Error(options.t('status.downloadFileUnavailable'));

    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (isFileBusyError(error)) throw new Error(options.t('status.downloadDeleteFileBusy'));
      throw error;
    }
    return true;
  }

  function downloadRecordHasManagedFile(record: DownloadRecord): boolean {
    if (!record.localPath) return false;
    const filePath = options.resolveManagedDownloadPath(record.localPath);
    if (!filePath) return false;

    try {
      return fs.statSync(filePath).isFile();
    } catch (error) {
      return false;
    }
  }

  function confirmDeleteDownload(hasManagedFile: boolean): Promise<boolean> {
    return options
      .showAppDialog({
        type: 'warning',
        buttons: [options.t('dialog.deleteDownloadConfirm'), options.t('dialog.cancel')],
        defaultId: 1,
        cancelId: 1,
        title: options.t('dialog.deleteDownloadTitle'),
        message: hasManagedFile
          ? options.t('dialog.deleteDownloadMessage')
          : options.t('dialog.deleteDownloadRecordMessage')
      })
      .then(function (dialogResult: Electron.MessageBoxReturnValue) {
        return dialogResult.response === 0;
      });
  }

  function confirmDeleteDownloads(): Promise<boolean> {
    return options
      .showAppDialog({
        type: 'warning',
        buttons: [options.t('dialog.deleteDownloadsConfirm'), options.t('dialog.cancel')],
        defaultId: 1,
        cancelId: 1,
        title: options.t('dialog.deleteDownloadsTitle'),
        message: options.t('dialog.deleteDownloadsMessage')
      })
      .then(function (dialogResult: Electron.MessageBoxReturnValue) {
        return dialogResult.response === 0;
      });
  }

  function deleteDownloadRecord(visibleRecord: DownloadRecord): { deleted: boolean; removed: boolean } {
    options.removeQueuedDownload(visibleRecord.videoUrl);
    options.clearDownloadFlags(visibleRecord.videoUrl);
    options.suppressPlaybackCapture(visibleRecord.videoUrl);
    options.removeQueuedPreviewGeneration(visibleRecord.videoUrl);

    const deleted = deleteManagedDownloadFile(visibleRecord);
    options.removeDownloadWorkingFiles(visibleRecord);
    options.removePreviewFiles(visibleRecord);
    const removed = options.removePersistedDownload(visibleRecord.videoUrl);

    return {
      deleted: deleted,
      removed: removed
    };
  }

  async function deleteDownload(value: unknown): Promise<DeleteDownloadResult> {
    const videoUrl = options.normalizeDownloadVideoUrl(value, 'videoUrl', 'download:delete');
    if (!videoUrl) throw new Error(options.t('status.downloadFileUnavailable'));

    const activeRuntime = options.activeRuntime(videoUrl);
    if (activeRuntime && activeRuntime.source !== 'playback_background') {
      throw new Error(options.t('status.downloadDeleteActiveBlocked'));
    }

    const record = options.getPersistedDownload(videoUrl);
    const visibleRecord = record ? options.runtimeRecord(record) : null;
    if (!visibleRecord) throw new Error(options.t('status.downloadFileUnavailable'));
    if (
      visibleRecord.state === 'downloading' &&
      !options.isPlaybackCaptureActive(videoUrl) &&
      (!activeRuntime || activeRuntime.source !== 'playback_background')
    ) {
      throw new Error(options.t('status.downloadDeleteActiveBlocked'));
    }

    const confirmed = await confirmDeleteDownload(downloadRecordHasManagedFile(visibleRecord));
    if (!confirmed) {
      return {
        deleted: false,
        removed: false,
        canceled: true
      };
    }

    if (activeRuntime && activeRuntime.source === 'playback_background') {
      options.markDeleted(videoUrl);
      activeRuntime.abortController.abort();
      if (activeRuntime.nativeId) options.cancelNativeDownload(activeRuntime.nativeId);
      if (activeRuntime.process) terminateChildProcess(activeRuntime.process);
    }
    const result = deleteDownloadRecord(visibleRecord);
    options.notifyDownloadsChanged();

    return {
      deleted: result.deleted,
      removed: result.removed
    };
  }

  async function deleteDownloads(value: unknown): Promise<DeleteDownloadsResult> {
    const videoUrls = options.normalizeDownloadVideoUrls(value, 'download:delete-many');
    const confirmed = await confirmDeleteDownloads();
    const result: DeleteDownloadsResult = {
      requested: videoUrls.length,
      deletedFiles: 0,
      removedRecords: 0,
      skipped: 0,
      failed: 0
    };

    if (!confirmed) {
      return Object.assign(result, {
        canceled: true
      });
    }

    for (const videoUrl of videoUrls) {
      if (options.hasActiveRuntime(videoUrl)) {
        result.skipped += 1;
        continue;
      }

      const record = options.getPersistedDownload(videoUrl);
      const visibleRecord = record ? options.runtimeRecord(record) : null;
      if (
        !visibleRecord ||
        (visibleRecord.state !== 'ready' &&
          visibleRecord.state !== 'paused' &&
          visibleRecord.state !== 'failed' &&
          visibleRecord.state !== 'missing')
      ) {
        result.skipped += 1;
        continue;
      }

      try {
        const deleted = deleteDownloadRecord(visibleRecord);
        if (deleted.deleted) result.deletedFiles += 1;
        if (deleted.removed) result.removedRecords += 1;
      } catch (error) {
        result.failed += 1;
        if (options.reportError) {
          try {
            options.reportError('delete-download-file-failed', error, {
              videoUrl: videoUrl
            });
          } catch {}
        }
      }
    }

    options.notifyDownloadsChanged();

    return result;
  }

  function openDownloadFile(value: unknown): Promise<OpenDownloadFileResult> {
    const videoUrl = options.normalizeDownloadVideoUrl(value, 'videoUrl', 'download:open-file');
    if (!videoUrl) throw new Error(options.t('status.downloadFileUnavailable'));

    const record = options.getPersistedDownload(videoUrl);
    const readyRecord = record ? options.reconcileDownloadRecordFileState(record) : null;
    if (!readyRecord || readyRecord.state !== 'ready' || !readyRecord.localPath) {
      throw new Error(options.t('status.downloadFileUnavailable'));
    }
    const filePath = options.resolveManagedDownloadPath(readyRecord.localPath);
    if (!filePath) throw new Error(options.t('status.downloadFileUnavailable'));

    return options.openShellPath(filePath).then(function () {
      return {
        opened: true,
        path: filePath
      };
    });
  }

  function revealDownloadFile(value: unknown): RevealDownloadFileResult {
    const videoUrl = options.normalizeDownloadVideoUrl(value, 'videoUrl', 'download:reveal-file');
    if (!videoUrl) throw new Error(options.t('status.downloadFileUnavailable'));

    const record = options.getPersistedDownload(videoUrl);
    const readyRecord = record ? options.reconcileDownloadRecordFileState(record) : null;
    if (!readyRecord || readyRecord.state !== 'ready' || !readyRecord.localPath) {
      throw new Error(options.t('status.downloadFileUnavailable'));
    }
    const filePath = options.resolveManagedDownloadPath(readyRecord.localPath);
    if (!filePath) throw new Error(options.t('status.downloadFileUnavailable'));

    options.revealShellPath(filePath);
    return {
      revealed: true,
      path: filePath
    };
  }

  return {
    deleteDownload: deleteDownload,
    deleteDownloads: deleteDownloads,
    openDownloadFile: openDownloadFile,
    revealDownloadFile: revealDownloadFile
  };
}
