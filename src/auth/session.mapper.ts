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
 * `openapi.yaml:30-33`. Assigning `undefined` would satisfy the wire and still
 * put the key on the object, where a test that reads the object would find it.
 */
export function toSessionDto(row: RefreshTokenRow): SessionDto {
  const dto: SessionDto = {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };

  if (row.deviceName !== null) {
    dto.deviceName = row.deviceName;
  }

  return dto;
}
