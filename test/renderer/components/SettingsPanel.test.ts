import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import SettingsPanel from '@/components/SettingsPanel.vue';
import { setLocale } from '@/i18n';
import type { AppSettings, ExportResource } from '../../../app/types/jable';

const settings: AppSettings = {
  maxBrowserTabs: 22,
  compactBrowserTabs: true,
  fullSyncAjaxWindowSize: 5,
  autoReplayDeferredSyncOperations: false,
  ffmpegPath: null
};

function mountPanel(overrides?: Partial<AppSettings>, databasePath: string | null = '/tmp/jable-favourites.sqlite') {
  return mount(SettingsPanel, {
    props: {
      active: true,
      busy: false,
      databasePath: databasePath,
      ffmpegStatus: {
        state: 'missing',
        source: null,
        path: null,
        version: null,
        error: null
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
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('renders settings sections and emits user preference updates', async function () {
    const wrapper = mountPanel();

    expect(wrapper.text()).toContain('一般');
    expect(wrapper.text()).toContain('瀏覽器');
    expect(wrapper.text()).toContain('同步');
    expect(wrapper.text()).toContain('下載');
    expect(wrapper.text()).toContain('資料');
    expect(wrapper.text()).toContain('檢查更新');
    expect(wrapper.find('[data-test="settings-max-tabs-warning"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="settings-speed-fast"]').classes()).toContain('is-active');
    expect(wrapper.text()).toContain('403、429');

    await wrapper.get('[data-test="settings-check-updates"]').trigger('click');
    expect(wrapper.emitted('check-updates')).toEqual([[]]);

    await wrapper.get('[data-test="settings-open-data-folder"]').trigger('click');
    expect(wrapper.emitted('open-data-folder')).toEqual([[]]);

    await wrapper.get('[data-test="settings-auto-replay"]').setValue(true);
    expect(wrapper.emitted('update-settings')).toContainEqual([{ autoReplayDeferredSyncOperations: true }]);

    await wrapper.get('[data-test="settings-ffmpeg-refresh"]').trigger('click');
    expect(wrapper.emitted('refresh-ffmpeg')).toEqual([[]]);

    await wrapper.get('#settings-locale').setValue('en-US');
    expect(wrapper.emitted('change-locale')).toEqual([['en-US']]);
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
