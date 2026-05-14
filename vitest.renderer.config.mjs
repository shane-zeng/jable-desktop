import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.renderer.config.mjs';

export default mergeConfig(
  viteConfig,
  defineConfig({
    root: '.',
    test: {
      environment: 'happy-dom',
      include: ['test/renderer/**/*.{test,spec}.{js,ts}']
    }
  })
);
