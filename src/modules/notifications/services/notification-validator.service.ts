import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { CreateNotificationDto } from '../dto/create-notification.dto';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  context?: Record<string, any>;
}

export class ValidationContext {
  private errors: ValidationError[] = [];
  
  constructor(private readonly dto: CreateNotificationDto) {}

  addError(field: string, code: string, message: string, context?: Record<string, any>): void {
    this.errors.push({ field, code, message, context });
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  getErrors(): ValidationError[] {
    return [...this.errors];
  }

  getDto(): CreateNotificationDto {
    return this.dto;
  }

  getResult(): ValidationResult {
    return {
      isValid: !this.hasErrors(),
      errors: this.getErrors(),
    };
  }
}

// Base validator interface
export interface INotificationValidator {
  validate(context: ValidationContext): Promise<void> | void;
}

// Email notification validator
@Injectable()
export class EmailNotificationValidator implements INotificationValidator {
  validate(context: ValidationContext): void {
    const dto = context.getDto();
    
    if (dto.channel !== NotificationChannel.EMAIL) {
      return;
    }

    // Subject is required for email
    if (!dto.subject || dto.subject.trim().length === 0) {
      context.addError(
        'subject',
        'SUBJECT_REQUIRED',
        'Subject is required for email notifications',
        { channel: dto.channel }
      );
    }

    // Validate email format
    if (!this.isValidEmailFormat(dto.recipient)) {
      context.addError(
        'recipient',
        'INVALID_EMAIL_FORMAT',
        'Recipient must be a valid email address',
        { 
          channel: dto.channel,
          recipient: dto.recipient,
          expectedFormat: 'email@domain.com'
        }
      );
    }

    // Email-specific length constraints
    if (dto.subject && dto.subject.length > 255) {
      context.addError(
        'subject',
        'SUBJECT_TOO_LONG',
        'Email subject must be 255 characters or less',
        { 
          channel: dto.channel,
          currentLength: dto.subject.length,
          maxLength: 255
        }
      );
    }
  }

  private isValidEmailFormat(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

// SMS notification validator
@Injectable() 
export class SmsNotificationValidator implements INotificationValidator {
  private readonly SMS_MAX_LENGTH = 160;

  validate(context: ValidationContext): void {
    const dto = context.getDto();
    
    if (dto.channel !== NotificationChannel.SMS) {
      return;
    }

    // Validate phone number format
    if (!this.isValidPhoneFormat(dto.recipient)) {
      context.addError(
        'recipient',
        'INVALID_PHONE_FORMAT',
        'Recipient must be a valid phone number',
        {
          channel: dto.channel,
          recipient: dto.recipient,
          expectedFormat: '+1234567890 or international format'
        }
      );
    }

    // SMS content length validation
    if (dto.content.length > this.SMS_MAX_LENGTH) {
      context.addError(
        'content',
        'SMS_CONTENT_TOO_LONG',
        `SMS content must be ${this.SMS_MAX_LENGTH} characters or less`,
        {
          channel: dto.channel,
          currentLength: dto.content.length,
          maxLength: this.SMS_MAX_LENGTH
        }
      );
    }

    // Subject should not be used for SMS
    if (dto.subject && dto.subject.trim().length > 0) {
      context.addError(
        'subject',
        'SUBJECT_NOT_ALLOWED',
        'Subject is not supported for SMS notifications',
        { channel: dto.channel }
      );
    }
  }

  private isValidPhoneFormat(phone: string): boolean {
    // International phone number format (E.164)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
  }
}

// Webhook notification validator
@Injectable()
export class WebhookNotificationValidator implements INotificationValidator {
  validate(context: ValidationContext): void {
    const dto = context.getDto();
    
    if (dto.channel !== NotificationChannel.WEBHOOK) {
      return;
    }

    // Validate URL format
    if (!this.isValidUrl(dto.recipient)) {
      context.addError(
        'recipient',
        'INVALID_WEBHOOK_URL',
        'Recipient must be a valid URL for webhook notifications',
        {
          channel: dto.channel,
          recipient: dto.recipient,
          expectedFormat: 'https://example.com/webhook'
        }
      );
    }

    // Webhook security validations
    if (!this.isSecureUrl(dto.recipient)) {
      context.addError(
        'recipient',
        'INSECURE_WEBHOOK_URL',
        'Webhook URLs should use HTTPS for security',
        {
          channel: dto.channel,
          recipient: dto.recipient
        }
      );
    }
  }

  private isValidUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private isSecureUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      return url.protocol === 'https:';
    } catch {
      return false;
    }
  }
}

// Content validation (applies to all channels)
@Injectable()
export class ContentValidator implements INotificationValidator {
  private readonly MAX_CONTENT_LENGTH = 50000;
  private readonly MIN_CONTENT_LENGTH = 1;

