import 'reflect-metadata';
import { vi, beforeAll, afterAll, expect } from 'vitest';
import { TestEnvironment } from '../src/test/test-utils';

// Global test setup
beforeAll(() => {
  // Set test environment variables
  TestEnvironment.setTestEnvironment();

  // Configure global test settings
  // Vitest timeout is configured in vitest.config.mjs

  // Suppress console output during tests (optional)
  if (process.env.SUPPRESS_LOGS === 'true') {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  }
});

// Global test teardown
afterAll(() => {
  // Restore environment
  if (process.env.NODE_ENV === 'test') {
    // Clean up any global test state
  }
});

// Configure Vitest custom matchers
expect.extend({
  // Custom matchers can be added here
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () =>
          `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
});

// Declare custom matcher types for TypeScript
declare global {
  interface CustomMatchers<R = unknown> {
    toBeWithinRange(floor: number, ceiling: number): R;
  }
}

// Mock timers configuration
vi.useFakeTimers();
// Note: Vitest handles timer mocking differently than Jest
// Individual tests can override with vi.useRealTimers() if needed

// Global error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process during tests
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process during tests
});
