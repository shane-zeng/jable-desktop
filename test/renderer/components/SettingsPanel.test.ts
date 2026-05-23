import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SettingsPanel from '@/components/SettingsPanel.vue';
import { setLocale } from '@/i18n';
import type { AppPlatform, AppSettings, ExportResource } from '../../../app/types/jable';

const settings: AppSettings = {
  maxBrowserTabs: 22,
  browserTabsMode: 'compact',
  compactBrowserTabs: true,
  restoreBrowserTabsOnStartup: false,
  webViewEnhancementMode: false,
  fullSyncAjaxWindowSize: 5,
  autoReplayDeferredSyncOperations: false,
  ffmpegPath: null,
  autoDownloadOnPlayback: false,
  downloadSidebarEnabled: false,
  downloadRoot: null,
  downloadStateFilters: ['all'],
  downloadSpeedMode: 'balanced',
  maxConcurrentDownloads: 1
};

function mountPanel(
  overrides?: Partial<AppSettings>,
  databasePath: string | null = '/tmp/jable-favourites.sqlite',
  platform: AppPlatform | null = 'macos',
  appVersion: string | null = '0.12.4'
) {
  return mount(SettingsPanel, {
    attachTo: document.body,
    props: {
      active: true,
      busy: false,
      databasePath: databasePath,
      platform: platform,
      appVersion: appVersion,
      ffmpegStatus: {
        state: 'missing',
        source: null,
        path: null,
        version: null,
        error: null
      },
      downloadRoot: {
        source: 'default',
        path: '/tmp/jable-downloads',
        exists: false
      },
      settings: Object.assign({}, settings, overrides || {})
    }
  });
}

async function selectImportFile(wrapper: ReturnType<typeof mount>, resource: ExportResource, filename: string) {
  const input = wrapper.get('[data-test="settings-import-file"]').element as HTMLInputElement;
  const file = new File([JSON.stringify(resource)], filename, { type: 'application/json' });

  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file]
  });

  await wrapper.get('[data-test="settings-import-file"]').trigger('change');
  await flushPromises();
}

