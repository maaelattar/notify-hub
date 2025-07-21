import { ValueTransformer } from 'typeorm';
import { Recipient } from '../value-objects/recipient.value-object';
import { Logger } from '@nestjs/common';

/**
 * TypeORM transformer for Recipient value object
 * Handles serialization/deserialization between database and application
 */
export class RecipientTransformer implements ValueTransformer {
  private readonly logger = new Logger(RecipientTransformer.name);

  /**
   * Transform from Recipient value object to database value
   */
  to(recipient: Recipient | null): string | null {
    if (!recipient) {
      return null;
    }

    try {
      // Serialize the value object to JSON for database storage
      return JSON.stringify(recipient.toJSON());
    } catch (error) {
      this.logger.error('Failed to serialize Recipient for database storage', {
        error: error instanceof Error ? error.message : error,
        recipientValue: recipient.getMaskedValue(), // Use masked value for security
      });
      
      // Fallback to raw value to prevent data loss
      return recipient.getValue();
    }
  }

  /**
   * Transform from database value to Recipient value object
   */
  from(databaseValue: string | null): Recipient | null {
    if (!databaseValue) {
      return null;
    }

    try {
      // Try to parse as JSON first (new format)
      const parsed = JSON.parse(databaseValue);
      
      if (parsed.value && parsed.metadata) {
        return Recipient.fromJSON(parsed);
      }
      
      // Fallback: treat as raw value (legacy format)
      return this.createFromLegacyFormat(parsed.value || databaseValue);
    } catch (parseError) {
      // Not JSON, treat as legacy raw value
      try {
        return this.createFromLegacyFormat(databaseValue);
      } catch (error) {
        this.logger.error('Failed to deserialize Recipient from database', {
          error: error instanceof Error ? error.message : error,
          databaseValue: databaseValue.substring(0, 50), // Truncate for logging
        });
        
        // Return null to prevent application crash
        return null;
      }
    }
  }

  /**
   * Handle legacy format (raw string values)
   */
  private createFromLegacyFormat(value: string): Recipient {
    // Try to auto-detect recipient type from raw value
    return Recipient.create(value);
  }
}

/**
 * Simplified transformer for cases where only the value is needed
 */
export class SimpleRecipientTransformer implements ValueTransformer {
  private readonly logger = new Logger(SimpleRecipientTransformer.name);

  /**
   * Transform from Recipient to string value
   */
  to(recipient: Recipient | null): string | null {
    return recipient ? recipient.getValue() : null;
  }

  /**
   * Transform from string to Recipient
   */
  from(databaseValue: string | null): Recipient | null {
    if (!databaseValue) {
      return null;
    }

    try {
      return Recipient.create(databaseValue);
    } catch (error) {
      this.logger.warn('Failed to create Recipient from database value', {
        error: error instanceof Error ? error.message : error,
        databaseValue: databaseValue.substring(0, 50),
      });
      
      return null;
    }
  }
}