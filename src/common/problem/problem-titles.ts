/**
 * The title and detail each status carries when the thrower names neither.
 *
 * Every string is transcribed from the response examples in `openapi.yaml`, so a
 * generic failure reads the same as the contract says it reads. RFC 9457 states
 * that a title "does not change between occurrences", which is why nothing here
 * is built from a message that carries request text.
 *
 * A status whose detail depends on the case is absent from `STATUS_DETAILS`. 401,
 * 409 and 422 each cover more than one cause, and the contract gives a different
 * detail for each, so the thrower supplies it.
 */
export const STATUS_TITLES: Record<number, string> = {
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
