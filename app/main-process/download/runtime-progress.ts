'use strict';

export type DownloadRuntimeProgressRecord = {
  downloadedBytes: number | null;
  downloadSpeedBytesPerSecond: number | null;
};

type DownloadRuntimeProgressState = DownloadRuntimeProgressRecord & {
  lastBytes: number | null;
  lastSampledAt: number | null;
  lastNotifiedAt: number | null;
};

export type DownloadRuntimeProgressController = {
  clear(videoUrl: string): void;
  get(videoUrl: string): DownloadRuntimeProgressRecord | null;
  update(videoUrl: string, downloadedBytes: number): void;
};

type DownloadRuntimeProgressControllerOptions = {
  notifyDownloadsChanged(): void;
  progressNotifyIntervalMs: number;
};

export function createDownloadRuntimeProgressController(
  options: DownloadRuntimeProgressControllerOptions
): DownloadRuntimeProgressController {
  const progressByVideoUrl = new Map<string, DownloadRuntimeProgressState>();

  function clear(videoUrl: string) {
    progressByVideoUrl.delete(videoUrl);
  }

  function get(videoUrl: string): DownloadRuntimeProgressRecord | null {
    const progress = progressByVideoUrl.get(videoUrl);
    if (!progress) return null;

    return {
      downloadedBytes: progress.downloadedBytes,
      downloadSpeedBytesPerSecond: progress.downloadSpeedBytesPerSecond
    };
  }

  function update(videoUrl: string, downloadedBytes: number) {
    if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0) return;

    const now = Date.now();
    const current = progressByVideoUrl.get(videoUrl) || {
      downloadedBytes: null,
      downloadSpeedBytesPerSecond: null,
      lastBytes: null,
      lastSampledAt: null,
      lastNotifiedAt: null
    };
    const nextDownloadedBytes =
      typeof current.downloadedBytes === 'number'
        ? Math.max(downloadedBytes, current.downloadedBytes)
        : downloadedBytes;
    let speedBytesPerSecond = current.downloadSpeedBytesPerSecond;
    let lastBytes = current.lastBytes;
    let lastSampledAt = current.lastSampledAt;
    const shouldNotify =
      current.lastNotifiedAt === null || now - current.lastNotifiedAt >= options.progressNotifyIntervalMs;

    if (shouldNotify) {
      if (
        typeof current.lastBytes === 'number' &&
        typeof current.lastSampledAt === 'number' &&
        nextDownloadedBytes >= current.lastBytes &&
        now > current.lastSampledAt
      ) {
        speedBytesPerSecond = Math.round(
          ((nextDownloadedBytes - current.lastBytes) * 1000) / (now - current.lastSampledAt)
        );
      }
      lastBytes = nextDownloadedBytes;
      lastSampledAt = now;
    }

    progressByVideoUrl.set(videoUrl, {
      downloadedBytes: nextDownloadedBytes,
      downloadSpeedBytesPerSecond: speedBytesPerSecond,
      lastBytes: lastBytes,
      lastSampledAt: lastSampledAt,
      lastNotifiedAt: shouldNotify ? now : current.lastNotifiedAt
    });

    if (shouldNotify) options.notifyDownloadsChanged();
  }

  return {
    clear: clear,
    get: get,
    update: update
  };
}
