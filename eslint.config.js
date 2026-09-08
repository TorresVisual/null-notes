import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import noUnsanitized from 'eslint-plugin-no-unsanitized'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'src-tauri/**', 'node_modules/**', '.claude/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { react, 'react-hooks': reactHooks, 'no-unsanitized': noUnsanitized },
    languageOptions: {
      globals: globals.browser,
    },
    settings: { react: { version: '19' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The rules this linter exists to enforce (L-1): tsc can't see either
      // of these, and both flag exactly the raw-HTML sinks H-2/H-3 were
      // found in.
      ...noUnsanitized.configs.recommended.rules,
      'react/no-danger': 'error',
      // Formatting/style is tsc + prettier-less convention here, not this
      // linter's job; and the codebase predates React's new JSX transform
      // requiring React in scope, but jsx-runtime config above already
      // covers that.
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
)
