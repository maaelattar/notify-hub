import { BadRequestException, ValidationError } from '@nestjs/common';

export function validationExceptionFactory(errors: ValidationError[]) {
  const formattedErrors: Record<string, string[]> = {};

  errors.forEach((error) => {
    const property = error.property;
    const constraints = error.constraints || {};

    formattedErrors[property] = Object.values(constraints);

    // Handle nested errors
    if (error.children && error.children.length > 0) {
      const nestedErrors = formatNestedErrors(error.children, property);
      Object.assign(formattedErrors, nestedErrors);
    }
  });

  return new BadRequestException({
    message: 'Validation failed',
    code: 'VALIDATION_ERROR',
    errors: formattedErrors,
  });
}

function formatNestedErrors(
  errors: ValidationError[],
  parentProperty: string,
): Record<string, string[]> {
  const formattedErrors: Record<string, string[]> = {};

  errors.forEach((error) => {
    const property = `${parentProperty}.${error.property}`;
    const constraints = error.constraints || {};

    formattedErrors[property] = Object.values(constraints);

    if (error.children && error.children.length > 0) {
      const nestedErrors = formatNestedErrors(error.children, property);
      Object.assign(formattedErrors, nestedErrors);
    }
  });

  return formattedErrors;
}
