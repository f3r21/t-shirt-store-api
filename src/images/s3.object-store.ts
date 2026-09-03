import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { EnvironmentVariables } from '../config/env.validation';
import { OBJECT_STORE } from './object-store';
import type { ObjectStore } from './object-store';

/** What the store sends; the spec replaces it with a recorder. */
export type S3Sender = Pick<S3Client, 'send'>;

/**
 * The production binding for `OBJECT_STORE`: one bucket, two commands.
 *
 * Every key is unique (a uuid), so an object never changes under its URL and
 * can carry a one-year immutable cache header: the edge and the browser keep
 * it, and a replaced image is a new key. The client's credentials come from
 * the default chain, the task role in the container and `AWS_PROFILE` in a
 * laptop's shell; nothing here reads a key.
 */
export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Sender,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

export const objectStoreProvider: Provider = {
  provide: OBJECT_STORE,
  inject: [ConfigService],
  useFactory: (
    config: ConfigService<EnvironmentVariables, true>,
  ): ObjectStore =>
    new S3ObjectStore(
      new S3Client({ region: config.get<string>('AWS_REGION') }),
      config.getOrThrow<string>('S3_BUCKET'),
    ),
};
