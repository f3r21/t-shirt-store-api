import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';

/** The liveness route at the prefix root. The release smoke reads it. */
@Controller()
export class HealthController {
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
