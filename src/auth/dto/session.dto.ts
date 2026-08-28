/**
 * One entry of GET /auth/sessions. See `openapi.yaml:1620-1643`.
 *
 * The field list is the point. The `refresh_tokens` row also holds `token_hash`
 * and `previous_token_hash`. Neither reaches a response.
 */
export class SessionDto {
  /**
   * The id of this device session. Rotation updates the row and keeps the id, so
   * a client can send this value to DELETE /auth/sessions/{id}.
   */
  id!: number;

  /**
   * The label the device sent at sign-in.
   *
   * The key is absent when the device sent none. The contract admits no null
   * value, so the mapper omits the key instead.
   */
  deviceName?: string;

  /** ISO 8601. When this device first signed in. Rotation does not change it. */
  createdAt!: string;

  /** ISO 8601. When the refresh token expires. Every rotation moves it. */
  expiresAt!: string;
}
