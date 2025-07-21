export default async (): Promise<void> => {
  console.log('🌐 Setting up E2E test environment...');

  // Save original environment for E2E tests
  (global as any).__E2E_ORIGINAL_ENV__ = { ...process.env };

  // Set E2E-specific environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.DATABASE_URL = 'sqlite::memory:';
  process.env.REDIS_HOST = 'localhost';
  process.env.REDIS_PORT = '6379';
  process.env.JWT_SECRET = 'test-secret-for-e2e';

  // Start test database or other services if needed
  // For example, start a test PostgreSQL instance, Redis, etc.

  // Wait for services to be ready
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log('✅ E2E test environment setup complete');
};
