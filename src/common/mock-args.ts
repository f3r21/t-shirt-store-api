/**
 * Read an argument off a jest mock without reaching through `any`.
 *
 * `mock.mock.calls[0][0]` is typed `any`, so every assertion written that way
 * silently opts out of type checking and trips `no-unsafe-member-access`. This
 * returns `unknown`, so the caller states the shape it expects and the compiler
 * holds it to that.
 *
 * It also fails with a useful message when the call never happened, rather than
 * throwing `Cannot read properties of undefined` from inside an assertion.
 */
export function nthArg(mock: jest.Mock, index = 0, call = 0): unknown {
  const calls = mock.mock.calls as unknown[][];
  if (calls.length <= call) {
    throw new Error(
      `expected at least ${call + 1} call(s), but the mock was called ${calls.length} time(s)`,
    );
  }
  return calls[call][index];
}
