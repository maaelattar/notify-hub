import 'reflect-metadata';
import { TestEnvironment } from '../src/test/test-utils';

// Global test setup
beforeAll(() => {
  // Set test environment variables
  TestEnvironment.setTestEnvironment();

  // Configure global test settings
  jest.setTimeout(30000); // 30 second timeout for unit tests

  // Suppress console output during tests (optional)
  if (process.env.SUPPRESS_LOGS === 'true') {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  }
});

// Global test teardown
afterAll(() => {
  // Restore environment
  if (process.env.NODE_ENV === 'test') {
    // Clean up any global test state
  }
});

// Configure Jest globals
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
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(floor: number, ceiling: number): R;
    }
  }
}

// Mock timers configuration
jest.useFakeTimers({
  // Use real timers for setTimeout/setInterval by default
  doNotFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
  // Can be overridden in individual tests
});

// Global error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process during tests
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process during tests
});
