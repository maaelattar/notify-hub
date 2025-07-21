import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  constructor(
    message: string,
    code: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        message,
        code,
        statusCode: status,
      },
      status,
    );
  }
}

export class ResourceNotFoundException extends BusinessException {
  constructor(resource: string, id: string) {
    super(
      `${resource} with ID ${id} not found`,
      'RESOURCE_NOT_FOUND',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class InvalidStateException extends BusinessException {
  constructor(message: string) {
    super(message, 'INVALID_STATE', HttpStatus.BAD_REQUEST);
  }
}

export class DuplicateResourceException extends BusinessException {
  constructor(resource: string, field: string, value: string) {
    super(
      `${resource} with ${field} '${value}' already exists`,
      'DUPLICATE_RESOURCE',
      HttpStatus.CONFLICT,
    );
  }
}

export class ValidationException extends BusinessException {
  constructor(errors: Record<string, string[]>) {
    super('Validation failed', 'VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    const response = this.getResponse() as Record<string, unknown>;
    response.errors = errors;
  }
}
