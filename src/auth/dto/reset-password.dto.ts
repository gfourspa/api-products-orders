import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recibido por correo' })
  @IsString()
  token!: string;

  @ApiProperty({
    minLength: 8,
    description: 'Mínimo 8 caracteres, 1 mayúscula, 1 número, 1 carácter especial',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message:
      'password must contain at least 1 uppercase letter, 1 number and 1 special character',
  })
  newPassword!: string;
}
