import type { Type } from '@nestjs/common';
import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PageMetaDto } from './page-meta.dto';

/**
 * Describe the `{ data, meta }` envelope every collection returns, in the
 * contract's own shape. `@ApiExtraModels` registers the two classes, or
 * `getSchemaPath` would produce a `$ref` to nothing.
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
