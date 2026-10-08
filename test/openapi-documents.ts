import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { parse as parseYaml } from 'yaml';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { TestApp } from './app-factory';

/**
 * The two documents the OpenAPI suites read, and the lookups they share: the
 * document this service serves, the hand-written contract, and an operation
 * in either, named the way both suites name it, as "POST /products".
 */

/** The parts of one operation the suites read. */
export type Operation = {
  operationId?: string;
  security?: Record<string, unknown>[];
  responses?: Record<string, unknown>;
  requestBody?: { content?: Record<string, { schema?: unknown }> };
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * The one problem type the contract and the served document both list at
 * sign-up's 409, which makes it the control of a check on problem types.
 */
export const EMAIL_TAKEN = 'https://tshirt.store/problems/email-taken';

/** The document `/docs-json` serves, read over HTTP as a client reads it. */
export async function fetchServedDocument(
  ctx: TestApp,
): Promise<OpenAPIObject> {
  const res = await request(ctx.app.getHttpServer())
    .get('/docs-json')
    .expect(200);
  return res.body as OpenAPIObject;
}

/** The hand-written contract, `contract/openapi.yaml`, which wins. */
export function loadContract(): OpenAPIObject {
  return parseYaml(
    readFileSync(join(__dirname, '../contract/openapi.yaml'), 'utf8'),
  ) as OpenAPIObject;
}

/**
 * Every operation a document lists, as "POST /products", sorted, so two
 * documents compare as sets.
 */
export function operationsOf(doc: OpenAPIObject): string[] {
  return Object.entries(doc.paths)
    .flatMap(([path, item]) => {
      const record = item as Record<string, unknown>;
      return METHODS.filter((m) => record[m]).map(
        (m) => `${m.toUpperCase()} ${path}`,
      );
    })
    .sort();
}

/** The operation object behind "POST /products", or undefined. */
export function operationAt(
  doc: OpenAPIObject,
  op: string,
): Operation | undefined {
  const [method, path] = op.split(' ');
  const item = doc.paths[path] as Record<string, unknown> | undefined;
  return item?.[method.toLowerCase()] as Operation | undefined;
}
