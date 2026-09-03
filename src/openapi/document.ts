import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Problem } from '../common/problem/problem.dto';

type Responses = Record<string, Record<string, unknown> | undefined>;

/** Visit the responses of every operation, with the path template it is keyed on. */
function forEachOperation(
  document: OpenAPIObject,
  visit: (path: string, responses: Responses) => void,
): void {
  for (const [path, item] of Object.entries(document.paths)) {
    if (item === null || typeof item !== 'object') continue;

    for (const operation of Object.values(item)) {
      const responses = (operation as { responses?: Responses } | null)
        ?.responses;
      if (responses !== undefined) visit(path, responses);
    }
  }
}

/**
 * Give every failure the `Problem` body, in one place: `ProblemFilter` is
 * global, so this is one rule and not a decorator per response. It only fills;
 * a response that names its content keeps it.
 */
function describeFailuresAsProblems(document: OpenAPIObject): OpenAPIObject {
  const problem = {
    content: {
      'application/problem+json': {
        schema: { $ref: '#/components/schemas/Problem' },
      },
    },
  };

  forEachOperation(document, (_path, responses) => {
    for (const [status, response] of Object.entries(responses)) {
      if (
        response !== undefined &&
        Number(status) >= 400 &&
        response.content === undefined
      ) {
        Object.assign(response, problem);
      }
    }
  });

  return document;
}

/**
 * Declare the 400 that `ParseIdPipe` answers to a non-integer id, on every
 * route with a path parameter. Keyed on the path template, which is what the
 * contract keys on.
 */
function declarePathParamBadRequest(document: OpenAPIObject): OpenAPIObject {
  forEachOperation(document, (path, responses) => {
    if (!path.includes('{') || responses['400'] !== undefined) return;

    responses['400'] = {
      description:
        'A path segment that must be an integer is not one. ' +
        'An integer that matches no row returns 404.',
    };
  });

  return document;
}

/**
 * Declare `WWW-Authenticate` on every 401 and `Retry-After` on every 429, which
 * the runtime sends unconditionally. It only fills, and the contract suite is
 * what says so if an operation ever omits them.
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

  forEachOperation(document, (_path, responses) => {
    for (const [status, response] of Object.entries(responses)) {
      const headers = byStatus[status];
      // It only fills. A response that already names its headers keeps them,
      // so the four `Location` headers on the 201s are untouched.
      if (response !== undefined && headers !== undefined) {
        response.headers = {
          ...headers,
          ...(response.headers as Record<string, unknown> | undefined),
        };
      }
    }
  });

  return document;
}

/**
 * The document this service generates from its controllers. It is not the
 * contract: `contract/openapi.yaml` wins where the two disagree, and
 * `test/openapi-contract.e2e-spec.ts` compares the two. One factory serves and
 * compares it. `ignoreGlobalPrefix` makes the path keys match the contract's,
 * and `operationIdFactory` hands the method name through, which is the
 * contract's `operationId`.
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

  // `extraModels` puts `Problem` in `components.schemas`; no decorator
  // references it, and a schema nothing points at is dropped.
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
