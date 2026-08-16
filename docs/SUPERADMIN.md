# Panel Superadmin

## Acceso

El panel global vive en `/superadmin`. Requiere una sesión activa cuyo usuario tenga `platform_role = SUPERADMIN`.

Si una sesión ya está abierta y se visita `/login`, Next.js la valida contra el backend antes de renderizar y responde con redirección a `/superadmin`. Los usuarios normales son enviados a `/dashboard`.

Los roles se separan en dos niveles:

- `role`: `OWNER`, `ADMIN` o `MEMBER` dentro de un tenant.
- `platform_role`: `USER` o `SUPERADMIN` para la plataforma completa.

Un `OWNER` de cliente no puede consultar endpoints globales.

## Capacidades actuales

- Métricas de tenants, usuarios, conexiones y webhooks fallidos.
- Listado de organizaciones con cantidad de usuarios y líneas.
- Activación, regreso a onboarding y suspensión de tenants.
- Listado global de usuarios y sus roles.
- Listado global de WABAs y números, sin exponer access tokens.
- Acceso rápido al panel cliente del tenant interno.
- Settings globales para SMTP y Meta, con espacio extensible para Stripe.

El sistema impide suspender el tenant al que pertenece la sesión actual para reducir el riesgo de bloqueo administrativo accidental.

## Endpoints

```text
GET   /api/admin/overview
GET   /api/admin/tenants
PATCH /api/admin/tenants/{tenantPublicId}/status
GET   /api/admin/users
GET   /api/admin/connections
GET   /api/admin/settings
PUT   /api/admin/settings/smtp
POST  /api/admin/settings/smtp/test
PUT   /api/admin/settings/meta
```

Las mutaciones validan `APP_ORIGIN`. Todos los endpoints ejecutan `requireSuperAdmin()` en el backend.

## Crear o recuperar un Superadmin

El comando es idempotente: crea o actualiza la cuenta, aplica hash scrypt y revoca sus sesiones anteriores.

PowerShell:

```powershell
$env:SUPERADMIN_EMAIL="admin@ejemplo.com"
$env:SUPERADMIN_PASSWORD="PASSWORD_LARGO"
$env:SUPERADMIN_NAME="Administrador"
npm run admin:create --workspace backend
Remove-Item Env:SUPERADMIN_EMAIL,Env:SUPERADMIN_PASSWORD,Env:SUPERADMIN_NAME
```

Evita guardar el comando con una contraseña real en scripts, tickets o documentación. En producción entrega las variables desde el gestor seguro del VPS y bórralas del entorno al finalizar.
