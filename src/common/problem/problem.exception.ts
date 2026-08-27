import { HttpException } from '@nestjs/common';
import { ProblemType } from './problem-type';

export class ProblemException extends HttpException {
  constructor(
    readonly type: ProblemType,
    title: string,
    status: number,
    readonly errors?: { field: string; message: string }[],
  ) {
    super(title, status);
  }
}
