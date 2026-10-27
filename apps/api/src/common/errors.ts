import { HttpStatus } from '@nestjs/common';

/** An error with a stable machine-readable code, returned to clients as `{ statusCode, code, message }`. */
export class AppError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) =>
  new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
