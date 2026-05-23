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

  it('routes maintenance settings actions through the preload API', async function () {
    const api = createAppTestApi([]);
    api.openLogFolder = vi.fn().mockResolvedValue({
      opened: true,
      path: '/tmp/jable/logs'
    });
    api.clearBrowserCache = vi
      .fn()
      .mockResolvedValueOnce({ cleared: true })
      .mockRejectedValueOnce(new Error('cache locked'));
    api.clearDiagnostics = vi
      .fn()
      .mockResolvedValueOnce({
        canceled: true,
        deletedFiles: 0,
        failedFiles: 0
      })
      .mockResolvedValueOnce({
        canceled: false,
        deletedFiles: 2,
        failedFiles: 1
      })
      .mockRejectedValueOnce(new Error('locked'));
    api.reportRendererError = vi.fn();
    window.jableApp = api;

    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          BrowserPanel: true
        }
      }
    });
    await settle();
    await clickButtonByText(wrapper, '設定');

    await wrapper.get('[data-test="settings-open-log-folder"]').trigger('click');
    await settle();
    expect(api.openLogFolder).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('已開啟 Log 資料夾');

    await wrapper.get('[data-test="settings-clear-browser-cache"]').trigger('click');
    await settle();
    expect(api.clearBrowserCache).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('已清除瀏覽器快取');

    await wrapper.get('[data-test="settings-clear-browser-cache"]').trigger('click');
    await settle();
    expect(api.reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'clear-browser-cache-failed'
      })
    );
    expect(wrapper.text()).toContain('清除瀏覽器快取失敗：cache locked');

    await wrapper.get('[data-test="settings-clear-diagnostics"]').trigger('click');
    await settle();
    expect(wrapper.text()).toContain('已取消清除診斷紀錄');

    await wrapper.get('[data-test="settings-clear-diagnostics"]').trigger('click');
    await settle();
    expect(wrapper.text()).toContain('已清除 2 個診斷檔案，1 個檔案暫時無法刪除');

    await wrapper.get('[data-test="settings-clear-diagnostics"]').trigger('click');
    await settle();
    expect(api.reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'clear-diagnostics-failed'
      })
    );
    expect(wrapper.text()).toContain('清除診斷紀錄失敗：locked');

    wrapper.unmount();
  });
});
