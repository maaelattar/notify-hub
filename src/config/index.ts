// Clean configuration exports
export * from './config';

// Re-export common config types
export type { ConfigService } from '@nestjs/config';

// Export configuration validators for testing
export { validateConfig } from './config';
export { validateNotificationConfig } from '../modules/notifications/config/notification.config';
