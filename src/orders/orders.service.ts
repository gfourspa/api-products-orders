import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { I18nService } from 'nestjs-i18n';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import PDFDocument from 'pdfkit';
import { Repository } from 'typeorm';
import { Business } from '../business/entities/business.entity';
import { Language, OrderSource, OrderStatus, Role } from '../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { CreateAdminOrderDto } from './dto/create-admin-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';

@Injectable()
export class OrdersService {
  private static readonly TRACKING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  private static generateTrackingToken(): string {
    const bytes = randomBytes(8);
    const raw = Array.from(bytes)
      .map((b) => OrdersService.TRACKING_ALPHABET[b % OrdersService.TRACKING_ALPHABET.length])
      .join('');
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  }

  constructor(
    @InjectPinoLogger(OrdersService.name)
    private readonly logger: PinoLogger,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly notificationsService: NotificationsService,
    private readonly i18n: I18nService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateOrderDto, lang: string) {
    const orderLang = dto.language ?? Language.ES;

    const business = await this.businessRepository.findOne({
      where: { id: dto.businessId },
    });

    if (!business) {
      throw new NotFoundException(
        await this.i18n.translate('common.not_found', { lang }),
      );
    }

    // Validar y construir items
    const items: OrderItem[] = [];
    let total = 0;

    for (const itemDto of dto.items) {
      const product = await this.productsRepository.findOne({
        where: { id: itemDto.productId, businessId: dto.businessId },
        relations: { translations: true },
      });

      if (!product) {
        throw new BadRequestException(
          await this.i18n.translate('orders.invalid_product', {
            lang,
            args: { id: itemDto.productId },
          }),
        );
      }

      if (!product.available) {
        const translation =
          product.translations.find((t) => t.language === orderLang) ??
          product.translations[0];
        throw new BadRequestException(
          await this.i18n.translate('orders.product_unavailable', {
            lang,
            args: { name: translation?.name ?? product.id },
          }),
        );
      }

      if (product.stock !== null && product.stock < itemDto.quantity) {
        const translation =
          product.translations.find((t) => t.language === orderLang) ??
          product.translations[0];
        throw new BadRequestException(
          await this.i18n.translate('orders.insufficient_stock', {
            lang,
            args: { name: translation?.name ?? product.id },
          }),
        );
      }

      const translation =
        product.translations.find((t) => t.language === orderLang) ??
        product.translations[0];

      const item = this.orderItemsRepository.create({
        productId: product.id,
        quantity: itemDto.quantity,
        unitPrice: product.price,
        productNameSnapshot: translation?.name ?? product.id,
      });

      items.push(item);
      total += Number(product.price) * itemDto.quantity;

      // Descontar stock si aplica
      if (product.stock !== null) {
        product.stock -= itemDto.quantity;
        await this.productsRepository.save(product);
      }
    }

    const order = this.ordersRepository.create({
      customerName: dto.customerName,
      phone: dto.phone,
      email: dto.email,
      deliveryDate: dto.deliveryDate,
      notes: dto.notes,
      businessId: dto.businessId,
      language: orderLang,
      total: parseFloat(total.toFixed(2)),
      trackingToken: OrdersService.generateTrackingToken(),
      items,
    });

    const saved = await this.ordersRepository.save(order);

    // Notificación asíncrona — no bloquea la respuesta
    setImmediate(() => {
      this.notificationsService
        .notifyNewOrder(saved, business)
        .catch((err: unknown) => {
          this.logger.error(
            {
              orderId: saved.id,
              businessId: saved.businessId,
              error: err instanceof Error ? err.message : String(err),
            },
            'Failed to send new order notification',
          );
        });
    });

    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    const trackingUrl = `${appUrl}/api/v1/orders/track/${saved.trackingToken}`;

    return {
      data: { ...saved, trackingUrl },
      message: await this.i18n.translate('orders.created', { lang }),
    };
  }

