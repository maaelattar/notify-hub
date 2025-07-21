import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEmail,
  Matches,
  IsOptional,
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannel } from '../../modules/notifications/enums/notification-channel.enum';

/**
 * Custom validation decorator for notification recipients
 * Validates email, phone, webhook URL, or device token based on format
 */
export function IsNotificationRecipient(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotificationRecipient',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== 'string') return false;

          const trimmed = value.trim();

          // Email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (emailRegex.test(trimmed)) return true;

          // Phone format (E.164)
          const phoneRegex = /^\+?[1-9]\d{1,14}$/;
          if (phoneRegex.test(trimmed.replace(/[\s\-\(\)]/g, ''))) return true;

          // URL format
          try {
            const url = new URL(trimmed);
            if (['http:', 'https:'].includes(url.protocol)) return true;
          } catch {}

          // Device token format (hex or base64)
          const hexRegex = /^[a-fA-F0-9]{8,}$/;
          const base64Regex = /^[A-Za-z0-9+/=]{8,}$/;
          if (
            trimmed.length >= 8 &&
            trimmed.length <= 4096 &&
            (hexRegex.test(trimmed) || base64Regex.test(trimmed))
          ) {
            return true;
          }

          return false;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid email, phone number, URL, or device token`;
        },
      },
    });
  };
}

/**
 * Custom validation decorator for notification content
 * Validates content length and checks for suspicious patterns
 */
export function IsNotificationContent(
  maxLength: number = 50000,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotificationContent',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== 'string') return false;

          const trimmed = value.trim();

          // Length validation
          if (trimmed.length === 0 || trimmed.length > maxLength) return false;

          // Security validation - check for suspicious patterns
          const suspiciousPatterns = [
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            /javascript:/gi,
            /on\w+\s*=/gi, // Event handlers
            /data:text\/html/gi,
          ];

          if (suspiciousPatterns.some((pattern) => pattern.test(trimmed))) {
            return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be valid content without malicious patterns (max ${maxLength} characters)`;
        },
      },
    });
  };
}

/**
 * Custom validation decorator for notification subject
 * Validates subject for different channels
 */
export function IsNotificationSubject(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotificationSubject',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          // Subject is optional, so null/undefined is valid
          if (value === null || value === undefined) return true;

          if (typeof value !== 'string') return false;

          const trimmed = value.trim();

          // Length validation
          if (trimmed.length > 255) return false;

          // Get the notification object to check channel
          const notification = args.object as any;
          const channel = notification.channel;

          // SMS notifications should not have subjects
          if (channel === NotificationChannel.SMS && trimmed.length > 0) {
            return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid subject (max 255 characters, not allowed for SMS)`;
        },
      },
    });
  };
}

/**
 * Composite decorator for notification recipient field
 */
export function NotificationRecipientField() {
  return applyDecorators(
    ApiProperty({
      description:
        'The recipient identifier (email, phone, device token, or webhook URL)',
      example: 'user@example.com',
      maxLength: 255,
    }),
    IsString(),
    IsNotEmpty(),
    MaxLength(255),
    IsNotificationRecipient(),
  );
}

/**
 * Composite decorator for notification subject field
 */
export function NotificationSubjectField() {
  return applyDecorators(
    ApiPropertyOptional({
      description: 'Subject line (required for email, optional for others)',
      example: 'Welcome to NotifyHub!',
      maxLength: 255,
    }),
    IsOptional(),
    IsString(),
    MaxLength(255),
    IsNotificationSubject(),
  );
}

/**
 * Composite decorator for notification content field
 */
export function NotificationContentField(maxLength: number = 50000) {
  return applyDecorators(
    ApiProperty({
      description: 'The main content of the notification',
      example: 'Thank you for signing up. Click here to get started...',
      maxLength,
    }),
    IsString(),
    IsNotEmpty(),
    IsNotificationContent(maxLength),
  );
}

/**
 * Composite decorator for email field
 */
export function EmailField() {
  return applyDecorators(
    ApiProperty({
      description: 'Email address',
      example: 'user@example.com',
      format: 'email',
    }),
    IsString(),
    IsNotEmpty(),
    IsEmail(),
    MaxLength(255),
  );
}

/**
 * Composite decorator for phone field
 */
export function PhoneField() {
  return applyDecorators(
    ApiProperty({
      description: 'Phone number in international format',
      example: '+1234567890',
    }),
    IsString(),
    IsNotEmpty(),
    Matches(/^\+?[1-9]\d{1,14}$/, {
      message: 'Phone number must be in international format (E.164)',
    }),
  );
}

/**
 * Composite decorator for URL field
 */
export function UrlField() {
  return applyDecorators(
    ApiProperty({
      description: 'Valid HTTP or HTTPS URL',
      example: 'https://example.com/webhook',
    }),
    IsString(),
    IsNotEmpty(),
    Matches(/^https?:\/\/.+/, {
      message: 'URL must be a valid HTTP or HTTPS URL',
    }),
  );
}
