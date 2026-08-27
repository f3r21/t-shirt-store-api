import { BadRequestException, ValidationError } from '@nestjs/common';

export function validationExceptionFactory(errors: ValidationError[]) {
  const flat = errors.flatMap((e) =>
    Object.values(e.constraints ?? {}).map((message) => ({
      field: e.property,
      message,
    })),
  );

  return new BadRequestException({
    title: 'Bad Request',
    status: 400,
    errors: flat,
  });
}
