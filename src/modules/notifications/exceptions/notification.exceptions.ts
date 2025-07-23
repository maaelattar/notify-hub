import { NotFoundException, BadRequestException } from '@nestjs/common';

export class NotificationNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Notification with ID "${id}" not found`);
  }
}

export class NotificationUpdateFailedException extends BadRequestException {
  constructor(id: string, reason?: string) {
    const message = reason
      ? `Failed to update notification "${id}": ${reason}`
      : `Failed to update notification "${id}"`;
    super(message);
  }
}

export class NotificationDeleteFailedException extends BadRequestException {
  constructor(id: string) {
    super(`Failed to delete notification "${id}": notification not found`);
  }
}

export class NotificationOperationFailedException extends BadRequestException {
  constructor(operation: string, id: string, reason?: string) {
    const message = reason
      ? `Failed to ${operation} notification "${id}": ${reason}`
      : `Failed to ${operation} notification "${id}"`;
    super(message);
  }
}
