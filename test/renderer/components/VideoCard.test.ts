import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import VideoCard from '@/components/VideoCard.vue';
import { setLocale } from '@/i18n';
import type { DownloadRecord, VideoRow } from '../../../app/types/jable';

const originalPlatform = window.navigator.platform;

function makeVideo(overrides?: Partial<VideoRow>): VideoRow {
  return Object.assign(
    {
      title: 'Sample Video',
      url: 'https://example.test/videos/sample/',
      img: 'https://example.test/sample.jpg',
      preview: 'https://example.test/sample.mp4',
      views: 1234,
      likes: 56,
      last_seen_at: '2026-05-12T08:00:00.000Z'
    },
    overrides || {}
  );
}

function makeDownloadRecord(video: VideoRow, overrides?: Partial<DownloadRecord>): DownloadRecord {
  return Object.assign(
    {
      videoUrl: video.url,
      collectionKey: 'favourites',
      title: video.title,
      img: video.img,
      localPath: '/tmp/sample.mp4',
      state: 'ready',
      progress: null,
      fileSizeBytes: 1024,
      error: null,
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      completedAt: '2026-05-16T00:00:00.000Z'
    },
    overrides || {}
  );
}

function setNavigatorPlatform(value: string) {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: value
  });
}

describe('VideoCard', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  afterEach(function () {
    setNavigatorPlatform(originalPlatform);
  });

  it('renders the video title, URL, views, and likes', function () {
    const video = makeVideo({ img: null, preview: null });
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    expect(wrapper.find('[data-test="video-title-link"]').text()).toBe(video.title);
    expect(wrapper.find('[data-test="video-title-link"]').attributes('href')).toBe(video.url);
    expect(wrapper.find('[data-test="video-views-value"]').text()).toBe(Number(video.views).toLocaleString('zh-TW'));
    expect(wrapper.find('[data-test="video-likes-value"]').text()).toBe(Number(video.likes).toLocaleString('zh-TW'));
    expect(
      wrapper.findAll('[data-test$="-label"]').map(function (label) {
        return label.text();
      })
    ).toEqual(['views', 'likes']);
  });

  it('emits open with the video URL when the title link is clicked', async function () {
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-title-link"]').trigger('click');

    expect(wrapper.emitted('open')).toEqual([[video.url]]);
  });

  it('emits open with the video URL when the cover is clicked', async function () {
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-thumb-link"]').trigger('click');

    expect(wrapper.emitted('open')).toEqual([[video.url]]);
  });

  it('emits open-new with the video URL when a link is command clicked', async function () {
    setNavigatorPlatform('MacIntel');
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-thumb-link"]').trigger('click', { metaKey: true });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toEqual([[video.url]]);
  });

  it('emits open-new with the video URL when a link is middle clicked', async function () {
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-title-link"]').trigger('auxclick', { button: 1 });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toEqual([[video.url]]);
  });

  it('does not treat control click as a new tab gesture on macOS', async function () {
    setNavigatorPlatform('MacIntel');
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-thumb-link"]').trigger('click', { ctrlKey: true });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toBeUndefined();
  });

  it('emits open-new with the video URL when a link is control clicked off macOS', async function () {
    setNavigatorPlatform('Win32');
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-thumb-link"]').trigger('click', { ctrlKey: true });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toEqual([[video.url]]);
  });

  it('emits context-menu with video details and pointer coordinates', async function () {
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('article').trigger('contextmenu', {
      clientX: 12,
      clientY: 34
    });

    expect(wrapper.emitted('context-menu')).toEqual([
      [
        {
          url: video.url,
          title: video.title,
          x: 12,
          y: 34
        }
      ]
    ]);
  });

  it('emits download with the video row when the download button is clicked', async function () {
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.get('[data-test="video-download"]').trigger('click');

    expect(wrapper.emitted('download')).toEqual([[video]]);
    expect(wrapper.emitted('open')).toBeUndefined();
  });

  it('shows completed downloads as disabled on the source card', async function () {
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video,
        downloadRecord: makeDownloadRecord(video)
      }
    });
    const button = wrapper.get('[data-test="video-download"]');

    expect(button.text()).toBe('已下載');
    expect((button.element as HTMLButtonElement).disabled).toBe(true);

    await button.trigger('click');

    expect(wrapper.emitted('download')).toBeUndefined();
  });

  it('allows failed downloads to be retried from the source card', async function () {
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video,
        downloadRecord: makeDownloadRecord(video, {
          state: 'failed',
          completedAt: null,
          error: 'HTTP 403'
        })
      }
    });
    const button = wrapper.get('[data-test="video-download"]');

    expect(button.text()).toBe('重試');
    expect((button.element as HTMLButtonElement).disabled).toBe(false);

    await button.trigger('click');

    expect(wrapper.emitted('download')).toEqual([[video]]);
  });

  it('renders English aria labels and sync metadata', function () {
    setLocale('en-US', false);
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    expect(wrapper.find('[data-test="video-thumb-link"]').attributes('aria-label')).toBe('Open video: Sample Video');
    expect(wrapper.text()).toContain('Synced');
  });

  it('renders Japanese aria labels, metadata labels, and locale-formatted sync date', function () {
    setLocale('ja-JP', false);
    const video = makeVideo();
    const wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });
    const syncedAt = new Date(video.last_seen_at || '').toLocaleString('ja-JP');

    expect(wrapper.find('[data-test="video-thumb-link"]').attributes('aria-label')).toBe('動画を開く: Sample Video');
    expect(wrapper.text()).toContain(Number(video.views).toLocaleString('ja-JP'));
    expect(wrapper.text()).toContain(Number(video.likes).toLocaleString('ja-JP'));
    expect(wrapper.text()).toContain('同期 ' + syncedAt);
    expect(
      wrapper.findAll('[data-test$="-label"]').map(function (label) {
        return label.text();
      })
    ).toEqual(['再生', 'いいね']);
  });
});
