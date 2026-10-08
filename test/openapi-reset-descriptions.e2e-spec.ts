import type { OpenAPIObject } from '@nestjs/swagger';
import type { TestApp } from './app-factory';
import { createTestApp } from './app-factory';
import {
  fetchServedDocument,
  loadContract,
  operationAt,
} from './openapi-documents';

/**
 * The password reset flow as the served document tells it, read over HTTP the
 * way a client reads `/docs-json`, against the contract's own text.
 *
 * A front-end developer who read only the deployed Swagger page could not tell
 * what follows forgot-password. The contract said it and the served document
 * did not. Whitespace is normalized on both sides, because the contract wraps
 * its lines and the controller joins strings.
 */
describe('Password reset descriptions in the served document (e2e)', () => {
  let ctx: TestApp;
  let served: OpenAPIObject;
  let contract: OpenAPIObject;

  type Described = { description?: string };
  type DescribedOperation = Described & {
    responses?: Record<string, Described>;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    served = await fetchServedDocument(ctx);
    contract = loadContract();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /**
   * The description of "POST /auth/forgot-password", or of one of its
   * responses when a status is given, with each run of whitespace made one
   * space. Empty when the document has none.
   */
  function descriptionOf(
    doc: OpenAPIObject,
    op: string,
    status?: string,
  ): string {
    const operation = operationAt(doc, op) as DescribedOperation | undefined;
    const target =
      status === undefined ? operation : operation?.responses?.[status];
    return (target?.description ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * What a reader needs before the first call: the answer is always 202, the
   * mail goes out only for an address with an account, and too many requests
   * return 429. The two `toContain` lines are the control: two empty strings
   * compare equal and prove nothing.
   */
  it('gives forgot-password and its 202 the contract description', () => {
    const op = 'POST /auth/forgot-password';
    const operation = descriptionOf(contract, op);
    const accepted = descriptionOf(contract, op, '202');

    expect(operation).toContain('429');
    expect(accepted).toContain('only if the address has an account');
    expect(descriptionOf(served, op)).toBe(operation);
    expect(descriptionOf(served, op, '202')).toBe(accepted);
  });

  /**
   * The rest of the flow: the token in the body, 422 for an unknown or expired
   * token, and every device signed out and a mail sent on success.
   */
  it('gives reset-password the contract description', () => {
    const op = 'POST /auth/reset-password';
    const operation = descriptionOf(contract, op);

    expect(operation).toContain('422');
    expect(descriptionOf(served, op)).toBe(operation);
  });
});
