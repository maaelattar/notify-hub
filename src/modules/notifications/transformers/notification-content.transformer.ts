import { ValueTransformer } from 'typeorm';
import { NotificationContent } from '../value-objects/notification-content.value-object';
import { Logger } from '@nestjs/common';

/**
 * TypeORM transformer for NotificationContent value object
 * Handles serialization/deserialization between database and application
 */
export class NotificationContentTransformer implements ValueTransformer {
  private readonly logger = new Logger(NotificationContentTransformer.name);

  /**
   * Transform from NotificationContent value object to database value
   */
  to(content: NotificationContent | null): string | null {
    if (!content) {
      return null;
    }

    try {
      // Serialize the value object to JSON for database storage
      return JSON.stringify(content.toJSON());
    } catch (error) {
      this.logger.error(
        'Failed to serialize NotificationContent for database storage',
        {
          error: error instanceof Error ? error.message : error,
          contentPreview: content.getPreview(100), // Safe preview for logging
          format: content.getFormat(),
          characterCount: content.getCharacterCount(),
        },
      );

      // Fallback to raw value to prevent data loss
      return content.getValue();
    }
  }

  /**
   * Transform from database value to NotificationContent value object
   */
  from(databaseValue: string | null): NotificationContent | null {
    if (!databaseValue) {
      return null;
    }

    try {
      // Try to parse as JSON first (new format)
      const parsed = JSON.parse(databaseValue);

      if (parsed.value && parsed.metadata) {
        return NotificationContent.fromJSON(parsed);
      }

      // Fallback: treat as raw value (legacy format)
      return this.createFromLegacyFormat(parsed.value ?? databaseValue);
    } catch (parseError) {
      // Not JSON, treat as legacy raw value
      this.logger.debug('Failed to parse JSON, treating as legacy format', {
        error:
          parseError instanceof Error
            ? parseError.message
            : 'Unknown parse error',
        valuePreview: databaseValue.substring(0, 50),
      });

      try {
        return this.createFromLegacyFormat(databaseValue);
      } catch (error) {
        this.logger.error(
          'Failed to deserialize NotificationContent from database',
          {
            error: error instanceof Error ? error.message : error,
            databaseValuePreview: databaseValue.substring(0, 100), // Truncate for logging
          },
        );

        // Return null to prevent application crash
        return null;
      }
    }
  }

  /**
   * Handle legacy format (raw string values)
   */
  private createFromLegacyFormat(value: string): NotificationContent {
    // Auto-detect format from raw value
    return NotificationContent.create(value);
  }
}

/**
 * Simplified transformer for cases where only the value is needed
 */
export class SimpleContentTransformer implements ValueTransformer {
  private readonly logger = new Logger(SimpleContentTransformer.name);

  /**
   * Transform from NotificationContent to string value
   */
  to(content: NotificationContent | null): string | null {
    return content ? content.getValue() : null;
  }

  /**
   * Transform from string to NotificationContent
   */
  from(databaseValue: string | null): NotificationContent | null {
    if (!databaseValue) {
      return null;
    }

    try {
      return NotificationContent.create(databaseValue);
    } catch (error) {
      this.logger.warn(
        'Failed to create NotificationContent from database value',
        {
          error: error instanceof Error ? error.message : error,
          databaseValuePreview: databaseValue.substring(0, 100),
        },
      );

      return null;
    }
  }
}

/**
 * Transformer for content that should be stored as plain text
 * Useful for compatibility with existing text columns
 */
export class PlainTextContentTransformer implements ValueTransformer {
  /**
   * Transform from NotificationContent to plain text
   */
  to(content: NotificationContent | null): string | null {
    return content ? content.getPlainText() : null;
  }

  /**
   * Transform from plain text to NotificationContent
   */
  from(databaseValue: string | null): NotificationContent | null {
    return databaseValue ? NotificationContent.text(databaseValue) : null;
  }
}
