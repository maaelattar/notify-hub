import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    example: 'Validation failed',
    description: 'Human-readable error message',
  })
  message: string;

  @ApiProperty({
    example: 'VALIDATION_ERROR',
    description: 'Machine-readable error code',
  })
  code: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Request ID for tracking',
  })
  requestId: string;

  @ApiProperty({ example: '2024-01-01T00:00:00Z' })
  timestamp: string;

  @ApiProperty({
    example: '/api/v1/notifications',
    description: 'Request path',
  })
  path: string;

  @ApiProperty({
    example: {
      field1: ['Field is required'],
      field2: ['Must be a valid email'],
    },
    description: 'Field-level validation errors',
    required: false,
  })
  errors?: Record<string, string[]>;

  @ApiProperty({
    example: { userId: '123' },
    description: 'Additional error context',
    required: false,
  })
  context?: Record<string, any>;

  @ApiProperty({
    example: {
      message: 'Please check the request format and ensure all required fields are provided correctly.',
      documentation: 'http://localhost:3000/api#/notifications',
      actions: ['Verify all required fields are provided', 'Check data types match the schema']
    },
    description: 'Actionable guidance for resolving the error',
    required: false,
  })
  guidance?: Record<string, any>;
}
