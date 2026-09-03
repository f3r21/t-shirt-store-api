/**
 * Read an argument off a jest mock as `unknown`, so the caller states the shape
 * and the compiler holds it to that. Fails with a message when the call never
 * happened.
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
