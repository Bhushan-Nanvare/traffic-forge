// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/vite.config.ts.timestamp-*',
      'lib/db/dist/**',
      'artifacts/api-server/dist/**',
      'artifacts/traffic-forge/dist/**',
      'artifacts/demo-app/dist/**',
      // ShadCN UI components are vendor-style boilerplate; lint upstream
      'artifacts/traffic-forge/src/shared/components/ui/**',
    ],
  },
  // Base JS rules
  js.configs.recommended,
  // TypeScript rules (without type-aware checking — too slow for monorepo)
  ...tseslint.configs.recommended,
  // Node-side files: build scripts, server code, API
  {
    files: [
      '**/*.mjs',
      '**/*.cjs',
      '**/build.mjs',
      'artifacts/api-server/**/*.{ts,tsx}',
      'artifacts/demo-app/server.ts',
      'artifacts/demo-app/vite.config.ts',
      'lib/**/*.ts',
      'scripts/**/*.{ts,mjs,cjs}',
    ],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        DOMException: 'readonly',
        performance: 'readonly',
        crypto: 'readonly',
        WebSocket: 'readonly',
      },
    },
  },
  // Browser-side: frontend + demo-app React
  {
    files: ['artifacts/traffic-forge/**/*.{ts,tsx}', 'artifacts/demo-app/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        WebSocket: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        location: 'readonly',
        history: 'readonly',
      },
    },
  },
  // Project conventions
  {
    rules: {
      // We use _-prefixed unused params intentionally
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow explicit `any` only where narrowing isn't worth the noise
      '@typescript-eslint/no-explicit-any': 'warn',
      // Empty catch blocks are sometimes correct (best-effort cleanup)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Allow inferred returns
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Some files cast through unknown which is the correct pattern
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      // Pre-existing @ts-ignore in loadEngine — refactor opportunity, not a blocker
      '@typescript-eslint/ban-ts-comment': 'warn',
      // Lanczos coefficients in statistics.ts use full-precision literals
      'no-loss-of-precision': 'warn',
      // preserve-caught-error encourages `cause` on rethrows; nice but not blocking
      'preserve-caught-error': 'off',
    },
  },
  // Tests can be looser
  {
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  // Prettier compatibility — turn off rules that conflict with formatting
  prettier,
);
