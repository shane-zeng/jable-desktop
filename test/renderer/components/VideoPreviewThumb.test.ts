import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPreviewThumb from '@/components/VideoPreviewThumb.vue';
import { setLocale } from '@/i18n';

const originalPlatform = window.navigator.platform;
const originalPlay = HTMLMediaElement.prototype.play;
const originalPause = HTMLMediaElement.prototype.pause;

function setNavigatorPlatform(value: string) {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: value
  });
}

function mountThumb(overrides?: Partial<InstanceType<typeof VideoPreviewThumb>['$props']>) {
  return mount(VideoPreviewThumb, {
    props: Object.assign(
      {
        href: 'https://example.test/videos/sample/',
        title: 'Sample Video',
        img: 'https://example.test/sample.jpg',
        preview: 'https://example.test/sample.mp4',
        dataTest: 'video-preview-thumb'
      },
      overrides || {}
    )
  });
}

describe('VideoPreviewThumb', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
    HTMLMediaElement.prototype.play = vi.fn(function () {
      return Promise.resolve();
    });
    HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(function () {
    setNavigatorPlatform(originalPlatform);
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLMediaElement.prototype.pause = originalPause;
    vi.restoreAllMocks();
  });

  it('renders the thumbnail link with image, fallback metadata, and preview video', function () {
    const wrapper = mountThumb();
    const link = wrapper.get('[data-test="video-preview-thumb"]');

    expect(link.attributes('href')).toBe('https://example.test/videos/sample/');
    expect(link.attributes('aria-label')).toBe('開啟影片：Sample Video');
    expect(wrapper.get('img').attributes('src')).toBe('https://example.test/sample.jpg');
    expect(wrapper.get('video').attributes('preload')).toBe('none');
  });

  it('renders a fallback thumbnail when no image or preview is available', function () {
    const wrapper = mountThumb({ img: null, preview: null });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('video').exists()).toBe(false);
    expect(wrapper.get('a > div').classes()).toContain('bg-[var(--thumb-bg)]');
  });

  it('lazy-loads, plays, pauses, and resets the preview video on hover', async function () {
    const wrapper = mountThumb();
    const link = wrapper.get('[data-test="video-preview-thumb"]');
    const video = wrapper.get('video').element as HTMLVideoElement;

    expect(video.getAttribute('src')).toBeNull();

    await link.trigger('pointerenter');

    expect(video.getAttribute('src')).toBe('https://example.test/sample.mp4');
    expect(video.classList.contains('active')).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    video.currentTime = 12;
    await link.trigger('pointerleave');

    expect(video.classList.contains('active')).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(0);
  });

  it('emits open for a regular click', async function () {
    const wrapper = mountThumb();

    await wrapper.get('[data-test="video-preview-thumb"]').trigger('click');

    expect(wrapper.emitted('open')).toEqual([['https://example.test/videos/sample/']]);
    expect(wrapper.emitted('open-new')).toBeUndefined();
  });

  it('emits open-new for command and middle click gestures', async function () {
    setNavigatorPlatform('MacIntel');
    const wrapper = mountThumb();
    const link = wrapper.get('[data-test="video-preview-thumb"]');

    await link.trigger('click', { metaKey: true });
    await link.trigger('auxclick', { button: 1 });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toEqual([
      ['https://example.test/videos/sample/'],
      ['https://example.test/videos/sample/']
    ]);
  });

  it('keeps macOS control click reserved for the context menu gesture', async function () {
    setNavigatorPlatform('MacIntel');
    const wrapper = mountThumb();

    await wrapper.get('[data-test="video-preview-thumb"]').trigger('click', { ctrlKey: true });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toBeUndefined();
  });

  it('emits open-new for control click off macOS', async function () {
    setNavigatorPlatform('Win32');
    const wrapper = mountThumb();

    await wrapper.get('[data-test="video-preview-thumb"]').trigger('click', { ctrlKey: true });

    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toEqual([['https://example.test/videos/sample/']]);
  });

  it('can disable new-tab gestures for thumbnail targets that do not support them', async function () {
    setNavigatorPlatform('Win32');
    const wrapper = mountThumb({ openNewGestures: false });
    const link = wrapper.get('[data-test="video-preview-thumb"]');

    await link.trigger('click', { ctrlKey: true });
    await link.trigger('auxclick', { button: 1 });

    expect(wrapper.emitted('open')).toEqual([['https://example.test/videos/sample/']]);
    expect(wrapper.emitted('open-new')).toBeUndefined();
  });

  it('does not open when disabled while preserving hover preview playback', async function () {
    const wrapper = mountThumb({ disabled: true });
    const link = wrapper.get('[data-test="video-preview-thumb"]');
    const video = wrapper.get('video').element as HTMLVideoElement;

    await link.trigger('click');
    await link.trigger('pointerenter');

    expect(link.attributes('aria-disabled')).toBe('true');
    expect(wrapper.emitted('open')).toBeUndefined();
    expect(wrapper.emitted('open-new')).toBeUndefined();
    expect(video.getAttribute('src')).toBe('https://example.test/sample.mp4');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
});
