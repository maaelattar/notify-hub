import 'reflect-metadata';
import { vi, beforeAll, afterEach, afterAll } from 'vitest';
import { TestEnvironment } from '../src/test/test-utils';

// E2E Test Setup
beforeAll(async () => {
  // Set test environment variables specific to E2E tests
  TestEnvironment.setTestEnvironment();

  // Override specific settings for E2E tests
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error'; // Minimize logging during E2E tests
  process.env.DATABASE_URL = 'sqlite::memory:'; // Use in-memory database

  // Configure timeouts for E2E tests
  // Vitest timeout is configured in vitest.config.mjs

  // Suppress console output for cleaner E2E test output
  const originalConsole = global.console;
  global.console = {
    ...originalConsole,
    log: vi.fn(), // Mock console.log
    debug: vi.fn(), // Mock console.debug
    info: vi.fn(), // Mock console.info
    warn: originalConsole.warn, // Keep warnings
    error: originalConsole.error, // Keep errors
  };
});

// Clean up after each E2E test
afterEach(async () => {
  // Clear any global state that might affect other tests
  vi.clearAllMocks();

  // Add any E2E-specific cleanup here
  // For example, clear test database, reset Redis, etc.
});

// Global E2E teardown
afterAll(async () => {
  // Clean up any resources created during E2E tests
  // For example, close database connections, stop test servers, etc.

  // Wait a bit to ensure all async operations are complete
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

// Global error handling for E2E tests
process.on('unhandledRejection', (reason, promise) => {
  console.error(
    'Unhandled Rejection during E2E test:',
    promise,
    'reason:',
    reason,
  );
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception during E2E test:', error);
});

// Configure supertest defaults
// You can configure default supertest settings here if needed
// For example, default headers, timeouts, etc.
