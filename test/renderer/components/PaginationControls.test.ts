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
    expect(wrapper.text()).toContain('ページ 2 / 4');
    expect(wrapper.text()).toContain('次へ');
  });
});