describe('SettingsPanel', function () {
  afterEach(function () {
    document.body.innerHTML = '';
  });

  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('renders settings sections and emits user preference updates', async function () {
    const wrapper = mountPanel();

    expect(wrapper.text()).toContain('一般');
    expect(wrapper.text()).toContain('瀏覽器');
    expect(wrapper.text()).toContain('分頁列顯示方式');
    expect(wrapper.text()).toContain('記住開啟的分頁');
    expect(wrapper.text()).toContain('WebView 增強模式');
    expect(wrapper.text()).toContain('快捷鍵');
    expect(wrapper.text()).toContain('新增瀏覽器分頁');
    expect(wrapper.text()).toContain('同步');
    expect(wrapper.text()).toContain('下載');
    expect(wrapper.text()).toContain('下載位置');
    expect(wrapper.text()).toContain('最多同時下載數');
    expect(wrapper.text()).toContain('下載速度模式');
    expect(wrapper.text()).toContain('播放時自動下載');
    expect(wrapper.text()).toContain('瀏覽器下載進度側邊欄');
    expect(wrapper.text()).toContain('資料');
    expect(wrapper.text()).toContain('診斷紀錄');
    expect(wrapper.text()).toContain('保留 14 天');
    expect(wrapper.text()).toContain('版本');
    expect(wrapper.get('[data-test="settings-app-version"]').text()).toBe('0.12.4');
    expect(wrapper.text()).toContain('檢查更新');
    expect(wrapper.find('[data-test="settings-max-tabs-warning"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="settings-speed-fast"]').classes()).toContain('is-active');
    expect(wrapper.get('[data-test="settings-browser-tabs-mode-compact"]').classes()).toContain('is-active');
    expect(wrapper.text()).toContain('403、429');

    await wrapper.get('[data-test="settings-check-updates"]').trigger('click');
    expect(wrapper.emitted('check-updates')).toEqual([[]]);

    await wrapper.get('[data-test="settings-open-data-folder"]').trigger('click');
    expect(wrapper.emitted('open-data-folder')).toEqual([[]]);

    await wrapper.get('[data-test="settings-open-log-folder"]').trigger('click');
    expect(wrapper.emitted('open-log-folder')).toEqual([[]]);

    await wrapper.get('[data-test="settings-clear-diagnostics"]').trigger('click');
    expect(wrapper.emitted('clear-diagnostics')).toEqual([[]]);

    await wrapper.get('[data-test="settings-auto-replay"]').setValue(true);
    expect(wrapper.emitted('update-settings')).toContainEqual([{ autoReplayDeferredSyncOperations: true }]);

    expect((wrapper.get('[data-test="settings-webview-enhancement-mode"]').element as HTMLInputElement).checked).toBe(
      false
    );
    await wrapper.get('[data-test="settings-webview-enhancement-mode"]').setValue(true);
    expect(wrapper.emitted('update-settings')).toContainEqual([{ webViewEnhancementMode: true }]);

    await wrapper.get('[data-test="settings-browser-tabs-mode-shared"]').trigger('click');
    expect(wrapper.emitted('update-settings')).toContainEqual([{ browserTabsMode: 'shared' }]);

    await wrapper.get('[data-test="settings-restore-browser-tabs-on-startup"]').setValue(true);
    expect(wrapper.emitted('update-settings')).toContainEqual([{ restoreBrowserTabsOnStartup: true }]);

    await wrapper.get('[data-test="settings-ffmpeg-refresh"]').trigger('click');
    expect(wrapper.emitted('refresh-ffmpeg')).toEqual([[]]);

    await wrapper.get('[data-test="settings-download-root-choose"]').trigger('click');
    expect(wrapper.emitted('choose-download-root')).toEqual([[]]);

    await wrapper.get('[data-test="settings-download-root-open"]').trigger('click');
    expect(wrapper.emitted('open-download-root')).toEqual([[]]);

    expect(wrapper.get('[data-test="settings-max-concurrent-downloads"]').attributes('max')).toBe('3');

    await wrapper.get('[data-test="settings-max-concurrent-downloads"]').setValue('3');
    await wrapper.get('[data-test="settings-max-concurrent-downloads"]').trigger('change');
    expect(wrapper.emitted('update-settings')).toContainEqual([{ maxConcurrentDownloads: 3 }]);

    await wrapper.get('[data-test="settings-download-speed-fast"]').trigger('click');
    expect(wrapper.emitted('update-settings')).toContainEqual([{ downloadSpeedMode: 'fast' }]);

    await wrapper.get('[data-test="settings-auto-download-on-playback"]').setValue(true);
    expect(wrapper.emitted('update-settings')).toContainEqual([{ autoDownloadOnPlayback: true }]);

    await wrapper.get('[data-test="settings-download-sidebar-enabled"]').setValue(true);
    expect(wrapper.emitted('update-settings')).toContainEqual([{ downloadSidebarEnabled: true }]);

    await wrapper.get('#settings-locale').setValue('en-US');
    expect(wrapper.emitted('change-locale')).toEqual([['en-US']]);
  });

  it('renders section navigation and shows the selected settings group', async function () {
    const wrapper = mountPanel();

    const links = wrapper.findAll('[data-test^="settings-section-link-"]');
    expect(links).toHaveLength(6);
    expect(
      links.map(function (link) {
        return link.text();
      })
    ).toEqual(['一般', '瀏覽器', '快捷鍵', '同步', '下載', '資料']);
    expect(wrapper.get('[data-test="settings-section-link-settings-general"]').attributes('aria-current')).toBe('page');
    expect(wrapper.get('#settings-general').attributes('style')).toBeUndefined();
    expect(wrapper.get('#settings-downloads').attributes('style')).toContain('display: none');

    await wrapper.get('[data-test="settings-section-link-settings-downloads"]').trigger('click');

    expect(wrapper.get('[data-test="settings-section-link-settings-downloads"]').classes()).toContain('is-active');
    expect(wrapper.get('[data-test="settings-section-link-settings-downloads"]').attributes('aria-current')).toBe(
      'page'
    );
    expect(wrapper.get('#settings-general').attributes('style')).toContain('display: none');
    expect(wrapper.get('#settings-downloads').attributes('style')).toBeUndefined();
  });

  it('renders platform-specific shortcuts and filters the shortcut list', async function () {
    const macWrapper = mountPanel();

    await macWrapper.get('[data-test="settings-section-link-settings-shortcuts"]').trigger('click');

    expect(macWrapper.get('[data-test="settings-shortcut-keys-switch-browser-view"]').text()).toContain('⌘1');
    expect(macWrapper.get('[data-test="settings-shortcut-keys-switch-local-data-view"]').text()).toContain('⌘2');
    expect(macWrapper.get('[data-test="settings-shortcut-keys-switch-settings-view"]').text()).toContain('⌘3');
    expect(macWrapper.get('[data-test="settings-shortcut-keys-new-browser-tab"]').text()).toContain('⌘T');
    expect(macWrapper.get('[data-test="settings-shortcut-keys-new-browser-tab"]').text()).not.toContain('Ctrl+T');
    expect(macWrapper.get('[data-test="settings-shortcut-keys-next-browser-tab"]').text()).toContain('⌥⌘→');
    expect(macWrapper.get('[data-test="settings-shortcut-keys-toggle-shared-tabs"]').text()).toContain('⇧⌘S');
    expect(macWrapper.get('[data-test="settings-shortcut-keys-toggle-download-sidebar"]').text()).toContain('⇧⌘D');

    const windowsWrapper = mountPanel(undefined, '/tmp/jable-favourites.sqlite', 'windows');

    await windowsWrapper.get('[data-test="settings-section-link-settings-shortcuts"]').trigger('click');

    expect(windowsWrapper.get('[data-test="settings-shortcut-keys-switch-browser-view"]').text()).toContain('Ctrl+1');
    expect(windowsWrapper.get('[data-test="settings-shortcut-keys-switch-local-data-view"]').text()).toContain(
      'Ctrl+2'
    );
    expect(windowsWrapper.get('[data-test="settings-shortcut-keys-switch-settings-view"]').text()).toContain('Ctrl+3');
    expect(windowsWrapper.get('[data-test="settings-shortcut-keys-new-browser-tab"]').text()).toContain('Ctrl+T');
    expect(windowsWrapper.get('[data-test="settings-shortcut-keys-new-browser-tab"]').text()).not.toContain('⌘T');
    expect(windowsWrapper.get('[data-test="settings-shortcut-keys-next-browser-tab"]').text()).toContain(
      'Ctrl+PageDown'
    );
    expect(windowsWrapper.get('[data-test="settings-shortcut-keys-toggle-shared-tabs"]').text()).toContain(
      'Ctrl+Shift+S'
    );
    expect(windowsWrapper.get('[data-test="settings-shortcut-keys-toggle-download-sidebar"]').text()).toContain(
      'Ctrl+Shift+D'
    );

    await windowsWrapper.get('[data-test="settings-shortcut-search"]').setValue('劇院');

    expect(windowsWrapper.find('[data-test="settings-shortcut-row-toggle-theater-mode"]').exists()).toBe(true);
    expect(windowsWrapper.find('[data-test="settings-shortcut-row-new-browser-tab"]').exists()).toBe(false);

    await windowsWrapper.get('[data-test="settings-shortcut-search"]').setValue('跨頁');

    expect(windowsWrapper.find('[data-test="settings-shortcut-row-toggle-shared-tabs"]').exists()).toBe(true);
  });

  it('moves shortcut selection with keyboard arrows after a row is clicked', async function () {
    const wrapper = mountPanel();

    await wrapper.get('[data-test="settings-section-link-settings-shortcuts"]').trigger('click');

    const localDataRow = wrapper.get('[data-test="settings-shortcut-row-switch-local-data-view"]');
    await localDataRow.trigger('click');

    expect(localDataRow.attributes('aria-current')).toBe('true');

    await localDataRow.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();

    const settingsRow = wrapper.get('[data-test="settings-shortcut-row-switch-settings-view"]');
    expect(settingsRow.attributes('aria-current')).toBe('true');
    expect(document.activeElement).toBe(settingsRow.element);

    await settingsRow.trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();

    expect(localDataRow.attributes('aria-current')).toBe('true');
    expect(document.activeElement).toBe(localDataRow.element);
  });

  it('disables opening the data folder until the database path is available', function () {
    const wrapper = mountPanel(undefined, null);

    expect(wrapper.text()).toContain('尚未建立資料庫');
    expect(wrapper.get('[data-test="settings-open-data-folder"]').attributes('disabled')).toBeDefined();
  });

  it('detects import target from JSON metadata and confirms the selected collection', async function () {
    const wrapper = mountPanel();
    const resource: ExportResource = {
      data: [
        {
          data: [
            {
              title: 'Later video',
              url: 'https://jable.tv/videos/later/',
              views: null,
              likes: null,
              img: null,
              preview: null,
              site_order: 1
            }
          ],
          meta: {
            current_page: 1,
            per_page: 24,
            count: 1,
            first_url: 'https://jable.tv/videos/later/',
            last_url: 'https://jable.tv/videos/later/',
            exported_at: '2026-05-16T00:00:00.000Z'
          }
        }
      ],
      meta: {
        format_version: 2,
        source_path: '/my/favourites/videos-watch-later/',
        source_url: 'https://jable.tv/my/favourites/videos-watch-later/',
        exported_at: '2026-05-16T00:00:00.000Z',
        completed: true,
        per_page: 24,
        page_count: 1,
        total: 1,
        last_page: 1,
        last_scraped_page: 1
      }
    };

    await selectImportFile(wrapper, resource, 'backup.json');

    expect(wrapper.text()).toContain('從檔案內容判斷：稍後觀看');
    expect((wrapper.get('[data-test="settings-import-target"]').element as HTMLSelectElement).value).toBe(
      'watch_later'
    );

    await wrapper.get('[data-test="settings-import-confirm"]').trigger('click');

    expect(wrapper.emitted('import-json')).toEqual([[{ collectionKey: 'watch_later', resource: resource }]]);
  });

  it('requires a target collection when JSON source cannot be detected', async function () {
    const wrapper = mountPanel();
    const resource = {
      data: [],
      meta: {
        format_version: 2,
        source_path: '',
        source_url: '',
        exported_at: '2026-05-16T00:00:00.000Z',
        completed: false,
        per_page: 24,
        page_count: 0,
        total: 0,
        last_page: null,
        last_scraped_page: null
      }
    } as ExportResource;

    await selectImportFile(wrapper, resource, 'backup.json');

    expect(wrapper.text()).toContain('無法判斷來源清單');
    expect((wrapper.get('[data-test="settings-import-target"]').element as HTMLSelectElement).value).toBe('');
    expect(wrapper.get('[data-test="settings-import-confirm"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-test="settings-import-target"]').setValue('favourites');
    await wrapper.get('[data-test="settings-import-confirm"]').trigger('click');

    expect(wrapper.emitted('import-json')).toEqual([[{ collectionKey: 'favourites', resource: resource }]]);
  });

  it('exports the explicitly selected collection', async function () {
    const wrapper = mountPanel();

    await wrapper.find('select[aria-label="匯出清單"]').setValue('watch_later');
    await wrapper.get('[data-test="settings-export-button"]').trigger('click');

    expect(wrapper.emitted('export-json')).toEqual([['watch_later']]);
  });
});
