import { readFileSync } from 'node:fs';
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
 * **What it compares:** the set of operations, the status codes each declares,
 * and the property and required names of each request body. **What it does
 * not:** types, formats, lengths, examples and descriptions. The contract
 * expresses bounds the generated document spells differently, and asserting on
 * those would fail on spelling rather than on substance. That limit is stated
 * here rather than left for a reader to find out.
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
