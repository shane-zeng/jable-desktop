import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import vue from 'eslint-plugin-vue';

var commonRules = {
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      caughtErrors: 'none',
      varsIgnorePattern: '^_'
    }
  ],
  'no-var': 'off',
  'no-useless-assignment': 'off',
  'object-shorthand': 'off',
  'preserve-caught-error': 'off',
  'prefer-const': 'off'
};

var browserGlobals = {
  ...globals.browser,
  ...globals.es2024
};

var nodeGlobals = {
  ...globals.node,
  ...globals.es2024
};

export default [
  {
    ignores: ['app/renderer-dist/**', 'coverage/**', 'node_modules/**', 'release/**']
  },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 'latest'
    },
    rules: commonRules
  },
  {
    files: ['app/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      globals: nodeGlobals,
      sourceType: 'commonjs'
    }
  },
  {
    files: ['**/*.mjs', 'app/renderer-src/**/*.{js,vue}'],
    languageOptions: {
      sourceType: 'module'
    }
  },
  {
    files: ['app/webview-preload.js'],
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
    files: ['app/renderer-src/**/*.{js,vue}'],
    languageOptions: {
      globals: {
        ...browserGlobals,
        defineEmits: 'readonly',
        defineProps: 'readonly'
      }
    }
  },
  {
    files: ['app/renderer-src/**/*.test.js'],
    languageOptions: {
      globals: {
        ...browserGlobals,
        ...globals.vitest
      }
    }
  },
  eslintConfigPrettier
];
