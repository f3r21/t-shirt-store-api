import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3ObjectStore } from './s3.object-store';
import { nthArg } from '../common/mock-args';

/**
 * The two commands, pinned: the bucket, the key, the body, the type, and the
 * cache header that lets the edge keep an object forever because its key
 * never changes.
 */
describe('S3ObjectStore', () => {
  let send: jest.Mock;
  let store: S3ObjectStore;

  beforeEach(() => {
    send = jest.fn().mockResolvedValue({});
    store = new S3ObjectStore({ send }, 'the-bucket');
  });

  it('puts the object with its type and an immutable cache header', async () => {
    const body = Buffer.from('bytes');

    await store.put('images/products/7/x.png', body, 'image/png');

    const command = nthArg(send) as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'the-bucket',
      Key: 'images/products/7/x.png',
      Body: body,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('deletes the object by its key', async () => {
    await store.delete('images/products/7/x.png');

    const command = nthArg(send) as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'the-bucket',
      Key: 'images/products/7/x.png',
    });
  });

  it("lets the client's failure through, so the caller can compensate", async () => {
    send.mockRejectedValue(new Error('AccessDenied'));

    await expect(store.put('k', Buffer.from(''), 'image/png')).rejects.toThrow(
      'AccessDenied',
    );
  });
});
