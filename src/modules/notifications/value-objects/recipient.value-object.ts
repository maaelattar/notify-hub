import { NotificationChannel } from '../enums/notification-channel.enum';

export class InvalidRecipientError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'INVALID_RECIPIENT',
  ) {
    super(message);
    this.name = 'InvalidRecipientError';
  }
}

export enum RecipientType {
  EMAIL = 'email',
  PHONE = 'phone',
  WEBHOOK_URL = 'webhook_url',
  DEVICE_TOKEN = 'device_token',
}

export interface RecipientMetadata {
  type: RecipientType;
  domain?: string;
  countryCode?: string;
  isSecure?: boolean;
  isVerified?: boolean;
  [key: string]: any;
}

/**
 * Recipient Value Object - Encapsulates recipient validation and behavior
 * Prevents primitive obsession and provides domain-specific operations
 */
export class Recipient {
  private constructor(
    private readonly value: string,
    private readonly metadata: RecipientMetadata,
  ) {
    this.validate();
  }

  /**
   * Factory method for email recipients
   */
  static email(email: string, isVerified: boolean = false): Recipient {
    const trimmed = email.trim().toLowerCase();

    if (!this.isValidEmailFormat(trimmed)) {
      throw new InvalidRecipientError(
        `Invalid email format: ${email}`,
        'INVALID_EMAIL_FORMAT',
      );
    }

    const domain = trimmed.split('@')[1];

    return new Recipient(trimmed, {
      type: RecipientType.EMAIL,
      domain,
      isVerified,
    });
  }

  /**
   * Factory method for phone number recipients
   */
  static phone(phone: string, countryCode?: string): Recipient {
    const cleaned = phone.replace(/[\s\-\(\)]/g, ''); // Remove formatting

    if (!this.isValidPhoneFormat(cleaned)) {
      throw new InvalidRecipientError(
        `Invalid phone format: ${phone}`,
        'INVALID_PHONE_FORMAT',
      );
    }

    // Extract country code if not provided
    let detectedCountryCode = countryCode;
    if (!detectedCountryCode && cleaned.startsWith('+')) {
      detectedCountryCode = this.extractCountryCode(cleaned);
    }

    return new Recipient(cleaned, {
      type: RecipientType.PHONE,
      countryCode: detectedCountryCode,
    });
  }

  /**
   * Factory method for webhook URL recipients
   */
  static webhookUrl(url: string): Recipient {
    const trimmed = url.trim();

    if (!this.isValidUrlFormat(trimmed)) {
      throw new InvalidRecipientError(
        `Invalid webhook URL format: ${url}`,
        'INVALID_WEBHOOK_URL',
      );
    }

    const isSecure = trimmed.startsWith('https://');
    const urlObj = new URL(trimmed);

    return new Recipient(trimmed, {
      type: RecipientType.WEBHOOK_URL,
      domain: urlObj.hostname,
      isSecure,
    });
  }

  /**
   * Factory method for device token recipients (push notifications)
   */
  static deviceToken(token: string): Recipient {
    const trimmed = token.trim();

    if (!this.isValidDeviceTokenFormat(trimmed)) {
      throw new InvalidRecipientError(
        `Invalid device token format: ${token}`,
        'INVALID_DEVICE_TOKEN',
      );
    }

    return new Recipient(trimmed, {
      type: RecipientType.DEVICE_TOKEN,
    });
  }

  /**
   * Smart factory method that auto-detects recipient type
   */
  static create(value: string, channel?: NotificationChannel): Recipient {
    const trimmed = value.trim();

    // Use channel hint if provided
    if (channel) {
      switch (channel) {
        case NotificationChannel.EMAIL:
          return this.email(trimmed);
        case NotificationChannel.SMS:
          return this.phone(trimmed);
        case NotificationChannel.WEBHOOK:
          return this.webhookUrl(trimmed);
        case NotificationChannel.PUSH:
          return this.deviceToken(trimmed);
      }
    }

    // Auto-detect based on format
    if (this.isValidEmailFormat(trimmed)) {
      return this.email(trimmed);
    }

    if (this.isValidPhoneFormat(trimmed)) {
      return this.phone(trimmed);
    }

    if (this.isValidUrlFormat(trimmed)) {
      return this.webhookUrl(trimmed);
    }

    if (this.isValidDeviceTokenFormat(trimmed)) {
      return this.deviceToken(trimmed);
    }

    throw new InvalidRecipientError(
      `Could not determine recipient type for: ${value}`,
      'UNKNOWN_RECIPIENT_TYPE',
    );
  }

  /**
   * Get the raw recipient value
   */
  getValue(): string {
    return this.value;
  }

  /**
   * Get recipient metadata
   */
  getMetadata(): RecipientMetadata {
    return { ...this.metadata };
  }

