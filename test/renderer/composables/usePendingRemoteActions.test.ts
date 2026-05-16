import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { usePendingRemoteActions } from '@/composables/usePendingRemoteActions';
import type { JableAppApi } from '../../../app/types/jable';

describe('usePendingRemoteActions', function () {
  it('refreshes pending groups and videos after a resolved add', async function () {
    const busy = ref(false);
    const setStatus = vi.fn();
    const api = {
      addPendingRemoteOperationGroup: vi.fn().mockResolvedValue({
        groupId: 'favourites:https://jable.tv/videos/a/',
        collectionKey: 'favourites',
        videoUrl: 'https://jable.tv/videos/a/',
        resolved: true
      })
    };
    const library = {
      refreshPendingGroups: vi.fn().mockResolvedValue(undefined),
      refreshVideos: vi.fn().mockResolvedValue(undefined)
    };
    const actions = usePendingRemoteActions({
      api: api as unknown as JableAppApi,
      busy: busy,
      errorMessage: function (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      },
      library: library as never,
      setStatus: setStatus,
      t: function (key: string) {
        return key;
      }
    });

    await actions.addPendingRemoteOperationGroup('group-1');

    expect(api.addPendingRemoteOperationGroup).toHaveBeenCalledWith('group-1');
    expect(library.refreshPendingGroups).toHaveBeenCalled();
    expect(library.refreshVideos).toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith('status.pendingRemoteAdded', 'success');
    expect(busy.value).toBe(false);
  });
});
