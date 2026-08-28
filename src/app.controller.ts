import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // The access token guard is global, so the starter route needs the marker
  // like any other public operation.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
