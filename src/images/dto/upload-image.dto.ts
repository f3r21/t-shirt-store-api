import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * The one field beside the file in the multipart body.
 *
 * A multipart field arrives as a string, so `isPrimary` takes the two
 * spellings the contract allows and hands anything else to `@IsBoolean`,
 * the same transform `includeInactive` uses and for the same reason: a
 * `Boolean('false')` is true.
 */
export class UploadImageDto {
  /** Make this the card image of the product. */
  @ApiPropertyOptional({ default: false })
  @IsOptionalNotNull()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: 'must be a boolean' })
  isPrimary: boolean = false;
}
