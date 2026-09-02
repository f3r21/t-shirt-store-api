export const OBJECT_STORE = Symbol('OBJECT_STORE');

/**
 * The two calls the image service makes on storage. Narrow on purpose, the
 * `StripeClient` shape: the e2e suite hands the service a store in memory,
 * and the unit spec of the S3 binding pins the two commands it sends.
 */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}
