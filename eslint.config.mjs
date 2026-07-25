import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import importPlugin from 'eslint-plugin-import-x'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'webpack.config.js',
      'src/wasm/*',
      'dist/*',
      'crate/*',
      'esm/*',
      'esm_*/*',
      'example/*',
      'benchmarks/*',
      'eslint.config.mjs',
      'coverage',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylisticTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  importPlugin.flatConfigs.recommended,
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      '@typescript-eslint/parameter-properties': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      'no-underscore-dangle': 'off',
      curly: 'error',
      'object-shorthand': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      eqeqeq: 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      semi: ['error', 'never'],

      // unicorn rules we do not want; shared across the gmod repos
      'unicorn/better-regex': 'off',
      'unicorn/catch-error-name': 'off',
      'unicorn/consistent-boolean-name': 'off',
      'unicorn/consistent-class-member-order': 'off',
      'unicorn/consistent-destructuring': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/escape-case': 'off',
      'unicorn/expiring-todo-comments': 'off',
      'unicorn/explicit-length-check': 'off',
      // keep off: files use camelCase
      'unicorn/filename-case': 'off',
      // keep off: codebase uses many abbreviations (fd, fh, buf, pos, etc.)
      'unicorn/name-replacements': 'off',
      'unicorn/no-abusive-eslint-disable': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-array-sort': 'off',
      // keep off: (await x).property pattern used in bgzFilehandle.ts
      'unicorn/no-await-expression-member': 'off',
      'unicorn/no-break-in-nested-loop': 'off',
      'unicorn/no-empty-file': 'off',
      // keep off: indexed for-loops that track index/position are intentional
      'unicorn/no-for-loop': 'off',
      'unicorn/no-lonely-if': 'off',
      // keep off: primary code path in negated condition is more readable as-is
      'unicorn/no-negated-condition': 'off',
      'unicorn/no-nested-ternary': 'off',
      // keep off: new Array(n) pre-allocation is intentional for performance
      'unicorn/no-new-array': 'off',
      'unicorn/no-null': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/no-unreadable-array-destructuring': 'off',
      'unicorn/no-useless-else': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/number-literal-case': 'off',
      'unicorn/numeric-separators-style': 'off',
      // keep off: port.onmessage assignment used in workerPoolHost.ts
      'unicorn/prefer-add-event-listener': 'off',
      'unicorn/prefer-at': 'off',
      'unicorn/prefer-await': 'off',
      'unicorn/prefer-bigint-literals': 'off',
      'unicorn/prefer-blob-reading-methods': 'off',
      'unicorn/prefer-code-point': 'off',
      'unicorn/prefer-continue': 'off',
      'unicorn/prefer-includes-over-repeated-comparisons': 'off',
      'unicorn/prefer-math-trunc': 'off',
      // keep off: bitwise ops in bgzfBlockScan.ts/long.ts are intentional 32-bit integer arithmetic
      'unicorn/prefer-modern-math-apis': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-node-protocol': 'off',
      'unicorn/prefer-number-properties': 'off',
      'unicorn/prefer-optional-catch-binding': 'off',
      'unicorn/prefer-private-class-fields': 'off',
      'unicorn/prefer-query-selector': 'off',
      'unicorn/prefer-regexp-test': 'off',
      'unicorn/prefer-simple-condition-first': 'off',
      'unicorn/prefer-spread': 'off',
      'unicorn/prefer-string-replace-all': 'off',
      'unicorn/prefer-structured-clone': 'off',
      'unicorn/prefer-switch': 'off',
      // keep off: top-level await not applicable for library exports
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/prefer-type-error': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/relative-url-style': 'off',
      'unicorn/switch-case-braces': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-deprecated': 'warn',
      // keep off: non-null assertions are used intentionally on bounds-checked array access
      '@typescript-eslint/no-non-null-assertion': 'off',

      'import-x/no-unresolved': 'off',
      'import-x/extensions': ['error', 'ignorePackages'],
      'import-x/order': [
        'error',
        {
          named: true,
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
          },
          groups: [
            'builtin',
            ['external', 'internal'],
            ['parent', 'sibling', 'index', 'object'],
            'type',
          ],
        },
      ],
    },
  },
)
