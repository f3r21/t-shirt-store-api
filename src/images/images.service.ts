import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EnvironmentVariables } from '../config/env.validation';
import { NOT_DELETED } from '../products/product-visibility';
import { toProductImageDto } from '../products/product.mapper';
import { ProductImageDto } from '../products/dto/product.dto';
import { imageTypeOf } from './image-type';
import { OBJECT_STORE } from './object-store';
import type { ObjectStore } from './object-store';

/** What the controller hands over: the bytes, and nothing the client declared. */
export interface UploadedImage {
  buffer: Buffer;
}

/**
 * The two image operations. See `openapi.yaml:911-1000`.
 *
 * **The object first, then the row; the row first, then the object.** An
 * upload writes the object and then the row in one transaction, and a row
 * that fails takes its object back down, so the API never shows a URL with
 * nothing behind it. A delete removes the row and then the object, and an
 * object that will not go is logged and left, because a URL the API still
 * shows is worse than one object nobody references.
 *
 * **One primary per product**, kept by the transaction that clears the
 * previous flag before it sets the new one. Removing the primary leaves the
 * product with none, which is what the contract says.
 *
 * **The type is read from the bytes**, in `image-type.ts`, never from the
 * header the client declared. DECISIONS 31.
 */
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.baseUrl = config
      .getOrThrow<string>('IMAGES_BASE_URL')
      .replace(/\/+$/, '');
  }

  async upload(
    productId: number,
    file: UploadedImage,
    isPrimary: boolean,
  ): Promise<ProductImageDto> {
    // `NOT_DELETED` and not the shopper's view: a manager may add an image to
    // a product they disabled, as `updateProduct` lets them edit it.
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...NOT_DELETED },
      select: { id: true },
    });
    if (product === null) {
      throw new NotFoundException();
    }

    const type = imageTypeOf(file.buffer);
    if (type === null) {
      throw new UnsupportedMediaTypeException({
        title: 'Unsupported media type',
        detail: 'The file is not a PNG, JPEG, GIF or WebP image.',
      });
    }

    const key = `images/products/${productId}/${randomUUID()}.${type.ext}`;
    await this.store.put(key, file.buffer, type.mime);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (isPrimary) {
          await tx.productImage.updateMany({
            where: { productId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        return tx.productImage.create({
          data: { productId, url: `${this.baseUrl}/${key}`, isPrimary },
        });
      });
      return toProductImageDto(row);
    } catch (err) {
      await this.forget(key);
      throw err;
    }
  }

  async remove(imageId: number): Promise<void> {
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
    });
    if (image === null) {
      throw new NotFoundException();
    }

    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.forget(this.keyOf(image.url), imageId);
  }

  /** The key is the URL without the base, which is how `upload` built it. */
  private keyOf(url: string): string {
    return url.startsWith(`${this.baseUrl}/`)
      ? url.slice(this.baseUrl.length + 1)
      : new URL(url).pathname.replace(/^\//, '');
  }

  /**
   * Remove an object the API no longer shows. A failure here is logged and
   * not thrown: the row is already gone or was never written, so the answer
   * to the caller is right, and the object is one orphan to sweep.
   */
  private async forget(key: string, imageId?: number): Promise<void> {
    try {
      await this.store.delete(key);
    } catch (err) {
      this.logger.error({
        msg: 'an image object outlived its row',
        event: 'image.orphaned',
        key,
        imageId,
        err,
      });
    }
  }
}
