import { ValidateIf } from 'class-validator';

/**
 * Validate this property unless the caller omitted it. `@IsOptional()` treats
 * null as missing and skips every validator after it, and the contract
 * declares no nullable field, so null is a 400.
 */
export const IsOptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);
