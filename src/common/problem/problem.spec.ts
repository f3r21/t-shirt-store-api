import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { toProblem } from './problem';
import { ProblemException } from './problem.exception';
import { ProblemType } from './problem-type';

/**
 * The mapper every failure in this API passes through.
 *
 * It had no spec at all. Measured before this file existed:
 *
 *     npx jest --ci --coverage --coverageReporters=json-summary
 *       src/common/problem/problem.ts   12.82% stmt   0% fn   0% branch
 *
 *     rg -N -l "toProblem|ProblemFilter" --glob '*.spec.ts' src test
 *       -> one type-only import of ProblemField, and nothing else
 *       control: rg -N -l "ParseIdPipe|NonEmptyBodyPipe" --glob '*.spec.ts'
 *       -> parse-id.pipe.spec.ts, non-empty-body.pipe.spec.ts
 *
 * That is a `@Catch()`-all filter with five branches, named by the capstone as a
 * Mandatory Implementation at line 167, and every 4xx and 5xx in the API runs
 * through it.
 *
 * Two properties matter more than the individual cases, and each has its own
 * block below:
 *
 * 1. **No request text reaches `title`.** RFC 9457 requires a title that does
 *    not change between occurrences. Nest fills `err.message` with the path for
 *    an unrouted request and with a parse fragment for a bad body, so a mapper
 *    that read the message would answer with a title that changes every time.
 * 2. **Nothing unrecognised is described to the caller.** Whatever falls past
 *    every branch is a 500 with the table's own wording, never the thrown
 *    object's.
 */
