import { ValueObject } from './value-object.base';

export class ScheduledFor extends ValueObject<Date> {
  private constructor(value: Date) {
    super(value);
  }

  public static create(isoString: string): ScheduledFor {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid ISO 8601 date string');
    }
    // Optionally, add logic to ensure it's a future date if required by business rules
    // if (date.getTime() < Date.now()) {
    //   throw new Error('Scheduled date must be in the future');
    // }
    return new ScheduledFor(date);
  }

  public getValue(): Date {
    return this._value;
  }

  public toIsoString(): string {
    return this._value.toISOString();
  }

  public equals(other: ScheduledFor): boolean {
    if (!(other instanceof ScheduledFor)) {
      return false;
    }
    return this._value.getTime() === other.getValue().getTime();
  }
}
