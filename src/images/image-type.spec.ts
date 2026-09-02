import { imageTypeOf, MAX_IMAGE_BYTES } from './image-type';

/**
 * The four signatures as literal bytes, and the things that look close and
 * are not: a `RIFF` that is a WAV, text, and nothing at all.
 */
describe('imageTypeOf', () => {
  it('is five mebibytes, the limit the contract names without a number', () => {
    expect(MAX_IMAGE_BYTES).toBe(5242880);
  });

  it('reads PNG from its first four bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(imageTypeOf(png)).toEqual({ mime: 'image/png', ext: 'png' });
  });

  it('reads JPEG from its first three bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(imageTypeOf(jpeg)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('reads GIF from GIF8', () => {
    const gif = Buffer.from('GIF89a', 'latin1');
    expect(imageTypeOf(gif)).toEqual({ mime: 'image/gif', ext: 'gif' });
  });

  it('reads WebP from RIFF with WEBP eight bytes in', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WEBPVP8 ', 'latin1'),
    ]);
    expect(imageTypeOf(webp)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('answers null for a RIFF that is not WebP, for text, and for nothing', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVEfmt ', 'latin1'),
    ]);
    expect(imageTypeOf(wav)).toBeNull();
    expect(imageTypeOf(Buffer.from('hello, not an image', 'utf8'))).toBeNull();
    expect(imageTypeOf(Buffer.alloc(0))).toBeNull();
  });
});
