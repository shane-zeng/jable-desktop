import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App.vue';
import type { DownloadRecord, VideoRow } from '../../../app/types/jable';
import { clickButtonByText, createAppTestApi, settle } from '../helpers/appTestUtils';

const originalScrollIntoView = Element.prototype.scrollIntoView;

function makeVideo(): VideoRow {
  return {
    title: 'Ready Source Video',
    url: 'https://jable.tv/videos/ready-source/',
    views: 1,
    likes: 2,
    img: null,
    preview: null,
    last_seen_at: '2026-05-18T00:00:00.000Z'
  };
}

function makeDownloadRecord(video: VideoRow): DownloadRecord {
  return {
    videoUrl: video.url,
    collectionKeys: ['favourites'],
    title: video.title,
    img: video.img,
    preview: video.preview,
    sourcePageChineseSubtitleNotice: false,
    sourcePageSubtitleNoticeText: null,
    downloadSource: 'normal',
    localPath: 'Ready Source Video.mp4',
    state: 'ready',
    progress: 1,
    playbackAutoResumeBlocked: false,
    fileSizeBytes: 1024,
    error: null,
    failurePhase: null,
    failureCode: null,
    attemptCount: 1,
    lastStartedAt: '2026-05-18T00:00:00.000Z',
    lastErrorAt: null,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    completedAt: '2026-05-18T00:00:00.000Z'
  };
}

describe('App download list locating', function () {
  afterEach(function () {
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.jableApp;
    if (typeof originalScrollIntoView === 'undefined') {
      delete (Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView;
    } else {
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView
      });
    }
    vi.restoreAllMocks();
  });

  it('jumps from a ready source card to the matching Download List card', async function () {
    const video = makeVideo();
    const api = createAppTestApi([makeDownloadRecord(video)], {
      downloadStateFilters: ['failed']
    });
    api.countVideos = vi.fn().mockResolvedValue(1);
    api.listVideos = vi.fn().mockResolvedValue([video]);
    window.jableApp = api;
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });

    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          BrowserPanel: true,
          SettingsPanel: true
        }
      }
    });
    await settle();
    await clickButtonByText(wrapper, '本機資料');

    const sourceDownloadButton = wrapper.get('[data-test="video-download"]');
    expect(sourceDownloadButton.text()).toBe('查看下載');

    await sourceDownloadButton.trigger('click');
    await settle();

    const locatedCard = wrapper.get('[data-test="download-record-card"]');
    expect(locatedCard.text()).toContain('Ready Source Video');
    expect(locatedCard.classes()).toContain('download-card-located');
    expect(wrapper.get('[data-test="download-state-filters"] summary').text()).toContain('全部狀態');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(api.updateSettings).not.toHaveBeenCalledWith({ downloadStateFilters: ['all'] });

    wrapper.unmount();
  });
});
