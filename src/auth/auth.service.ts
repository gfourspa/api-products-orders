import {
    BadRequestException,
    Injectable,
    NotFoundException,
    OnModuleInit,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { I18nService } from 'nestjs-i18n';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  businessId: string | null;
}

@Injectable()
export class AuthService implements OnModuleInit {
  // Pre-computado al arranque para prevenir timing attacks en login
  private dummyHash!: string;

  constructor(
    @InjectPinoLogger(AuthService.name)
    private readonly logger: PinoLogger,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokensRepository: Repository<PasswordResetToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await bcrypt.hash('_dummy_timing_protection_', 12);
  }

  async login(dto: LoginDto, lang: string) {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase().trim() },
    });

    // Siempre ejecutar bcrypt.compare para prevenir timing-based user enumeration.
    // Si el usuario no existe, comparar contra un hash dummy (igual costo computacional).
    const hashToCheck = user?.password ?? this.dummyHash;
    const isMatch = await bcrypt.compare(dto.password, hashToCheck);

    if (!user) {
      this.logger.warn(
        { email: dto.email, requestContext: 'auth.login' },
        'Failed login attempt — email not found',
      );
      throw new UnauthorizedException(
        await this.i18n.translate('auth.email_not_found', { lang }),
      );
    }

    if (!isMatch) {
      this.logger.warn(
        { email: dto.email, requestContext: 'auth.login' },
        'Failed login attempt — invalid password',
      );
      throw new UnauthorizedException(
        await this.i18n.translate('auth.invalid_password', { lang }),
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        await this.i18n.translate('auth.account_inactive', { lang }),
      );
    }

    const tokens = await this.generateTokens(user);

    return {
      data: {
        user,
        ...tokens,
      },
      message: await this.i18n.translate('auth.login_success', { lang }),
    };
  }

  async refresh(rawRefreshToken: string, lang: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(rawRefreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(
        await this.i18n.translate('auth.token_invalid', { lang }),
      );
    }

    const tokenRecord = await this.refreshTokensRepository.findOne({
      where: { userId: payload.sub },
      order: { createdAt: 'DESC' },
    });

    if (!tokenRecord || tokenRecord.revokedAt) {
      throw new UnauthorizedException(
        await this.i18n.translate('auth.token_invalid', { lang }),
      );
    }

    if (new Date() > tokenRecord.expiresAt) {
      throw new UnauthorizedException(
        await this.i18n.translate('auth.token_invalid', { lang }),
      );
    }

    const isMatch = await bcrypt.compare(rawRefreshToken, tokenRecord.token);
    if (!isMatch) {
      throw new UnauthorizedException(
        await this.i18n.translate('auth.token_invalid', { lang }),
      );
    }

    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        await this.i18n.translate('auth.token_invalid', { lang }),
      );
    }

    // Revocar token anterior
    tokenRecord.revokedAt = new Date();
    await this.refreshTokensRepository.save(tokenRecord);

    const tokens = await this.generateTokens(user);

    return {
      data: tokens,
      message: await this.i18n.translate('auth.token_refreshed', { lang }),
    };
  }

  async logout(userId: string, lang: string) {
    await this.refreshTokensRepository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return {
      data: null,
      message: await this.i18n.translate('auth.logout_success', { lang }),
    };
  }

  async me(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException();
    }

    return { data: user };
  }

  async forgotPassword(dto: ForgotPasswordDto, lang: string) {
    // Always return the same response to prevent email enumeration
    const successMessage = await this.i18n.translate('auth.password_reset_sent', { lang });

    const user = await this.usersRepository.findOne({
      where: { email: dto.email },
    });

    if (!user || !user.isActive) {
      return { data: null, message: successMessage };
    }

    // Invalidate any previous unused tokens for this user
    await this.passwordResetTokensRepository.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    // Generate a 256-bit entropy token — stored as-is (random, non-user-derived)
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const record = this.passwordResetTokensRepository.create({
      userId: user.id,
      token: rawToken,
      expiresAt,
      usedAt: null,
    });
    await this.passwordResetTokensRepository.save(record);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.split(',')[0]
      ?? this.configService.get<string>('APP_URL', 'http://localhost:3000');
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    setImmediate(() => {
      this.notificationsService
        .sendPasswordResetEmail(user.email, user.name, resetUrl)
        .catch((err: unknown) => {
          this.logger.error(
            { userId: user.id, error: err instanceof Error ? err.message : String(err) },
            'Failed to dispatch password reset email',
          );
        });
    });

    return { data: null, message: successMessage };
  }

  async resetPassword(dto: ResetPasswordDto, lang: string) {
    const record = await this.passwordResetTokensRepository.findOne({
      where: {
        token: dto.token,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!record) {
      throw new BadRequestException(
        await this.i18n.translate('auth.password_reset_token_invalid', { lang }),
      );
    }

    const user = await this.usersRepository.findOne({ where: { id: record.userId } });

    if (!user || !user.isActive) {
      throw new BadRequestException(
        await this.i18n.translate('auth.password_reset_token_invalid', { lang }),
      );
    }

    user.password = await bcrypt.hash(dto.newPassword, 12);
    await this.usersRepository.save(user);

    // Mark token as used and revoke all refresh tokens
    record.usedAt = new Date();
    await this.passwordResetTokensRepository.save(record);
    await this.refreshTokensRepository.update(
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return {
      data: null,
      message: await this.i18n.translate('auth.password_reset_success', { lang }),
    };
  }

  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      businessId: user.businessId ?? null,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET') as string,
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '8h') as unknown as number,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') as string,
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as unknown as number,
    });

    const expiresInDays = parseInt(
      (
        this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d'
      ).replace('d', ''),
      10,
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const hashedToken = await bcrypt.hash(refreshToken, 10);

    const tokenRecord = this.refreshTokensRepository.create({
      userId: user.id,
      token: hashedToken,
      expiresAt,
    });
    await this.refreshTokensRepository.save(tokenRecord);

    return { accessToken, refreshToken };
  }
}
