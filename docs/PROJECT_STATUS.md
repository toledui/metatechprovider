# Estado del proyecto

Última actualización: 2026-08-16.

## Completado

### Base inicial

- Monorepo npm con `frontend/` y `backend/` en la raíz.
- Node.js 24, Next.js 16, TypeScript y Prisma 7.
- Paleta visual de THagencia aplicada al frontend inicial.
- Base local `thagenciatechprovider` configurada.
- Portada comercial ampliada con propuesta de valor, módulos, flujo, seguridad, roadmap y llamadas a la acción.
- Login y registro complementados con contexto operativo, beneficios y pasos de onboarding.
- Revisión visual aprobada en escritorio y móvil; formularios priorizados en el orden móvil.

### Parte 1: persistencia

- Modelos Prisma: Tenant, User, WhatsAppConnection, ApiKey y WebhookLog.
- Migración inicial aplicada.
- Índice único de `phone_number_id` para resolución inbound.
- Índices de observabilidad y reintentos de webhooks.
- Contratos TypeScript del dominio.
- Cliente Prisma con pool limitado.

### Operación

- `npm run dev` inicia frontend y backend simultáneamente.
- Preflight de puertos evita colisiones y Next.js permanece fijo en 3000.
- Backend mínimo con `/health` y `/ready`.
- Backend Fastify con límites, headers seguros y errores JSON uniformes.
- Meta Graph API centralizada en `v26.0`.
- Documentación inicial de arquitectura, entorno y despliegue.

### Parte 2: Embedded Signup

- Registro y login de owner/tenant con contraseñas scrypt.
- Sesiones revocables persistidas; cookie HttpOnly/SameSite y solo hash en MySQL.
- Proxy interno `/api/*` de Next.js al backend.
- Panel multitenant con paleta THagencia y listado de conexiones.
- SDK de Facebook cargado asíncronamente con `next/script`.
- `FB.login()` por Configuration ID, código temporal y `sessionInfoListener`.
- Soporte seleccionable de Coexistence (`sessionInfoVersion: 3`).
- Intercambio de código, `/debug_token`, consulta de teléfonos y `subscribed_apps`.
- Token Meta cifrado con AES-256-GCM antes de persistirlo.
- Migración `add_user_sessions` aplicada.
- Lint, typecheck y builds de producción aprobados.
- Desarrollo local servido por HTTPS mediante el certificado generado por Next.js; `FB.login()` bloquea HTTP incluso en localhost.
- Validación preventiva en el botón de Embedded Signup y `APP_ORIGIN` local actualizado a `https://localhost:3000`.

### Panel Superadmin

- Rol global `PlatformRole` separado de los roles internos del tenant.
- Migración `add_platform_superadmin_role` aplicada.
- Middleware `requireSuperAdmin()` en todos los endpoints globales.
- Resumen de tenants, usuarios, conexiones y fallos de webhook.
- Listados globales sin exposición de tokens ni hashes.
- Activación y suspensión de tenants con protección de auto-suspensión.
- Panel `/superadmin` y navegación independiente de `/dashboard`.
- Comando idempotente `admin:create` para aprovisionamiento seguro.
- Cuenta Superadmin inicial de THagencia creada.
- `/login` valida la cookie HttpOnly en el servidor y redirige sesiones activas a su panel correspondiente sin mostrar el formulario.

### Settings globales

- Migración `add_platform_settings` aplicada.
- Documentos por proveedor cifrados con AES-256-GCM.
- Configuración SMTP global con TLS, autenticación, remitente y Reply-To.
- Verificación SMTP y envío real de correo de prueba desde Superadmin.
- Servicio reutilizable `sendAppEmail()` para futuros correos transaccionales.
- Meta App ID, App Secret, Config ID y Webhook Verify Token administrables desde el panel.
- Fallback compatible a variables `META_*` del entorno.
- Stripe visible como proveedor futuro sin solicitar credenciales todavía.
- Prueba automatizada de email con transporte JSON sin entrega externa.
- Nodemailer actualizado a 9.0.5 después de auditoría; cero vulnerabilidades npm.

