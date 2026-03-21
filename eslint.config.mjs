import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import importPlugin from 'eslint-plugin-import'
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
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      'no-underscore-dangle': 'off',
      curly: 'error',
      eqeqeq: 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      semi: ['error', 'never'],

      // keep off: new Array(n) pre-allocation is intentional for performance
      'unicorn/no-new-array': 'off',
      'unicorn/no-empty-file': 'off',
      'unicorn/prefer-type-error': 'off',
      // keep off: bitwise ops in bgzfBlockScan.ts/long.ts are intentional 32-bit integer arithmetic
      'unicorn/prefer-modern-math-apis': 'off',
      'unicorn/prefer-math-trunc': 'off',
      // keep off: (await x).property pattern used in bgzFilehandle.ts
      'unicorn/no-await-expression-member': 'off',
      // keep off: port.onmessage assignment used in workerPoolHost.ts
      'unicorn/prefer-add-event-listener': 'off',
      // keep off: top-level await not applicable for library exports
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/no-lonely-if': 'off',
      'unicorn/consistent-destructuring': 'off',
      'unicorn/no-useless-undefined': 'off',

      // keep off: files use camelCase
      'unicorn/filename-case': 'off',
      // keep off: codebase uses many abbreviations (fd, fh, buf, pos, etc.)
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/numeric-separators-style': 'off',
      'unicorn/number-literal-case': 'off',
      // keep off: primary code path in negated condition is more readable as-is
      'unicorn/no-negated-condition': 'off',
      // keep off: indexed for-loops that track index/position are intentional
      'unicorn/no-for-loop': 'off',
      'unicorn/explicit-length-check': 'off',
      'unicorn/prefer-switch': 'off',

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

      'import/no-unresolved': 'off',
      'import/extensions': ['error', 'ignorePackages'],
      'import/order': [
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
