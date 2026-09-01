import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NonEmptyBodyPipe } from './non-empty-body.pipe';
import { VALIDATION_PIPE_OPTIONS } from './validation-pipe-options';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import { UpdateVariantDto } from '../variants/dto/update-variant.dto';

/**
 * The `minProperties: 1` the contract declares on both update operations.
 *
 * The refusals matter more than the acceptances here. An empty body is the case
 * the pipe exists for, and before it the request answered 200 having written
 * nothing, which is the worst answer of the three available: it tells the caller
 * a change landed.
 */
describe('NonEmptyBodyPipe', () => {
  const pipe = new NonEmptyBodyPipe();

  describe('refuses', () => {
    it.each([
      ['an empty object', {}],
      ['an instance with no own keys', Object.create(null) as object],
      ['null', null],
      ['undefined', undefined],
    ])('%s', (_label, value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    });

    /**
     * The case the plain `{}` above does not reach, and the one production
     * actually sends.
     *
     * This pipe never sees the raw body. The global `ValidationPipe` runs first
     * and hands on a DTO instance carrying every declared field as an own
     * property, all of them undefined, so a check written against `Object.keys`
     * counts four here and lets the request through. These two cases are the
     * only thing standing between that mistake and a green suite.
     */
    it.each([
      ['UpdateProductDto', UpdateProductDto],
      ['UpdateVariantDto', UpdateVariantDto],
    ])('an empty %s, as the global pipe builds it', async (_label, dto) => {
      const global = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
      const instance: unknown = await global.transform(
        {},
        { type: 'body', metatype: dto },
      );

      // The shape that makes a key count wrong, asserted rather than described.
      expect(Object.keys(instance as object).length).toBeGreaterThan(0);
      expect(() => pipe.transform(instance)).toThrow(BadRequestException);
    });

    /**
     * The body repeats the contract's own wording and carries no `errors`.
     * `errors` is documented as one entry per rejected field, and an empty body
     * rejects no field, so an entry here would name a field that does not exist.
     */
    it('with the contract wording and no invented field', () => {
      let caught: unknown;
      try {
        pipe.transform({});
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const body = (caught as BadRequestException).getResponse();
      expect(body).toEqual({
        title: 'Validation failed',
        status: 400,
        detail: 'Send at least one field.',
      });
      expect(body).not.toHaveProperty('errors');
    });
  });

  describe('lets through', () => {
    it('a body with one field, and returns it unchanged', () => {
      const body = { name: 'Renamed' };

      expect(pipe.transform(body)).toBe(body);
    });

    /**
     * The positive control. A pipe that refused everything would satisfy every
     * assertion above and would break both update operations.
     */
    it('a body whose only field is falsy', () => {
      // `isActive: false` is the disable path, and it is the field most likely
      // to be dropped by a check written as a truthiness test.
      const body = { isActive: false };

      expect(pipe.transform(body)).toBe(body);
    });
  });
});
