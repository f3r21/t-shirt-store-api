import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The body of `receiveStripeEvent`, for the document only: the handler reads
 * the raw bytes, and the SDK parses them after the signature check.
 */
export class StripeEventDto {
  id!: string;

  type!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  data?: Record<string, unknown>;
}
