import request from 'supertest';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { TestApp } from './app-factory';
import { createTestApp } from './app-factory';

/**
 * The problems each failure lists in the served document, read over HTTP the
 * way a client reads `/docs-json`.
 *
 * Every failure pointed at the bare `Problem` schema, and the contract lists
 * its examples per status, so a reader could not tell which problems one
 * operation returns (issue 34). The served document lists, per operation,
 * what that operation throws. Whether each listed type is one the contract
 * allows at that status is the contract test's check.
 */
describe('Problems each operation lists in the served document (e2e)', () => {
  let ctx: TestApp;
  let served: OpenAPIObject;

  type ProblemContent = {
    schema?: unknown;
    examples?: Record<string, { value?: Record<string, unknown> }>;
  };
  type Operation = {
    responses?: Record<string, { content?: Record<string, ProblemContent> }>;
  };

  const EMAIL_TAKEN = 'https://tshirt.store/problems/email-taken';

  beforeAll(async () => {
    ctx = await createTestApp();
    const res = await request(ctx.app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    served = res.body as OpenAPIObject;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** The problem body of "POST /users" at one status, or undefined. */
  function problemContent(
    op: string,
    status: string,
  ): ProblemContent | undefined {
    const [method, path] = op.split(' ');
    const item = served.paths[path] as Record<string, unknown> | undefined;
    const operation = item?.[method.toLowerCase()] as Operation | undefined;
    const content = operation?.responses?.[status]?.content;
    return content?.['application/problem+json'];
  }

  /** The example values one failure lists, in the order it lists them. */
  function problemsAt(op: string, status: string): Record<string, unknown>[] {
    return Object.values(problemContent(op, status)?.examples ?? {}).map(
      (example) => example.value ?? {},
    );
  }

  /**
   * Sign-up is the one operation that answers email-taken, and a client that
   * reads its type can offer sign-in instead. The title and detail are the
   * throw site's in `UsersService`.
   */
  it('lists email-taken on the sign-up 409, with its title and detail', () => {
    expect(problemsAt('POST /users', '409')).toEqual([
      {
        type: EMAIL_TAKEN,
        title: 'Email already registered',
        status: 409,
        detail: 'An account with this email already exists.',
      },
    ]);
  });

  /**
   * The contract's 409 lists email-taken for every operation, so a reader of
   * the contract sees it on POST /promo-codes, where it cannot happen. The
   * served document lists it on sign-up only. The sign-up line is the
   * control: a lookup that read nothing would pass the second.
   */
  it('lists no email-taken on the promo-code 409', () => {
    const types = (op: string) => problemsAt(op, '409').map((p) => p.type);

    expect(types('POST /users')).toContain(EMAIL_TAKEN);
    expect(types('POST /promo-codes')).not.toContain(EMAIL_TAKEN);
  });

  /**
   * An operation the map does not name, at a status with no specific problem,
   * serves the body it served before the map: the schema and nothing else, so
   * not an empty `examples` either.
   */
  it('keeps the bare Problem schema where the map lists nothing', () => {
    expect(problemContent('DELETE /products/{id}', '404')).toEqual({
      schema: { $ref: '#/components/schemas/Problem' },
    });
  });
});
