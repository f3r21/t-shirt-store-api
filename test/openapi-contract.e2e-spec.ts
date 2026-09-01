import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../src/openapi/document';
import { createTestApp, TestApp } from './app-factory';

/**
 * The generated document against the hand written contract.
 *
 * The contract is authoritative. This suite is the thing that notices when the
 * code stops matching it, and it is the only reason generating a second
 * description of the same API is worth anything.
 *
 * **What it compares:** the set of operations, the name each one is served
 * under, who may call it, the status codes it declares, whether every failure
 * describes its body, and the property and required names of each request body.
 *
 * **What it does not:** types, formats, lengths, examples and descriptions. The
 * contract expresses bounds the generated document spells differently, and
 * asserting on those would fail on spelling rather than on substance. That limit
 * is stated here rather than left for a reader to find out.
 *
 * The first four of those six were added on 2026-08-31, after an audit found
 * that the served document renamed all 19 operations, showed seven of them with
 * the wrong authentication, described 75 failures with no body at all, and
 * pointed readers at a file in another repository. Every one of those was green
 * here, because comparing status code keys says nothing about what sits under
 * them. A drift test is only worth what it compares.
 */
describe('OpenAPI document against the contract (e2e)', () => {
  let ctx: TestApp;
  let generated: OpenAPIObject;
  let contract: OpenAPIObject;

  /**
   * Differences that are correct, each with the reason.
   *
   * The list is the point of the suite. A diff with no exceptions would be red
   * on day one and get skipped. A diff that swallowed differences quietly would
   * be green and prove nothing. Every entry here is a difference somebody looked
   * at and signed off, and anything not on the list fails.
   */
  const DECLARED_DIFFERENCES = {
    /** Not an API operation. A liveness route the contract has no reason to describe. */
    operationsNotInContract: ['GET /'],
  };

  type Operation = {
    operationId?: string;
    security?: Record<string, unknown>[];
    responses?: Record<string, unknown>;
    requestBody?: { content?: Record<string, { schema?: unknown }> };
  };

  const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

  beforeAll(async () => {
    ctx = await createTestApp();
    generated = buildOpenApiDocument(ctx.app);
    contract = parseYaml(
      readFileSync(join(__dirname, '../contract/openapi.yaml'), 'utf8'),
    ) as OpenAPIObject;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** "POST /products", for both documents, so they compare as sets. */
  function operationsOf(doc: OpenAPIObject): string[] {
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
  function operationAt(doc: OpenAPIObject, op: string): Operation | undefined {
    const [method, path] = op.split(' ');
    const item = doc.paths[path] as Record<string, unknown> | undefined;
    return item?.[method.toLowerCase()] as Operation | undefined;
  }

  /** Follow a `$ref` one hop, inside the document it came from. */
  function deref(doc: OpenAPIObject, schema: unknown): Record<string, unknown> {
    const s = schema as Record<string, unknown> | undefined;
    if (!s) return {};
    if (typeof s.$ref !== 'string') return s;
    const name = s.$ref.split('/').pop() ?? '';
    const schemas: Record<string, unknown> = doc.components?.schemas ?? {};
    return (schemas[name] ?? {}) as Record<string, unknown>;
  }

  /** Property names and required names, which is what actually drifts. */
  function requestShape(doc: OpenAPIObject, op: string): string {
    const content = operationAt(doc, op)?.requestBody?.content;
    const schema = deref(doc, content?.['application/json']?.schema);
    const props = Object.keys(schema.properties ?? {}).sort();
    const required = [
      ...((schema.required as string[] | undefined) ?? []),
    ].sort();
    return `props=[${props.join(' ')}] required=[${required.join(' ')}]`;
  }

  function statusCodesOf(doc: OpenAPIObject, op: string): string {
    return Object.keys(operationAt(doc, op)?.responses ?? {})
      .sort()
      .join(' ');
  }

  /** The 19 routes this service serves that the contract also declares. */
  function implementedOperations(): string[] {
    return operationsOf(generated).filter(
      (op) => !DECLARED_DIFFERENCES.operationsNotInContract.includes(op),
    );
  }

  /**
   * The served document points a reader at a file that exists here.
   *
   * It named `5-api-design/openapi.yaml`, which is the sibling repository this
   * copy came from and is not a path in this checkout. Two commits, `43b7995`
   * and `f96b834`, both claim to have repointed every contract reference, and
   * both missed this one because nothing read it. A reviewer who follows the
   * pointer and finds nothing trusts the rest of the document less.
   */
  it('points at a contract file this repository actually has', () => {
    const described = generated.info.description ?? '';
    const cited = described.match(/[\w/.-]+openapi\.yaml/)?.[0];

    expect(cited).toBeDefined();
    expect(existsSync(join(__dirname, '..', cited as string))).toBe(true);
  });

  it('describes only operations the contract declares', () => {
    const declared = operationsOf(contract);
    const extra = implementedOperations().filter(
      (op) => !declared.includes(op),
    );

    expect(extra).toEqual([]);
  });

  it('implements a strict subset, and pins how much is left', () => {
    const implemented = implementedOperations();
    const missing = operationsOf(contract).filter(
      (op) => !implemented.includes(op),
    );

    // Not an assertion that nothing is missing: 18 operations are Week 4 work.
    // It pins the counts, so finishing one without updating the contract, or
    // deleting one by accident, shows up here as a number that moved.
    expect(implemented).toHaveLength(19);
    expect(missing).toHaveLength(18);
    expect(implemented.length + missing.length).toBe(
      operationsOf(contract).length,
    );
  });

  it('declares the same status codes the contract declares', () => {
    const wrong = implementedOperations()
      .filter(
        (op) => statusCodesOf(generated, op) !== statusCodesOf(contract, op),
      )
      .map(
        (op) =>
          `${op}: generated [${statusCodesOf(generated, op)}] contract [${statusCodesOf(contract, op)}]`,
      );

    expect(wrong).toEqual([]);
  });

  /**
   * The name a generated client calls the method.
   *
   * Nest's default is `${controllerKey}_${methodKey}`, so without an
   * `operationIdFactory` every one of the 19 operations was served under a name
   * the contract does not use. Two clients generated from the two documents
   * would not compile against each other, and nothing here noticed.
   */
  it('names each operation the way the contract names it', () => {
    const wrong = implementedOperations()
      .filter(
        (op) =>
          operationAt(generated, op)?.operationId !==
          operationAt(contract, op)?.operationId,
      )
      .map(
        (op) =>
          `${op}: generated ${operationAt(generated, op)?.operationId} contract ${operationAt(contract, op)?.operationId}`,
      );

    expect(wrong).toEqual([]);
  });

  /**
   * Whether a caller needs a token, which the contract spells three ways.
   *
   * The root `security` is the default and means required. An operation's own
   * `security: []` means public. `[{}, {bearerAuth: []}]` is the 3.0.3 spelling
   * for optional, a token allowed and not required, and `listProducts` and
   * `getProduct` are the two that carry it.
   *
   * Comparing the arrays literally would fail on ordering, so both sides are
   * reduced to the answer a reader of the document actually wants: may I call
   * this without signing in.
   */
  function authOf(doc: OpenAPIObject, op: string): string {
    const requirements = operationAt(doc, op)?.security ?? doc.security ?? [];
    if (requirements.length === 0) return 'public';
    return requirements.some((r) => Object.keys(r).length === 0)
      ? 'optional'
      : 'required';
  }

  it('agrees with the contract on who may call each operation', () => {
    const wrong = implementedOperations()
      .filter((op) => authOf(generated, op) !== authOf(contract, op))
      .map(
        (op) =>
          `${op}: generated ${authOf(generated, op)} contract ${authOf(contract, op)}`,
      );

    expect(wrong).toEqual([]);
  });

  /**
   * Every failure the document describes has to say what the body looks like.
   *
   * RFC 9457 problem documents are this API's headline choice and the contract
   * gives all 94 error responses a `Problem` schema. A generated document that
   * describes them with a description and nothing else tells a client the
   * request can fail and not how to read the failure, which is the half that
   * matters: `type` is what a client branches on.
   */
  function untypedFailures(op: string): string[] {
    const responses = operationAt(generated, op)?.responses ?? {};
    return Object.entries(responses)
      .filter(([status]) => Number(status) >= 400)
      .filter(([, response]) => {
        const content = (response as { content?: Record<string, unknown> })
          .content;
        return content === undefined || Object.keys(content).length === 0;
      })
      .map(([status]) => `${op} ${status}`);
  }

  it('gives every failure a body schema', () => {
    const untyped = implementedOperations().flatMap(untypedFailures);

    expect(untyped).toEqual([]);
  });

  it('agrees with the contract on request body shapes', () => {
    const wrong = implementedOperations()
      .filter((op) => {
        const g = requestShape(generated, op);
        const c = requestShape(contract, op);
        const empty = 'props=[] required=[]';
        if (g === empty && c === empty) return false;
        return g !== c;
      })
      .map(
        (op) =>
          `${op}: generated ${requestShape(generated, op)} contract ${requestShape(contract, op)}`,
      );

    expect(wrong).toEqual([]);
  });
});
