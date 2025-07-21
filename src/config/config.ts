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
}

export interface Config {
  app: AppConfig;
  database: DatabaseConfig;
}

// Interface for validated environment variables
export interface ValidatedEnv {
  NODE_ENV: 'development' | 'staging' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
}

// Clean Joi schema
const configSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
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
  const corsOrigins = getCorsOrigins(env.NODE_ENV);

  return {
    name: 'NotifyHub API',
    version: '1.0.0',
    port: env.PORT,
    environment: env.NODE_ENV,
    corsOrigins,
    apiPrefix: 'api/v1',
  };
}

function getCorsOrigins(environment: string): string[] {
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

