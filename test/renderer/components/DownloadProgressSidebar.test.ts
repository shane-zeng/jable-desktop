import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import DownloadProgressSidebar from '@/components/DownloadProgressSidebar.vue';
import { setLocale } from '@/i18n';
import type { DownloadRecord } from '../../../app/types/jable';

function makeRecord(patch: Partial<DownloadRecord>): DownloadRecord {
  return Object.assign(
    {
      videoUrl: 'https://jable.tv/videos/sidebar/',
      collectionKeys: [],
      title: 'Sidebar Video',
      img: null,
      preview: null,
      sourcePageChineseSubtitleNotice: false,
      sourcePageSubtitleNoticeText: null,
      downloadSource: 'normal',
      localPath: null,
      state: 'downloading',
      progress: null,
      playbackAutoResumeBlocked: false,
      fileSizeBytes: null,
      downloadedBytes: 1024,
      downloadSpeedBytesPerSecond: 512,
      error: null,
      failurePhase: null,
      failureCode: null,
      attemptCount: 0,
      lastStartedAt: '2026-05-23T09:30:00.000Z',
      lastErrorAt: null,
      createdAt: '2026-05-23T09:00:00.000Z',
      updatedAt: '2026-05-23T09:30:00.000Z',
      completedAt: null
    },
    patch
  );
}

describe('DownloadProgressSidebar', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('renders a collapsed trigger without download action buttons', async function () {
    const wrapper = mount(DownloadProgressSidebar, {
      props: {
        collapsed: true,
        records: [makeRecord({})],
        width: 320
      }
    });

    expect(wrapper.get('[data-test="download-sidebar-toggle"]').attributes('aria-label')).toBe('展開下載進度側邊欄');
    expect(wrapper.text()).toBe('‹');
    expect(wrapper.find('[data-test="download-sidebar-record"]').exists()).toBe(false);

    await wrapper.get('[data-test="download-sidebar-toggle"]').trigger('click');

    expect(wrapper.emitted('toggle')).toEqual([[]]);
    expect(wrapper.find('[data-test="download-record-pause"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="download-record-resume"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="download-record-retry"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="download-record-cancel"]').exists()).toBe(false);
  });

  it('renders compact progress rows and empty state', function () {
    const wrapper = mount(DownloadProgressSidebar, {
      props: {
        collapsed: false,
        width: 320,
        records: [
          makeRecord({
            title: 'Downloading Video',
            state: 'downloading',
            progress: null
          }),
          makeRecord({
            title: 'Failed Video',
            videoUrl: 'https://jable.tv/videos/sidebar-failed/',
            state: 'failed',
            error: 'HTTP 403'
          })
        ]
      }
    });

    const records = wrapper.findAll('[data-test="download-sidebar-record"]');
    expect(records).toHaveLength(2);
    expect(records[0].text()).toContain('Downloading Video');
    expect(records[0].get('[data-test="download-sidebar-state"]').classes()).toContain('download-state-downloading');
    expect(records[0].find('[data-test="download-sidebar-source"]').exists()).toBe(false);
    expect(records[0].get('[data-test="download-sidebar-progress-fill"]').classes()).toContain(
      'download-progress-indeterminate'
    );
    expect(records[1].get('[data-test="download-sidebar-state"]').classes()).toContain('download-state-failed');
    expect(wrapper.find('[aria-label="收合下載進度側邊欄"]').exists()).toBe(false);

    const emptyWrapper = mount(DownloadProgressSidebar, {
      props: {
        collapsed: false,
        records: [],
        width: 320
      }
    });
    expect(emptyWrapper.get('[data-test="download-sidebar-empty"]').text()).toBe('沒有進行中或最近完成的下載');
  });

  it('marks the current video and only cancels the current playback auto download', async function () {
    const currentVideoUrl = 'https://jable.tv/videos/sidebar-current/';
    const wrapper = mount(DownloadProgressSidebar, {
      props: {
        collapsed: false,
        currentPlaybackVideoUrl: currentVideoUrl,
        width: 320,
        records: [
          makeRecord({
            title: 'Other Playback',
            videoUrl: 'https://jable.tv/videos/sidebar-other/',
            downloadSource: 'playback_auto',
            state: 'downloading'
          }),
          makeRecord({
            title: 'Current Playback',
            videoUrl: currentVideoUrl,
            downloadSource: 'playback_auto',
            state: 'downloading'
          })
        ]
      }
    });

    expect(wrapper.findAll('[data-test="download-sidebar-current-video"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="download-sidebar-source"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="download-sidebar-record"]')[1].classes()).toContain(
      'download-card-current-video'
    );
    expect(wrapper.findAll('[data-test="download-sidebar-record"]')[1].classes()).toContain(
      'download-card-playback-auto'
    );
    const cancelButton = wrapper.get('[data-test="download-sidebar-current-cancel"]');
    expect(cancelButton.text()).toBe('取消');

    await cancelButton.trigger('click');

    expect(wrapper.emitted('cancel-current-playback-download')).toEqual([[currentVideoUrl]]);
  });

  it('marks current formal downloads without showing the playback auto cancel action', function () {
    const currentVideoUrl = 'https://jable.tv/videos/sidebar-current-formal/';
    const wrapper = mount(DownloadProgressSidebar, {
      props: {
        collapsed: false,
        currentPlaybackVideoUrl: currentVideoUrl,
        width: 320,
        records: [
          makeRecord({
            title: 'Current Formal',
            videoUrl: currentVideoUrl,
            downloadSource: 'normal',
            state: 'downloading'
          })
        ]
      }
    });

    expect(wrapper.get('[data-test="download-sidebar-current-video"]').text()).toBe('目前影片');
    expect(wrapper.get('[data-test="download-sidebar-record"]').classes()).toContain('download-card-current-video');
    expect(wrapper.get('[data-test="download-sidebar-record"]').classes()).not.toContain('download-card-playback-auto');
    expect(wrapper.find('[data-test="download-sidebar-source"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="download-sidebar-current-cancel"]').exists()).toBe(false);
  });

  it('uses the edge handle for resize and collapse gestures', async function () {
    const wrapper = mount(DownloadProgressSidebar, {
      props: {
        collapsed: false,
        records: [makeRecord({})],
        width: 320
      }
    });

    const handle = wrapper.get('[data-test="download-sidebar-resize"]');
    expect(handle.attributes('aria-label')).toBe('拖曳調整下載進度側邊欄寬度，點一下收合');
    expect(handle.attributes('data-width')).toBe('320');

    await handle.trigger('pointerdown', { clientX: 400 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 360 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 360 }));

    expect(wrapper.emitted('resize-width')).toEqual([
      [360, false],
      [360, true]
    ]);

    await handle.trigger('dblclick');
    expect(wrapper.emitted('reset-width')).toEqual([[]]);

    await handle.trigger('pointerdown', { clientX: 400 });
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 400 }));
    expect(wrapper.emitted('toggle')).toEqual([[]]);
  });
});
