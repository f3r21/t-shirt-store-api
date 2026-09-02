/** The size limit the contract names and does not number: five mebibytes. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ImageType {
  mime: string;
  ext: string;
}

/**
 * The image type from the first bytes, or null.
 *
 * The bytes and not the header the client declared, because the header is
 * whatever the client chose to send and the contract's 415 is about what the
 * file is. Four formats, by their signatures: PNG `89 50 4E 47`, JPEG
 * `FF D8 FF`, GIF `GIF8`, WebP `RIFF` then `WEBP` eight bytes in. Nothing
 * else is an image here, whatever its extension.
 */
export function imageTypeOf(bytes: Buffer): ImageType | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'GIF8') {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}
