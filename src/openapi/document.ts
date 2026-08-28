import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * The OpenAPI document this service generates from its own controllers.
 *
 * **It is not the contract.** `5-api-design/openapi.yaml` is hand written, was
 * agreed before any of this existed, and wins wherever the two disagree. This
 * document exists because the challenge asks the running service to describe
 * itself, and because a generated description is the only one that cannot drift
 * from the code by accident. It can drift from the contract, which is what
 * `test/openapi-contract.e2e-spec.ts` exists to catch.
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
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('T-Shirt Store API')
    .setVersion('0.1.0')
    .setDescription(
      'Generated from the controllers. The hand written contract at ' +
        '5-api-design/openapi.yaml is authoritative where the two disagree.',
    )
    .addServer('http://localhost:3000/v1', 'Local development')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearerAuth',
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    ignoreGlobalPrefix: true,
  });
}
