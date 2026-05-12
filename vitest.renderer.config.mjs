import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.renderer.config.mjs';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      include: ['**/*.{test,spec}.js']
    }
  })
);
