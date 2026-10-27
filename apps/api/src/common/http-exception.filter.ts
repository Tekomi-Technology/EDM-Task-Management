import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { TransitionError, type ApiError } from '@edm/shared';
import type { Request, Response } from 'express';
import { AppError } from './errors';

const TRANSITION_STATUS: Record<TransitionError['code'], number> = {
  INVALID_TRANSITION: HttpStatus.CONFLICT,
  FORBIDDEN_ROLE: HttpStatus.FORBIDDEN,
  NOT_ASSIGNEE: HttpStatus.FORBIDDEN
};

/** Turns every error into the single error shape described in ApiError. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) this.logger.error(exception);
    // Read by the integration log, to say why another system's request was refused.
    res.locals.error = `${body.code}: ${body.message}`;
    res.status(body.statusCode).json({ ...body, requestId: req.id });
  }

  private toBody(exception: unknown): ApiError {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details
      };
    }
    if (exception instanceof TransitionError) {
      return {
        statusCode: TRANSITION_STATUS[exception.code],
        code: exception.code,
        message: exception.message
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string }).message ?? exception.message);
      return { statusCode: status, code: HttpStatus[status] ?? 'ERROR', message: String(message) };
    }
    // Express's body parser refuses a body before any controller runs (too large, not JSON): the caller's mistake.
    const parser = exception as { type?: unknown; status?: unknown };
    if (typeof parser.type === 'string' && typeof parser.status === 'number' && parser.status < 500) {
      return parser.type === 'entity.too.large'
        ? { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large' }
        : { statusCode: parser.status, code: 'INVALID_BODY', message: 'The request body could not be read' };
    }
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
  }
}
