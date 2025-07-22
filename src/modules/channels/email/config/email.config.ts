import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
import { EmailConfig } from '../interfaces/email-config.interface';

interface ValidatedEmailEnv {
  NODE_ENV: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_MAX_CONNECTIONS?: number;
  SMTP_MAX_MESSAGES?: number;
  SMTP_RATE_DELTA?: number;
  SMTP_RATE_LIMIT?: number;
  SMTP_FROM?: string;
  SMTP_REPLY_TO?: string;
}

const emailConfigSchema = Joi.object({
  NODE_ENV: Joi.string().required(),
  SMTP_HOST: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().hostname().required(),
    otherwise: Joi.string().hostname().optional().allow(''),
  }),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().optional().allow(''),
  }),
  SMTP_PASS: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().optional().allow(''),
  }),
  SMTP_MAX_CONNECTIONS: Joi.number().integer().min(1).max(20).default(5),
  SMTP_MAX_MESSAGES: Joi.number().integer().min(1).max(1000).default(100),
  SMTP_RATE_DELTA: Joi.number().integer().min(100).max(10000).default(1000),
  SMTP_RATE_LIMIT: Joi.number().integer().min(1).max(100).default(5),
  SMTP_FROM: Joi.string()
    .email()
    .default('"NotifyHub" <noreply@notifyhub.com>'),
  SMTP_REPLY_TO: Joi.string().email().optional().allow(''),
});

function validateEmailConfig(env: Record<string, unknown>): ValidatedEmailEnv {
  const result = emailConfigSchema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
  });

  if (result.error) {
    throw new Error(
      `Email configuration validation failed: ${result.error.details
        .map((detail) => detail.message)
        .join(', ')}`,
    );
  }

  return result.value as ValidatedEmailEnv;
}

export default registerAs('email', (): EmailConfig => {
  const validatedEnv = validateEmailConfig(process.env);

  return {
    transport: {
      host: validatedEnv.SMTP_HOST ?? 'smtp.ethereal.email',
      port: validatedEnv.SMTP_PORT!,
      secure: validatedEnv.SMTP_SECURE!,
      auth: {
        user: validatedEnv.SMTP_USER ?? '',
        pass: validatedEnv.SMTP_PASS ?? '',
      },
      // Additional options for production
      pool: true, // Use pooled connections
      maxConnections: validatedEnv.SMTP_MAX_CONNECTIONS!,
      maxMessages: validatedEnv.SMTP_MAX_MESSAGES!,
      rateDelta: validatedEnv.SMTP_RATE_DELTA!, // How often to check rate limit
      rateLimit: validatedEnv.SMTP_RATE_LIMIT!, // Messages per rateDelta
    },
    defaults: {
      from: validatedEnv.SMTP_FROM!,
      replyTo: validatedEnv.SMTP_REPLY_TO,
    },
    // Development settings
    ethereal: {
      enabled:
        validatedEnv.NODE_ENV === 'development' && !validatedEnv.SMTP_HOST,
    },
    // Template settings
    templates: {
      viewPath: __dirname + '/../templates',
      cache: validatedEnv.NODE_ENV === 'production',
    },
  };
});
