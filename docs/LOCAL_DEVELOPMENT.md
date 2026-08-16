# Desarrollo local

## Requisitos

- Node.js 24 LTS
- npm 11+
- MySQL 8+ o MariaDB compatible

## Primera instalación

Desde la raíz del monorepo:

```bash
npm install
npm run db:validate
npm run db:migrate
npm run db:generate
```

La base local esperada es `thagenciatechprovider` en `127.0.0.1:3306`.

Para probar Embedded Signup, completa en `backend/.env`:

```dotenv
APP_ORIGIN="https://localhost:3000"
CREDENTIALS_ENCRYPTION_KEY="BASE64_DE_32_BYTES"
META_APP_ID="ID_DE_LA_APP"
META_APP_SECRET="SECRETO_DE_LA_APP"
META_CONFIG_ID="CONFIGURATION_ID"
```

En Meta debes autorizar `localhost` para desarrollo en la configuración correspondiente del SDK/Login for Business. Facebook Login exige HTTPS incluso durante esta prueba local.

## Arrancar todo

```bash
npm run dev
```

Servicios:

| Servicio | URL |
| --- | --- |
| Next.js | `https://localhost:3000` |
| Backend Node.js | `http://127.0.0.1:3001` |
| Liveness | `http://127.0.0.1:3001/health` |
| Readiness MySQL | `http://127.0.0.1:3001/ready` |
| Panel | `https://localhost:3000/dashboard` |
| Superadmin | `https://localhost:3000/superadmin` |

El workspace backend inicia también el worker persistente de webhooks. Este proceso no abre otro puerto: consulta trabajos pendientes en MySQL y entrega eventos hacia n8n/CRM.

`Ctrl+C` detiene frontend, API y worker.

Antes de iniciar, el comando comprueba que 3000 y 3001 estén disponibles. Next.js queda fijado explícitamente a 3000 y no cambiará silenciosamente al puerto del backend.

Next.js inicia con `--experimental-https` y genera un certificado local. La primera ejecución puede pedirte aceptar o confiar en el certificado. Abre siempre `https://localhost:3000`; una pestaña anterior en `http://localhost:3000` seguirá siendo rechazada por el SDK de Facebook.

`localhost`, `127.0.0.1` y la interfaz local `172.31.160.1` están autorizados para cargar assets de desarrollo. Si accedes mediante ngrok u otro hostname, crea `frontend/.env.local` y agrega solo ese hostname, sin protocolo:

```dotenv
DEV_ALLOWED_ORIGINS="localhost,127.0.0.1,MI_SUBDOMINIO.ngrok-free.app"
```

Reinicia `npm run dev` después de cambiar esta variable.

Como Next.js escucha TLS local, ngrok debe usar explícitamente un upstream HTTPS:

```bash
ngrok http https://localhost:3000
```

No uses `ngrok http 3000`: ese comando intenta HTTP contra el puerto HTTPS y genera `ERR_NGROK_3004`. Si tu versión de ngrok valida el certificado local y lo rechaza, usa la opción de esa versión para desactivar exclusivamente la verificación TLS del upstream de desarrollo; no desactives TLS en el endpoint público.

Para que las mutaciones del backend acepten el túnel, agrega también el origen completo a `backend/.env`:

```dotenv
DEV_ALLOWED_ORIGINS="https://MI_SUBDOMINIO.ngrok-free.dev"
```

Esta excepción solo funciona con `NODE_ENV` distinto de `production`; producción continúa aceptando únicamente `APP_ORIGIN`.

## Comandos útiles

```bash
npm run typecheck
npm run build
npm run db:format
npm run db:validate
npm run db:status
npm run db:migrate
npm run db:generate
npm test
```

El aprovisionamiento de administradores globales se documenta en `docs/SUPERADMIN.md`. No agregues contraseñas de usuarios a `.env.example` ni a migraciones.

`db:migrate` es solo para desarrollo. En producción debe usarse `npm run db:deploy`.

## Problemas comunes

- `/ready` devuelve `503`: MySQL no está iniciado o las credenciales son incorrectas.
- Puerto ocupado: identifica primero el proceso con `netstat -ano | findstr :3000` o `netstat -ano | findstr :3001`. Después de confirmar que pertenece a este proyecto, detenlo desde PowerShell con `Stop-Process -Id <PID> -Force`.
- Para comprobar los puertos sin iniciar servicios ejecuta `npm run dev:check`.
- Prisma desactualizado después de editar el esquema: ejecuta `npm run db:generate`.
- Drift de base: revisa `npm run db:status`; no uses `db push` en producción.
- El botón indica “Configuración pendiente”: falta al menos una variable `META_*` o la clave de cifrado.
- `FB.login can no longer be called from http pages`: reinicia el monorepo y abre exactamente `https://localhost:3000/dashboard`.
- El botón se queda en `Cargando formulario…`: React no pudo cargar. Revisa el certificado, `DEV_ALLOWED_ORIGINS` y los errores de `/_next/static/*` antes de escribir credenciales.
- Meta no devuelve WABA: revisa los activos y permisos asignados al Configuration ID.
- Varios números sin selección: el backend responde `phone_number_ambiguous` para evitar asociar el número incorrecto.
