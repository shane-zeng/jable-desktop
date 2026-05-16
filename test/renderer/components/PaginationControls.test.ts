import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import PaginationControls from '@/components/PaginationControls.vue';
import { setLocale } from '@/i18n';

describe('PaginationControls', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('renders Japanese pagination labels', function () {
    setLocale('ja-JP', false);
    const wrapper = mount(PaginationControls, {
      props: {
        busy: false,
        currentPage: 2,
        totalPages: 4,
        pageLabel: 'ページ 2 / 4'
      }
    });

    expect(wrapper.text()).toContain('前へ');
    expect(wrapper.text()).toContain('ページ');
    expect((wrapper.get('[data-test="pagination-page-input"]').element as HTMLInputElement).value).toBe('2');
    expect(wrapper.text()).toContain('/ 4');
    expect(wrapper.text()).toContain('次へ');
  });

  it('turns the next button into a go button when the page input changes', async function () {
    const wrapper = mount(PaginationControls, {
      props: {
        busy: false,
        currentPage: 1,
        totalPages: 4,
        pageLabel: '第 1 / 4 頁'
      }
    });

    expect(wrapper.get('[data-test="pagination-action"]').text()).toBe('下一頁');

    await wrapper.get('[data-test="pagination-page-input"]').setValue('3');
    expect(wrapper.get('[data-test="pagination-action"]').text()).toBe('前往');
    await wrapper.get('[data-test="pagination-action"]').trigger('click');

    expect(wrapper.emitted('page')).toEqual([[3]]);

    await wrapper.get('[data-test="pagination-page-input"]').setValue('99');
    await wrapper.get('[data-test="pagination-action"]').trigger('click');

    expect(wrapper.emitted('page')).toEqual([[3], [4]]);
  });
});
