import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The body of POST /webhooks/stripe, for the document only. See
 * `openapi.yaml:1713-1732`.
 *
 * The handler never validates through this class. The signature covers the
 * raw bytes Stripe sent, so the route reads `req.rawBody` and hands it to the
 * SDK, which parses it after the check. This class exists so the served
 * document describes the body the contract describes: `id` and `type`
 * required, the rest opaque.
 */
export class StripeEventDto {
  id!: string;

  type!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  data?: Record<string, unknown>;
}
