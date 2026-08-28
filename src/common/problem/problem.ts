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
