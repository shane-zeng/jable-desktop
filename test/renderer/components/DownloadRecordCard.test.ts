import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import DownloadRecordCard from '@/components/DownloadRecordCard.vue';
import { setLocale } from '@/i18n';
import type { DownloadRecord, DownloadState } from '../../../app/types/jable';

function makeDownloadRecord(overrides: Partial<DownloadRecord>): DownloadRecord {
  return Object.assign(
    {
      videoUrl: 'https://jable.tv/videos/default/',
      collectionKeys: ['favourites'],
      title: 'Default Video',
      img: null,
      preview: null,
      sourcePageChineseSubtitleNotice: false,
      sourcePageSubtitleNoticeText: null,
      downloadSource: 'normal',
      localPath: '/tmp/default.mp4',
      state: 'ready',
      progress: null,
      playbackAutoResumeBlocked: false,
      fileSizeBytes: 1024,
      error: null,
      failurePhase: null,
      failureCode: null,
      attemptCount: 0,
      lastStartedAt: '2026-05-18T00:00:00.000Z',
      lastErrorAt: null,
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
      completedAt: '2026-05-18T00:00:00.000Z'
    },
    overrides
  );
}

describe('DownloadRecordCard', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('uses semantic visual classes for each download state', function () {
    const cases: Array<{
      state: DownloadState;
      stateClass: string;
      progressClass: string;
      progress: number | null;
      error: string | null;
    }> = [
      {
        state: 'ready',
        stateClass: 'download-state-ready',
        progressClass: 'download-progress-ready',
        progress: null,
        error: null
      },
      {
        state: 'failed',
        stateClass: 'download-state-failed',
        progressClass: 'download-progress-failed',
        progress: null,
        error: 'HTTP 403'
      },
      {
        state: 'missing',
        stateClass: 'download-state-failed',
        progressClass: 'download-progress-failed',
        progress: null,
        error: 'File removed'
      },
      {
        state: 'queued',
        stateClass: 'download-state-muted',
        progressClass: 'download-progress-muted',
        progress: null,
        error: null
      },
      {
        state: 'downloading',
        stateClass: 'download-state-downloading',
        progressClass: 'download-progress-downloading',
        progress: 0.52,
        error: null
      },
      {
        state: 'paused',
        stateClass: 'download-state-paused',
        progressClass: 'download-progress-paused',
        progress: null,
        error: 'Paused'
      }
    ];

    for (const testCase of cases) {
      const wrapper = mount(DownloadRecordCard, {
        props: {
          record: makeDownloadRecord({
            videoUrl: 'https://jable.tv/videos/' + testCase.state + '/',
            title: testCase.state + ' video',
            state: testCase.state,
            progress: testCase.progress,
            error: testCase.error,
            completedAt: testCase.state === 'ready' ? '2026-05-18T00:00:00.000Z' : null
          })
        }
      });

      expect(wrapper.get('[data-test="download-record-state"]').classes()).toContain(testCase.stateClass);
      expect(wrapper.get('[data-test="download-record-progress-fill"]').classes()).toContain(testCase.progressClass);

      wrapper.unmount();
    }
  });

  it('does not reserve an empty collection badge row before the subtitle badge', function () {
    const wrapper = mount(DownloadRecordCard, {
      props: {
        record: makeDownloadRecord({
          collectionKeys: [],
          sourcePageChineseSubtitleNotice: true,
          sourcePageSubtitleNoticeText: '此作品曾在本站上傳，現已更新至中文字幕版。'
        })
      }
    });

    expect(wrapper.find('[data-test="download-record-collection-list"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="download-record-subtitle-badge"]').text()).toBe('中文字幕');
  });

  it('keeps the video URL available for download-list scrolling', function () {
    const record = makeDownloadRecord({
      videoUrl: 'https://jable.tv/videos/located/'
    });
    const wrapper = mount(DownloadRecordCard, {
      props: {
        record: record
      }
    });
    const card = wrapper.get('[data-test="download-record-card"]');

    expect(card.attributes('data-video-url')).toBe(record.videoUrl);
  });

  it('marks playback auto records and animates the formal download transition', async function () {
    const playbackRecord = makeDownloadRecord({
      downloadSource: 'playback_auto',
      state: 'queued',
      completedAt: null
    });
    const wrapper = mount(DownloadRecordCard, {
      props: {
        record: playbackRecord
      }
    });

    expect(wrapper.get('[data-test="download-record-card"]').classes()).toContain('download-card-playback-auto');

    await wrapper.setProps({
      record: Object.assign({}, playbackRecord, { downloadSource: 'normal' })
    });

    const cardClasses = wrapper.get('[data-test="download-record-card"]').classes();
    expect(cardClasses).not.toContain('download-card-playback-auto');
    expect(cardClasses).toContain('download-card-formalizing');

    wrapper.unmount();
  });
});
