import type { ProblemType } from './problem-type';
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
 * An error Express raised before any handler ran, in the `http-errors` shape:
 * an oversized body arrives raw as a 413. `expose` is true for a 4xx, where
 * the message describes what the caller sent, so a 5xx falls past this branch
 * and keeps the generic 500.
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
 * The detail for a body the parser refused. One entry: the contract's own 413
 * detail is about the image upload, and every other body-parser failure
 * arrives already wrapped by Nest.
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
 * Fill the members the thrower did not name, from the contract's own examples
 * and never from `err.message`. ADR 11.
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

  // The payload, not the message: `validationExceptionFactory` packs title,
  // detail and errors into it, and the message is only the class name.
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
