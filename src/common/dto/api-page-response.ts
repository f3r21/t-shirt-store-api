import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PageMetaDto } from './page-meta.dto';

/**
 * Describe the `{ data, meta }` envelope every collection returns.
 *
 * The three list operations declared a 200 with a description and no `type`,
 * because the envelope is generic and no class exists for it. The plugin cannot
 * infer a return type it was never given, so it served the status with no body
 * schema at all. Measured against the contract:
 *
 *     GET /auth/sessions 200   contract carries a schema, served document did not
 *     GET /products      200   the same
 *     GET /categories    200   the same
 *
 * The reader lost three payloads and, with them, `ProductSummary`, `Session`
 * and `PageMeta`, because a schema reaches `components.schemas` only when
 * something references it. A generated client built from that document could
 * not type any list response in the API.
 *
 * The shape written here is the contract's own, at `openapi.yaml:517-532` and
 * the two operations that copy it: an object requiring `data` and `meta`, where
 * `data` is an array of the item and `meta` is the shared `PageMeta`.
 *
 * `@ApiExtraModels` is what registers the two classes. Without it `getSchemaPath`
 * returns a `$ref` to a schema the document does not define, which is worse than
 * the gap it replaces: the document would look complete and resolve to nothing.
 */
export const ApiPageResponse = <T extends Type<unknown>>(
  item: T,
  description: string,
) =>
  applyDecorators(
    ApiExtraModels(PageMetaDto, item),
    ApiOkResponse({
      description,
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(item) } },
          meta: { $ref: getSchemaPath(PageMetaDto) },
        },
      },
    }),
  );
