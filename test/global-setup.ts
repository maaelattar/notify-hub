import { TestEnvironment } from '../src/test/test-utils';

export default async (): Promise<void> => {
  console.log('🧪 Setting up global test environment...');

  // Save original environment
  (global as any).__ORIGINAL_ENV__ = { ...process.env };

  // Set test environment
  TestEnvironment.setTestEnvironment();

  // Additional global setup for all tests
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';

  // Mock external services if needed
  // For example, mock email service, SMS service, etc.

  console.log('✅ Global test environment setup complete');
};
