import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BrowserPanel from './BrowserPanel.vue';

function makeTabs() {
  return [
    {
      id: 'tab-1',
      kind: 'normal',
      title: 'Jable',
      url: 'https://jable.tv/',
      favicon: 'https://jable.tv/favicon.ico',
      loading: false,
      locked: false
    },
    {
      id: 'tab-2',
      kind: 'sync',
      title: '同步：影片收藏',
      url: 'https://jable.tv/my/favourites/videos/',
      favicon: '',
      loading: true,
      locked: true
    }
  ];
}

describe('BrowserPanel', function () {
  it('renders browser tabs with active, loading, and locked states', function () {
    var wrapper = mount(BrowserPanel, {
      props: {
        active: true,
        tabs: makeTabs(),
        activeTabId: 'tab-2',
        canCreateTab: false,
        compact: false,
        tabWidth: 220
      }
    });

    expect(wrapper.text()).toContain('Jable');
    expect(wrapper.text()).not.toContain('jable.tv/my/favourites');
    expect(wrapper.text()).not.toContain('同步中');
    expect(wrapper.find('[aria-label="新增分頁"]').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true');
    expect(wrapper.findAll('[aria-label="關閉分頁"]')[1].attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('[aria-label="關閉分頁"]')[0].classes()).toContain('browser-tab-close');
  });

  it('emits tab actions', async function () {
    var wrapper = mount(BrowserPanel, {
      props: {
        active: true,
        tabs: makeTabs(),
        activeTabId: 'tab-1',
        canCreateTab: true,
        compact: false,
        tabWidth: 220
      }
    });

    await wrapper.find('[aria-label="新增分頁"]').trigger('click');
    await wrapper.findAll('[role="tab"]')[1].trigger('click');
    await wrapper.findAll('[aria-label="關閉分頁"]')[0].trigger('click');

    expect(wrapper.emitted('new-tab')).toHaveLength(1);
    expect(wrapper.emitted('activate-tab')).toEqual([['tab-2']]);
    expect(wrapper.emitted('close-tab')).toEqual([['tab-1']]);
  });

  it('auto-hides compact floating tab rail until the left edge is hovered', async function () {
    var wrapper = mount(BrowserPanel, {
      props: {
        active: true,
        tabs: makeTabs(),
        activeTabId: 'tab-1',
        canCreateTab: true,
        compact: true,
        tabWidth: 220
      }
    });

    expect(wrapper.find('aside').classes()).toContain('absolute');
    expect(wrapper.find('aside').classes()).toContain('inset-y-0');
    expect(wrapper.find('aside').classes()).not.toContain('relative');
    expect(wrapper.find('aside').attributes('style')).toContain('display: none');

    await wrapper.find('[data-test="compact-tab-trigger"]').trigger('pointerenter');

    expect(wrapper.emitted('layout-change')).toHaveLength(1);
    expect(wrapper.find('aside').attributes('style') || '').not.toContain('display: none');
    expect(wrapper.text()).not.toContain('jable.tv/my/favourites');

    await wrapper.find('aside').trigger('mouseleave');

    expect(wrapper.emitted('layout-change')).toHaveLength(2);
    expect(wrapper.find('aside').attributes('style')).toContain('display: none');
  });

  it('emits tab context menu coordinates', async function () {
    var wrapper = mount(BrowserPanel, {
      props: {
        active: true,
        tabs: makeTabs(),
        activeTabId: 'tab-1',
        canCreateTab: true,
        compact: false,
        tabWidth: 220
      }
    });

    await wrapper.findAll('[role="tab"]')[0].trigger('contextmenu', {
      clientX: 25,
      clientY: 30
    });

    expect(wrapper.emitted('tab-context-menu')).toEqual([[
      {
        tabId: 'tab-1',
        x: 25,
        y: 30
      }
    ]]);
  });

  it('emits the active tab context menu from the rail background', async function () {
    var wrapper = mount(BrowserPanel, {
      props: {
        active: true,
        tabs: makeTabs(),
        activeTabId: 'tab-2',
        canCreateTab: true,
        compact: false,
        tabWidth: 220
      }
    });

    await wrapper.find('[role="tablist"]').trigger('contextmenu', {
      clientX: 80,
      clientY: 160
    });

    expect(wrapper.emitted('tab-context-menu')).toEqual([[
      {
        tabId: 'tab-2',
        x: 80,
        y: 160
      }
    ]]);
  });

  it('emits resized tab width while dragging the rail handle', async function () {
    var wrapper = mount(BrowserPanel, {
      props: {
        active: true,
        tabs: makeTabs(),
        activeTabId: 'tab-1',
        canCreateTab: true,
        compact: false,
        tabWidth: 220
      }
    });

    await wrapper.find('[role="separator"]').trigger('pointerdown', {
      clientX: 220
    });
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 280 }));
    window.dispatchEvent(new PointerEvent('pointerup'));

    expect(wrapper.emitted('resize-tabs')).toEqual([[280]]);
  });
});
