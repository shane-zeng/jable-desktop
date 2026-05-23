import { describe, expect, it, vi } from 'vitest';
import { computed, effectScope, ref } from 'vue';
import { useDownloadWorkflow } from '@/composables/useDownloadWorkflow';
import type { CollectionKey, DownloadRecord, JableAppApi, VideoRow } from '../../../app/types/jable';

function makeVideo(index: number): VideoRow {
  return {
    title: 'Video ' + index,
    url: 'https://jable.tv/videos/video-' + index + '/',
    views: null,
    likes: null,
    img: null,
    preview: null
  };
}

function makeDownloadRecord(overrides: Partial<DownloadRecord>): DownloadRecord {
  return Object.assign(
    {
      videoUrl: 'https://jable.tv/videos/default/',
      collectionKeys: [],
      title: 'Default Video',
      img: null,
      preview: null,
      sourcePageChineseSubtitleNotice: false,
      sourcePageSubtitleNoticeText: null,
      downloadSource: 'normal',
      localPath: null,
      state: 'ready',
      progress: null,
      playbackAutoResumeBlocked: false,
      fileSizeBytes: null,
      error: null,
      failurePhase: null,
      failureCode: null,
      attemptCount: 0,
      lastStartedAt: null,
      lastErrorAt: null,
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
      completedAt: null
    },
    overrides
  );
}

function createWorkflow(options: {
  records?: DownloadRecord[];
  selectedVideos?: VideoRow[];
  api?: Partial<JableAppApi>;
}) {
  const scope = effectScope();
  const downloadRecords = ref(options.records || []);
  const selectedVideos = ref(options.selectedVideos || []);
  const busy = ref(false);
  const syncing = ref(false);
  const setStatus = vi.fn(function (_text: string, _tone?: 'error' | 'warning' | 'success' | 'info') {
    return;
  });
  const api = Object.assign(
    {
      enqueueDownload: vi.fn().mockResolvedValue({ queued: true }),
      retryDownload: vi.fn().mockResolvedValue({ queued: true }),
      retryFailedDownloads: vi.fn(),
      pauseDownload: vi.fn(),
      pauseAllDownloads: vi.fn(),
      resumeDownload: vi.fn().mockResolvedValue({ queued: true }),
      resumePausedDownloads: vi.fn(),
      cancelDownload: vi.fn().mockResolvedValue({ canceled: true }),
      cancelQueuedDownloads: vi.fn(),
      openDownloadFile: vi.fn(),
      revealDownloadFile: vi.fn(),
      deleteDownload: vi.fn(),
      deleteDownloads: vi.fn(),
      reportRendererError: vi.fn()
    },
    options.api || {}
  );
  const library = {
    activeCollection: ref<CollectionKey>('favourites'),
    selectedBatchDownloadVideos: computed(function () {
      return selectedVideos.value;
    }),
    downloadRecords: downloadRecords,
    downloads: computed(function () {
      return downloadRecords.value;
    }),
    refreshDownloads: vi.fn().mockResolvedValue(undefined),
    clearBatchDownloadSelection: vi.fn(function () {
      selectedVideos.value = [];
    }),
    selectBatchDownloadVideos: vi.fn()
  };
  const workflow = scope.run(function () {
    return useDownloadWorkflow({
      api: api as unknown as JableAppApi,
      busy: busy,
      syncing: syncing,
      errorMessage: function (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      },
      library: library,
      setStatus: setStatus,
      t: function (key: string, params?: Record<string, string | number | null | undefined>) {
        return params ? key + ':' + JSON.stringify(params) : key;
      }
    });
  });

  if (!workflow) throw new Error('Failed to create download workflow');

  return {
    api: api,
    busy: busy,
    downloadRecords: downloadRecords,
    library: library,
    selectedVideos: selectedVideos,
    setStatus: setStatus,
    stop: function () {
      scope.stop();
    },
    workflow: workflow
  };
}

