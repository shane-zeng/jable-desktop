import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { DOWNLOAD_ERROR_LOG_PREVIEW_LIMIT, useDownloadErrorLog } from '@/composables/useDownloadErrorLog';
import type { DownloadRecord } from '../../../app/types/jable';

function makeDownloadRecord(index: number, state: DownloadRecord['state'] = 'failed'): DownloadRecord {
  const timestamp = new Date(Date.UTC(2026, 4, 18, 0, 0, index)).toISOString();

  return {
    videoUrl: 'https://jable.tv/videos/error-' + index + '/',
    collectionKeys: [],
    title: 'Error Video ' + index,
    img: null,
    preview: null,
    sourcePageChineseSubtitleNotice: false,
    sourcePageSubtitleNoticeText: null,
    downloadSource: 'normal',
    localPath: null,
    state: state,
    progress: null,
    playbackAutoResumeBlocked: false,
    fileSizeBytes: null,
    error: 'Segment request rejected',
    failurePhase: 'segments',
    failureCode: 'segment_http_403',
    attemptCount: index,
    lastStartedAt: timestamp,
    lastErrorAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null
  };
}

function createErrorLog(records: DownloadRecord[], available = true) {
  const scope = effectScope();
  const sourceRecords = ref(records);
  const isAvailable = vi.fn(function () {
    return available;
  });
  const state = scope.run(function () {
    return useDownloadErrorLog({
      records: sourceRecords,
      isAvailable: isAvailable
    });
  });

  if (!state) throw new Error('Failed to create download error log');

  return {
    isAvailable: isAvailable,
    records: sourceRecords,
    state: state,
    stop: function () {
      state.unregisterShortcut();
      scope.stop();
    }
  };
}

function dispatchKey(
  key: string,
  options?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; target?: HTMLElement }
) {
  const event = new KeyboardEvent(
    'keydown',
    Object.assign(
      {
        key: key,
        bubbles: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false
      },
      options || {}
    )
  );

  const target = options && options.target ? options.target : window;
  target.dispatchEvent(event);
}

describe('useDownloadErrorLog', function () {
  it('sorts failed records by newest error time and limits the preview', function () {
    const setup = createErrorLog(
      Array.from({ length: 105 }, function (_, index) {
        return makeDownloadRecord(index);
      })
    );

    try {
      expect(setup.state.records.value).toHaveLength(DOWNLOAD_ERROR_LOG_PREVIEW_LIMIT);
      expect(setup.state.total.value).toBe(105);
      expect(setup.state.shown.value).toBe(DOWNLOAD_ERROR_LOG_PREVIEW_LIMIT);
      expect(setup.state.canShowAll.value).toBe(true);
      expect(setup.state.records.value[0].title).toBe('Error Video 104');

      setup.state.toggleShowAll();

      expect(setup.state.records.value).toHaveLength(105);
      expect(setup.state.shown.value).toBe(105);
    } finally {
      setup.stop();
    }
  });

  it('opens only when the download log is available', function () {
    const blocked = createErrorLog([makeDownloadRecord(1)], false);
    const available = createErrorLog([makeDownloadRecord(1)], true);

    try {
      blocked.state.open();
      available.state.open();

      expect(blocked.state.show.value).toBe(false);
      expect(available.state.show.value).toBe(true);
    } finally {
      blocked.stop();
      available.stop();
    }
  });

  it('handles Ctrl+Shift+E, the D L E sequence, editable targets, and Escape close', function () {
    const setup = createErrorLog([makeDownloadRecord(1)]);
    const input = document.createElement('input');
    document.body.appendChild(input);

    try {
      setup.state.registerShortcut();

      dispatchKey('d', { target: input });
      dispatchKey('l');
      dispatchKey('e');
      expect(setup.state.show.value).toBe(false);

      dispatchKey('E', { ctrlKey: true, shiftKey: true });
      expect(setup.state.show.value).toBe(true);

      dispatchKey('Escape');
      expect(setup.state.show.value).toBe(false);

      dispatchKey('d');
      dispatchKey('l');
      dispatchKey('e');
      expect(setup.state.show.value).toBe(true);
    } finally {
      input.remove();
      setup.stop();
    }
  });
});
