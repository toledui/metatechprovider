# Manual integral de producción

Este documento registra la infraestructura y el procedimiento operativo utilizado para desplegar THagencia Tech Provider en el VPS. Es la referencia específica del entorno real; [DEPLOYMENT_VPS.md](DEPLOYMENT_VPS.md) conserva la guía genérica.

## 1. Datos del entorno

| Elemento | Valor |
| --- | --- |
| Dominio público | `https://app.thagencia.com` |
| Ruta del proyecto | `/var/www/thagencia-tech-provider` |
| Frontend Next.js | `127.0.0.1:3010` |
| Backend Node.js | `127.0.0.1:3001` |
| Base de datos | MySQL local, puerto `3306` |
| Proxy público | Nginx en `80/443` |
| Supervisor | PM2 |
| Procesos | frontend, backend y webhook worker |
| Runtime | Node.js 24 LTS |

Topología:

```text
Internet
   |
   | HTTPS :443
   v
Nginx (app.thagencia.com)
   |-- /api/*, /health, /ready --> Backend Node.js :3001
   `-- /* ----------------------> Frontend Next.js :3010

Backend/worker --> MySQL :3306
Backend        --> Meta Graph API
Backend        --> relay SMTP :465 con TLS implícito
Meta           --> /api/webhooks/meta
Worker         --> webhooks HTTPS de n8n/CRM
```

Los puertos `3001`, `3010` y `3306` no se exponen públicamente.

## 2. Preparación inicial del VPS

Ejemplo para Ubuntu LTS:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y nginx mysql-server git build-essential curl certbot python3-certbot-nginx
```

Instala Node.js 24 LTS con el administrador de versiones elegido y valida:

```bash
node --version
npm --version
```

Instala PM2 globalmente:

```bash
sudo npm install -g pm2
pm2 --version
```

Configura el firewall sin abrir puertos internos:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Antes de solicitar TLS, crea en DNS el registro `A` de `app.thagencia.com` apuntando a la IP pública del VPS.

## 3. Base de datos

No utilices la cuenta `root` desde la aplicación:

```sql
CREATE DATABASE thagenciatechprovider
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'thagencia_app'@'localhost'
  IDENTIFIED BY 'REEMPLAZAR_CON_PASSWORD_LARGO';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX,
      DROP, REFERENCES
ON thagenciatechprovider.*
TO 'thagencia_app'@'localhost';

FLUSH PRIVILEGES;
```

MySQL debe escuchar únicamente en localhost o una red privada. Crea un respaldo antes de cada migración productiva.

## 4. Instalación del proyecto

```bash
sudo mkdir -p /var/www/thagencia-tech-provider
sudo chown "$USER":"$USER" /var/www/thagencia-tech-provider
cd /var/www/thagencia-tech-provider
git clone URL_DEL_REPOSITORIO .
npm ci
```

Estructura relevante:

```text
/var/www/thagencia-tech-provider/
|-- backend/
|   |-- src/
|   |-- dist/
|   |-- package.json
|   `-- .env
|-- frontend/
|   |-- src/
|   |-- .next/
|   |-- package.json
|   `-- .env.production
|-- docs/
|-- ecosystem.config.cjs
`-- package.json
```

## 5. Variables de entorno

### 5.1 Backend

Crea `/var/www/thagencia-tech-provider/backend/.env`. Los nombres siguientes corresponden al código actual:

```dotenv
NODE_ENV="production"
HOST="127.0.0.1"
PORT="3001"
APP_ORIGIN="https://app.thagencia.com"

DATABASE_URL="mysql://thagencia_app:PASSWORD@127.0.0.1:3306/thagenciatechprovider"
DATABASE_HOST="127.0.0.1"
DATABASE_PORT="3306"
DATABASE_USER="thagencia_app"
DATABASE_PASSWORD="PASSWORD"
DATABASE_NAME="thagenciatechprovider"
DATABASE_CONNECTION_LIMIT="10"

SESSION_TTL_DAYS="7"
WEBHOOK_WORKER_POLL_MS="1000"
WEBHOOK_DELIVERY_TIMEOUT_MS="10000"
WEBHOOK_DELIVERY_MAX_ATTEMPTS="5"
API_RATE_LIMIT_PER_MINUTE="60"
META_MESSAGE_TIMEOUT_MS="15000"
REDIS_URL=""

CREDENTIALS_ENCRYPTION_KEY="BASE64_DE_32_BYTES"

META_GRAPH_API_VERSION="v26.0"
META_GRAPH_API_BASE_URL="https://graph.facebook.com"
META_APP_ID="ID_DE_LA_APP"
META_APP_SECRET="SECRETO_DE_LA_APP"
META_CONFIG_ID="1013974830124639"
META_WEBHOOK_VERIFY_TOKEN="TOKEN_DE_VERIFICACION"
```

Consideraciones:

- La variable correcta es `APP_ORIGIN`, no `APP_URL`.
- La variable correcta para el token es `META_WEBHOOK_VERIFY_TOKEN`.
- `CREDENTIALS_ENCRYPTION_KEY` debe ser una clave Base64 de 32 bytes y respaldarse fuera del VPS.
- `META_*` funciona como fallback. Después de guardar Meta desde el panel Superadmin, Settings cifrado en MySQL se convierte en la fuente principal.
- No guardes contraseñas SMTP en este archivo: SMTP se administra desde Settings y se cifra antes de persistirse.
- No publiques `backend/.env`, App Secret, contraseña MySQL, clave de cifrado ni verify token.

Genera la clave de cifrado una sola vez:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

### 5.2 Frontend

Crea `/var/www/thagencia-tech-provider/frontend/.env.production`:

```dotenv
BACKEND_INTERNAL_URL="http://127.0.0.1:3001"
```

El frontend obtiene App ID, Configuration ID y versión de Graph API desde `/api/config/public`. No necesita `NEXT_PUBLIC_FACEBOOK_APP_ID` ni `NEXT_PUBLIC_FACEBOOK_CONFIG_ID`.

## 6. Migraciones y build inicial

Desde la raíz del monorepo:

```bash
cd /var/www/thagencia-tech-provider
npm ci
npm run db:validate
npm run db:deploy
npm run db:generate
npm run build
```

En producción nunca ejecutes `prisma migrate dev` ni `prisma db push`.

## 7. Creación del Superadmin

El comando crea o actualiza la cuenta y revoca sus sesiones anteriores. La contraseña debe tener al menos 12 caracteres:

```bash
cd /var/www/thagencia-tech-provider

export SUPERADMIN_EMAIL="admin@thagencia.com"
export SUPERADMIN_NAME="Administrador"
read -rsp "Contraseña del superadmin: " SUPERADMIN_PASSWORD
echo
export SUPERADMIN_PASSWORD

npm run admin:create --workspace backend

unset SUPERADMIN_EMAIL SUPERADMIN_NAME SUPERADMIN_PASSWORD
```

Después inicia sesión en `https://app.thagencia.com/login`; la cuenta tendrá acceso a `/superadmin`.

## 8. Procesos PM2

El archivo `ecosystem.config.cjs` ejecuta:

| Proceso | Comando/artefacto | Puerto |
| --- | --- | --- |
| `thagencia-backend` | `backend/dist/server.js` | `3001` |
| `thagencia-frontend` | `npm run start --workspace frontend` | `3010` |
| `thagencia-webhook-worker` | `backend/dist/webhook-worker.js` | No aplica |

Primer arranque:

```bash
cd /var/www/thagencia-tech-provider
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Ejecuta también el comando con `sudo` que imprima `pm2 startup`, y después repite `pm2 save`.

Verificación interna:

```bash
pm2 status
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3001/ready
curl -I http://127.0.0.1:3010
```

## 9. Nginx

Crea `/etc/nginx/sites-available/thagencia-provider`:

```nginx
server {
    listen 80;
    server_name app.thagencia.com;

    client_max_body_size 25m;

    location = /api/inbox/events {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Origin $http_origin;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3001/health;
    }

    location = /ready {
        proxy_pass http://127.0.0.1:3001/ready;
    }

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activa y valida el sitio:

```bash
sudo ln -s /etc/nginx/sites-available/thagencia-provider /etc/nginx/sites-enabled/thagencia-provider
sudo nginx -t
sudo systemctl reload nginx
```

Si existe el sitio predeterminado y entra en conflicto, desactívalo únicamente después de confirmar la ruta exacta:

```bash
sudo unlink /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 10. HTTPS con Certbot

Cuando DNS ya resuelva hacia el VPS:

```bash
sudo certbot --nginx -d app.thagencia.com
sudo certbot renew --dry-run
```

Comprobaciones públicas:

```bash
curl -fsS https://app.thagencia.com/health
curl -fsS https://app.thagencia.com/ready
curl -I https://app.thagencia.com/
```

`APP_ORIGIN` debe coincidir exactamente con `https://app.thagencia.com`, sin slash final.

## 11. Configuración de Meta

### 11.1 App y permisos

La app Business debe tener WhatsApp y Facebook Login for Business configurados. Permisos requeridos:

- `whatsapp_business_messaging`;
- `whatsapp_business_management`;
- `public_profile` para el inicio de sesión.

Para onboarding público, los permisos de WhatsApp requieren el nivel de acceso y revisión correspondientes. Mientras estén en acceso estándar o revisión, limita las pruebas a usuarios y negocios habilitados en la app.

### 11.2 Embedded Signup

Configuration ID productivo:

```text
1013974830124639
```

En Facebook Login for Business habilita:

- inicio de sesión OAuth del cliente y OAuth web;
- HTTPS obligatorio;
- URI estricta;
- SDK de JavaScript;
- navegador integrado cuando el flujo lo requiera.

Orígenes y rutas de producción:

```text
Dominio de la app:
app.thagencia.com

Origen permitido para JavaScript SDK:
https://app.thagencia.com

URI/ruta del flujo:
https://app.thagencia.com/dashboard
https://app.thagencia.com/
```

Desarrollo local utiliza HTTPS generado por Next.js:

```text
https://localhost:3000/dashboard
https://localhost:3000/
```

La regla sobre la aplicación móvil depende del modo de onboarding:

- En el onboarding clásico de Cloud API, una línea migrada deja de utilizarse en la aplicación móvil.
- Con Coexistence habilitado y una línea elegible, el proyecto solicita `whatsapp_business_app_onboarding` para conservar el uso compatible de WhatsApp Business App y Cloud API.

No prometas Coexistence para todas las líneas; Meta determina elegibilidad y comportamiento final.

### 11.3 Settings de Meta en la aplicación

En `Superadmin -> Settings -> Meta` guarda y habilita:

- App ID;
- App Secret;
- Configuration ID;
- Webhook Verify Token.

Los secretos se cifran con `CREDENTIALS_ENCRYPTION_KEY`. El App Secret y los tokens no se entregan al navegador.

### 11.4 Webhook de Meta

En Meta for Developers configura:

```text
Callback URL: https://app.thagencia.com/api/webhooks/meta
Verify token: el mismo valor guardado en Settings
Campo suscrito: messages
```

El endpoint procesa:

1. `GET` de handshake, validando `hub.verify_token` y devolviendo `hub.challenge`.
2. `POST` de eventos, validando `X-Hub-Signature-256` con HMAC-SHA256 sobre el cuerpo crudo.
3. Persistencia idempotente en MySQL y respuesta rápida `200` a Meta.
4. Entrega posterior a n8n/CRM mediante el worker y reintentos persistentes.

La validación de firma nunca debe deshabilitarse en producción. Para pruebas manuales usa los tests automatizados o genera una firma HMAC válida con el App Secret en un entorno controlado.

### 11.5 Callbacks de cumplimiento

Configura en Meta:

```text
Cancelar autorización:
https://app.thagencia.com/api/meta/deauthorize

Solicitudes de eliminación de datos:
https://app.thagencia.com/api/meta/data-deletion
```

La URL pública de estado de eliminación vive bajo `/data-deletion`.

## 12. Configuración SMTP

SMTP no se configura mediante variables `SMTP_*` en `backend/.env`. Entra a `Superadmin -> Settings -> SMTP` y guarda:

```text
Servidor: mail.thagencia.com
Puerto: 465
TLS directo: activado
Usuario: cuenta SMTP completa
Contraseña: contraseña de esa cuenta
Nombre del remitente: THagencia
Correo del remitente: preferentemente la misma cuenta autenticada
Reply-To: opcional
Estado: habilitado
```

El backend normaliza automáticamente:

- puerto `465` a TLS implícito;
- puerto `587` a STARTTLS obligatorio.

La prueba confirma conexión, autenticación y aceptación en la cola SMTP. Un `250 OK` no confirma entrega final al buzón.

Diagnóstico en el VPS:

```bash
pm2 logs thagencia-backend --nostream --lines 200 |
grep -A 10 -B 1 "\[mail\]"
```

Una respuesta como esta conserva los identificadores necesarios para soporte del proveedor:

```text
[mail] SMTP queued message {
  messageId: '<UUID@thagencia.com>',
  recipientDomain: 'hotmail.com',
  response: '250 OK id=ID_DE_COLA_EXIM',
  transport: 'implicit-tls',
  port: 465,
  warnings: []
}
```

Si el mensaje no llega después del `250`, solicita al proveedor el estado final usando `messageId`, ID de cola Exim, remitente, destinatario y hora exacta. Revisa también SPF, firma DKIM real, DMARC, PTR y reputación de la IP de salida.

## 13. Actualización ordinaria

No mantengas modificaciones permanentes directamente en el VPS. Los cambios de `ecosystem.config.cjs`, código y scripts deben versionarse en Git.

Procedimiento recomendado:

```bash
cd /var/www/thagencia-tech-provider
git status --short
git pull --ff-only
npm ci
npm run db:deploy
npm run db:generate
npm run build
pm2 reload ecosystem.config.cjs --update-env
pm2 status
```

Verificación posterior:

```bash
curl -fsS http://127.0.0.1:3001/ready
curl -I http://127.0.0.1:3010
curl -fsS https://app.thagencia.com/health
curl -I https://app.thagencia.com/
pm2 logs --nostream --lines 50
```

Si `git status --short` muestra cambios inesperados, detén el despliegue y revísalos. Solo cuando sepas exactamente qué estás preservando puedes usar temporalmente:

```bash
git stash push -u -m "cambios locales antes del despliegue"
git pull --ff-only
git stash pop
```

Resuelve cualquier conflicto antes de compilar. No uses `git reset --hard` para ocultar modificaciones desconocidas.

## 14. Rollback

Antes de desplegar, registra el commit actual y crea respaldo de MySQL:

```bash
cd /var/www/thagencia-tech-provider
git rev-parse HEAD
```

El rollback de aplicación consiste en volver a un release conocido, reinstalar dependencias, compilar y recargar PM2. Las migraciones Prisma no se revierten automáticamente. Si el esquema cambió de forma incompatible, restaura el respaldo validado y sigue una estrategia expand/migrate/contract.

## 15. Resolución de problemas

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `EADDRINUSE` | Otro proceso usa `3001` o `3010`. | Identifica el proceso, confirma que pertenezca al proyecto y reinícialo mediante PM2. |
| Frontend devuelve `502` | Next.js no está en `3010` o Nginx aún apunta a `3000`. | Revisa `pm2 status`, `curl -I 127.0.0.1:3010` y `proxy_pass`. |
| `/api/*` devuelve `502` | Backend caído o Nginx no apunta a `3001`. | Revisa `pm2 logs thagencia-backend` y `/ready`. |
| Error de handshake de Meta | Verify token distinto o backend no disponible. | Compara Settings con Meta y prueba la URL pública. |
| `invalid_meta_signature` | Firma ausente o inválida. | Es normal con un POST manual sin firma; no desactives la validación productiva. |
| Webhook válido pero no llegan eventos | Campo `messages` sin suscripción o WABA no suscrita. | Activa `messages` y revisa `/{waba_id}/subscribed_apps`. |
| Error `#2655111` en Embedded Signup | Permisos o negocio aún sin acceso suficiente. | Revisa App Review, roles de prueba y activos asignados. |
| `git pull` rechaza cambios locales | El VPS tiene archivos versionados modificados. | Inspecciona `git diff`; versiona el cambio o usa stash deliberadamente. |
| SMTP muestra `250 OK` pero no llega | El relay aceptó la cola, pero falló la entrega posterior. | Usa Message ID/ID Exim con soporte y revisa SPF, DKIM, DMARC, PTR y reputación. |
| Settings no puede descifrar secretos | Cambió o falta `CREDENTIALS_ENCRYPTION_KEY`. | Restaura exactamente la clave respaldada; no generes otra sobre datos existentes. |
| Sesión funciona en HTTP pero falla en producción | Origen o proxy HTTPS incorrectos. | Confirma `APP_ORIGIN`, `X-Forwarded-Proto` y certificado. |

## 16. Checklist posterior al despliegue

- [ ] `pm2 status` muestra los tres procesos `online`.
- [ ] `/health` responde `200`.
- [ ] `/ready` confirma conexión MySQL.
- [ ] El frontend abre en `https://app.thagencia.com`.
- [ ] Registro y verificación de correo funcionan.
- [ ] Recuperación de contraseña funciona y revoca sesiones anteriores.
- [ ] Superadmin abre `/superadmin`.
- [ ] Embedded Signup completa el callback y guarda la conexión.
- [ ] Meta verifica `/api/webhooks/meta`.
- [ ] El campo `messages` está suscrito.
- [ ] Un mensaje inbound aparece en Inbox.
- [ ] Un envío outbound controlado registra estado.
- [ ] Webhook hacia n8n/CRM pasa la prueba firmada.
- [ ] Callbacks de desautorización y eliminación responden correctamente.
- [ ] SMTP muestra modo TLS, puerto, respuesta e identificador de cola.
- [ ] Firewall expone únicamente SSH, HTTP y HTTPS.
- [ ] Existe un respaldo reciente de MySQL y de `CREDENTIALS_ENCRYPTION_KEY`.
