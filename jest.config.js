module.exports = {
  // Basic Jest configuration
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // File patterns
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  
  // Transform configuration
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  
  // Module resolution
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^test/(.*)$': '<rootDir>/test/$1',
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  
  // Coverage configuration
  collectCoverage: false, // Enable via CLI flag
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/main.ts', // Exclude bootstrap file
    '!src/**/*.interface.ts', // Exclude pure interfaces
    '!src/**/*.enum.ts', // Exclude enums
    '!src/**/*.dto.ts', // Exclude DTOs (unless they have complex validation logic)
    '!src/**/*.config.ts', // Exclude configuration files
    '!src/**/*.module.ts', // Exclude simple module files
    '!src/**/*.spec.ts', // Exclude test files
    '!src/**/*.e2e-spec.ts', // Exclude E2E test files
    '!src/test/**/*', // Exclude test utilities
  ],
  
  coverageDirectory: 'coverage',
  
  // Coverage reporters
  coverageReporters: [
    'text',        // Console output
    'text-summary', // Brief summary
    'html',        // HTML report
    'lcov',        // For CI/CD integration
    'json',        // Machine readable
    'cobertura',   // For some CI systems
  ],
  
  // Coverage thresholds (fail if below these percentages)
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    // Specific thresholds for critical modules
    'src/modules/notifications/services/': {
      branches: 90,
      functions: 95,
      lines: 90,
      statements: 90,
    },
    'src/modules/channels/': {
      branches: 85,
      functions: 90,
      lines: 85,
      statements: 85,
    },
    'src/common/': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  
  // Test timeout (30 seconds for complex operations)
  testTimeout: 30000,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Verbose output for better debugging
  verbose: true,
  
  // Error handling
  errorOnDeprecated: true,
  
  // Global setup and teardown
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  
  // Test result processor
  testResultsProcessor: '<rootDir>/test/test-results-processor.js',
  
  // Watch plugins
  // watchPlugins: [
  //   'jest-watch-typeahead/filename',
  //   'jest-watch-typeahead/testname',
  // ],
  
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
  
  // Max workers for parallel testing
  maxWorkers: '50%', // Use 50% of available CPU cores
  
  // Fail fast - stop on first failure
  bail: false, // Set to true in CI for faster feedback
  
  // Force exit after tests complete
  forceExit: false,
  
  // Detect open handles
  detectOpenHandles: true,
  
  // Detect leaked handles
  detectLeaks: false, // Enable only when debugging memory leaks
};