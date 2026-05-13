import type { JableAppApi } from '../types/jable';

declare global {
  interface Window {
    jableApp?: JableAppApi;
  }
}

export {};
