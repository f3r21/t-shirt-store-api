import type { ExamplesObject } from '@nestjs/swagger';
import { ProblemType } from '../common/problem/problem-type';

/**
 * One problem an operation can return, as its throw site builds it. A typed
 * problem carries the throw site's own title; an untyped one has no `type`
 * and carries its status's title from the table (ADR 11), so its detail is
 * what tells it apart.
 */
type OperationProblem = {
  /** The example's name in the served document. */
  name: string;
  type?: ProblemType;
  title: string;
  detail: string;
};

type ProblemsByStatus = Partial<Record<string, readonly OperationProblem[]>>;

/**
 * The problems each operation can return, by `operationId` and then by
 * status. Every entry is traced to the code that throws it, so the served
 * document lists no problem the API never sends. The contract shares one set
 * of examples per status, so this is narrower on purpose: POST /promo-codes
 * does not list email-taken. A status with no entry keeps the bare schema.
 */
const OPERATION_PROBLEMS: Partial<Record<string, ProblemsByStatus>> = {
  createUser: {
    // `UsersService.emailTaken`, on the pre-read and on the `P2002` race.
    '409': [
      {
        name: 'emailTaken',
        type: ProblemType.EmailTaken,
        title: 'Email already registered',
        detail: 'An account with this email already exists.',
      },
    ],
  },
};

/**
 * The named examples one operation's failure at one status carries, each
 * value in the shape of the contract's own examples, or undefined when the
 * map lists none. The builder reads the map through this alone.
 */
export function problemExamples(
  operationId: string | undefined,
  status: string,
): ExamplesObject | undefined {
  if (operationId === undefined) return undefined;
  const problems = OPERATION_PROBLEMS[operationId]?.[status];
  if (problems === undefined) return undefined;

  const examples: ExamplesObject = {};
  for (const { name, type, title, detail } of problems) {
    examples[name] = {
      value: {
        ...(type === undefined ? {} : { type }),
        title,
        status: Number(status),
        detail,
      },
    };
  }
  return examples;
}