  async findAll(
    businessId: string,
    lang: string,
    currentUser: User,
    status?: OrderStatus,
    date?: string,
    phone?: string,
    page = 1,
    limit = 10,
  ) {
    const resolvedBusinessId = this.resolveBusinessId(currentUser, businessId);

    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'item')
      .where('order.businessId = :businessId', { businessId: resolvedBusinessId });

    if (status) {
      qb.andWhere('order.status = :status', { status });
    }

    if (date) {
      qb.andWhere('order.deliveryDate = :date', { date });
    }

    if (phone) {
      qb.andWhere('order.phone ILIKE :phone', { phone: `%${phone}%` });
    }

    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('order.createdAt', 'DESC')
      .getManyAndCount();

    return {
      data,
      meta: { total, page, limit },
      message: await this.i18n.translate('orders.list', { lang }),
    };
  }

  async findOne(id: string, lang: string, currentUser: User) {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: { items: true, business: true },
    });

    if (!order) {
      throw new NotFoundException(
        await this.i18n.translate('orders.not_found', { lang }),
      );
    }

    if (currentUser.role !== Role.SUPER_ADMIN && currentUser.businessId !== order.businessId) {
      throw new ForbiddenException();
    }

    return { data: order };
  }

  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    lang: string,
    currentUser: User,
  ) {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: { items: true, business: true },
    });

    if (!order) {
      throw new NotFoundException(
        await this.i18n.translate('orders.not_found', { lang }),
      );
    }

    if (currentUser.role !== Role.SUPER_ADMIN && currentUser.businessId !== order.businessId) {
      throw new ForbiddenException();
    }

    const business = await this.businessRepository.findOne({
      where: { id: order.businessId },
    });

    order.status = dto.status;
    const saved = await this.ordersRepository.save(order);

    // Notificar al cliente de forma asíncrona cuando el estado cambia
    if (
      business &&
      (dto.status === OrderStatus.CONFIRMED || dto.status === OrderStatus.READY)
    ) {
      const event =
        dto.status === OrderStatus.CONFIRMED ? 'confirmed' : 'ready';
      setImmediate(() => {
        this.notificationsService
          .notifyCustomer(saved, business, event)
          .catch((err: unknown) => {
            this.logger.error(
              {
                orderId: saved.id,
                businessId: saved.businessId,
                event,
                error: err instanceof Error ? err.message : String(err),
              },
              'Failed to send customer notification',
            );
          });
      });
    }

    return {
      data: saved,
      message: await this.i18n.translate('orders.status_updated', {
        lang,
        args: { status: dto.status },
      }),
    };
  }

  async remove(id: string, lang: string, currentUser: User) {
    const order = await this.ordersRepository.findOne({ where: { id } });

    if (!order) {
      throw new NotFoundException(
        await this.i18n.translate('orders.deleted', { lang }),
      );
    }

    if (currentUser.role !== Role.SUPER_ADMIN && currentUser.businessId !== order.businessId) {
      throw new ForbiddenException();
    }

    await this.ordersRepository.remove(order);

    return {
      data: null,
      message: await this.i18n.translate('orders.deleted', { lang }),
    };
  }

  async findByTrackingToken(token: string) {
    const order = await this.ordersRepository.findOne({
      where: { trackingToken: token },
      relations: { items: true, business: true },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    // Solo exponer campos públicos — sin datos sensibles
    return {
      data: {
        id: order.id,
        status: order.status,
        customerName: order.customerName,
        deliveryDate: order.deliveryDate,
        total: order.total,
        createdAt: order.createdAt,
        businessName: order.business?.name,
        items: order.items.map((item) => ({
          productName: item.productNameSnapshot,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    };
  }

  async exportCsv(filters: {
    businessId: string;
    status?: OrderStatus;
    date?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<string> {
    if (!filters.businessId) {
      throw new BadRequestException('businessId es requerido para exportar');
    }

    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .where('order.businessId = :businessId', { businessId: filters.businessId });

    if (filters.status) {
      qb.andWhere('order.status = :status', { status: filters.status });
    }

    // date range takes precedence over single date
    if (filters.startDate && filters.endDate) {
      qb.andWhere('order.deliveryDate BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    } else if (filters.startDate) {
      qb.andWhere('order.deliveryDate >= :startDate', { startDate: filters.startDate });
    } else if (filters.endDate) {
      qb.andWhere('order.deliveryDate <= :endDate', { endDate: filters.endDate });
    } else if (filters.date) {
      qb.andWhere('order.deliveryDate = :date', { date: filters.date });
    }

    const orders = await qb.orderBy('order.createdAt', 'DESC').getMany();

    const escapeCsv = (value: string | number | null | undefined): string => {
      const str = String(value ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const header = 'ID,Cliente,Telefono,Email,Estado,Total,Entrega,Creado\n';
    const rows = orders
      .map((o) =>
        [
          escapeCsv(o.id),
          escapeCsv(o.customerName),
          escapeCsv(o.phone),
          escapeCsv(o.email),
          escapeCsv(o.status),
          escapeCsv(o.total),
          escapeCsv(o.deliveryDate),
          escapeCsv(o.createdAt.toISOString()),
        ].join(','),
      )
      .join('\n');

    return header + rows;
  }

  async createByAdmin(dto: CreateAdminOrderDto, currentUser: User, lang: string) {
    const businessId = this.resolveBusinessId(currentUser, dto.businessId);

    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException(
        await this.i18n.translate('common.not_found', { lang }),
      );
    }

    const orderLang = dto.language ?? Language.ES;
    const items: OrderItem[] = [];
    let total = 0;

    for (const itemDto of dto.items) {
      const product = await this.productsRepository.findOne({
        where: { id: itemDto.productId, businessId },
        relations: { translations: true },
      });

      if (!product) {
        throw new BadRequestException(
          await this.i18n.translate('orders.invalid_product', {
            lang,
            args: { id: itemDto.productId },
          }),
        );
      }

      if (!product.available) {
        const translation =
          product.translations.find((t) => t.language === orderLang) ??
          product.translations[0];
        throw new BadRequestException(
          await this.i18n.translate('orders.product_unavailable', {
            lang,
            args: { name: translation?.name ?? product.id },
          }),
        );
      }

      if (product.stock !== null && product.stock < itemDto.quantity) {
        const translation =
          product.translations.find((t) => t.language === orderLang) ??
          product.translations[0];
        throw new BadRequestException(
          await this.i18n.translate('orders.insufficient_stock', {
            lang,
            args: { name: translation?.name ?? product.id },
          }),
        );
      }

      const translation =
        product.translations.find((t) => t.language === orderLang) ??
        product.translations[0];

      const item = this.orderItemsRepository.create({
        productId: product.id,
        quantity: itemDto.quantity,
        unitPrice: product.price,
        productNameSnapshot: translation?.name ?? product.id,
      });

      items.push(item);
      total += Number(product.price) * itemDto.quantity;

      if (product.stock !== null) {
        product.stock -= itemDto.quantity;
        await this.productsRepository.save(product);
      }
    }

    const order = this.ordersRepository.create({
      customerName: dto.customerName,
      phone: dto.phone,
      email: dto.email,
      deliveryDate: dto.deliveryDate,
      notes: dto.notes,
      businessId,
      language: orderLang,
      source: OrderSource.ADMIN,
      total: parseFloat(total.toFixed(2)),
      trackingToken: OrdersService.generateTrackingToken(),
      items,
    });

    const saved = await this.ordersRepository.save(order);

    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    const trackingUrl = `${appUrl}/api/v1/orders/track/${saved.trackingToken}`;

    return {
      data: { ...saved, trackingUrl },
      message: await this.i18n.translate('orders.created', { lang }),
    };
  }

  async exportPdf(filters: {
    businessId: string;
    date?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<Buffer> {
    if (!filters.businessId) {
      throw new BadRequestException('businessId es requerido para exportar');
    }

    // Resolve date range
    let rangeLabel: string;
    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'item')
      .where('order.businessId = :businessId', { businessId: filters.businessId });

    if (filters.startDate && filters.endDate) {
      qb.andWhere('order.deliveryDate BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      rangeLabel = `${filters.startDate} — ${filters.endDate}`;
    } else if (filters.startDate) {
      qb.andWhere('order.deliveryDate >= :startDate', { startDate: filters.startDate });
      rangeLabel = `Desde ${filters.startDate}`;
    } else if (filters.endDate) {
      qb.andWhere('order.deliveryDate <= :endDate', { endDate: filters.endDate });
      rangeLabel = `Hasta ${filters.endDate}`;
    } else {
      const date = filters.date ?? new Date().toISOString().slice(0, 10);
      qb.andWhere('order.deliveryDate = :date', { date });
      rangeLabel = date;
    }

    qb.orderBy('order.createdAt', 'ASC');
    const orders = await qb.getMany();

    const business = await this.businessRepository.findOne({
      where: { id: filters.businessId },
    });

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ───────────────────────────────────────────────────────────────────
      const businessName = business?.name ?? filters.businessId;
      doc.fontSize(18).font('Helvetica-Bold').text(`Reporte de Ventas`, { align: 'center' });
      doc.fontSize(12).font('Helvetica').text(businessName, { align: 'center' });
      doc.text(`Fecha(s) de entrega: ${rangeLabel}`, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleString('es')}`, { align: 'center' });
      doc.moveDown(1);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);

      if (orders.length === 0) {
        doc.fontSize(11).font('Helvetica').text('No hay pedidos para esta fecha.', { align: 'center' });
        doc.end();
        return;
      }

      // ── Orders table ────────────────────────────────────────────────────
      const COL = { idx: 40, customer: 60, items: 200, status: 390, total: 480 };

      // Table header
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('#', COL.idx, doc.y, { width: 18, continued: false });
      const headerY = doc.y - doc.currentLineHeight();
      doc.text('Cliente', COL.customer, headerY, { width: 135 });
      doc.text('Productos', COL.items, headerY, { width: 185 });
      doc.text('Estado', COL.status, headerY, { width: 85 });
      doc.text('Total', COL.total, headerY, { width: 75, align: 'right' });
      doc.moveDown(0.2);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#aaaaaa').stroke();
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(9);

      let grandTotal = 0;
      orders.forEach((order, idx) => {
        const rowY = doc.y;
        const itemsText = order.items
          .map((i) => `${i.productNameSnapshot} x${i.quantity}`)
          .join('\n');

        // Estimate row height (items text may wrap)
        const linesCount = order.items.length || 1;
        const rowHeight = Math.max(linesCount * 13, 20);

        // Page break if needed
        if (rowY + rowHeight > doc.page.height - 80) {
          doc.addPage();
        }

        const y = doc.y;
        doc.text(String(idx + 1), COL.idx, y, { width: 18 });
        doc.text(order.customerName, COL.customer, y, { width: 135 });
        doc.text(itemsText, COL.items, y, { width: 185 });
        doc.text(order.status, COL.status, y, { width: 85 });
        doc.text(`$${Number(order.total).toFixed(2)}`, COL.total, y, { width: 75, align: 'right' });

        // Advance cursor by the tallest column
        doc.y = y + rowHeight;
        doc.moveDown(0.1);

        grandTotal += Number(order.total);
      });

      // ── Summary footer ───────────────────────────────────────────────────
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(`Total de pedidos: ${orders.length}`, 40, doc.y);
      doc.text(`Ingresos totales: $${grandTotal.toFixed(2)}`, 40, doc.y, { align: 'right', width: 515 });

      doc.end();
    });
  }

  private resolveBusinessId(user: User, queryBusinessId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!queryBusinessId) {
        throw new BadRequestException('businessId es requerido para super_admin');
      }
      return queryBusinessId;
    }
    return user.businessId as string;
  }
}
