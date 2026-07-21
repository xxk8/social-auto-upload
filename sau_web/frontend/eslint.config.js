import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import labelHtmlFor from './eslint-rules/label-html-for.mjs'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { sau: labelHtmlFor },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    // Repo-wide: `_`-prefixed callback args / vars / caught errors are
    // conventionally "I know it's there, no need to consume". React
    // Profiler onRender dumps 6 args; we only consume the first 2, so
    // the trailing 4 are `_`-prefixed and would otherwise be flagged
    // by `@typescript-eslint/no-unused-vars`. Same convention as used
    // in src/test/setup.ts and src/stores/useAiStore.ts.
    rules: {
      'sau/label-html-for': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
])
