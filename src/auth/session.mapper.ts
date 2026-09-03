import type { RefreshToken as RefreshTokenRow } from '../generated/prisma/client';
import type { SessionDto } from './dto/session.dto';

/**
 * One entry of the device list. Every field is named, so no hash reaches a
 * response. `deviceName` is assigned only when present, because the contract
 * says an optional value is absent and never null.
 */
export function toSessionDto(row: RefreshTokenRow): SessionDto {
  const dto: SessionDto = {
    // The family, not the row: the contract says the session id does not
    // change, and a family can hold more than one live row. ADR 2.
    id: row.familyId ?? row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };

  if (row.deviceName !== null) {
    dto.deviceName = row.deviceName;
  }

  return dto;
}
