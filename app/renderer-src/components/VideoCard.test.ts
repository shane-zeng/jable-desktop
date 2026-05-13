import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import VideoCard from './VideoCard.vue';
import type { VideoRow } from '../../types/jable';

var originalPlatform = window.navigator.platform;

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

function setNavigatorPlatform(value: string) {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: value
  });
}

describe('VideoCard', function () {
  afterEach(function () {
    setNavigatorPlatform(originalPlatform);
  });

  it('renders the video title, URL, views, and likes', function () {
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    expect(wrapper.find('[data-test="video-title-link"]').text()).toBe(video.title);
    expect(wrapper.find('[data-test="video-title-link"]').attributes('href')).toBe(video.url);
    expect(wrapper.text()).toContain(Number(video.views).toLocaleString());
    expect(wrapper.text()).toContain(Number(video.likes).toLocaleString());
  });

  it('emits open with the video URL when the title link is clicked', async function () {
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-title-link"]').trigger('click');

    expect(wrapper.emitted('open')).toEqual([[video.url]]);
  });

  it('emits open with the video URL when the cover is clicked', async function () {
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-thumb-link"]').trigger('click');

    expect(wrapper.emitted('open')).toEqual([[video.url]]);
  });

  it('emits open-new with the video URL when a link is command clicked', async function () {
    setNavigatorPlatform('MacIntel');
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-thumb-link"]').trigger('click', { metaKey: true });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toEqual([[video.url]]);
  });

  it('emits open-new with the video URL when a link is middle clicked', async function () {
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
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
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
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
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    await wrapper.find('[data-test="video-thumb-link"]').trigger('click', { ctrlKey: true });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toEqual([[video.url]]);
  });

  it('emits context-menu with video details and pointer coordinates', async function () {
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
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
});
