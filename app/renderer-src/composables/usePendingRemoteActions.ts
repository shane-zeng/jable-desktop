import type { Ref } from 'vue';
import type { JableAppApi } from '../../types/jable';
import type { useLibraryState } from './useLibraryState';
import type { ToastTone } from './useToastStatus';

type LibraryState = ReturnType<typeof useLibraryState>;
type Translate = (key: string, params?: Record<string, string | number | null | undefined>) => string;
type SetStatus = (text: string, tone?: ToastTone, options?: { sticky?: boolean; queueProgress?: boolean }) => void;

export function usePendingRemoteActions(options: {
  api: JableAppApi;
  busy: Ref<boolean>;
  errorMessage(error: unknown): string;
  library: LibraryState;
  setStatus: SetStatus;
  t: Translate;
}) {
  async function addPendingRemoteOperationGroup(groupId: string) {
    options.busy.value = true;
    try {
      const result = await options.api.addPendingRemoteOperationGroup(groupId);
      await options.library.refreshPendingGroups();
      if (result.resolved) {
        await options.library.refreshVideos();
        options.setStatus(options.t('status.pendingRemoteAdded'), 'success');
      } else {
        options.setStatus(
          options.t('status.pendingRemoteAddFailed', { error: result.error || options.t('status.unknownError') }),
          'error',
          {
            sticky: true
          }
        );
      }
    } catch (error) {
      options.setStatus(options.t('status.pendingRemoteAddFailed', { error: options.errorMessage(error) }), 'error', {
        sticky: true
      });
    } finally {
      options.busy.value = false;
    }
  }

  async function removePendingRemoteOperationGroup(groupId: string) {
    options.busy.value = true;
    try {
      const result = await options.api.removePendingRemoteOperationGroup(groupId);
      await options.library.refreshPendingGroups();
      if (result.resolved) {
        await options.library.refreshVideos();
        options.setStatus(options.t('status.pendingRemoteRemoved'), 'success');
      } else {
        options.setStatus(
          options.t('status.pendingRemoteRemoveFailed', { error: result.error || options.t('status.unknownError') }),
          'error',
          {
            sticky: true
          }
        );
      }
    } catch (error) {
      options.setStatus(
        options.t('status.pendingRemoteRemoveFailed', { error: options.errorMessage(error) }),
        'error',
        { sticky: true }
      );
    } finally {
      options.busy.value = false;
    }
  }

  async function resolvePendingRemoteOperationGroup(groupId: string) {
    options.busy.value = true;
    try {
      const result = await options.api.resolvePendingRemoteOperationGroup(groupId);
      await options.library.refreshPendingGroups();
      if (result.resolved) {
        options.setStatus(options.t('status.pendingRemoteResolved'), 'success');
      } else {
        options.setStatus(options.t('status.pendingRemoteResolveFailed'), 'error', { sticky: true });
      }
    } catch (error) {
      options.setStatus(
        options.t('status.pendingRemoteResolveFailedWithError', { error: options.errorMessage(error) }),
        'error',
        {
          sticky: true
        }
      );
    } finally {
      options.busy.value = false;
    }
  }

  return {
    addPendingRemoteOperationGroup: addPendingRemoteOperationGroup,
    removePendingRemoteOperationGroup: removePendingRemoteOperationGroup,
    resolvePendingRemoteOperationGroup: resolvePendingRemoteOperationGroup
  };
}