describe('useDownloadWorkflow', function () {
  it('queues selected videos with retry and resume paths for existing records', async function () {
    const newVideo = makeVideo(1);
    const pausedVideo = makeVideo(2);
    const failedVideo = makeVideo(3);
    const setup = createWorkflow({
      selectedVideos: [newVideo, pausedVideo, failedVideo],
      records: [
        makeDownloadRecord({ videoUrl: pausedVideo.url, state: 'paused' }),
        makeDownloadRecord({ videoUrl: failedVideo.url, state: 'failed' })
      ],
      api: {
        enqueueDownload: vi.fn().mockResolvedValue({ queued: true }),
        resumeDownload: vi.fn().mockResolvedValue({ queued: true }),
        retryDownload: vi.fn().mockResolvedValue({ queued: false })
      }
    });

    try {
      await setup.workflow.downloadSelectedVideos();

      expect(setup.api.enqueueDownload).toHaveBeenCalledWith({
        collectionKey: 'favourites',
        video: newVideo
      });
      expect(setup.api.resumeDownload).toHaveBeenCalledWith(pausedVideo.url);
      expect(setup.api.retryDownload).toHaveBeenCalledWith(failedVideo.url);
      expect(setup.library.clearBatchDownloadSelection).toHaveBeenCalled();
      expect(setup.library.refreshDownloads).toHaveBeenCalled();
      expect(setup.setStatus).toHaveBeenCalledWith(
        'status.downloadBatchQueued:{"queued":2,"skipped":1,"failed":0}',
        'success'
      );
      expect(setup.busy.value).toBe(false);
    } finally {
      setup.stop();
    }
  });

  it('deletes only selected visible records that are delete-selectable', async function () {
    const ready = makeDownloadRecord({ videoUrl: 'https://jable.tv/videos/ready/', state: 'ready' });
    const queued = makeDownloadRecord({ videoUrl: 'https://jable.tv/videos/queued/', state: 'queued' });
    const failed = makeDownloadRecord({ videoUrl: 'https://jable.tv/videos/failed/', state: 'failed' });
    const setup = createWorkflow({
      records: [ready, queued, failed],
      api: {
        deleteDownloads: vi.fn().mockResolvedValue({
          requested: 2,
          deletedFiles: 1,
          removedRecords: 2,
          skipped: 0,
          failed: 0
        })
      }
    });

    try {
      setup.workflow.toggleDownloadRecordSelection({ videoUrl: ready.videoUrl, selected: true });
      setup.workflow.toggleDownloadRecordSelection({ videoUrl: queued.videoUrl, selected: true });
      setup.workflow.toggleDownloadRecordSelection({ videoUrl: failed.videoUrl, selected: true });

      await setup.workflow.deleteSelectedDownloads();

      expect(setup.api.deleteDownloads).toHaveBeenCalledWith([ready.videoUrl, failed.videoUrl]);
      expect(setup.workflow.selectedDownloadUrls.value).toEqual([queued.videoUrl]);
      expect(setup.library.refreshDownloads).toHaveBeenCalled();
      expect(setup.setStatus).toHaveBeenCalledWith(
        'status.downloadBulkDeleteComplete:{"deletedFiles":1,"removedRecords":2,"skipped":0,"failed":0}',
        'success'
      );
      expect(setup.busy.value).toBe(false);
    } finally {
      setup.stop();
    }
  });

  it('suppresses a follow-up failed notification after canceling a download', async function () {
    const videoUrl = 'https://jable.tv/videos/cancel/';
    const setup = createWorkflow({
      records: [makeDownloadRecord({ videoUrl: videoUrl, state: 'downloading' })]
    });

    try {
      setup.workflow.applyDownloadNotifications([makeDownloadRecord({ videoUrl: videoUrl, state: 'downloading' })]);
      await setup.workflow.cancelDownload(videoUrl);
      setup.workflow.applyDownloadNotifications([
        makeDownloadRecord({
          videoUrl: videoUrl,
          state: 'failed',
          error: 'Canceled'
        })
      ]);

      expect(setup.api.cancelDownload).toHaveBeenCalledWith(videoUrl);
      expect(setup.setStatus).toHaveBeenCalledWith('status.downloadCanceled', 'success');
      expect(
        setup.setStatus.mock.calls.some(function (call) {
          return String(call[0]).indexOf('status.downloadFailed') !== -1;
        })
      ).toBe(false);
    } finally {
      setup.stop();
    }
  });

  it('reports handled download workflow failures through diagnostics', async function () {
    const videoUrl = 'https://jable.tv/videos/open-failed/';
    const setup = createWorkflow({
      api: {
        openDownloadFile: vi.fn().mockRejectedValue(new Error('file locked'))
      }
    });

    try {
      await setup.workflow.openDownloadFile(videoUrl);

      expect(setup.api.reportRendererError).toHaveBeenCalledWith({
        level: 'error',
        event: 'download-open-file-failed',
        error: expect.objectContaining({
          name: 'Error',
          message: 'file locked'
        }),
        details: {
          videoUrl: videoUrl
        }
      });
      expect(setup.setStatus).toHaveBeenCalledWith('status.downloadFileOpenFailed:{"error":"file locked"}', 'error');
      expect(setup.library.refreshDownloads).toHaveBeenCalled();
    } finally {
      setup.stop();
    }
  });
});
