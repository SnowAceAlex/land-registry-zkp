// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat ESLint config for `blockchain/` and `web-app/backend/`.
 *
 * The frontend is deliberately NOT covered here — it ships its own
 * `web-app/frontend/eslint.config.mjs` built on the Next.js preset, and running
 * two configs over the same files would fight.
 *
 * Type-aware linting (`recommendedTypeChecked`) is off on purpose: it needs one
 * TS program per package and roughly triples lint time, for rules that the two
 * test suites already cover in practice. Formatting is Prettier's job — the
 * `prettier` config last in the chain switches off every stylistic rule so the
 * two never disagree.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'blockchain/artifacts/**',
      'blockchain/cache/**',
      'blockchain/typechain-types/**',
      'blockchain/circuits/build/**',
      'blockchain/fixtures/**',
      // Auto-synced from circuits/build/ (D32) — regenerated, never hand-edited
      'blockchain/contracts/verifiers/**',
      // Has its own Next.js flat config
      'web-app/frontend/**',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Everything here runs on Node — nothing in these two packages is bundled
    // for a browser (that is the frontend's job, and it has its own config).
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },

  {
    files: ['blockchain/**/*.ts', 'web-app/backend/**/*.ts'],
    rules: {
      // The codebase marks deliberately-unused params with a leading underscore
      // (RecordsService.create(_dto), ProofService.generateProof(_propertyId)).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` shows up where snarkjs/circomlibjs have no usable types. Worth a
      // warning so new ones get noticed, not an error that blocks the build.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },

  {
    // CLI scripts talk to the operator through stdout and exit with a code;
    // that is their interface, not a leftover debug statement. They also wrap
    // low-level failures in a readable message on purpose, which is what
    // `preserve-caught-error` would otherwise flag.
    files: ['blockchain/scripts/**/*.ts', 'web-app/backend/scripts/**/*'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'preserve-caught-error': 'off',
    },
  },

  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Specs re-require modules to exercise startup behaviour under a
      // changed environment, which `import` cannot express.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  prettier,
);
