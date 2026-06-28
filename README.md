# api-adm-pedidos-productos

REST API for managing businesses, product catalogs, and customer orders. Built with NestJS 11 and PostgreSQL.

**Base URL:** `https://api-products-orders.onrender.com/api/v1`  
**Swagger UI:** `https://api-products-orders.onrender.com/api/docs`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 (TypeScript) |
| Database | PostgreSQL + TypeORM |
| Authentication | Passport JWT (access + refresh tokens) |
| Image storage | Cloudinary |
| Email notifications | NodeMailer + Handlebars templates |
| SMS / WhatsApp | Twilio |
| Logging | nestjs-pino (structured JSON logs) |
| i18n | nestjs-i18n (Spanish / English) |
| Validation | class-validator + Joi (env schema) |
| Rate limiting | @nestjs/throttler |
| API docs | Swagger (@nestjs/swagger) |

---

## Modules

| Module | Description |
|---|---|
| `auth` | Login, logout, JWT refresh, role-based guards, **password recovery** |
| `users` | User management (admins per business) |
| `business` | Business/tenant registration and management |
| `categories` | Product categories with i18n translations |
| `products` | Product catalog with images (Cloudinary) and stock |
| `orders` | Customer order creation, admin manual entry, status management |
| `notifications` | Async email / WhatsApp / SMS notification log |

---

## Roles

| Role | Access |
|---|---|
| `super_admin` | Full access to all resources |
| `admin` | Manages their own business, products, and orders |

---

## Order Sources

| Source | Endpoint | Auth | Admin notification |
|---|---|---|---|
| `customer` | `POST /orders` | None (public) | ✅ Sent |
| `admin` | `POST /orders/admin` | JWT required | ✗ Not sent |

Admin-created orders are intended for walk-in or phone sales entered manually by the admin. They follow the same stock validation and decrement logic as customer orders but skip the "new order" admin notification.

---

## Order Status Flow

```
pending → confirmed → ready → delivered
    \                            /
     --------> cancelled <------
```

| Status | Customer notification |
|---|---|
| `pending` | — |
| `confirmed` | ✅ Email sent |
| `ready` | ✅ Email sent |
| `delivered` | — |
| `cancelled` | — |

Order creation (`POST /orders`) is a **public endpoint** — no authentication required. Notifications are sent asynchronously and do not block the response.

---

## Password Recovery

| Step | Endpoint | Notes |
|---|---|---|
| 1. Request reset | `POST /auth/forgot-password` | Rate-limited 3 req/min. Always returns `200` — email sent async only if address is registered (prevents user enumeration). |
| 2. Reset | `POST /auth/reset-password` | Token valid for **1 hour**, single-use. Revokes all existing sessions on success. |

The reset link sent by email uses `FRONTEND_URL` (or `APP_URL` if not set) as the base: `{FRONTEND_URL}/reset-password?token=<token>`.

---

## Login Error Messages

Distinct error messages for each case:
- **Email not registered** → `401 auth.email_not_found`
- **Wrong password** → `401 auth.invalid_password`

> Timing-attack protection is preserved — bcrypt runs regardless of whether the user exists.

---

## Sales Export (PDF)

`GET /orders/export/pdf` — requires JWT, accessible to both `admin` and `super_admin`.

| Role | businessId param |
|---|---|
| `admin` | Auto-filled from JWT token |
| `super_admin` | Must provide `?businessId=<uuid>` |

**Query params:**
- `date` — ISO date (`YYYY-MM-DD`). Defaults to **today** when no date params are provided.
- `startDate` / `endDate` — Date range. When provided, `date` is ignored.

Returns a PDF file (`ventas-YYYY-MM-DD.pdf` or `ventas-startDate_endDate.pdf`) containing:
- Business name and report date header
- Table of all orders for that date: customer, products, status, total
- Footer: total order count + grand revenue total

---

## Project Setup

```bash
npm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in the required values:

```env
# App
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# Database
DB_HOST=
DB_PORT=5432
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_SSL=false
DB_SYNC=false

# JWT
JWT_ACCESS_SECRET=
JWT_ACCESS_EXPIRES_IN=8h
JWT_REFRESH_SECRET=
JWT_REFRESH_EXPIRES_IN=7d

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Mail
MAIL_HOST=
MAIL_PORT=587
MAIL_USER=
MAIL_PASSWORD=
MAIL_FROM=

# Twilio (optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# i18n
DEFAULT_LANGUAGE=es

# Seed
SEED_SUPER_ADMIN_EMAIL=
SEED_SUPER_ADMIN_PASSWORD=
SEED_SUPER_ADMIN_NAME=
```

### Seed super admin

```bash
npm run seed
```

---

## Running the App

```bash
# development
npm run start

# watch mode
npm run start:dev

# production
npm run start:prod
```

---

## Tests

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e

# coverage
npm run test:cov
```

---

## API Response Format

All responses follow a consistent envelope:

```json
{
  "data": <payload>,
  "statusCode": 200
}
```

Paginated endpoints also include:

```json
{
  "data": [...],
  "meta": { "page": 1, "limit": 10, "total": 42, "lastPage": 5 },
  "statusCode": 200
}
```

Errors:

```json
{
  "statusCode": 400,
  "message": "Description of the error"
}
```

---

## Project Structure

```
src/
├── auth/           # JWT auth, guards, strategies, decorators
├── business/       # Business/tenant management
├── categories/     # Categories with i18n translations
├── products/       # Product catalog, image upload
├── orders/         # Order creation and status updates
├── notifications/  # Email/WhatsApp/SMS async notifications
├── users/          # User management
├── common/         # Enums, filters, interceptors
├── config/         # Database, Cloudinary, mail, env validation
├── database/       # Seeds
└── i18n/           # Translation files (es / en)
```

---

## License

UNLICENSED — private project.
