import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import VideoCard from './VideoCard.vue';

function makeVideo(overrides) {
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

describe('VideoCard', function () {
  it('renders the video title, URL, views, and likes', function () {
    var video = makeVideo();
    var wrapper = mount(VideoCard, {
      props: {
        video: video
      }
    });

    expect(wrapper.find('a').text()).toBe(video.title);
    expect(wrapper.find('a').attributes('href')).toBe(video.url);
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

    await wrapper.find('a').trigger('click');

    expect(wrapper.emitted('open')).toEqual([[video.url]]);
  });
});
