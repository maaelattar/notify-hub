// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn'
    },
  },
  // Test file overrides - allow necessary flexibility for Jest mocking
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off', // Jest mocks require unbound methods
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }], // Allow _unused variables
      '@typescript-eslint/no-unsafe-assignment': 'warn', // Allow mock assignments in tests
      '@typescript-eslint/no-unsafe-member-access': 'warn', // Allow accessing mock properties
      '@typescript-eslint/no-unsafe-argument': 'warn', // Allow passing mocks as arguments
      '@typescript-eslint/no-unsafe-return': 'warn', // Allow returning mocks
      '@typescript-eslint/no-explicit-any': 'warn', // Allow any in test files for mocking
    },
  },
);