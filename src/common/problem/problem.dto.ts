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
 * The body every failure carries, per RFC 9457.
 *
 * This class exists only so the generated document can describe it. `toProblem`
 * in `problem.ts` builds the real body from the `ProblemBody` interface, and the
 * two are deliberately separate: the interface is what the runtime uses and
 * carries no decorators, while a schema needs a class the plugin can see. Their
 * shapes must match, and `problem.filter.e2e` style assertions on real responses
 * are what would notice if they stopped matching.
 *
 * The names and the optionality follow the contract: `title` and `status` are
 * required, everything else is not.
 */
export class Problem {
  /**
   * The problem kind. Two requests that failed for the same reason carry the
   * same value.
   *
   * Absent on the failures a status code already explains, which RFC 9457 reads
   * as `about:blank`. A 404 and a 429 deliberately carry none.
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
   * One entry per rejected field.
   *
   * An extension member. The server sends it only on a 400 from request
   * validation, so a failure that rejected no field carries none.
   *
   * The one decorator in this file, and the swagger plugin asks for it by name:
   * without a lazy resolver it reports "A circular dependency has been detected
   * (property key: errors)" and refuses to build the document. Every other
   * property here is inferred from its TypeScript type the way the response DTOs
   * in this repository are.
   */
  @ApiProperty({ type: () => [ProblemField], required: false })
  errors?: ProblemField[];
}
