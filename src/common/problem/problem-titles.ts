/**
 * The title and detail each status carries when the thrower names neither,
 * transcribed from the contract's examples. A status with more than one
 * cause is absent from `STATUS_DETAILS`, so the thrower supplies it. ADR 11.
 */
const STATUS_TITLES: Record<number, string> = {
  400: 'Validation failed',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Content too large',
  415: 'Unsupported media type',
  422: 'Unprocessable content',
  429: 'Too many requests',
  500: 'Internal server error',
};

export const STATUS_DETAILS: Record<number, string> = {
  400: 'One or more fields did not pass validation.',
  403: 'This operation is available to a manager only.',
  404: 'The server did not find this resource.',
  413: 'The image is above the size limit for this operation.',
  415: 'This operation accepts an image file only.',
  429: 'Wait before you send this request again.',
  500: 'The server failed to handle the request.',
};

export function titleFor(status: number): string {
  return STATUS_TITLES[status] ?? 'Internal server error';
}
