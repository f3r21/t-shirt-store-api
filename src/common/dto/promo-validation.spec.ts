import { names, rejectedFields, runPipe } from './request-validation.spec';
import { CreatePromoCodeDto } from '../../promo-codes/dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from '../../promo-codes/dto/update-promo-code.dto';

/**
 * The promo code DTOs through the pipe the application runs.
 *
 * The percentage ceiling is why this file exists. One column carries both a
 * percentage and an amount in minor units, so the bound on `discountValue`
 * depends on `discountType` and no `@Max` can state it. Every rejection ships
 * with the control that accepts the value one step inside the bound.
 */
describe('promo code validation', () => {
  // Written out rather than imported from `src/common/int4.ts`, for the reason
  // `catalog-validation.spec.ts` states: the boundary is a fact about Postgres,
  // and a spec that derives it from the value under test moves with it.
  const CEILING = 2147483647;
  const OVER = 2147483648;

  const percentage = {
    code: 'SAVE10',
    discountType: 'percentage',
    discountValue: 10,
  };
  const fixed = { code: 'FIVER', discountType: 'fixed', discountValue: 500 };

  describe('CreatePromoCodeDto', () => {
    it('accepts the three required fields and nothing else', async () => {
      await expect(runPipe(CreatePromoCodeDto, percentage)).resolves.toEqual(
        percentage,
      );
    });

    it('accepts the three optional rules beside them', async () => {
      const body = {
        ...fixed,
        expiresAt: '2026-12-31T23:59:59.000Z',
        usageLimit: 100,
        minPurchase: 5000,
      };

      await expect(runPipe(CreatePromoCodeDto, body)).resolves.toEqual(body);
    });

    describe('the percentage ceiling', () => {
      it('rejects a percentage of 101', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...percentage,
          discountValue: 101,
        });
        expect(names(fields)).toEqual(['discountValue']);
      });

      it('accepts a percentage of 100, which is the control', async () => {
        await expect(
          runPipe(CreatePromoCodeDto, { ...percentage, discountValue: 100 }),
        ).resolves.toMatchObject({ discountValue: 100 });
      });

      it('accepts a fixed amount of 101, so the ceiling is the percentage rule alone', async () => {
        await expect(
          runPipe(CreatePromoCodeDto, { ...fixed, discountValue: 101 }),
        ).resolves.toMatchObject({ discountValue: 101 });
      });

      it('accepts a fixed amount at the int4 ceiling', async () => {
        await expect(
          runPipe(CreatePromoCodeDto, { ...fixed, discountValue: CEILING }),
        ).resolves.toMatchObject({ discountValue: CEILING });
      });

      it('rejects a fixed amount above the int4 ceiling', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...fixed,
          discountValue: OVER,
        });
        expect(names(fields)).toEqual(['discountValue']);
      });
    });

    describe('the discount value floor', () => {
      it('rejects a percentage of 0', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...percentage,
          discountValue: 0,
        });
        expect(names(fields)).toEqual(['discountValue']);
      });

      it('rejects a fixed amount of 0', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...fixed,
          discountValue: 0,
        });
        expect(names(fields)).toEqual(['discountValue']);
      });

      it('accepts a discount of 1, which is the control for both', async () => {
        await expect(
          runPipe(CreatePromoCodeDto, { ...percentage, discountValue: 1 }),
        ).resolves.toMatchObject({ discountValue: 1 });
        await expect(
          runPipe(CreatePromoCodeDto, { ...fixed, discountValue: 1 }),
        ).resolves.toMatchObject({ discountValue: 1 });
      });
    });

    describe('the code', () => {
      it('rejects an empty code', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...percentage,
          code: '',
        });
        expect(names(fields)).toEqual(['code']);
      });

      it('rejects a code of 41 characters', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...percentage,
          code: 'a'.repeat(41),
        });
        expect(names(fields)).toEqual(['code']);
      });

      it('accepts a code of 40 characters, which is the control', async () => {
        await expect(
          runPipe(CreatePromoCodeDto, {
            ...percentage,
            code: 'a'.repeat(40),
          }),
        ).resolves.toMatchObject({ code: 'a'.repeat(40) });
      });
    });

    it('rejects a discount type the enum does not name', async () => {
      const fields = await rejectedFields(CreatePromoCodeDto, {
        ...percentage,
        discountType: 'half',
      });
      expect(names(fields)).toEqual(['discountType']);
    });

    it('rejects an expiresAt that is not an ISO 8601 date-time', async () => {
      const fields = await rejectedFields(CreatePromoCodeDto, {
        ...percentage,
        expiresAt: 'the end of the year',
      });
      expect(names(fields)).toEqual(['expiresAt']);
    });

    describe('the two optional integers', () => {
      it('rejects a usage limit of 0', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...percentage,
          usageLimit: 0,
        });
        expect(names(fields)).toEqual(['usageLimit']);
      });

      it('rejects a usage limit above the int4 ceiling', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...percentage,
          usageLimit: OVER,
        });
        expect(names(fields)).toEqual(['usageLimit']);
      });

      it('rejects a negative minimum purchase', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...percentage,
          minPurchase: -1,
        });
        expect(names(fields)).toEqual(['minPurchase']);
      });

      it('rejects a minimum purchase above the int4 ceiling', async () => {
        const fields = await rejectedFields(CreatePromoCodeDto, {
          ...percentage,
          minPurchase: OVER,
        });
        expect(names(fields)).toEqual(['minPurchase']);
      });

      it('accepts a usage limit of 1 and a minimum purchase of 0, the two controls', async () => {
        await expect(
          runPipe(CreatePromoCodeDto, {
            ...percentage,
            usageLimit: 1,
            minPurchase: 0,
          }),
        ).resolves.toMatchObject({ usageLimit: 1, minPurchase: 0 });
      });
    });

    it('rejects an explicit null optional field, because absent is not null', async () => {
      const fields = await rejectedFields(CreatePromoCodeDto, {
        ...percentage,
        usageLimit: null,
      });
      expect(names(fields)).toEqual(['usageLimit']);
    });

    it('rejects usedCount, which no caller writes', async () => {
      const fields = await rejectedFields(CreatePromoCodeDto, {
        ...percentage,
        usedCount: 9,
      });
      expect(names(fields)).toContain('usedCount');
    });
  });

  describe('UpdatePromoCodeDto', () => {
    it('accepts the disable switch on its own', async () => {
      await expect(
        runPipe(UpdatePromoCodeDto, { isActive: false }),
      ).resolves.toEqual({ isActive: false });
    });

    it('accepts a new code on its own', async () => {
      await expect(
        runPipe(UpdatePromoCodeDto, { code: 'SAVE20' }),
      ).resolves.toEqual({ code: 'SAVE20' });
    });

    it('rejects a percentage of 101', async () => {
      const fields = await rejectedFields(UpdatePromoCodeDto, {
        discountType: 'percentage',
        discountValue: 101,
      });
      expect(names(fields)).toEqual(['discountValue']);
    });

    it('accepts a percentage of 100, which is the control', async () => {
      await expect(
        runPipe(UpdatePromoCodeDto, {
          discountType: 'percentage',
          discountValue: 100,
        }),
      ).resolves.toMatchObject({ discountValue: 100 });
    });

    /**
     * The pair travels together. One column carries a percentage and an
     * amount, so a value with no type could turn a 50 percent code into a 50
     * percent code priced in cents, and a type with no value could turn a
     * fixed 500 into 500 percent. Neither half can be checked alone.
     */
    it('rejects a discount value with no discount type', async () => {
      const fields = await rejectedFields(UpdatePromoCodeDto, {
        discountValue: 20,
      });
      expect(names(fields)).toEqual(['discountType']);
    });

    it('rejects a discount type with no discount value', async () => {
      const fields = await rejectedFields(UpdatePromoCodeDto, {
        discountType: 'fixed',
      });
      expect(names(fields)).toEqual(['discountValue']);
    });

    it('accepts the pair, which is the control for both', async () => {
      await expect(
        runPipe(UpdatePromoCodeDto, {
          discountType: 'fixed',
          discountValue: 500,
        }),
      ).resolves.toEqual({ discountType: 'fixed', discountValue: 500 });
    });

    it('rejects usedCount, which checkout alone writes', async () => {
      const fields = await rejectedFields(UpdatePromoCodeDto, {
        usedCount: 9,
      });
      expect(names(fields)).toContain('usedCount');
    });
  });
});
