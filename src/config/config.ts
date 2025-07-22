import * as Joi from 'joi';
import { registerAs } from '@nestjs/config';

// Simple interfaces for type safety
export interface DatabaseConfig {
  url: string;
  synchronize: boolean;
  logging: boolean;
}

export interface AppConfig {
  name: string;
  version: string;
  port: number;
  environment: string;
  corsOrigins: string[];
  apiPrefix: string;
  baseUrl: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export interface SecurityConfig {
  jwtSecret: string;
}

export interface Config {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  security: SecurityConfig;
}

// Interface for validated environment variables
export interface ValidatedEnv {
  NODE_ENV: 'development' | 'staging' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  CORS_ORIGIN?: string;
  JWT_SECRET: string;
  API_BASE_URL: string;
}

// Clean Joi schema
const configSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri().required(),

  // Redis configuration
  REDIS_HOST: Joi.string().hostname().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  // CORS configuration
  CORS_ORIGIN: Joi.string().optional().allow(''),

  // Security configuration
  JWT_SECRET: Joi.string().min(32).required(),

  // API configuration
  API_BASE_URL: Joi.string().uri().default('http://localhost:3000'),
});

// Simple validation function
export function validateConfig(config: Record<string, unknown>): ValidatedEnv {
  const result = configSchema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
  });

  if (result.error) {
    throw new Error(
      `Configuration validation failed: ${result.error.details
        .map((detail) => detail.message)
        .join(', ')}`,
    );
  }

  return result.value as ValidatedEnv;
}

// Simple transformation functions
function createDatabaseConfig(env: ValidatedEnv): DatabaseConfig {
  const isDevelopment = env.NODE_ENV === 'development';

  return {
    url: env.DATABASE_URL,
    synchronize: isDevelopment,
    logging: isDevelopment,
  };
}

function createAppConfig(env: ValidatedEnv): AppConfig {
  const corsOrigins = getCorsOrigins(env.NODE_ENV, env.CORS_ORIGIN);

  return {
    name: 'NotifyHub API',
    version: '1.0.0',
    port: env.PORT,
    environment: env.NODE_ENV,
    corsOrigins,
    apiPrefix: 'api/v1',
    baseUrl: env.API_BASE_URL,
  };
}

function createRedisConfig(env: ValidatedEnv): RedisConfig {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
  };
}

function createSecurityConfig(env: ValidatedEnv): SecurityConfig {
  return {
    jwtSecret: env.JWT_SECRET,
  };
}

function getCorsOrigins(environment: string, corsOrigin?: string): string[] {
  // If CORS_ORIGIN is explicitly set, use it
  if (corsOrigin) {
    return corsOrigin.split(',').map((origin) => origin.trim());
  }

  // Default origins based on environment
  switch (environment) {
    case 'production':
      return ['https://notifyhub.app'];
    case 'staging':
      return ['https://staging.notifyhub.app'];
    default:
      return ['http://localhost:3000', 'http://localhost:3001'];
  }
}

// Register configurations
export const appConfig = registerAs('app', () => {
  const validatedEnv = validateConfig(process.env);
  return createAppConfig(validatedEnv);
});

export const databaseConfig = registerAs('database', () => {
  const validatedEnv = validateConfig(process.env);
  return createDatabaseConfig(validatedEnv);
});

export const redisConfig = registerAs('redis', () => {
  const validatedEnv = validateConfig(process.env);
  return createRedisConfig(validatedEnv);
});

export const securityConfig = registerAs('security', () => {
  const validatedEnv = validateConfig(process.env);
  return createSecurityConfig(validatedEnv);
});
