import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Problem } from '../common/problem/problem.dto';

/**
 * Give every failure the problem schema, in one place.
 *
 * The contract gives all 94 error responses a `Problem` body, and that is one
 * rule rather than 94 decisions: `ProblemFilter` is global, so every failure
 * this service can produce leaves as `application/problem+json`. Writing
 * `type: Problem` on 75 `@ApiResponse` decorators would state the same rule 75
 * times and let it rot in 75 places, which is how the five stale comments this
 * repository already carried came to exist.
 *
 * It only fills. A response that already describes its content is left alone,
 * so an operation that answers something other than a problem document still
 * says so. `openapi-contract.e2e-spec.ts` asserts the result rather than
 * trusting this function.
 */
function describeFailuresAsProblems(document: OpenAPIObject): OpenAPIObject {
  const problem = {
    content: {
      'application/problem+json': {
        schema: { $ref: '#/components/schemas/Problem' },
      },
    },
  };

  type Responses = Record<string, { content?: unknown } | undefined>;

  for (const item of Object.values(document.paths)) {
    if (item === null || typeof item !== 'object') continue;

    for (const operation of Object.values(item)) {
      const responses = (operation as { responses?: Responses } | null)
        ?.responses;
      if (responses === undefined) continue;

      for (const [status, response] of Object.entries(responses)) {
        if (
          response !== undefined &&
          Number(status) >= 400 &&
          response.content === undefined
        ) {
          Object.assign(response, problem);
        }
      }
    }
  }

  return document;
}

/**
 * The OpenAPI document this service generates from its own controllers.
 *
 * **It is not the contract.** `contract/openapi.yaml`, in this repository, is
 * hand written, was agreed before any of this existed, and wins wherever the two
 * disagree. This document exists because the challenge asks the running service
 * to describe itself, and because a generated description is the only one that
 * cannot drift from the code by accident. It can drift from the contract, which
 * is what `test/openapi-contract.e2e-spec.ts` exists to catch.
 *
 * One factory, called by `configure-app.ts` to serve it and by that spec to
 * compare it. A spec that built its own document would check something the
 * server does not serve, and the drift would be invisible because both would
 * pass. This is the same argument as `VALIDATION_PIPE_OPTIONS`.
 *
 * `ignoreGlobalPrefix` is the detail that makes the comparison possible. Nest
 * puts `/v1` on every route through `setGlobalPrefix`, while the contract keeps
 * its path keys bare and carries the prefix in `servers.url`. Stripping it here
 * makes the two documents describe paths the same way, so a difference in the
 * diff is a real difference rather than a spelling one.
 *
 * `operationIdFactory` is the second such detail. Nest's default names an
 * operation `${controllerKey}_${methodKey}`, so every one of the 19 implemented
 * operations was served under a name the contract does not use, and a client
 * generated from this document would not compile against one generated from the
 * contract. Every handler is already named after its contract `operationId`, so
 * handing the method name through is the whole fix and renames nothing.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('T-Shirt Store API')
    .setVersion('0.1.0')
    .setDescription(
      'Generated from the controllers. The hand written contract at ' +
        'contract/openapi.yaml in this repository is authoritative where the ' +
        'two disagree.',
    )
    .addServer('http://localhost:3000/v1', 'Local development')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearerAuth',
    )
    .build();

  // `extraModels` is what puts `Problem` in `components.schemas`. No decorator
  // references it, because the filling below is what references it, and a schema
  // nothing points at is dropped from the document.
  const document = SwaggerModule.createDocument(app, config, {
    ignoreGlobalPrefix: true,
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
    extraModels: [Problem],
  });

  return describeFailuresAsProblems(document);
}
