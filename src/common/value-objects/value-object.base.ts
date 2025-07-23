export abstract class ValueObject<T> {
  protected readonly _value: T;

  constructor(value: T) {
    this._value = value;
  }

  public equals(other: ValueObject<T>): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (other.constructor.name !== this.constructor.name) {
      return false;
    }
    return this._value === other._value;
  }

  public get value(): T {
    return this._value;
  }
}
