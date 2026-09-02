import { Module } from '@nestjs/common';
import { ImagesService } from './images.service';
import { ImagesController, ProductImagesController } from './images.controller';
import { objectStoreProvider } from './s3.object-store';

/**
 * The product images. The store is a token, so the e2e factory replaces it
 * with one in memory and keeps everything else real; see `object-store.ts`.
 * `PrismaModule` and `ConfigModule` are global.
 */
@Module({
  controllers: [ProductImagesController, ImagesController],
  providers: [objectStoreProvider, ImagesService],
})
export class ImagesModule {}
