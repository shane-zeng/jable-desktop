import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import DownloadErrorLogModal from '@/components/DownloadErrorLogModal.vue';
import { setLocale } from '@/i18n';
import type { DownloadRecord } from '../../../app/types/jable';

function makeDownloadRecord(index: number): DownloadRecord {
  const timestamp = new Date(Date.UTC(2026, 4, 18, 0, 0, index)).toISOString();

  return {
    videoUrl: 'https://jable.tv/videos/error-' + index + '/',
    collectionKeys: [],
    title: 'Error Video ' + index,
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
    attemptCount: index,
    lastStartedAt: timestamp,
    lastErrorAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null
  };
}

function mountModal(overrides: Record<string, unknown> = {}) {
  return mount(DownloadErrorLogModal, {
    attachTo: document.body,
    props: Object.assign(
      {
        records: [makeDownloadRecord(1)],
        shown: 1,
        total: 2,
        canShowAll: true,
        showAll: false,
        previewLimit: 1,
        errorSummaryLabel: function (record: DownloadRecord) {
          return record.error || '';
        },
        failurePhaseLabel: function (record: DownloadRecord) {
          return record.failurePhase || '';
        },
        optionalDetail: function (value: string | number | null | undefined) {
          return value === null || typeof value === 'undefined' ? '-' : String(value);
        }
      },
      overrides
    )
  });
}

async function settleFocus() {
  await nextTick();
  await flushPromises();
  await nextTick();
}

describe('DownloadErrorLogModal', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  afterEach(function () {
    document.body.innerHTML = '';
  });

  it('focuses the close button on mount and restores the previous focus on unmount', async function () {
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open diagnostics';
    document.body.appendChild(opener);
    opener.focus();

    const wrapper = mountModal();
    await settleFocus();

    expect(document.activeElement).toBe(wrapper.get('[data-test="download-error-log-close"]').element);

    wrapper.unmount();

    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab focus inside the modal', async function () {
    const wrapper = mountModal();
    await settleFocus();

    const modal = wrapper.get('[data-test="download-error-log-modal"]');
    const close = wrapper.get('[data-test="download-error-log-close"]');
    const showAll = wrapper.get('[data-test="download-error-log-show-all"]');
    const closeElement = close.element as HTMLElement;
    const showAllElement = showAll.element as HTMLElement;

    showAllElement.focus();
    await modal.trigger('keydown', { key: 'Tab' });

    expect(document.activeElement).toBe(closeElement);

    closeElement.focus();
    await modal.trigger('keydown', { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(showAllElement);

    wrapper.unmount();
  });
});
