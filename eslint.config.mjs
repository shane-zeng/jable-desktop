import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
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
    files: ['**/*.{js,mjs,ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest'
    },
    rules: commonRules
  },
  {
    files: ['app/**/*.js', 'scripts/**/*.js', 'test/node/**/*.js'],
    languageOptions: {
      globals: nodeGlobals,
      sourceType: 'commonjs'
    }
  },
  {
    files: ['**/*.mjs', 'app/renderer-src/**/*.{js,ts,vue}', 'app/types/**/*.ts', 'test/renderer/**/*.{js,ts}'],
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
