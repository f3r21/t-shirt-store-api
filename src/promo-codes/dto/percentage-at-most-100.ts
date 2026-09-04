import { ValidatorConstraint } from 'class-validator';
import type {
  ValidationArguments,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PromoDiscountType } from '../../generated/prisma/enums';

/**
 * A percentage discount stops at 100. A fixed one is an amount in minor units
 * and stops at the `int4` ceiling. One column carries both values, so the
 * upper bound of `discountValue` depends on `discountType` and no `@Max` can
 * state it: a decorator sees one property and this constraint reads the body.
 *
 * `@Max(INT4_MAX)` stays on the property and this adds the narrower ceiling
 * for one of the two kinds, so a percentage of 101 is a 400 from validation
 * rather than a rule the service applies later.
 */
@ValidatorConstraint({ name: 'percentageAtMost100' })
export class PercentageAtMost100 implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const { discountType } = args.object as { discountType?: unknown };

    if (discountType !== PromoDiscountType.percentage) {
      return true;
    }
    return typeof value === 'number' && value <= 100;
  }

  defaultMessage(): string {
    return 'must be at most 100 for a percentage discount';
  }
}
