import { HttpException } from '@nestjs/common';
import type { ProblemType } from './problem-type';
import type { ProblemField } from './problem';

/**
 * An error that names its own problem document.
 *
 * `title` names the problem kind and does not change between occurrences.
 * `detail` explains this one occurrence, and the contract gives a different one
 * for each cause behind a shared status, which is why the thrower supplies it
 * rather than a table.
 */
export class ProblemException extends HttpException {
  constructor(
    readonly type: ProblemType,
    title: string,
    status: number,
    readonly detail?: string,
    readonly errors?: ProblemField[],
  ) {
    super(title, status);
  }
}
