import { ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import {
  batchDownloadQueueTone,
  bulkDeleteActionTone,
  bulkDownloadActionTone,
  queuedDownloadUrls,
  selectedVisibleDownloadUrls as selectedVisibleDownloadUrlsForRecords
} from '../download-actions';
import {
  downloadNotificationTitle,
  downloadRequestVideo as buildDownloadRequestVideo,
  isDownloadDeleteSelectable
} from '../download-display';
import { reportRendererWorkflowError } from '../diagnostics';
import type { CollectionKey, DownloadRecord, JableAppApi, VideoRow } from '../../types/jable';
import type { ToastTone } from './useToastStatus';

type Translate = (key: string, params?: Record<string, string | number | null | undefined>) => string;
type ErrorMessage = (error: unknown) => string;
type SetStatus = (text: string, tone?: ToastTone) => void;

type DownloadWorkflowLibrary = {
  activeCollection: Ref<CollectionKey>;
  selectedBatchDownloadVideos: ComputedRef<VideoRow[]>;
  downloadRecords: Ref<DownloadRecord[]>;
  downloads: ComputedRef<DownloadRecord[]>;
  refreshDownloads: () => Promise<void>;
  clearBatchDownloadSelection: () => void;
  selectBatchDownloadVideos: (videoUrls: string[]) => void;
};

export function useDownloadWorkflow(options: {
  api: JableAppApi;
  busy: Ref<boolean>;
  syncing: Ref<boolean> | ComputedRef<boolean>;
  library: DownloadWorkflowLibrary;
  errorMessage: ErrorMessage;
  setStatus: SetStatus;
  t: Translate;
}) {
  const selectedDownloadUrls = ref<string[]>([]);
  let downloadNotificationStates = new Map<string, DownloadRecord['state']>();
  const suppressedDownloadFailureUrls = new Set<string>();

  function isBlocked() {
    return options.busy.value || options.syncing.value;
  }

  function downloadRecordForVideoUrl(videoUrl: string) {
    return (
      options.library.downloadRecords.value.find(function (record) {
        return record.videoUrl === videoUrl;
      }) || null
    );
  }

  function downloadRequestVideo(video: VideoRow) {
    return buildDownloadRequestVideo(video);
  }

  function selectBatchDownloadVideos(videos: VideoRow[]) {
    options.library.selectBatchDownloadVideos(
      videos.map(function (video) {
        return video.url;
      })
    );
  }

  function toggleDownloadRecordSelection(payload: { videoUrl: string; selected: boolean }) {
    const next = new Set(selectedDownloadUrls.value);
    if (payload.selected) next.add(payload.videoUrl);
    else next.delete(payload.videoUrl);
    selectedDownloadUrls.value = Array.from(next);
  }

  function selectedVisibleDownloadUrls() {
    return selectedVisibleDownloadUrlsForRecords(options.library.downloads.value, selectedDownloadUrls.value);
  }

  function applyDownloadNotifications(records: DownloadRecord[]) {
    const nextStates = new Map<string, DownloadRecord['state']>();

    for (const record of records) {
      const previousState = downloadNotificationStates.get(record.videoUrl) || null;
      nextStates.set(record.videoUrl, record.state);
      if (record.state !== 'failed' && previousState === 'failed')
        suppressedDownloadFailureUrls.delete(record.videoUrl);

      if (!previousState || previousState === record.state) continue;

      if (record.state === 'ready') {
        options.setStatus(
          options.t('status.downloadCompleted', { title: downloadNotificationTitle(record) }),
          'success'
        );
      } else if (record.state === 'failed') {
        if (suppressedDownloadFailureUrls.has(record.videoUrl)) {
          suppressedDownloadFailureUrls.delete(record.videoUrl);
        } else {
          options.setStatus(
            options.t('status.downloadFailed', {
              title: downloadNotificationTitle(record),
              error: record.error || options.t('status.unknownError')
            }),
            'error'
          );
        }
      }
    }

    downloadNotificationStates = nextStates;
  }

  async function refreshDownloadsAfterFailure() {
    options.library.refreshDownloads().catch(function (refreshError) {
      reportRendererWorkflowError(options.api, 'download-refresh-after-failure-failed', refreshError);
    });
  }

  async function openDownloadFile(videoUrl: string) {
    if (!videoUrl || isBlocked()) return;

    try {
      await options.api.openDownloadFile(videoUrl);
      options.setStatus(options.t('status.downloadFileOpened'), 'success');
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-open-file-failed', error, { videoUrl: videoUrl });
      options.setStatus(options.t('status.downloadFileOpenFailed', { error: options.errorMessage(error) }), 'error');
      refreshDownloadsAfterFailure();
    }
  }

  async function revealDownloadFile(videoUrl: string) {
    if (!videoUrl || isBlocked()) return;

    try {
      await options.api.revealDownloadFile(videoUrl);
      options.setStatus(options.t('status.downloadFileRevealed'), 'success');
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-reveal-file-failed', error, { videoUrl: videoUrl });
      options.setStatus(options.t('status.downloadFileRevealFailed', { error: options.errorMessage(error) }), 'error');
      refreshDownloadsAfterFailure();
    }
  }

  async function downloadVideo(video: VideoRow) {
    if (!video || !video.url || isBlocked()) return;

    try {
      const result = await options.api.enqueueDownload({
        collectionKey: options.library.activeCollection.value,
        video: downloadRequestVideo(video)
      });
      options.setStatus(
        result.queued ? options.t('status.downloadQueued') : options.t('status.downloadAlreadyQueued'),
        result.queued ? 'success' : 'info'
      );
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-enqueue-failed', error, { videoUrl: video.url });
      options.setStatus(options.t('status.downloadStartFailed', { error: options.errorMessage(error) }), 'error');
    }
  }

  async function downloadSelectedVideos() {
    if (isBlocked()) return;

    const videos = options.library.selectedBatchDownloadVideos.value.slice();
    if (!videos.length) {
      options.setStatus(options.t('status.downloadBatchNoSelection'), 'info');
      return;
    }

    options.busy.value = true;
    let queued = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (const video of videos) {
        try {
          const record = downloadRecordForVideoUrl(video.url);
          const result =
            record && record.state === 'paused'
              ? await options.api.resumeDownload(record.videoUrl)
              : record && (record.state === 'failed' || record.state === 'missing')
                ? await options.api.retryDownload(record.videoUrl)
                : await options.api.enqueueDownload({
                    collectionKey: options.library.activeCollection.value,
                    video: downloadRequestVideo(video)
                  });

          if (result.queued) queued += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
          reportRendererWorkflowError(options.api, 'download-batch-item-failed', error, { videoUrl: video.url });
        }
      }

      options.library.clearBatchDownloadSelection();
      await options.library.refreshDownloads();
      options.setStatus(
        options.t('status.downloadBatchQueued', {
          queued: queued,
          skipped: skipped,
          failed: failed
        }),
        batchDownloadQueueTone({ queued: queued, failed: failed })
      );
    } finally {
      options.busy.value = false;
    }
  }

  async function retryDownload(videoUrl: string) {
    if (!videoUrl || isBlocked()) return;

    try {
      const result = await options.api.retryDownload(videoUrl);
      options.setStatus(
        result.queued ? options.t('status.downloadQueued') : options.t('status.downloadAlreadyQueued'),
        result.queued ? 'success' : 'info'
      );
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-retry-failed', error, { videoUrl: videoUrl });
      options.setStatus(options.t('status.downloadRetryFailed', { error: options.errorMessage(error) }), 'error');
    }
  }

  async function retryFailedDownloads() {
    if (isBlocked()) return;

    options.busy.value = true;
    try {
      const result = await options.api.retryFailedDownloads();
      options.setStatus(
        options.t('status.downloadBulkActionComplete', {
          affected: result.affected,
          skipped: result.skipped,
          failed: result.failed
        }),
        bulkDownloadActionTone(result)
      );
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-retry-failed-downloads-failed', error);
      options.setStatus(options.t('status.downloadRetryFailed', { error: options.errorMessage(error) }), 'error');
    } finally {
      options.busy.value = false;
    }
  }

  async function resumeDownload(videoUrl: string) {
    if (!videoUrl || isBlocked()) return;

    try {
      const result = await options.api.resumeDownload(videoUrl);
      options.setStatus(
        result.queued ? options.t('status.downloadResumed') : options.t('status.downloadAlreadyQueued'),
        result.queued ? 'success' : 'info'
      );
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-resume-failed', error, { videoUrl: videoUrl });
      options.setStatus(options.t('status.downloadResumeFailed', { error: options.errorMessage(error) }), 'error');
    }
  }

  async function pauseDownload(videoUrl: string) {
    if (!videoUrl || isBlocked()) return;

    try {
      await options.api.pauseDownload(videoUrl);
      options.setStatus(options.t('status.downloadPaused'), 'success');
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-pause-failed', error, { videoUrl: videoUrl });
      options.setStatus(options.t('status.downloadPauseFailed', { error: options.errorMessage(error) }), 'error');
    }
  }

  async function pauseAllDownloads() {
    if (isBlocked()) return;

    options.busy.value = true;
    try {
      const result = await options.api.pauseAllDownloads();
      options.setStatus(
        options.t('status.downloadBulkActionComplete', {
          affected: result.affected,
          skipped: result.skipped,
          failed: result.failed
        }),
        bulkDownloadActionTone(result)
      );
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-pause-all-failed', error);
      options.setStatus(options.t('status.downloadPauseFailed', { error: options.errorMessage(error) }), 'error');
    } finally {
      options.busy.value = false;
    }
  }

  async function resumePausedDownloads() {
    if (isBlocked()) return;

    options.busy.value = true;
    try {
      const result = await options.api.resumePausedDownloads();
      options.setStatus(
        options.t('status.downloadBulkActionComplete', {
          affected: result.affected,
          skipped: result.skipped,
          failed: result.failed
        }),
        bulkDownloadActionTone(result)
      );
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-resume-paused-failed', error);
      options.setStatus(options.t('status.downloadResumeFailed', { error: options.errorMessage(error) }), 'error');
    } finally {
      options.busy.value = false;
    }
  }

  async function cancelDownload(videoUrl: string, cancelOptions?: { ignoreBlocked?: boolean }) {
    if (!videoUrl || (!cancelOptions?.ignoreBlocked && isBlocked())) return;

    suppressedDownloadFailureUrls.add(videoUrl);
    try {
      await options.api.cancelDownload(videoUrl);
      options.setStatus(options.t('status.downloadCanceled'), 'success');
      await options.library.refreshDownloads();
    } catch (error) {
      suppressedDownloadFailureUrls.delete(videoUrl);
      reportRendererWorkflowError(options.api, 'download-cancel-failed', error, { videoUrl: videoUrl });
      options.setStatus(options.t('status.downloadCancelFailed', { error: options.errorMessage(error) }), 'error');
    }
  }

  async function cancelQueuedDownloads() {
    if (isBlocked()) return;

    options.busy.value = true;
    try {
      const queuedUrls = queuedDownloadUrls(options.library.downloadRecords.value);
      queuedUrls.forEach(function (videoUrl) {
        suppressedDownloadFailureUrls.add(videoUrl);
      });
      const result = await options.api.cancelQueuedDownloads();
      options.setStatus(
        options.t('status.downloadBulkActionComplete', {
          affected: result.affected,
          skipped: result.skipped,
          failed: result.failed
        }),
        bulkDownloadActionTone(result)
      );
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-cancel-queued-failed', error);
      options.setStatus(options.t('status.downloadCancelFailed', { error: options.errorMessage(error) }), 'error');
    } finally {
      options.busy.value = false;
    }
  }

  async function deleteDownload(videoUrl: string) {
    if (!videoUrl || isBlocked()) return;

    try {
      const result = await options.api.deleteDownload(videoUrl);
      if (result.canceled) return;
      options.setStatus(options.t('status.downloadDeleted'), 'success');
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-delete-failed', error, { videoUrl: videoUrl });
      options.setStatus(options.t('status.downloadDeleteFailed', { error: options.errorMessage(error) }), 'error');
    }
  }

  async function deleteSelectedDownloads() {
    if (isBlocked()) return;

    const videoUrls = selectedVisibleDownloadUrls();
    if (!videoUrls.length) {
      options.setStatus(options.t('status.downloadBulkNoSelection'), 'info');
      return;
    }

    options.busy.value = true;
    try {
      const result = await options.api.deleteDownloads(videoUrls);
      if (result.canceled) return;
      selectedDownloadUrls.value = selectedDownloadUrls.value.filter(function (videoUrl) {
        return videoUrls.indexOf(videoUrl) === -1;
      });
      options.setStatus(
        options.t('status.downloadBulkDeleteComplete', {
          deletedFiles: result.deletedFiles,
          removedRecords: result.removedRecords,
          skipped: result.skipped,
          failed: result.failed
        }),
        bulkDeleteActionTone(result)
      );
      await options.library.refreshDownloads();
    } catch (error) {
      reportRendererWorkflowError(options.api, 'download-delete-selected-failed', error, { videoUrls: videoUrls });
      options.setStatus(options.t('status.downloadDeleteFailed', { error: options.errorMessage(error) }), 'error');
    } finally {
      options.busy.value = false;
    }
  }

  watch(options.library.downloadRecords, function (records) {
    const selectable = new Set(
      records.filter(isDownloadDeleteSelectable).map(function (record) {
        return record.videoUrl;
      })
    );
    selectedDownloadUrls.value = selectedDownloadUrls.value.filter(function (videoUrl) {
      return selectable.has(videoUrl);
    });
  });

  return {
    selectedDownloadUrls: selectedDownloadUrls,
    applyDownloadNotifications: applyDownloadNotifications,
    openDownloadFile: openDownloadFile,
    revealDownloadFile: revealDownloadFile,
    downloadRecordForVideoUrl: downloadRecordForVideoUrl,
    downloadRequestVideo: downloadRequestVideo,
    selectBatchDownloadVideos: selectBatchDownloadVideos,
    toggleDownloadRecordSelection: toggleDownloadRecordSelection,
    selectedVisibleDownloadUrls: selectedVisibleDownloadUrls,
    downloadVideo: downloadVideo,
    downloadSelectedVideos: downloadSelectedVideos,
    retryDownload: retryDownload,
    retryFailedDownloads: retryFailedDownloads,
    resumeDownload: resumeDownload,
    pauseDownload: pauseDownload,
    pauseAllDownloads: pauseAllDownloads,
    resumePausedDownloads: resumePausedDownloads,
    cancelDownload: cancelDownload,
    cancelQueuedDownloads: cancelQueuedDownloads,
    deleteDownload: deleteDownload,
    deleteSelectedDownloads: deleteSelectedDownloads
  };
}
