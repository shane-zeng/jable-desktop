import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import App from '@/App.vue';
import type { DownloadRecord } from '../../../app/types/jable';
import { clickButtonByText, createAppTestApi, settle } from '../helpers/appTestUtils';

function makeDownloadRecord(index: number): DownloadRecord {
  const timestamp = new Date(Date.UTC(2026, 4, 17, 0, 0, index)).toISOString();

  return {
    videoUrl: 'https://jable.tv/videos/failed-' + index + '/',
    collectionKeys: [],
    title: 'Failed Video ' + (index + 1),
    img: null,
    preview: null,
    sourcePageChineseSubtitleNotice: false,
    sourcePageSubtitleNoticeText: null,
    localPath: null,
    state: 'failed',
    progress: null,
    playbackAutoResumeBlocked: false,
    fileSizeBytes: null,
    error: 'Segment request rejected',
    failurePhase: 'segments',
    failureCode: 'segment_http_403',
    attemptCount: index + 1,
    lastStartedAt: timestamp,
    lastErrorAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null
  };
}

async function openDownloadList(wrapper: ReturnType<typeof mount>) {
  await clickButtonByText(wrapper, '本機資料');
  await clickButtonByText(wrapper, '下載清單');
}

function dispatchKey(
  key: string,
  options?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }
) {
  window.dispatchEvent(
    new KeyboardEvent(
      'keydown',
      Object.assign(
        {
          key: key,
          bubbles: true
        },
        options || {}
      )
    )
  );
}

describe('App Download Error Log diagnostics shortcut', function () {
  afterEach(function () {
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.jableApp;
  });

  it('opens from Ctrl+Shift+E only on Download List and limits the initial records', async function () {
    window.jableApp = createAppTestApi(
      Array.from({ length: 105 }, function (_, index) {
        return makeDownloadRecord(index);
      })
    );

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

    dispatchKey('E', { ctrlKey: true, shiftKey: true });
    await settle();
    expect(wrapper.find('[data-test="download-error-log-modal"]').exists()).toBe(false);

    await openDownloadList(wrapper);
    expect(wrapper.find('[data-test="download-error-log"]').exists()).toBe(false);

    dispatchKey('E', { ctrlKey: true, shiftKey: true });
    await settle();

    expect(wrapper.find('[data-test="download-error-log-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="download-error-log-summary"]').text()).toContain('100');
    expect(wrapper.find('[data-test="download-error-log-summary"]').text()).toContain('105');
    expect(wrapper.findAll('[data-test="download-error-log-row"]')).toHaveLength(100);
    expect(wrapper.findAll('[data-test="download-error-log-row"]')[0].text()).toContain('Failed Video 105');

    await wrapper.get('[data-test="download-error-log-show-all"]').trigger('click');
    await settle();

    expect(wrapper.findAll('[data-test="download-error-log-row"]')).toHaveLength(105);

    dispatchKey('Escape');
    await settle();
    expect(wrapper.find('[data-test="download-error-log-modal"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('opens from the D L E key sequence', async function () {
    window.jableApp = createAppTestApi([makeDownloadRecord(0)]);

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

    dispatchKey('d');
    dispatchKey('l');
    dispatchKey('e');
    await settle();

    expect(wrapper.find('[data-test="download-error-log-modal"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="download-error-log-row"]')).toHaveLength(1);

    wrapper.unmount();
  });
});