  validate(context: ValidationContext): void {
    const dto = context.getDto();

    // Content length validation
    if (dto.content.length < this.MIN_CONTENT_LENGTH) {
      context.addError(
        'content',
        'CONTENT_EMPTY',
        'Content cannot be empty',
        {
          currentLength: dto.content.length,
          minLength: this.MIN_CONTENT_LENGTH
        }
      );
    }

    if (dto.content.length > this.MAX_CONTENT_LENGTH) {
      context.addError(
        'content',
        'CONTENT_TOO_LONG',
        `Content must be ${this.MAX_CONTENT_LENGTH} characters or less`,
        {
          currentLength: dto.content.length,
          maxLength: this.MAX_CONTENT_LENGTH
        }
      );
    }

    // Check for potentially malicious content
    if (this.containsSuspiciousContent(dto.content)) {
      context.addError(
        'content',
        'SUSPICIOUS_CONTENT',
        'Content contains potentially harmful elements',
        {
          contentPreview: dto.content.substring(0, 100)
        }
      );
    }
  }

  private containsSuspiciousContent(content: string): boolean {
    // Basic checks for suspicious patterns
    const suspiciousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi, // Event handlers like onclick=
      /data:text\/html/gi,
    ];

    return suspiciousPatterns.some(pattern => pattern.test(content));
  }
}

// Recipient format validator (general format validation)
@Injectable()
export class RecipientFormatValidator implements INotificationValidator {
  validate(context: ValidationContext): void {
    const dto = context.getDto();

    // Basic recipient validation (non-empty, reasonable length)
    if (!dto.recipient || dto.recipient.trim().length === 0) {
      context.addError(
        'recipient',
        'RECIPIENT_EMPTY',
        'Recipient cannot be empty',
        { channel: dto.channel }
      );
      return;
    }

    if (dto.recipient.length > 255) {
      context.addError(
        'recipient',
        'RECIPIENT_TOO_LONG',
        'Recipient must be 255 characters or less',
        {
          channel: dto.channel,
          currentLength: dto.recipient.length,
          maxLength: 255
        }
      );
    }

    // Check for potentially malicious recipient values
    if (this.containsSuspiciousRecipient(dto.recipient)) {
      context.addError(
        'recipient',
        'SUSPICIOUS_RECIPIENT',
        'Recipient contains potentially harmful characters',
        {
          channel: dto.channel,
          recipient: dto.recipient.substring(0, 50)
        }
      );
    }
  }

  private containsSuspiciousRecipient(recipient: string): boolean {
    // Check for patterns that might indicate injection attempts
    const suspiciousPatterns = [
      /[<>'"]/,  // HTML/XML characters
      /[{}]/,    // Template injection
      /[;|&]/,   // Command injection
      /\x00/,    // Null bytes
    ];

    return suspiciousPatterns.some(pattern => pattern.test(recipient));
  }
}

// Main notification validator service
@Injectable()
export class NotificationValidatorService {
  private readonly validators: INotificationValidator[] = [
    new EmailNotificationValidator(),
    new SmsNotificationValidator(),
    new WebhookNotificationValidator(),
    new ContentValidator(),
    new RecipientFormatValidator(),
  ];

  async validate(dto: CreateNotificationDto): Promise<ValidationResult> {
    const context = new ValidationContext(dto);

    // Run all validators
    for (const validator of this.validators) {
      await validator.validate(context);
      
      // Early exit if critical errors found (optional optimization)
      // if (context.hasErrors()) break;
    }

    return context.getResult();
  }

  /**
   * Validate with detailed error categorization
   */
  async validateWithCategories(dto: CreateNotificationDto): Promise<{
    isValid: boolean;
    criticalErrors: ValidationError[];
    warningErrors: ValidationError[];
    allErrors: ValidationError[];
  }> {
    const result = await this.validate(dto);
    
    const criticalCodes = [
      'RECIPIENT_EMPTY',
      'CONTENT_EMPTY', 
      'INVALID_EMAIL_FORMAT',
      'INVALID_PHONE_FORMAT',
      'INVALID_WEBHOOK_URL',
      'SUSPICIOUS_CONTENT',
      'SUSPICIOUS_RECIPIENT'
    ];

    const criticalErrors = result.errors.filter(error => 
      criticalCodes.includes(error.code)
    );
    
    const warningErrors = result.errors.filter(error => 
      !criticalCodes.includes(error.code)
    );

    return {
      isValid: result.isValid,
      criticalErrors,
      warningErrors,
      allErrors: result.errors,
    };
  }
}