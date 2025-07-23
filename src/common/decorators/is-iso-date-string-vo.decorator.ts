import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { ScheduledFor } from '../value-objects/scheduled-for.vo';

@ValidatorConstraint({ async: false })
export class IsIsoDateStringVoConstraint implements ValidatorConstraintInterface {
  validate(isoString: any, args: ValidationArguments) {
    if (typeof isoString !== 'string') {
      return false;
    }
    try {
      ScheduledFor.create(isoString);
      return true;
    } catch (e) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments) {
    return 'Text ($value) must be a valid ISO 8601 date string';
  }
}

export function IsIsoDateStringVo(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsIsoDateStringVoConstraint,
    });
  };
}
