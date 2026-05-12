export function useJableApi() {
  if (!window.jableApp) {
    throw new Error('window.jableApp API is not available. Open this renderer inside Electron.');
  }

  return window.jableApp;
}
