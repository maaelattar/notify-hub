/**
 * Application-wide constants
 * Centralizes magic numbers and strings to improve maintainability
 */

export const APP_CONSTANTS = {
  // Server Configuration
  SERVER: {
    DEFAULT_PORT: 3000,
    LOCAL_BASE_URL: 'http://localhost:3000',
    DEVELOPMENT_CORS_ORIGINS: [
      'http://localhost:3000',
      'http://localhost:3001',
    ],
    API_VERSION: '1.0.0',
    API_DOCUMENTATION_PATH: '/api#/notifications',
  },

  // Timeouts (in milliseconds)
  TIMEOUTS: {
    JOB_PROCESSING: 30000, // 30 seconds
    REQUEST_TIMEOUT: 30000,
    GRACEFUL_SHUTDOWN: 10000,
    REDIS_CONNECT: 10000,
    REDIS_KEEP_ALIVE: 30000,
    TEST_TIMEOUT: 30000,
    E2E_SETUP_DELAY: 1000,
  },

  // Email/SMTP Configuration
  EMAIL: {
    DEFAULT_SMTP_PORT: 587,
    SECURE_SMTP_PORT: 465,
    DEFAULT_MAX_CONNECTIONS: 5,
    DEFAULT_MAX_MESSAGES: 100,
    DEFAULT_RATE_DELTA: 1000,
    DEFAULT_RATE_LIMIT: 5,
  },

  // Notification Limits
  NOTIFICATIONS: {
    MAX_RETRY_ATTEMPTS: 3,
    MAX_PAGE_SIZE: 1000,
    PUSH_CONTENT_MAX_LENGTH: 1000,
    CONTENT_FIELD_MAX_LENGTH: 255,
    METADATA_FIELD_MAX_LENGTH: 1000,
  },

  // Memory and Performance Limits
  PERFORMANCE: {
    MAX_PROCESSING_TIMES_STORED: 1000,
    MAX_QUEUE_WAITING_JOBS: 1000,
    MAX_TEST_CONTENT_SIZE: 10000, // 10KB for stress tests
    PERFORMANCE_TEST_ITERATIONS: 1000,
    PERFORMANCE_TOLERANCE_MS: 1000,
  },

  // Redis Configuration
  REDIS: {
    METRICS_TTL_SECONDS: 7 * 24 * 3600, // 7 days
    PROCESSING_TIMES_TTL_SECONDS: 24 * 3600, // 24 hours
    MAX_PROCESSING_TIMES_PER_HOUR: 1000,
  },

  // Rate Limiting
  RATE_LIMITS: {
    DEFAULT_HOURLY: 1000,
    DEFAULT_DAILY: 10000,
    HIGH_VOLUME_HOURLY: 10000,
    BASIC_HOURLY: 100,
    BASIC_DAILY: 1000,
    API_KEY_GENERAL: 1000,
  },

  // Time Constants (in milliseconds)
  TIME: {
    SECOND: 1000,
    MINUTE: 60 * 1000,
    HOUR: 60 * 60 * 1000,
    DAY: 24 * 60 * 60 * 1000,
    WEBHOOK_TIMESTAMP_DIVISOR: 1000, // Convert to Unix timestamp
    CACHE_TTL_SHORT: 300000, // 5 minutes
    CACHE_TTL_TEST: 1000,
  },

  // Time Constants (in seconds - for HTTP headers, etc.)
  TIME_SECONDS: {
    MINUTE: 60,
    HOUR: 60 * 60,
    DAY: 24 * 60 * 60, // 86400 seconds
    WEEK: 7 * 24 * 60 * 60, // 7 days in seconds
  },

  // Queue and Job Processing
  QUEUE: {
    INITIAL_BACKOFF_DELAY: 1000,
    EXPONENTIAL_BACKOFF_MULTIPLIER: 3000,
    MAX_BACKOFF_DELAY: 30000,
    PROCESSING_TIME_PRECISION_DIVISOR: 1000000, // nanoseconds to milliseconds
    SUCCESS_RATE_PRECISION_MULTIPLIER: 10000, // For percentage calculations
    DEFAULT_JOB_TIMEOUT: 30000,
    DEFAULT_MAX_RETRIES: 3,
    MAX_CONNECTION_RETRIES: 10,
    BULL_INITIAL_BACKOFF_DELAY: 2000,
    COMPLETED_JOBS_TO_KEEP: 100,
    COMPLETED_JOBS_AGE_SECONDS: 3600, // 1 hour

    // Priority-specific backoff delays
    HIGH_PRIORITY_BACKOFF: 1000, // 1 second
    NORMAL_PRIORITY_BACKOFF: 2000, // 2 seconds
    LOW_PRIORITY_BACKOFF: 5000, // 5 seconds

    // Bull queue priority values (lower = higher priority)
    HIGH_PRIORITY_VALUE: 1,
    NORMAL_PRIORITY_VALUE: 5,
    LOW_PRIORITY_VALUE: 10,
  },

  // Throttling Configuration
  THROTTLING: {
    GLOBAL_TTL: 60000, // 1 minute
    GLOBAL_LIMIT: 100,
    CREATE_TTL: 60000, // 1 minute
    CREATE_LIMIT: 10,
    EXPENSIVE_TTL: 300000, // 5 minutes
    EXPENSIVE_LIMIT: 5,
  },

  // Validation and Limits
  VALIDATION: {
    MAX_STRING_LENGTH_STANDARD: 1000,
    MAX_STRING_LENGTH_EXTREME: 10000,
    VARCHAR_DEFAULT_LENGTH: 255,
    INT_DEFAULT_VALUE: 0,
    TOLERANCE_MS_DEFAULT: 1000,
  },

  // Test Environment
  TEST: {
    MOCK_MESSAGE_ID: 'msg-123',
    TEST_EMAIL: 'test@example.com',
    ETHEREAL_SMTP_HOST: 'smtp.ethereal.email',
    ETHEREAL_SMTP_PORT: 587,
    TEST_ARRAY_ITERATIONS: 1000,
    STRESS_TEST_SIZE: 10000,
    CONCURRENT_TEST_OPERATIONS: 1000,
  },

  // HTTP Status Codes (commonly used)
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
  },

  // Database Configuration
  DATABASE: {
    DEFAULT_INT_VALUE: 0,
    STANDARD_VARCHAR_LENGTH: 255,
    LONG_TEXT_LENGTH: 1000,
  },
} as const;
