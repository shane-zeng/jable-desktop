import { describe, expect, it } from 'vitest';
import { recordTimeLabel } from '../../app/renderer-src/download-display';
import type { DownloadRecord } from '../../app/types/jable';

function downloadRecord(patch: Partial<DownloadRecord>): DownloadRecord {
  return {
    videoUrl: 'https://jable.tv/videos/time-label/',
    collectionKeys: [],
    title: null,
    img: null,
    preview: null,
    sourcePageChineseSubtitleNotice: false,
    sourcePageSubtitleNoticeText: null,
    localPath: null,
    state: 'paused',
    progress: null,
    fileSizeBytes: null,
    error: null,
    failurePhase: null,
    failureCode: null,
    attemptCount: 0,
    lastStartedAt: null,
    lastErrorAt: null,
    createdAt: '2026-05-18T01:00:00',
    updatedAt: '2026-05-18T03:00:00',
    completedAt: null,
    ...patch
  };
}

describe('download-display', function () {
  it('keeps downloading record time pinned to the start time', function () {
    expect(
      recordTimeLabel(
        downloadRecord({
          state: 'downloading',
          lastStartedAt: '2026-05-18T02:00:00',
          updatedAt: '2026-05-18T03:30:00'
        })
      )
    ).toBe('2026-05-18 02:00:00');
  });

  it('uses completion time for ready records and updated time for paused records', function () {
    expect(
      recordTimeLabel(
        downloadRecord({
          state: 'ready',
          completedAt: '2026-05-18T04:00:00',
          updatedAt: '2026-05-18T03:30:00'
        })
      )
    ).toBe('2026-05-18 04:00:00');

    expect(
      recordTimeLabel(
        downloadRecord({
          state: 'paused',
          updatedAt: '2026-05-18T03:30:00'
        })
      )
    ).toBe('2026-05-18 03:30:00');
  });
});
