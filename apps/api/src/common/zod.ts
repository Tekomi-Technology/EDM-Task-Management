import { applyDecorators, ArgumentMetadata, Body, HttpStatus, PipeTransform, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from './errors';

export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _meta: ArgumentMetadata): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Request data is not valid',
        result.error.issues
      );
    }
    return result.data;
  }
}

/** Validates the request body with a zod schema and documents it in Swagger. */
export const ZodBody = (schema: z.ZodType) => Body(new ZodPipe(schema));

export const ZodQuery = (schema: z.ZodType) => Query(new ZodPipe(schema));

/** The body as callers send it (defaults not yet filled in), in the OpenAPI 3.0 dialect Swagger UI reads. */
export const ApiZodBody = (schema: z.ZodType) =>
  applyDecorators(
    ApiBody({
      schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }) as object
    })
  );
