import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_SIDEBAR_ACTIVE_LIMIT,
  DOWNLOAD_SIDEBAR_RECENT_COMPLETED_LIMIT,
  downloadSidebarRecords,
  downloadSidebarRecordSet
} from '../../app/renderer-src/download-sidebar';
import type { DownloadRecord } from '../../app/types/jable';

function makeRecord(patch: Partial<DownloadRecord>): DownloadRecord {
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
      state: 'queued',
      progress: null,
      playbackAutoResumeBlocked: false,
      fileSizeBytes: null,
      error: null,
      failurePhase: null,
      failureCode: null,
      attemptCount: 0,
      lastStartedAt: null,
      lastErrorAt: null,
      createdAt: '2026-05-23T09:00:00.000Z',
      updatedAt: '2026-05-23T09:00:00.000Z',
      completedAt: null
    },
    patch
  );
}

describe('download-sidebar', function () {
  it('shows active download states before recent completed records', function () {
    const now = new Date('2026-05-23T10:00:00.000Z').getTime();
    const records = [
      makeRecord({
        title: 'Recent Ready',
        videoUrl: 'https://jable.tv/videos/recent-ready/',
        state: 'ready',
        completedAt: '2026-05-23T09:45:00.000Z',
        updatedAt: '2026-05-23T09:45:00.000Z'
      }),
      makeRecord({
        title: 'Failed',
        videoUrl: 'https://jable.tv/videos/failed/',
        state: 'failed',
        updatedAt: '2026-05-23T09:59:00.000Z'
      }),
      makeRecord({
        title: 'Queued',
        videoUrl: 'https://jable.tv/videos/queued/',
        state: 'queued',
        updatedAt: '2026-05-23T09:58:00.000Z'
      }),
      makeRecord({
        title: 'Downloading',
        videoUrl: 'https://jable.tv/videos/downloading/',
        state: 'downloading',
        lastStartedAt: '2026-05-23T09:30:00.000Z',
        updatedAt: '2026-05-23T09:57:00.000Z'
      }),
      makeRecord({
        title: 'Paused',
        videoUrl: 'https://jable.tv/videos/paused/',
        state: 'paused',
        updatedAt: '2026-05-23T09:56:00.000Z'
      }),
      makeRecord({
        title: 'Old Ready',
        videoUrl: 'https://jable.tv/videos/old-ready/',
        state: 'ready',
        completedAt: '2026-05-23T09:20:00.000Z',
        updatedAt: '2026-05-23T09:20:00.000Z'
      }),
      makeRecord({
        title: 'Missing',
        videoUrl: 'https://jable.tv/videos/missing/',
        state: 'missing',
        updatedAt: '2026-05-23T09:59:00.000Z'
      })
    ];

    expect(
      downloadSidebarRecords(records, now).map(function (record) {
        return record.title;
      })
    ).toEqual(['Downloading', 'Queued', 'Paused', 'Failed', 'Recent Ready']);
  });

  it('limits recently completed records and falls back to updatedAt for readiness time', function () {
    const now = new Date('2026-05-23T10:00:00.000Z').getTime();
    const records: DownloadRecord[] = [];

    for (let i = 0; i < DOWNLOAD_SIDEBAR_RECENT_COMPLETED_LIMIT + 1; i++) {
      records.push(
        makeRecord({
          title: 'Ready ' + i,
          videoUrl: 'https://jable.tv/videos/ready-' + i + '/',
          state: 'ready',
          completedAt: i === 0 ? null : '2026-05-23T09:5' + i + ':00.000Z',
          updatedAt: '2026-05-23T09:5' + i + ':00.000Z'
        })
      );
    }

    const result = downloadSidebarRecords(records, now);

    expect(result).toHaveLength(DOWNLOAD_SIDEBAR_RECENT_COMPLETED_LIMIT);
    expect(result[0].title).toBe('Ready 5');
    expect(result.map((record) => record.title)).not.toContain('Ready 0');
  });

  it('pins the current video download before other matching state records', function () {
    const now = new Date('2026-05-23T10:00:00.000Z').getTime();
    const currentVideoUrl = 'https://jable.tv/videos/current-playback/';
    const result = downloadSidebarRecords(
      [
        makeRecord({
          title: 'Newer Download',
          videoUrl: 'https://jable.tv/videos/newer-download/',
          state: 'downloading',
          downloadSource: 'normal',
          lastStartedAt: '2026-05-23T09:58:00.000Z'
        }),
        makeRecord({
          title: 'Current Formal',
          videoUrl: currentVideoUrl,
          state: 'downloading',
          downloadSource: 'normal',
          lastStartedAt: '2026-05-23T09:30:00.000Z'
        })
      ],
      now,
      currentVideoUrl
    );

    expect(result.map((record) => record.title)).toEqual(['Current Formal', 'Newer Download']);
  });

  it('pins the current recent ready record above active downloads', function () {
    const now = new Date('2026-05-23T10:00:00.000Z').getTime();
    const currentVideoUrl = 'https://jable.tv/videos/current-ready/';
    const result = downloadSidebarRecords(
      [
        makeRecord({
          title: 'Active Download',
          videoUrl: 'https://jable.tv/videos/active-download/',
          state: 'downloading',
          lastStartedAt: '2026-05-23T09:58:00.000Z'
        }),
        makeRecord({
          title: 'Current Ready',
          videoUrl: currentVideoUrl,
          state: 'ready',
          downloadSource: 'normal',
          completedAt: '2026-05-23T09:50:00.000Z',
          updatedAt: '2026-05-23T09:50:00.000Z'
        })
      ],
      now,
      currentVideoUrl
    );

    expect(result.map((record) => record.title)).toEqual(['Current Ready', 'Active Download']);
  });

  it('excludes canceled failures from the sidebar records', function () {
    const now = new Date('2026-05-23T10:00:00.000Z').getTime();
    const result = downloadSidebarRecords(
      [
        makeRecord({
          title: 'Canceled',
          videoUrl: 'https://jable.tv/videos/canceled/',
          state: 'failed',
          failureCode: 'download_canceled',
          error: '下載已取消',
          updatedAt: '2026-05-23T09:59:00.000Z'
        }),
        makeRecord({
          title: 'Real Failure',
          videoUrl: 'https://jable.tv/videos/real-failure/',
          state: 'failed',
          failureCode: 'http_error',
          error: 'HTTP 403',
          updatedAt: '2026-05-23T09:58:00.000Z'
        })
      ],
      now
    );

    expect(result.map((record) => record.title)).toEqual(['Real Failure']);
  });

  it('limits active records to 20 and reports the hidden active count', function () {
    const now = new Date('2026-05-23T10:00:00.000Z').getTime();
    const records: DownloadRecord[] = [];

    for (let i = 0; i < DOWNLOAD_SIDEBAR_ACTIVE_LIMIT + 2; i++) {
      records.push(
        makeRecord({
          title: 'Active ' + i,
          videoUrl: 'https://jable.tv/videos/active-' + i + '/',
          state: 'queued',
          updatedAt: '2026-05-23T09:' + String(i).padStart(2, '0') + ':00.000Z'
        })
      );
    }
    records.push(
      makeRecord({
        title: 'Recent Ready',
        videoUrl: 'https://jable.tv/videos/recent-ready-with-cap/',
        state: 'ready',
        completedAt: '2026-05-23T09:59:00.000Z',
        updatedAt: '2026-05-23T09:59:00.000Z'
      })
    );

    const result = downloadSidebarRecordSet(records, now);

    expect(result.records).toHaveLength(DOWNLOAD_SIDEBAR_ACTIVE_LIMIT + 1);
    expect(result.hiddenActiveCount).toBe(2);
    expect(result.records[result.records.length - 1].title).toBe('Recent Ready');
  });

  it('pins the current playback auto record before applying the active limit', function () {
    const now = new Date('2026-05-23T10:00:00.000Z').getTime();
    const currentVideoUrl = 'https://jable.tv/videos/current-playback-cap/';
    const records: DownloadRecord[] = [];

    for (let i = 0; i < DOWNLOAD_SIDEBAR_ACTIVE_LIMIT; i++) {
      records.push(
        makeRecord({
          title: 'Newer Active ' + i,
          videoUrl: 'https://jable.tv/videos/newer-active-' + i + '/',
          state: 'downloading',
          downloadSource: 'normal',
          lastStartedAt: '2026-05-23T09:' + String(i).padStart(2, '0') + ':00.000Z'
        })
      );
    }
    records.push(
      makeRecord({
        title: 'Current Playback',
        videoUrl: currentVideoUrl,
        state: 'downloading',
        downloadSource: 'playback_auto',
        lastStartedAt: '2026-05-23T08:00:00.000Z'
      })
    );

    const result = downloadSidebarRecordSet(records, now, currentVideoUrl);

    expect(result.records).toHaveLength(DOWNLOAD_SIDEBAR_ACTIVE_LIMIT);
    expect(result.records[0].title).toBe('Current Playback');
    expect(result.hiddenActiveCount).toBe(1);
  });
});
