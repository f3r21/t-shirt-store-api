import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
 * Declare the 400 that a path id can produce, on every route that takes one.
 *
 * `ParseIdPipe` wraps `ParseIntPipe`, which answers 400 to a segment that is
 * not an integer, and that is deliberate: its docstring argues that `abc` is a
 * bad request while an id above the `int4` ceiling is a lookup that finds
 * nothing, so the second answers 404 instead. What was missing is that neither
 * document said the 400 existed, on any of the seventeen operations that carry
 * a path parameter.
 *
 * Ten of those seventeen declared no 400 at all in the contract, so a generated
 * client modelled a status the server has always been able to send. The other
 * seven declared one for body validation only. Both now point at the same
 * `BadRequest`, whose description covers the two causes, because one status
 * code cannot carry two component definitions and splitting it would have left
 * those seven describing half of their own 400.
 *
 * Keyed on the path template rather than on the parameter list, because that is
 * what the contract is keyed on and a difference in how the two documents spell
 * "this route takes an id" would show up as drift that is not real.
 */
function declarePathParamBadRequest(document: OpenAPIObject): OpenAPIObject {
  type Responses = Record<string, unknown>;

  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.includes('{')) continue;
    if (item === null || typeof item !== 'object') continue;

    for (const operation of Object.values(item)) {
      const responses = (operation as { responses?: Responses } | null)
        ?.responses;
      if (responses === undefined || responses['400'] !== undefined) continue;

      responses['400'] = {
        description:
          'A path segment that must be an integer is not one. ' +
          'An integer that matches no row returns 404.',
      };
    }
  }

  return document;
}

/**
 * Declare the two headers this service sends on every 401 and every 429.
 *
 * Same argument as `describeFailuresAsProblems` above, and the same shape. The
 * runtime sends both unconditionally: `ProblemFilter` sets `WWW-Authenticate`
 * on any 401 and `ThrottlerGuard` sets `Retry-After` on any 429, so this is one
 * rule rather than 19 decorators that would state it 19 times and rot in 19
 * places.
 *
 * The contract agrees, through `components/responses/Unauthorized`, whose
 * `WWW-Authenticate` is described as "Required on every 401", and
 * `TooManyRequests`, which carries `Retry-After`.
 *
 * **Filling every 401 and 429 is safe here, and that was measured rather than
 * assumed.** The contract declares 32 `'401':` responses and refs
 * `responses/Unauthorized` 32 times, and declares 4 `'429':` and refs
 * `responses/TooManyRequests` 4 times. Not one of either is spelled inline, so
 * there is no operation whose contract entry omits these headers and which this
 * would push the other way. If one ever appears, this rule needs a condition and
 * `openapi-contract.e2e-spec.ts` is what will say so.
 */
function declareUniversalHeaders(document: OpenAPIObject): OpenAPIObject {
  const byStatus: Record<string, Record<string, unknown>> = {
    '401': {
      'WWW-Authenticate': {
        schema: { type: 'string' },
        description: 'The scheme the caller must use. Sent on every 401.',
        example: 'Bearer',
      },
    },
    '429': {
      'Retry-After': {
        schema: { type: 'string' },
        description: 'How long the caller must wait, in seconds.',
        example: '60',
      },
    },
  };

  type Responses = Record<string, { headers?: unknown } | undefined>;

  for (const item of Object.values(document.paths)) {
    if (item === null || typeof item !== 'object') continue;

    for (const operation of Object.values(item)) {
      const responses = (operation as { responses?: Responses } | null)
        ?.responses;
      if (responses === undefined) continue;

      for (const [status, response] of Object.entries(responses)) {
        const headers = byStatus[status];
        // It only fills. A response that already names its headers keeps them,
        // so the four `Location` headers on the 201s are untouched.
        if (response !== undefined && headers !== undefined) {
          response.headers = { ...headers, ...(response.headers ?? {}) };
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

  // Order matters: the 400 is added first so `describeFailuresAsProblems` gives
  // it the same `Problem` body every other failure carries.
  return declareUniversalHeaders(
    describeFailuresAsProblems(declarePathParamBadRequest(document)),
  );
}
