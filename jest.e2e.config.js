module.exports = {
  // Extend base configuration
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // File patterns for E2E tests
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '\\.e2e-spec\\.ts$',
  
  // Transform configuration
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  
  // Module resolution
  moduleNameMapping: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^test/(.*)$': '<rootDir>/test/$1',
  },
  
  // Setup files specific to E2E tests
  setupFilesAfterEnv: ['<rootDir>/test/e2e-setup.ts'],
  
  // E2E tests don't need coverage (they test integration, not code coverage)
  collectCoverage: false,
  
  // E2E tests typically need more time
  testTimeout: 60000, // 1 minute timeout
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Less verbose for E2E (they can be noisy)
  verbose: false,
  
  // Error handling
  errorOnDeprecated: true,
  
  // Global setup and teardown for E2E environment
  globalSetup: '<rootDir>/test/e2e-global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e-global-teardown.ts',
  
  // Run E2E tests serially (not in parallel) to avoid conflicts
  maxWorkers: 1,
  
  // E2E tests should run sequentially to avoid database conflicts
  runInBand: true,
  
  // Fail fast for E2E tests to save time
  bail: 1, // Stop after first failure
  
  // Force exit after tests complete
  forceExit: true,
  
  // Detect open handles (important for E2E tests)
  detectOpenHandles: true,
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
  ],
  
  // Module path ignore patterns
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
  ],
  
  // Cache directory for E2E tests
  cacheDirectory: '<rootDir>/.jest-cache/e2e',
  
  // Display name for E2E tests
  displayName: {
    name: 'E2E Tests',
    color: 'blue',
  },
};