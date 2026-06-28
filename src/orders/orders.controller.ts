import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrderStatus, Role } from '../common/enums';
import { User } from '../users/entities/user.entity';
import { CreateAdminOrderDto } from './dto/create-admin-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Crear pedido (público)' })
  create(@Body() dto: CreateOrderDto, @I18nLang() lang: string) {
    return this.ordersService.create(dto, lang);
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear pedido como admin (registra venta manual)',
    description:
      'El admin crea un pedido en nombre de un cliente. businessId se toma del token JWT; super_admin debe enviarlo en el body.',
  })
  createByAdmin(
    @Body() dto: CreateAdminOrderDto,
    @CurrentUser() user: User,
    @I18nLang() lang: string,
  ) {
    return this.ordersService.createByAdmin(dto, user, lang);
  }

  // Va ANTES de :id para que 'track' no sea interpretado como un UUID
  @Get('track/:token')
  @ApiOperation({ summary: 'Seguimiento de pedido por token (público)' })
  trackOrder(@Param('token') token: string) {
    return this.ordersService.findByTrackingToken(token);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar pedidos de un negocio' })
  @ApiQuery({ name: 'businessId', required: true })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  @ApiQuery({ name: 'date', required: false, type: String })
  @ApiQuery({ name: 'phone', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @Query('businessId') businessId: string,
    @Query('status') status: OrderStatus,
    @Query('date') date: string,
    @Query('phone') phone: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10,
    @I18nLang() lang: string,
    @CurrentUser() user: User,
  ) {
    return this.ordersService.findAll(
      businessId,
      lang,
      user,
      status,
      date,
      phone,
      page,
      limit,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener pedido por id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @I18nLang() lang: string,
    @CurrentUser() user: User,
  ) {
    return this.ordersService.findOne(id, lang, user);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar estado del pedido' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @I18nLang() lang: string,
    @CurrentUser() user: User,
  ) {
    return this.ordersService.updateStatus(id, dto, lang, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar pedido (solo super_admin)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @I18nLang() lang: string,
    @CurrentUser() user: User,
  ) {
    return this.ordersService.remove(id, lang, user);
  }

  @Get('export/csv')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Exportar pedidos a CSV (solo super_admin)' })
  @ApiQuery({ name: 'businessId', required: true })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  @ApiQuery({ name: 'date', required: false, type: String, description: 'Fecha exacta (YYYY-MM-DD). Ignorado si se usa startDate/endDate.' })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Inicio del rango (YYYY-MM-DD).' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Fin del rango (YYYY-MM-DD).' })
  @Header('Content-Type', 'application/octet-stream')
  @Header('Content-Disposition', 'attachment; filename="orders.csv"')
  async exportCsv(
    @Query('businessId') businessId: string,
    @Query('status') status: OrderStatus,
    @Query('date') date: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const csv = await this.ordersService.exportCsv({ businessId, status, date, startDate, endDate });
    res.send(csv);
  }

  @Get('export/pdf')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Exportar ventas a PDF',
    description:
      'Genera un PDF con los pedidos del rango de fechas indicado (por defecto hoy). El admin exporta su propio negocio; super_admin debe pasar businessId.',
  })
  @ApiQuery({ name: 'businessId', required: false, type: String })
  @ApiQuery({
    name: 'date',
    required: false,
    type: String,
    description: 'Fecha exacta (YYYY-MM-DD). Ignorado si se usa startDate/endDate. Por defecto: hoy.',
  })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Inicio del rango (YYYY-MM-DD).' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Fin del rango (YYYY-MM-DD).' })
  async exportPdf(
    @Query('businessId') businessId: string,
    @Query('date') date: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const resolvedBusinessId =
      user.role === Role.SUPER_ADMIN
        ? businessId
        : (user.businessId as string);

    const pdf = await this.ordersService.exportPdf({
      businessId: resolvedBusinessId,
      date,
      startDate,
      endDate,
    });

    // Build a meaningful filename
    const fileLabel = startDate && endDate
      ? `${startDate}_${endDate}`
      : startDate ?? endDate ?? date ?? new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ventas-${fileLabel}.pdf"`,
    );
    res.send(pdf);
  }
}
