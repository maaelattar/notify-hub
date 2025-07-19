export class NotificationValidationException extends Error {
  constructor(public errors: string[]) {
    super(errors.join(', '));
    this.name = 'NotificationValidationException';
  }
}

export class InvalidNotificationStateException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNotificationStateException';
  }
}
