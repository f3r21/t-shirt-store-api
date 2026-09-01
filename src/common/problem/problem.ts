import { ProblemType } from './problem-type';
import { Prisma } from '../../generated/prisma/client';
import { HttpException } from '@nestjs/common';
import { ProblemException } from './problem.exception';
import { STATUS_DETAILS, titleFor } from './problem-titles';

export interface ProblemField {
  field: string;
  message: string;
}

export interface ProblemBody {
  type?: ProblemType;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: ProblemField[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An error Express raised before any handler ran, in the `http-errors` shape.
 *
 * Express and its body parsers signal failure with `http-errors`, not with
 * Nest's `HttpException`. Nest's adapter converts some of those on the way in
 * and passes the rest through untouched, and which is which is not something to
 * assume. Measured, by reading what actually reached the filter:
 *
 *     body over 100 KB   PayloadTooLargeError   raw, status 413, expose true
 *     body `{"email": `  BadRequestException    already wrapped, status 400
 *
 * So the oversized body was the one that missed every branch and answered 500,
 * on a route that needs no token, logged at error level with a stack. The
 * unreadable body was never broken: Nest had already wrapped it and the
 * `HttpException` branch above answers it 400.
 *
 * `expose` is the property that makes this safe to trust, and it is the reason
 * this branch reads it rather than reading `status` alone. `http-errors` sets it
 * true for a 4xx, where the message describes what the caller sent, and false
 * for a 5xx, where it describes the server. A 5xx therefore falls past this
 * branch and keeps the generic 500, which is the answer it should have.
 */
interface ExposedHttpError {
  status: number;
  expose: true;
  type?: string;
}

function isExposedHttpError(value: unknown): value is ExposedHttpError {
  return (
    value instanceof Error &&
    typeof (value as { status?: unknown }).status === 'number' &&
    (value as { expose?: unknown }).expose === true
  );
}

/**
 * What the caller is told for a body the parser refused.
 *
 * One entry, and the table is not a placeholder for more. `STATUS_DETAILS` is
 * transcribed from the contract, and the contract writes 413 for the image
 * upload: "The image is above the size limit for this operation." An oversized
 * JSON body is the same status for a different cause, so it needs its own
 * sentence. RFC 9457 asks for a `title` that does not change between
 * occurrences and a `detail` that describes this one, so the title stays and
 * only this differs.
 *
 * Every other `body-parser` failure is absent on purpose rather than pending.
 * Each one that was checked arrives already wrapped by Nest, so it never
 * reaches this branch, and an entry for it would be a line no test could turn
 * red. Anything that does arrive takes the status default, which is honest for
 * the status even when it is not specific to the cause.
 */
const PARSER_DETAILS: Record<string, string> = {
  'entity.too.large': 'The request body is above the size limit.',
};

function isProblemFields(value: unknown): value is ProblemField[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.field === 'string' &&
        typeof entry.message === 'string',
    )
  );
}

/**
 * Fill the members the thrower did not name.
 *
 * The default title and detail come from the contract's own response examples,
 * through `problem-titles.ts`. They are never taken from `err.message`: Nest puts
 * request-derived text there, so an unrouted request would answer with the title
 * `Cannot GET /v1/nope` and a malformed body would echo a fragment of what was
 * posted. RFC 9457 requires a title that does not change between occurrences.
 */
function withDefaults(body: ProblemBody): ProblemBody {
  if (body.detail === undefined) {
    const detail = STATUS_DETAILS[body.status];
    if (detail !== undefined) {
      body.detail = detail;
    }
  }
  return body;
}

export function toProblem(
  err: unknown,
  instance: string,
): { status: number; body: ProblemBody } {
  if (err instanceof ProblemException) {
    const status = err.getStatus();
    const body: ProblemBody = {
      type: err.type,
      title: err.message,
      status,
      instance,
    };
    if (err.detail !== undefined) {
      body.detail = err.detail;
    }
    if (err.errors !== undefined) {
      body.errors = err.errors;
    }
    return { status, body: withDefaults(body) };
  }

  /**
   * The payload, not the message.
   *
   * `validationExceptionFactory` packs `{ title, detail, errors }` into the
   * exception, and `err.message` for an object payload is the class name, so
   * reading the message would drop `errors` on every 400 and answer with the
   * title `Bad Request Exception`. The contract references that one response
   * from 22 operations and requires one entry per rejected field.
   */
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const payload: unknown = err.getResponse();
    const body: ProblemBody = { title: titleFor(status), status, instance };

    if (isRecord(payload)) {
      if (typeof payload.title === 'string') {
        body.title = payload.title;
      }
      if (typeof payload.detail === 'string') {
        body.detail = payload.detail;
      }
      if (isProblemFields(payload.errors)) {
        body.errors = payload.errors;
      }
    }

    return { status, body: withDefaults(body) };
  }

  if (isExposedHttpError(err)) {
    const status = err.status;
    const body: ProblemBody = { title: titleFor(status), status, instance };
    const detail =
      err.type === undefined ? undefined : PARSER_DETAILS[err.type];
    if (detail !== undefined) {
      body.detail = detail;
    }
    // No `errors` member. The contract calls it "one entry per rejected field",
    // and a body the parser never read rejects no field, so naming one would
    // invent it. `NonEmptyBodyPipe` records the same reasoning for its own 400.
    return { status, body: withDefaults(body) };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return {
        status: 409,
        body: withDefaults({ title: titleFor(409), status: 409, instance }),
      };
    }
    if (err.code === 'P2025') {
      return {
        status: 404,
        body: withDefaults({ title: titleFor(404), status: 404, instance }),
      };
    }
  }

  return {
    status: 500,
    body: withDefaults({ title: titleFor(500), status: 500, instance }),
  };
}
