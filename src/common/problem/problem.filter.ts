import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { toProblem } from './problem';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, body } = toProblem(err, req.url);

    if (status >= 500) {
      this.logger.error(err);
    }
    if (status === 401) {
      res.setHeader('WWW-Authenticate', 'Bearer');
    }
    res.status(status).type('application/problem+json').json(body);
  }
}
