import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CreateOrderDto } from './create-order.dto.js';

/**
 * DTO for admin-created orders.
 * businessId is optional: admins inherit it from their JWT token;
 * super_admin must provide it explicitly.
 */
export class CreateAdminOrderDto extends OmitType(CreateOrderDto, [
  'businessId',
] as const) {
  @ApiPropertyOptional({
    description: 'Required only for super_admin. Admins use their own businessId.',
  })
  @IsUUID()
  @IsOptional()
  businessId?: string;
}
