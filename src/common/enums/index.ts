export enum Language {
  ES = 'es',
  EN = 'en',
}

export enum Role {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
}

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  READY = 'ready',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export enum NotificationType {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
}

export enum NotificationStatus {
  SENT = 'sent',
  FAILED = 'failed',
}

export enum OrderSource {
  CUSTOMER = 'customer',
  ADMIN = 'admin',
}
