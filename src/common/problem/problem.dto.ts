import { ApiProperty } from '@nestjs/swagger';

/**
 * One rejected field. See `openapi.yaml`, the `errors` member of `Problem`.
 */
export class ProblemField {
  /** The name of the field that failed, as the request body spells it. */
  field!: string;

  /** What was wrong with it. One message per field, not one per constraint. */
  message!: string;
}

/**
 * The body every failure carries, per RFC 9457. This class exists for the
 * generated document; `ProblemBody` in `problem.ts` is what the runtime
 * builds, and the two must match.
 */
export class Problem {
  /**
   * The problem kind. Absent where the status already explains the failure,
   * which RFC 9457 reads as `about:blank`.
   */
  type?: string;

  /** A short summary of the problem kind. It does not change between occurrences. */
  title!: string;

  /** The HTTP status code. It repeats the status line. */
  status!: number;

  /** An explanation of this specific occurrence. */
  detail?: string;

  /** A URI reference that identifies this occurrence. */
  instance?: string;

  /**
   * One entry per rejected field, on a validation 400 only. The one decorator
   * here: without a lazy resolver the plugin reports a circular dependency.
   */
  @ApiProperty({ type: () => [ProblemField], required: false })
  errors?: ProblemField[];
}
