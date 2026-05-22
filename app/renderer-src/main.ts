import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

function serializedRendererError(error: unknown) {
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

function reportRendererError(event: string, error: unknown, details?: unknown) {
  try {
    window.jableApp?.reportRendererError({
      level: 'error',
      event: event,
      error: serializedRendererError(error),
      details: details
    });
  } catch (reportError) {}
}

window.addEventListener('error', function (event) {
  reportRendererError('window-error', event.error || event.message, {
    filename: event.filename,
    line: event.lineno,
    column: event.colno
  });
});

window.addEventListener('unhandledrejection', function (event) {
  reportRendererError('unhandled-rejection', event.reason);
});

createApp(App).mount('#app');
