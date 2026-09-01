import { names, rejectedFields, runPipe } from './request-validation.spec';
import { CreateProductDto } from '../../products/dto/create-product.dto';
import { UpdateProductDto } from '../../products/dto/update-product.dto';
import { ListProductsQueryDto } from '../../products/dto/list-products-query.dto';
import { CreateVariantDto } from '../../variants/dto/create-variant.dto';
import { UpdateVariantDto } from '../../variants/dto/update-variant.dto';
import { SetVariantStockDto } from '../../variants/dto/set-variant-stock.dto';

/**
 * The catalog DTOs, through the pipe the application actually runs.
 *
 * Two rules, and each one shipped as a measured 500 before it was a test.
 *
 * **An integer bound the contract never restated.** `price_cents`, `stock` and
 * every id are `int4`. A value above the ceiling parses, passes every validator
 * the DTO carried, reaches Prisma, and Postgres answers `P2020`. Nothing maps
 * that code, so the caller got a 500 where the contract declares 400 or 422.
 * Two of those routes need no token.
 *
 * **Null is not absent.** `@IsOptional()` skips the rest of a property's
 * validators for null as well as undefined, so an explicit null walked through
 * the global pipe, through `NonEmptyBodyPipe`, and into the service. Measured
 * before `@IsOptionalNotNull` existed:
 *
 *     PATCH /products/{id}  {"categoryIds": null}   TypeError, then 500
 *     PATCH /products/{id}  {"description": null}   200, and the column erased
 *
 * The contract has no nullable field anywhere and says so with the command that
 * proves it, at `contract/openapi.yaml:32-36`, so null is a 400 everywhere.
 *
 * Every rejection below ships with the accepting control beside it, because a
 * rejection alone does not show the pipe still lets a good value through.
 */
describe('catalog validation', () => {
  // Written out rather than imported from `src/common/int4.ts`. The boundary is
  // a fact about Postgres, not about our constant, and a spec that derives it
  // from the value under test moves with it. Measured: with `OVER` written as
  // `INT4_MAX + 1`, raising `INT4_MAX` to `Number.MAX_SAFE_INTEGER` left all 20
  // cases below green and only `parse-id.pipe.spec.ts`, which writes its
  // boundary out, turned red.
  const CEILING = 2147483647;
  const OVER = 2147483648;

  describe('the int4 ceiling', () => {
    it('accepts a variant priced and stocked at the ceiling itself', async () => {
      await expect(
        runPipe(CreateVariantDto, { price: CEILING, stock: CEILING }),
      ).resolves.toEqual({ price: CEILING, stock: CEILING });
    });

    it('rejects a variant price above the ceiling', async () => {
      const fields = await rejectedFields(CreateVariantDto, {
        price: OVER,
        stock: 1,
      });
      expect(names(fields)).toEqual(['price']);
    });

    it('rejects a variant stock above the ceiling', async () => {
      const fields = await rejectedFields(CreateVariantDto, {
        price: 1,
        stock: OVER,
      });
      expect(names(fields)).toEqual(['stock']);
    });

    it('rejects a price above the ceiling on update', async () => {
      const fields = await rejectedFields(UpdateVariantDto, { price: OVER });
      expect(names(fields)).toEqual(['price']);
    });

    it('rejects a stock above the ceiling on the stock operation', async () => {
      const fields = await rejectedFields(SetVariantStockDto, { stock: OVER });
      expect(names(fields)).toEqual(['stock']);
    });

    it.each([
      ['CreateProductDto', CreateProductDto],
      ['UpdateProductDto', UpdateProductDto],
    ])(
      'rejects a categoryIds entry above the ceiling on %s',
      async (_n, dto) => {
        const fields = await rejectedFields(dto, {
          name: 'Tee',
          categoryIds: [1, OVER],
        });
        expect(names(fields)).toEqual(['categoryIds']);
      },
    );

    it('accepts a categoryIds entry at the ceiling, which is the control', async () => {
      await expect(
        runPipe(CreateProductDto, { name: 'Tee', categoryIds: [CEILING] }),
      ).resolves.toEqual({ name: 'Tee', categoryIds: [CEILING] });
    });

    it('rejects categoryId above the ceiling, on a route that needs no token', async () => {
      // The anonymous half of this rule. `GET /products` is `@OptionalAuth`, so
      // before the bound one unauthenticated request produced a 500.
      const fields = await rejectedFields(
        ListProductsQueryDto,
        { categoryId: String(OVER) },
        'query',
      );
      expect(names(fields)).toEqual(['categoryId']);
    });

    it('accepts categoryId at the ceiling, which is the control', async () => {
      await expect(
        runPipe(ListProductsQueryDto, { categoryId: String(CEILING) }, 'query'),
      ).resolves.toEqual({
        limit: 20,
        offset: 0,
        categoryId: CEILING,
        includeInactive: false,
      });
    });
  });

  describe('null is not absent', () => {
    it.each(['name', 'description', 'isActive', 'categoryIds'])(
      'rejects an explicit null %s on UpdateProductDto',
      async (field) => {
        const fields = await rejectedFields(UpdateProductDto, {
          [field]: null,
        });
        expect(names(fields)).toEqual([field]);
      },
    );

    it('accepts the same body with a value, which is the control', async () => {
      await expect(
        runPipe(UpdateProductDto, {
          name: 'Tee',
          description: 'Cotton',
          isActive: false,
          categoryIds: [1],
        }),
      ).resolves.toEqual({
        name: 'Tee',
        description: 'Cotton',
        isActive: false,
        categoryIds: [1],
      });
    });

    it('accepts a body that omits every optional field but one', async () => {
      // The rule refuses null and must not refuse absence, which is the whole
      // point of an optional property. Without this case the fix would pass by
      // rejecting everything.
      await expect(runPipe(UpdateProductDto, { name: 'Tee' })).resolves.toEqual(
        { name: 'Tee' },
      );
    });

    it.each(['size', 'color', 'price'])(
      'rejects an explicit null %s on UpdateVariantDto',
      async (field) => {
        const fields = await rejectedFields(UpdateVariantDto, {
          [field]: null,
        });
        expect(names(fields)).toEqual([field]);
      },
    );

    it.each(['description', 'categoryIds'])(
      'rejects an explicit null %s on CreateProductDto',
      async (field) => {
        const fields = await rejectedFields(CreateProductDto, {
          name: 'Tee',
          [field]: null,
        });
        expect(names(fields)).toEqual([field]);
      },
    );

    it.each(['size', 'color'])(
      'rejects an explicit null %s on CreateVariantDto',
      async (field) => {
        const fields = await rejectedFields(CreateVariantDto, {
          price: 1,
          stock: 1,
          [field]: null,
        });
        expect(names(fields)).toEqual([field]);
      },
    );
  });
});
