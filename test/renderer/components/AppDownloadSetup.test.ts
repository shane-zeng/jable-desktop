import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App.vue';
import type { FfmpegStatus } from '../../../app/types/jable';
import { clickButtonByText, createAppTestApi, settle } from '../helpers/appTestUtils';

const missingFfmpegStatus: FfmpegStatus = {
  state: 'missing',
  source: null,
  path: null,
  version: null,
  error: null
};

async function openDownloadList(wrapper: ReturnType<typeof mount>) {
  await clickButtonByText(wrapper, '本機資料');
  await clickButtonByText(wrapper, '下載清單');
}

describe('App download setup actions', function () {
  afterEach(function () {
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.jableApp;
  });

  it('routes the FFmpeg setup CTAs through the preload API', async function () {
    const api = createAppTestApi([]);
    api.getFfmpegStatus = vi.fn().mockResolvedValue(missingFfmpegStatus);
    api.refreshFfmpegStatus = vi.fn().mockResolvedValue(missingFfmpegStatus);
    api.chooseFfmpegPath = vi.fn().mockResolvedValue(Object.assign({ canceled: false }, missingFfmpegStatus));
    api.openFfmpegGuide = vi.fn().mockResolvedValue({
      opened: true,
      url: 'https://example.test/ffmpeg'
    });
    window.jableApp = api;

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
    await openDownloadList(wrapper);

    await wrapper.get('[data-test="download-list-refresh-ffmpeg"]').trigger('click');
    await settle();
    await wrapper.get('[data-test="download-list-choose-ffmpeg"]').trigger('click');
    await settle();
    await wrapper.get('[data-test="download-list-open-ffmpeg-guide"]').trigger('click');
    await settle();

    expect(api.refreshFfmpegStatus).toHaveBeenCalledTimes(1);
    expect(api.chooseFfmpegPath).toHaveBeenCalledTimes(1);
    expect(api.openFfmpegGuide).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
