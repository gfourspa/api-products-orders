# Changelog

Registro de cambios funcionales y despliegues a producción del proyecto.

## Formato recomendado
- Fecha: `YYYY-MM-DD`
- Versión: `vX.Y.Z`
- Autor: nombre o iniciales
- Referencia: commit, PR o ticket si aplica

## Entradas

### 2026-06-27
- Versión: `v0.0.4`
- Cambios:
  - agregar reset password flow
  - agregar que admin pueda ingresar pedidos


### 2026-05-26
- Versión: `v0.0.3`
- Cambios:
  - fix:  error in start app.

  ### 2026-05-26
- Versión: `v0.0.2`
- Cambios:
  - Integración de logging estructurado con Pino y nestjs-pino.
  - Trazabilidad por `requestId` en cada request.
  - Redacción automática de datos sensibles y restricción de logs a metadata útil.
  - Eliminación de `console.log` y normalización de logs de servicios y seeder.

### 2026-05-26
- Versión: `v0.0.1`
- Cambios:
  - Configuración inicial de NestJS con TypeORM, i18n, Mailer, Cloudinary y seguridad base.
  - Integración de logging estructurado con Pino y trazabilidad por `requestId`.
  - Protección básica con Helmet, rate limiting en login y validación de archivos.