### Verificación de cuenta y recuperación

- Registro condicionado a verificación: el usuario nace como `PENDING_EMAIL_VERIFICATION` y no recibe sesión.
- Correos transaccionales de activación, recuperación y aviso de cambio de contraseña con la identidad THagencia.
- Tokens criptográficamente aleatorios almacenados únicamente como hash, con caducidad y consumo único.
- Reenvío de verificación y recuperación con cooldown por cuenta y respuestas genéricas contra enumeración.
- Restablecimiento real de contraseña con scrypt y revocación automática de todas las sesiones existentes.
- Páginas `/verify-email`, `/forgot-password` y `/reset-password` responsive y con política `no-referrer`.
- Migración `add_user_email_verification_and_password_reset` aplicada en MySQL.
- Prueba integral que valida bloqueo previo, activación, enlaces de un solo uso, contraseña nueva y revocación.
- Documentación operativa en `AUTHENTICATION.md`.

### Parte 3: webhooks inbound

- Endpoint público `GET/POST /api/webhooks/meta`.
- Challenge validado contra el Verify Token global de Settings.
- Firma `X-Hub-Signature-256` comprobada sobre el cuerpo crudo con el App Secret.
- Resolución multitenant mediante `metadata.phone_number_id`.
- Persistencia idempotente y separación de payloads con múltiples cambios.
- HTTP 200 después de persistir, sin esperar al webhook del cliente.
- Worker MySQL independiente con reclamo atómico y recuperación de trabajos interrumpidos.
- Entrega hacia n8n/CRM firmada mediante HMAC SHA-256 por conexión.
- Backoff para timeouts, red, 408, 425, 429 y 5xx.
- Configuración, rotación de secreto, prueba e historial desde el panel del tenant.
- PM2 y `npm run dev` actualizados para ejecutar el worker.
- Pruebas de challenge, firmas, deduplicación, routing, entrega y reintentos aprobadas.

### Cumplimiento Meta

- Callbacks públicos `POST /api/meta/deauthorize` y `POST /api/meta/data-deletion`.
- Validación de `signed_request` mediante HMAC-SHA256 y comparación en tiempo constante.
- Asociación del `user_id` de `/debug_token` con la conexión de WhatsApp.
- Desautorización idempotente que desconecta credenciales y entregas del tenant.
- Eliminación idempotente de logs y anonimización de identificadores, tokens y webhooks.
- Código de confirmación no almacenado en claro y página pública `/data-deletion` para consultar estado.
- Migración `add_meta_compliance_callbacks` aplicada en MySQL.
- Pruebas integrales de firma, desautorización, eliminación, estado e idempotencia aprobadas.
- Guía de configuración y despliegue en `META_COMPLIANCE.md`.

### Parte 4: API Gateway outbound

- Gestión multitenant de API Keys desde el panel para owners y admins.
- Token `thk_` visible una sola vez; MySQL conserva únicamente hash, máscara, scopes y vigencia.
- Revocación inmediata y expiración opcional.
- Autenticación Bearer y scope `messages:send`.
- Endpoint `POST /api/v1/messages/send` con Graph API `v26.0`.
- Soporte validado para texto, plantillas, imágenes, documentos, audio y video.
- Selección segura de conexión y aislamiento estricto por tenant.
- `Idempotency-Key` obligatorio con replay del resultado sin duplicar mensajes.
- Rate limit durable y configurable por API Key.
- Auditoría outbound con correlación por `request_id` y `message_id`.
- Migración `add_outbound_api_key_log_index` aplicada en MySQL.
- Panel responsive con creación, copia única, listado, último uso y revocación.
- Pruebas integrales de token, normalización, tipos de mensaje, idempotencia y revocación.
- Contrato completo y ejemplos en `API_GATEWAY.md`.

## Pendiente

### Siguientes módulos SaaS

- Gestión de miembros, invitaciones y roles del tenant.
- Gestión de plantillas desde el panel.
- Carga de multimedia a Meta y biblioteca de archivos.
- Métricas de consumo, alertas y exportación de auditoría.
- Planes, límites comerciales y facturación con Stripe.