  /**
   * Get recipient type
   */
  getType(): RecipientType {
    return this.metadata.type;
  }

  /**
   * Check if recipient is compatible with notification channel
   */
  isCompatibleWith(channel: NotificationChannel): boolean {
    switch (channel) {
      case NotificationChannel.EMAIL:
        return this.metadata.type === RecipientType.EMAIL;
      case NotificationChannel.SMS:
        return this.metadata.type === RecipientType.PHONE;
      case NotificationChannel.WEBHOOK:
        return this.metadata.type === RecipientType.WEBHOOK_URL;
      case NotificationChannel.PUSH:
        return this.metadata.type === RecipientType.DEVICE_TOKEN;
      default:
        return false;
    }
  }

  /**
   * Get domain for email or webhook recipients
   */
  getDomain(): string | null {
    return this.metadata.domain || null;
  }

  /**
   * Check if recipient is verified
   */
  isVerified(): boolean {
    return this.metadata.isVerified || false;
  }

  /**
   * Check if webhook recipient uses HTTPS
   */
  isSecure(): boolean {
    return this.metadata.isSecure || false;
  }

  /**
   * Get country code for phone recipients
   */
  getCountryCode(): string | null {
    return this.metadata.countryCode || null;
  }

  /**
   * Create a masked version for logging (privacy protection)
   */
  getMaskedValue(): string {
    switch (this.metadata.type) {
      case RecipientType.EMAIL:
        const [local, domain] = this.value.split('@');
        const maskedLocal =
          local.length > 2
            ? `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}`
            : local;
        return `${maskedLocal}@${domain}`;

      case RecipientType.PHONE:
        return this.value.length > 4
          ? `${this.value.substring(0, 4)}${'*'.repeat(this.value.length - 8)}${this.value.substring(this.value.length - 4)}`
          : this.value;

      case RecipientType.WEBHOOK_URL:
        const url = new URL(this.value);
        return `${url.protocol}//${url.hostname}/***`;

      case RecipientType.DEVICE_TOKEN:
        return this.value.length > 8
          ? `${this.value.substring(0, 8)}***${this.value.substring(this.value.length - 8)}`
          : this.value;

      default:
        return '***';
    }
  }

  /**
   * Equality comparison
   */
  equals(other: Recipient): boolean {
    return (
      this.value === other.value && this.metadata.type === other.metadata.type
    );
  }

  /**
   * String representation
   */
  toString(): string {
    return this.value;
  }

  /**
   * JSON representation for serialization
   */
  toJSON(): { value: string; metadata: RecipientMetadata } {
    return {
      value: this.value,
      metadata: this.metadata,
    };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: {
    value: string;
    metadata: RecipientMetadata;
  }): Recipient {
    return new Recipient(json.value, json.metadata);
  }

  // Private validation methods
  private validate(): void {
    if (!this.value || this.value.trim().length === 0) {
      throw new InvalidRecipientError(
        'Recipient value cannot be empty',
        'EMPTY_RECIPIENT',
      );
    }

    if (this.value.length > 255) {
      throw new InvalidRecipientError(
        'Recipient value exceeds maximum length of 255 characters',
        'RECIPIENT_TOO_LONG',
      );
    }

    // Check for potentially malicious content
    if (this.containsSuspiciousContent(this.value)) {
      throw new InvalidRecipientError(
        'Recipient contains potentially harmful characters',
        'SUSPICIOUS_RECIPIENT',
      );
    }
  }

  private containsSuspiciousContent(value: string): boolean {
    const suspiciousPatterns = [
      /[<>'"]/, // HTML/XML characters
      /[{}]/, // Template injection
      /[;|&]/, // Command injection
      /\x00/, // Null bytes
      /javascript:/i, // JavaScript protocol
      /data:/i, // Data URLs
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(value));
  }

  // Static validation methods
  private static isValidEmailFormat(email: string): boolean {
    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return emailRegex.test(email) && email.length <= 254; // RFC 5321 limit
  }

  private static isValidPhoneFormat(phone: string): boolean {
    // E.164 international phone number format
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
  }

  private static isValidUrlFormat(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
      return false;
    }
  }

  private static isValidDeviceTokenFormat(token: string): boolean {
    // Device tokens are typically hex strings or base64
    const hexRegex = /^[a-fA-F0-9]{8,}$/;
    const base64Regex = /^[A-Za-z0-9+/=]{8,}$/;

    return (
      token.length >= 8 &&
      token.length <= 4096 &&
      (hexRegex.test(token) || base64Regex.test(token))
    );
  }

  private static extractCountryCode(phone: string): string | undefined {
    // Basic country code extraction (simplified)
    const match = phone.match(/^\+(\d{1,4})/);
    return match ? match[1] : undefined;
  }
}
