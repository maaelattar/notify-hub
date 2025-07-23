import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export interface NotificationConfig {
  maxRetries: number;
  defaultPageSize: number;
  maxPageSize: number;
  recentFailuresWindowMinutes: number;
  pendingNotificationsBatchSize: number;
  maxRecentFailuresDisplay: number;
}

interface ValidatedNotificationEnv {
  NOTIFICATION_MAX_RETRIES: number;
  NOTIFICATION_DEFAULT_PAGE_SIZE: number;
  NOTIFICATION_MAX_PAGE_SIZE: number;
  NOTIFICATION_RECENT_FAILURES_WINDOW_MINUTES: number;
  NOTIFICATION_PENDING_BATCH_SIZE: number;
  NOTIFICATION_MAX_RECENT_FAILURES_DISPLAY: number;
}

const notificationConfigSchema = Joi.object({
  NOTIFICATION_MAX_RETRIES: Joi.number().integer().min(1).max(10).default(3),
  NOTIFICATION_DEFAULT_PAGE_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(20),
  NOTIFICATION_MAX_PAGE_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100),
  NOTIFICATION_RECENT_FAILURES_WINDOW_MINUTES: Joi.number()
    .integer()
    .min(1)
    .max(1440)
    .default(60),
  NOTIFICATION_PENDING_BATCH_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100),
  NOTIFICATION_MAX_RECENT_FAILURES_DISPLAY: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(10),
});

export const notificationConfig = registerAs('notification', () => {
  const config = {
    NOTIFICATION_MAX_RETRIES: process.env.NOTIFICATION_MAX_RETRIES,
    NOTIFICATION_DEFAULT_PAGE_SIZE: process.env.NOTIFICATION_DEFAULT_PAGE_SIZE,
    NOTIFICATION_MAX_PAGE_SIZE: process.env.NOTIFICATION_MAX_PAGE_SIZE,
    NOTIFICATION_RECENT_FAILURES_WINDOW_MINUTES:
      process.env.NOTIFICATION_RECENT_FAILURES_WINDOW_MINUTES,
    NOTIFICATION_PENDING_BATCH_SIZE:
      process.env.NOTIFICATION_PENDING_BATCH_SIZE,
    NOTIFICATION_MAX_RECENT_FAILURES_DISPLAY:
      process.env.NOTIFICATION_MAX_RECENT_FAILURES_DISPLAY,
  };

  const result = notificationConfigSchema.validate(config, {
    allowUnknown: false,
    abortEarly: false,
  });

  if (result.error) {
    throw new Error(
      `Notification configuration validation error: ${result.error.message}`,
    );
  }

  const validatedEnv = result.value as ValidatedNotificationEnv;

  return {
    maxRetries: validatedEnv.NOTIFICATION_MAX_RETRIES,
    defaultPageSize: validatedEnv.NOTIFICATION_DEFAULT_PAGE_SIZE,
    maxPageSize: validatedEnv.NOTIFICATION_MAX_PAGE_SIZE,
    recentFailuresWindowMinutes:
      validatedEnv.NOTIFICATION_RECENT_FAILURES_WINDOW_MINUTES,
    pendingNotificationsBatchSize: validatedEnv.NOTIFICATION_PENDING_BATCH_SIZE,
    maxRecentFailuresDisplay:
      validatedEnv.NOTIFICATION_MAX_RECENT_FAILURES_DISPLAY,
  } as NotificationConfig;
});


