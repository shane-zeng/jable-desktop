import type { JableAppApi } from '../types/jable';

export function serializedRendererError(error: unknown) {
  if (!(error instanceof Error)) {
    return {
      message: String(error)
    };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack || null
  };
}

export function reportRendererWorkflowError(api: JableAppApi, event: string, error: unknown, details?: unknown) {
  try {
    if (typeof api.reportRendererError !== 'function') return;
    api.reportRendererError({
      level: 'error',
      event: event,
      error: serializedRendererError(error),
      details: details
    });
  } catch (reportError) {}
}
