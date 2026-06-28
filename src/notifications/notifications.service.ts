import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as twilio from 'twilio';
import { Repository } from 'typeorm';
import { Business } from '../business/entities/business.entity';
import {
    Language,
    NotificationStatus,
    NotificationType,
} from '../common/enums';
import { Order } from '../orders/entities/order.entity';
import { NotificationLog } from './entities/notification-log.entity';

@Injectable()
export class NotificationsService {
  private readonly twilioClient: twilio.Twilio | null;

  constructor(
    @InjectPinoLogger(NotificationsService.name)
    private readonly logger: PinoLogger,
    @InjectRepository(NotificationLog)
    private readonly notificationLogRepository: Repository<NotificationLog>,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

    if (accountSid && authToken) {
      this.twilioClient = twilio.default(accountSid, authToken);
    } else {
      this.twilioClient = null;
    }
  }

  async notifyNewOrder(order: Order, business: Business): Promise<void> {
    const itemsWithSubtotal = order.items.map((item) => ({
      ...item,
      subtotal: (Number(item.unitPrice) * item.quantity).toFixed(2),
    }));

    const context = {
      businessName: business.name,
      customerName: order.customerName,
      phone: order.phone,
      email: order.email,
      deliveryDate: order.deliveryDate,
      notes: order.notes,
      items: itemsWithSubtotal,
      total: Number(order.total).toFixed(2),
      createdAt: new Date(order.createdAt).toLocaleString('es-MX'),
    };

    if (business.notifyViaEmail) {
      await this.sendEmailNotification(
        business.notificationEmail,
        `[${business.name}] Nuevo pedido de ${order.customerName}`,
        'new-order',
        context,
        order,
        NotificationType.EMAIL,
      );
    }

    if (business.notifyViaWhatsapp && this.twilioClient && business.notificationWhatsapp && this.configService.get('WHATSAPP_ENABLED') !== 'false') {
      const message =
        `*Nuevo pedido* en ${business.name}\n` +
        `👤 Cliente: ${order.customerName}\n` +
        `📞 Teléfono: ${order.phone}\n` +
        `📅 Entrega: ${order.deliveryDate}\n` +
        `💰 Total: $${context.total}`;

      await this.sendWhatsAppNotification(
        business.notificationWhatsapp,
        message,
        order,
      );
    }
  }

  async sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to,
        subject: 'Restablecer contraseña',
        template: 'reset-password',
        context: { name, resetUrl },
      });
      this.logger.info({ recipient: to }, 'Password reset email sent');
    } catch (error) {
      this.logger.error(
        {
          recipient: to,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to send password reset email',
      );
    }
  }

  async notifyCustomer(
    order: Order,
    business: Business,
    event: 'confirmed' | 'ready',
  ): Promise<void> {
    if (!order.email) return;

    const isSpanish = order.language === Language.ES;
    const context = {
      customerName: order.customerName,
      deliveryDate: order.deliveryDate,
      notes: order.notes,
      items: order.items,
      total: Number(order.total).toFixed(2),
      businessName: business.name,
      isSpanish,
      language: order.language,
    };

    const subject =
      event === 'confirmed'
        ? isSpanish
          ? `Tu pedido fue confirmado — ${business.name}`
          : `Your order has been confirmed — ${business.name}`
        : isSpanish
          ? `Tu pedido está listo — ${business.name}`
          : `Your order is ready — ${business.name}`;

    const template = event === 'confirmed' ? 'order-confirmed' : 'order-ready';

    await this.sendEmailNotification(
      order.email,
      subject,
      template,
      context,
      order,
      NotificationType.EMAIL,
    );
  }

  private async sendEmailNotification(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown>,
    order: Order,
    type: NotificationType,
  ): Promise<void> {
    const log = this.notificationLogRepository.create({
      orderId: order.id,
      type,
      recipient: to,
      sentAt: new Date(),
      status: NotificationStatus.SENT,
    });

    try {
      await this.mailerService.sendMail({ to, subject, template, context });
      await this.notificationLogRepository.save(log);
    } catch (error) {
      log.status = NotificationStatus.FAILED;
      log.errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.notificationLogRepository.save(log);
      this.logger.error(
        {
          recipient: to,
          notificationType: type,
          orderId: order.id,
          errorMessage: log.errorMessage,
        },
        'Failed to send email notification',
      );
    }
  }

  private async sendWhatsAppNotification(
    to: string,
    message: string,
    order: Order,
  ): Promise<void> {
    const log = this.notificationLogRepository.create({
      orderId: order.id,
      type: NotificationType.WHATSAPP,
      recipient: to,
      sentAt: new Date(),
      status: NotificationStatus.SENT,
    });

    try {
      const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
      const from = this.configService.get<string>('TWILIO_WHATSAPP_FROM')!;

      await this.twilioClient!.messages.create({
        from,
        to: formattedTo,
        body: message,
      });

      await this.notificationLogRepository.save(log);
    } catch (error) {
      log.status = NotificationStatus.FAILED;
      log.errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.notificationLogRepository.save(log);
      this.logger.error(
        {
          recipient: to,
          notificationType: NotificationType.WHATSAPP,
          orderId: order.id,
          errorMessage: log.errorMessage,
        },
        'Failed to send WhatsApp notification',
      );
    }
  }
}