describe('toProblem', () => {
  const INSTANCE = '/v1/products/7';

  describe('a ProblemException, which names its own document', () => {
    it('carries the type, title, status, detail and errors it was given', () => {
      const err = new ProblemException(
        ProblemType.EmailTaken,
        'Email taken',
        409,
        'This address already has an account.',
        [{ field: 'email', message: 'is already registered' }],
      );

      expect(toProblem(err, INSTANCE)).toEqual({
        status: 409,
        body: {
          type: ProblemType.EmailTaken,
          title: 'Email taken',
          status: 409,
          detail: 'This address already has an account.',
          instance: INSTANCE,
          errors: [{ field: 'email', message: 'is already registered' }],
        },
      });
    });

    it('omits detail and errors when the thrower named neither, and 409 has no default', () => {
      // 409 is deliberately absent from STATUS_DETAILS: it covers more than one
      // cause and the contract writes a different sentence for each, so the
      // thrower supplies it. Nothing invents one here.
      const { body } = toProblem(
        new ProblemException(ProblemType.InsufficientStock, 'Conflict', 409),
        INSTANCE,
      );

      expect(body.detail).toBeUndefined();
      expect(body.errors).toBeUndefined();
    });

    it('fills detail from the table for a status that has one', () => {
      const { body } = toProblem(
        new ProblemException(ProblemType.InvalidCredentials, 'Forbidden', 403),
        INSTANCE,
      );

      expect(body.detail).toBe(
        'This operation is available to a manager only.',
      );
    });
  });

  describe('an HttpException, read by its payload and never by its message', () => {
    it('takes title, detail and errors from an object payload', () => {
      const err = new BadRequestException({
        title: 'Validation failed',
        status: 400,
        detail: 'One or more fields did not pass validation.',
        errors: [{ field: 'email', message: 'must be a valid email address' }],
      });

      expect(toProblem(err, INSTANCE)).toEqual({
        status: 400,
        body: {
          title: 'Validation failed',
          status: 400,
          detail: 'One or more fields did not pass validation.',
          instance: INSTANCE,
          errors: [
            { field: 'email', message: 'must be a valid email address' },
          ],
        },
      });
    });

    it('answers a bare exception from the status table, with no payload to read', () => {
      expect(toProblem(new ForbiddenException(), INSTANCE).body).toEqual({
        title: 'Forbidden',
        status: 403,
        detail: 'This operation is available to a manager only.',
        instance: INSTANCE,
      });
    });

    it('drops an errors member that is not a list of field and message', () => {
      // The guard is not decoration. `errors` is a contract member described as
      // "one entry per rejected field", so a shape that is not that must not be
      // forwarded to the caller as though it were.
      const { body } = toProblem(
        new BadRequestException({ errors: ['just a string'] }),
        INSTANCE,
      );

      expect(body.errors).toBeUndefined();
    });

    it('ignores a payload that is an array rather than an object', () => {
      const { body } = toProblem(
        new BadRequestException([{ title: 'injected' }]),
        INSTANCE,
      );

      expect(body.title).toBe('Validation failed');
    });

    it('falls back to the table for a status the table does not carry', () => {
      // 418 is in neither table. The fallback is the 500 title rather than an
      // empty one, and the status the thrower chose is still what is returned.
      const { status, body } = toProblem(
        new HttpException('teapot', 418),
        INSTANCE,
      );

      expect(status).toBe(418);
      expect(body.title).toBe('Internal server error');
      expect(body.detail).toBeUndefined();
    });
  });

  describe('no request text reaches the title', () => {
    it.each([
      ['an unrouted path', new NotFoundException('Cannot GET /v1/nope'), 404],
      [
        'a parse fragment',
        new BadRequestException('Unexpected token } in JSON at position 14'),
        400,
      ],
    ])('keeps the stable title for %s', (_name, err, status) => {
      const { body } = toProblem(err, INSTANCE);

      expect(body.title).not.toContain('nope');
      expect(body.title).not.toContain('Unexpected');
      expect(body.status).toBe(status);
      // The path belongs to `instance`, which is the one member RFC 9457 says
      // identifies this occurrence.
      expect(body.instance).toBe(INSTANCE);
    });
  });

  describe('an http-errors failure from Express, which is not an HttpException', () => {
    const httpError = (status: number, expose: boolean, type?: string) =>
      Object.assign(new Error('request entity too large'), {
        status,
        statusCode: status,
        expose,
        ...(type === undefined ? {} : { type }),
      });

    it('answers 413 with its own detail for an oversized body', () => {
      // Measured shape, from body-parser 2.3.0:
      //   constructor PayloadTooLargeError, status 413, expose true,
      //   type 'entity.too.large'
      const { status, body } = toProblem(
        httpError(413, true, 'entity.too.large'),
        INSTANCE,
      );

      expect(status).toBe(413);
      expect(body.title).toBe('Content too large');
      // Not the contract's image wording, which is the default for this status.
      expect(body.detail).toBe('The request body is above the size limit.');
      expect(body.errors).toBeUndefined();
    });

    it('takes the status default for an exposed error with no type of its own', () => {
      const { body } = toProblem(httpError(415, true), INSTANCE);

      expect(body.title).toBe('Unsupported media type');
      expect(body.detail).toBe('This operation accepts an image file only.');
    });

    it('leaves a 5xx http-error as a generic 500, because expose is false there', () => {
      // The reason this branch reads `expose` and not `status` alone. A 5xx
      // http-error's message describes the server, so forwarding its status
      // without its message is right and forwarding the message would not be.
      const { status, body } = toProblem(
        httpError(503, false, 'something.internal'),
        INSTANCE,
      );

      expect(status).toBe(500);
      expect(body.title).toBe('Internal server error');
    });

    it('does not capture a plain Error that merely carries a status number', () => {
      // Without the `expose === true` half, any thrown object with a numeric
      // `status` would set the response status, which is a wide door.
      const { status } = toProblem(
        Object.assign(new Error('boom'), { status: 403 }),
        INSTANCE,
      );

      expect(status).toBe(500);
    });
  });

  describe('a Prisma error', () => {
    const prismaError = (code: string) =>
      new Prisma.PrismaClientKnownRequestError('failed', {
        code,
        clientVersion: 'test',
      });

    it.each([
      ['P2002, a unique violation', 'P2002', 409, 'Conflict'],
      ['P2025, a row that is not there', 'P2025', 404, 'Not found'],
    ])('maps %s', (_name, code, status, title) => {
      const result = toProblem(prismaError(code), INSTANCE);

      expect(result.status).toBe(status);
      expect(result.body.title).toBe(title);
    });

    it('leaves every other Prisma code as a 500', () => {
      // P2020 is the one this codebase actually met: a value out of range for
      // int4. It is deliberately not mapped here, because the fix belongs at the
      // edge, in the DTO bounds, and not in a translation that would let a bad
      // request look like a handled one. See `src/common/int4.ts`.
      const { status, body } = toProblem(prismaError('P2020'), INSTANCE);

      expect(status).toBe(500);
      expect(body.title).toBe('Internal server error');
    });
  });

  describe('nothing unrecognised is described to the caller', () => {
    it.each([
      ['a plain Error', new Error('connection reset by peer')],
      ['a thrown string', 'something went wrong at line 42'],
      ['a thrown object', { secret: 'DATABASE_URL=postgres://user:pw@host' }],
      ['null', null],
      ['undefined', undefined],
    ])('answers 500 with the table wording for %s', (_name, thrown) => {
      const { status, body } = toProblem(thrown, INSTANCE);

      expect(status).toBe(500);
      expect(body).toEqual({
        title: 'Internal server error',
        status: 500,
        detail: 'The server failed to handle the request.',
        instance: INSTANCE,
      });
    });

    it('never carries the thrown text, which is the point of the case above', () => {
      const { body } = toProblem(
        new Error('connect ECONNREFUSED 10.0.0.4:5432'),
        INSTANCE,
      );

      expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
      expect(JSON.stringify(body)).not.toContain('10.0.0.4');
    });
  });
});
