import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

const commonRules = {
  'block-scoped-var': 'error',
  eqeqeq: 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-implicit-coercion': 'error',
  'no-shadow': 'error',
  'no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      caughtErrors: 'none',
      varsIgnorePattern: '^_'
    }
  ],
  'no-var': 'error',
  'no-useless-assignment': 'off',
  'object-shorthand': 'off',
  'preserve-caught-error': 'off',
  'prefer-const': 'error'
};

const browserGlobals = {
  ...globals.browser,
  ...globals.es2024
};

const nodeGlobals = {
  ...globals.node,
  ...globals.es2024
};

export default [
  {
    ignores: ['app/renderer-dist/**', 'app/runtime-dist/**', 'coverage/**', 'node_modules/**', 'release/**']
  },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest'
    },
    rules: commonRules
  },
  {
    files: [
      'app/ad-blocker.ts',
      'app/ad-cosmetic-policy.ts',
      'app/app-contract.ts',
      'app/browser-tab-manager.ts',
      'app/browser-tab-policy.ts',
      'app/collections.ts',
      'app/data-engine.ts',
      'app/download-manager.ts',
      'app/i18n/**/*.ts',
      'app/ipc-normalizers.ts',
      'app/main.ts',
      'app/native-data-engine.ts',
      'app/native-download-engine.ts',
      'app/preload.ts',
      'app/settings.ts',
      'app/sync-utils.ts',
      'app/update-checker.ts',
      'app/url-policy.ts',
      'app/webview-preload-helpers.ts',
      'scripts/**/*.js',
      'test/electron/**/*.js',
      'test/node/**/*.js'
    ],
    languageOptions: {
      globals: nodeGlobals,
      sourceType: 'commonjs'
    }
  },
  {
    files: [
      '**/*.mjs',
      'app/app-contract.ts',
      'app/renderer-src/**/*.{js,ts,vue}',
      'app/types/**/*.ts',
      'app/url-policy.ts',
      'test/renderer/**/*.{js,ts}'
    ],
    languageOptions: {
      sourceType: 'module'
    }
  },
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    languageOptions: {
      parser: tseslint.parser
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    files: ['app/renderer-src/**/*.vue'],
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    files: ['app/ad-cosmetic-policy.ts', 'app/webview-preload-helpers.ts', 'app/webview-preload.ts'],
    languageOptions: {
      globals: {
        ...nodeGlobals,
        ...browserGlobals
      },
      sourceType: 'commonjs'
    }
  },
  {
    files: ['jable-favourites-exporter.user.js'],
    languageOptions: {
      globals: browserGlobals,
      sourceType: 'script'
    }
  },
  {
    files: ['app/renderer-src/**/*.{js,ts,vue}'],
    languageOptions: {
      globals: {
        ...browserGlobals,
        defineEmits: 'readonly',
        defineProps: 'readonly'
      }
    }
  },
  {
    files: ['test/renderer/**/*.{test,spec}.{js,ts}'],
    languageOptions: {
      globals: {
        ...browserGlobals,
        ...globals.vitest
      }
    }
  },
  eslintConfigPrettier
];
