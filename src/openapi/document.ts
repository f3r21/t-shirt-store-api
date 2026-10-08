import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Problem } from '../common/problem/problem.dto';
import { problemExamples } from './operation-problems';

type Responses = Record<string, Record<string, unknown> | undefined>;
type Operation = { operationId?: string; responses?: Responses };

/**
 * Visit the responses of every operation, with the path template it is keyed
 * on and the operation, whose `operationId` names its problems.
 */
function forEachOperation(
  document: OpenAPIObject,
  visit: (path: string, responses: Responses, operation: Operation) => void,
): void {
  for (const [path, item] of Object.entries(document.paths)) {
    if (item === null || typeof item !== 'object') continue;

    for (const value of Object.values(item)) {
      const operation = value as Operation | null;
      if (operation?.responses !== undefined) {
        visit(path, operation.responses, operation);
      }
    }
  }
}

/**
 * Give every failure the `Problem` body, in one place: `ProblemFilter` is
 * global, so this is one rule and not a decorator per response. It only fills;
 * a response that names its content keeps it. Where `operation-problems.ts`
 * lists what the operation returns at that status, the body names those
 * problems as examples.
 */
function describeFailuresAsProblems(document: OpenAPIObject): OpenAPIObject {
  forEachOperation(document, (_path, responses, operation) => {
    for (const [status, response] of Object.entries(responses)) {
      if (
        response !== undefined &&
        Number(status) >= 400 &&
        response.content === undefined
      ) {
        // A new object for each response. One object shared by reference
        // would carry one operation's examples to every other failure.
        const examples = problemExamples(operation.operationId, status);
        response.content = {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/Problem' },
            ...(examples === undefined ? {} : { examples }),
          },
        };
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
 * Type every number `integer`, as the contract does. Ids are `int4`, money is
 * minor units (ADR 13), and counts are whole, so this API has no fractional
 * number. The plugin reads a TypeScript `number` as `type: number`, and the
 * alternative is a decorator on every id, amount, count and path parameter.
 */
function typeNumbersAsIntegers<T>(node: T): T {
  if (Array.isArray(node)) {
    node.forEach(typeNumbersAsIntegers);
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record.type === 'number') record.type = 'integer';
    Object.values(record).forEach(typeNumbersAsIntegers);
  }

  return node;
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
    // The contract test cites the first `openapi.yaml` path in this text and
    // checks the file exists, so the repository path comes before the URL.
    .setDescription(
      'Generated from the controllers. The hand-written contract, ' +
        '[`contract/openapi.yaml`](https://github.com/f3r21/t-shirt-store-api/blob/main/contract/openapi.yaml), ' +
        'is authoritative where the two disagree. Each failure here lists ' +
        'only the problems its own operation returns, where the contract ' +
        'shares one set of examples per status. ' +
        '`test/openapi-contract.e2e-spec.ts` fails when this document drifts ' +
        'from the contract in operations, status codes, request bodies, ' +
        'parameters, headers or bounds, or when a failure lists a problem ' +
        'type the contract does not list for that status. It does not ' +
        'compare descriptions.\n\n' +
        'Every amount is an integer in minor units of USD, so 2400 is 24.00 USD.',
    )
    // First, because Swagger UI sends "Try it out" to the first server: a
    // relative `/v1` is the host that serves the page, deployed or local.
    .addServer('/v1', 'This host')
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
  return typeNumbersAsIntegers(
    declareUniversalHeaders(
      describeFailuresAsProblems(declarePathParamBadRequest(document)),
    ),
  );
}
