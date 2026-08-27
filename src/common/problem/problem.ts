import { ProblemType } from './problem-type';
import { Prisma } from '../../generated/prisma/client';
import { HttpException } from '@nestjs/common';

export interface ProblemBody {
  type?: ProblemType;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { field: string; message: string }[];
}

export function toProblem(
  err: unknown,
  instance: string,
): { status: number; body: ProblemBody } {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    return {
      status,
      body: { title: err.message, status, instance },
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return {
        status: 409,
        body: { title: 'Conflict', status: 409, instance },
      };
    }
    if (err.code === 'P2025') {
      return {
        status: 404,
        body: { title: 'Not Found', status: 404, instance },
      };
    }
  }
  return {
    status: 500,
    body: {
      title: 'Internal Server Error',
      status: 500,
      instance,
    },
  };
}
