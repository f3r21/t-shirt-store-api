import { ValidateIf } from 'class-validator';

/**
 * Validate this property unless the caller omitted it.
 *
 * `@IsOptional()` treats null as missing. It compiles to
 * `ValidateIf(value !== null && value !== undefined)`, so an explicit null
 * short circuits every decorator after it and reaches the service unchecked.
 *
 * The contract declares no nullable field anywhere, and states the command that
 * proves it at `contract/openapi.yaml:32-36`. So null is never a value a caller
 * may send, and the answer to one is 400.
 *
 * What that costs when the rule is missing, measured through the real global
 * pipe before this decorator existed:
 *
 *     PATCH /products/{id}  {"categoryIds": null}   TypeError, then 500
 *     PATCH /products/{id}  {"description": null}   200, and the column is erased
 *
 * `create-session.dto.ts` reached this conclusion first and wrote the condition
 * inline. This is the same rule, named once so every optional property in the
 * codebase can carry it.
 */
export const IsOptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);
