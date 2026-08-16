# Arquitectura

## Objetivo

Plataforma SaaS B2B multitenant que centraliza el onboarding de WhatsApp Business, autentica integraciones externas y enruta eventos entre Meta, n8n y CRMs.

## Monorepo

```text
frontend/  Next.js App Router, React y TypeScript
backend/   Fastify, Node.js, TypeScript, Prisma ORM y MySQL/MariaDB
docs/      Documentación técnica y operativa
```

Frontend, API backend y worker de webhooks son procesos independientes. En desarrollo se coordinan desde el workspace raíz. En producción, PM2 mantiene los tres procesos y Nginx termina TLS y actúa como reverse proxy.

## Flujo previsto

```text
Embedded Signup
Cliente -> Next.js -> Backend -> Meta Graph API -> MySQL

Inbound
Meta -> Backend -> resolución por phone_number_id -> webhook CRM/n8n

Outbound
CRM/n8n -> Bearer API Key -> Backend -> Meta Graph API
```

## Persistencia implementada

- `Tenant`: organización cliente.
- `User`: administradores y miembros del tenant.
- `WhatsAppConnection`: WABA, número, credenciales cifradas y webhook destino.
- `ApiKey`: prefijo, últimos cuatro caracteres y hash; nunca token plano.
- `WebhookLog`: observabilidad, deduplicación y reintentos.
- `Session`: sesiones revocables; conserva SHA-256 del token, nunca el token del navegador.
- `PlatformSetting`: documento cifrado y versionado por proveedor global.
- `DataDeletionRequest`: estado idempotente de borrado; conserva hashes, no el identificador Meta ni el código en claro.

## Separación de paneles

```text
/dashboard   Panel del tenant: solo sus conexiones y configuración
/superadmin  Panel THagencia: métricas y gestión global
```

`User.role` controla permisos dentro del tenant. `User.platformRole` es una autoridad independiente y solo `SUPERADMIN` puede consumir `/api/admin/*`. Conocer una URL administrativa no concede acceso: el backend valida la sesión y el rol global en cada solicitud.

Settings aplica una separación adicional: SMTP y credenciales de la app Meta son globales; access tokens, WABA y teléfonos continúan perteneciendo a cada tenant.

## Flujo implementado de Embedded Signup

```text
Browser -> Facebook SDK -> code + sessionInfo
Browser -> POST /api/auth/facebook/callback (cookie HttpOnly)
Backend -> /v26.0/oauth/access_token
Backend -> /debug_token
Backend -> /v26.0/{waba_id}/phone_numbers
Backend -> POST /v26.0/{waba_id}/subscribed_apps
Backend -> AES-256-GCM -> whatsapp_connections
```

Next.js reescribe `/api/*` al backend en desarrollo. En producción Nginx realiza el mismo enrutamiento, por lo que la cookie de sesión continúa siendo first-party.

## Flujo implementado de webhooks inbound

```text
Meta -> API Fastify -> firma + phone_number_id -> webhook_logs -> 200
                                                        |
                                                 worker MySQL
                                                        |
                                           HMAC -> n8n/CRM
```

`WebhookLog` funciona como registro de observabilidad y cola persistente. La API no mantiene promesas en memoria después de responder a Meta. El worker aplica reclamo atómico, timeouts, clasificación de errores y backoff; API y worker pueden reiniciarse de forma independiente.

## Flujo implementado del API Gateway outbound

```text
n8n/CRM -> Bearer API Key + Idempotency-Key -> tenant + conexión
Backend -> rate limit durable -> descifrar token -> /v26.0/{phone}/messages
Backend -> webhook_logs -> message_id + respuesta estándar
```

El token programático solo se muestra al crearlo; se autentica por hash SHA-256 y scope `messages:send`. La idempotencia se garantiza mediante un hash único por API Key y clave externa. Los logs outbound implementan auditoría y también alimentan el límite por minuto.

## Cumplimiento de la plataforma Meta

```text
Meta -> POST signed_request -> /api/meta/deauthorize -> desconectar credenciales
Meta -> POST signed_request -> /api/meta/data-deletion -> purgar + código de estado
Usuario -> /data-deletion?code=... -> estado público no sensible
```

Ambos callbacks verifican HMAC-SHA256 con el App Secret antes de procesar el `user_id`. El alta mediante Embedded Signup conserva esa asociación en la conexión. La eliminación borra logs relacionados y anonimiza las credenciales e identificadores, mientras el registro mínimo de la solicitud conserva únicamente hashes.

## Decisiones de seguridad

1. `phone_number_id` es único globalmente y resuelve el tenant de eventos Meta.
2. El token de Meta se cifra con AES-256-GCM y una clave maestra externa a la base de datos.
3. Las API keys tienen entropía criptográfica y solo se conserva su hash SHA-256.
4. Ningún log debe guardar `Authorization`, tokens, cookies ni secretos.
5. Toda consulta de panel debe estar limitada por `tenant_id`.
6. Los endpoints globales requieren `platform_role = SUPERADMIN`; los roles `OWNER/ADMIN` de clientes no son equivalentes.
7. Los webhooks públicos validan la firma sobre el cuerpo crudo y aplican límites de tamaño.
8. Todas las llamadas de Meta deben usar una versión explícita.
9. Los callbacks de cumplimiento aceptan exclusivamente `signed_request` válido y son idempotentes.

## Límites actuales

Las Partes 1, 2, 3 y 4 están implementadas. La carga binaria directa de archivos todavía no forma parte del gateway: multimedia acepta un Media ID de Meta o una URL pública.
