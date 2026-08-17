# THagencia Tech Provider

Monorepo para la plataforma SaaS multitenant de WhatsApp Business:

- `frontend/`: Next.js App Router y TypeScript.
- `backend/`: Node.js, TypeScript, Prisma ORM y MySQL.

## Requisitos

- Node.js 24 LTS
- MySQL 8+
- npm 11+

## Base de datos local

La configuración de desarrollo se encuentra en `backend/.env` y apunta a:

```text
Host: 127.0.0.1:3306
Database: thagenciatechprovider
User: root
Password: vacía
```

Comandos principales:

```bash
npm install
npm run db:validate
npm run db:migrate
npm run db:generate
```

En producción debe utilizarse un usuario MySQL dedicado con contraseña y permisos limitados.

## Desarrollo

Después de instalar dependencias y ejecutar las migraciones:

```bash
npm run dev
```

Este comando levanta simultáneamente:

- Frontend: `https://localhost:3000`
- Backend: `http://127.0.0.1:3001`
- Health check: `http://127.0.0.1:3001/health`
- Readiness check: `http://127.0.0.1:3001/ready`
- Worker de webhooks: proceso interno sin puerto HTTP.

Paneles:

- Cliente/tenant: `https://localhost:3000/dashboard`
- Conexiones: `https://localhost:3000/dashboard/connections`
- Webhooks: `https://localhost:3000/dashboard/webhooks`
- API Keys: `https://localhost:3000/dashboard/api-keys`
- Inbox: `https://localhost:3000/dashboard/inbox`
- Equipo: `https://localhost:3000/dashboard/team`
- Superadmin THagencia: `https://localhost:3000/superadmin`

Acceso público:

- Login: `https://localhost:3000/login`
- Registro con confirmación por correo: `https://localhost:3000/register`
- Recuperación de contraseña: `https://localhost:3000/forgot-password`

Configura SMTP desde el panel Superadmin antes de probar correos reales. El flujo y las comprobaciones están documentados en [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

## Documentación

La documentación mantenida del proyecto está en [`docs/`](docs/README.md):

- runbook del VPS productivo en [`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md);
- arquitectura y decisiones técnicas;
- configuración local;
- variables de entorno;
- despliegue en VPS;
- versión de Meta Graph API;
- avances y próximos módulos.
