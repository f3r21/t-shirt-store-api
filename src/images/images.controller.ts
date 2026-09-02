import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ImagesService } from './images.service';
import { UploadImageDto } from './dto/upload-image.dto';
import { MAX_IMAGE_BYTES } from './image-type';
import { ProductImageDto } from '../products/dto/product.dto';
import { CheckPolicies } from '../authz/check-policies.decorator';
import { can } from '../authz/policies';
import { ParseIdPipe } from '../common/parse-id.pipe';

/**
 * The upload, under the product it belongs to. See `openapi.yaml:911-966`.
 *
 * Multer reads the multipart body into memory with the contract's size limit,
 * so a file above it is refused while it streams, as 413, before a byte of
 * it is stored. Whether the bytes are an image is the service's question,
 * answered from the bytes and not from the part's declared type. Each
 * handler is named after its contract operation id, which the drift suite
 * compares.
 */
@ApiTags('catalog')
@Controller('products')
export class ProductImagesController {
  constructor(private readonly images: ImagesService) {}

  @CheckPolicies(can('update', 'Product'))
  @ApiOperation({ summary: 'Upload a product image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'The image file.',
        },
        isPrimary: {
          type: 'boolean',
          default: false,
          description: 'Make this the card image of the product.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'The server stored the image.',
    type: ProductImageDto,
    headers: {
      Location: {
        description: 'The URL of the new image.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'The request carries no file.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({ status: 404, description: 'The product does not exist.' })
  @ApiResponse({ status: 413, description: 'The file is above 5 MiB.' })
  @ApiResponse({ status: 415, description: 'The file is not an image.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post(':id/images')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  async uploadProductImage(
    @Param('id', ParseIdPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadImageDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductImageDto> {
    if (file === undefined) {
      throw new BadRequestException({
        title: 'Bad request',
        detail: 'The request carries no file. Send one in the `file` part.',
      });
    }
    const image = await this.images.upload(
      id,
      { buffer: file.buffer },
      dto.isPrimary,
    );
    res.setHeader('Location', `/v1/images/${image.id}`);
    return image;
  }
}

/** The delete, on the image's own path. See `openapi.yaml:968-1000`. */
@ApiTags('catalog')
@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @CheckPolicies(can('update', 'Product'))
  @ApiOperation({ summary: 'Remove a product image' })
  @ApiResponse({ status: 204, description: 'The image is gone.' })
  @ApiResponse({ status: 400, description: 'The id is not an integer.' })
  @ApiResponse({ status: 401, description: 'The request has no valid token.' })
  @ApiResponse({ status: 403, description: 'The caller is not a manager.' })
  @ApiResponse({ status: 404, description: 'The image does not exist.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProductImage(@Param('id', ParseIdPipe) id: number): Promise<void> {
    return this.images.remove(id);
  }
}
