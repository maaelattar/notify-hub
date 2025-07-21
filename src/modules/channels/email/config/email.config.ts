import { registerAs } from '@nestjs/config';
import { EmailConfig } from '../interfaces/email-config.interface';

export default registerAs('email', (): EmailConfig => {
  // Validate production SMTP requirements
  const isProduction = process.env.NODE_ENV === 'production';
  const hasSmtpHost = !!process.env.SMTP_HOST;

  if (isProduction && !hasSmtpHost) {
    throw new Error('SMTP_HOST is required in production environment');
  }

  if (isProduction && (!process.env.SMTP_USER || !process.env.SMTP_PASS)) {
    throw new Error(
      'SMTP_USER and SMTP_PASS are required in production environment',
    );
  }

  return {
    transport: {
      host: process.env.SMTP_HOST ?? 'smtp.ethereal.email',
      port: parseInt(process.env.SMTP_PORT ?? '587', 10) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
      },
      // Additional options for production
      pool: true, // Use pooled connections
      maxConnections:
        parseInt(process.env.SMTP_MAX_CONNECTIONS ?? '5', 10) || 5,
      maxMessages: parseInt(process.env.SMTP_MAX_MESSAGES ?? '100', 10) || 100,
      rateDelta: parseInt(process.env.SMTP_RATE_DELTA ?? '1000', 10) || 1000, // How often to check rate limit
      rateLimit: parseInt(process.env.SMTP_RATE_LIMIT ?? '5', 10) || 5, // Messages per rateDelta
    },
    defaults: {
      from: process.env.SMTP_FROM || '"NotifyHub" <noreply@notifyhub.com>',
      replyTo: process.env.SMTP_REPLY_TO,
    },
    // Development settings
    ethereal: {
      enabled: process.env.NODE_ENV === 'development' && !process.env.SMTP_HOST,
    },
    // Template settings
    templates: {
      viewPath: __dirname + '/../templates',
      cache: process.env.NODE_ENV === 'production',
    },
  };
});
