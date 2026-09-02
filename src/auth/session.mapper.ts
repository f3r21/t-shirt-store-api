import type { RefreshToken as RefreshTokenRow } from '../generated/prisma/client';
import { SessionDto } from './dto/session.dto';

/**
 * Map a `refresh_tokens` row to one entry of the device list.
 *
 * The function names every field it copies, so `token_hash` and
 * `previous_token_hash` cannot reach a response through this path.
 *
 * `deviceName` is assigned only when the column holds a value. The contract
 * states that an optional value is absent and never null, at
 * `openapi.yaml:33-36`. Assigning `undefined` would satisfy the wire and still
 * put the key on the object, where a test that reads the object would find it.
 */
export function toSessionDto(row: RefreshTokenRow): SessionDto {
  const dto: SessionDto = {
    // The family, not the row. A device is a family and a family can hold more
    // than one live row, so the row id would change under a caller the first
    // time two of their tabs refreshed at once. The contract promises the
    // opposite at `openapi.yaml:244`: "The session id does not change, so an id
    // from `GET /auth/sessions` stays valid for the life of the device
    // session." The founder carries `family_id` null and names the family with
    // its own id, so this is the same number it has always been.
    id: row.familyId ?? row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };

  if (row.deviceName !== null) {
    dto.deviceName = row.deviceName;
  }

  return dto;
}
