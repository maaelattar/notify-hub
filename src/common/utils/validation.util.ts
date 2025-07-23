import * as Joi from 'joi';

export function validateConfig<T>(
  schema: Joi.ObjectSchema<T>,
  config: Record<string, unknown>,
): T {
  const result = schema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
  });

  if (result.error) {
    throw new Error(
      `Configuration validation failed: ${result.error.details
        .map((detail) => detail.message)
        .join(', ')}`,
    );
  }

  return result.value;
}
