# Despliegue en VPS

## Topología recomendada

```text
Internet :443
    |
  Nginx
    |-- /api/* y /health -> Node backend :3001
    `-- /*               -> Next.js :3000

MySQL escucha solo en localhost o red privada.
PM2 mantiene frontend, API y worker de webhooks.
```

## 1. Preparar el servidor

Ejemplo para Ubuntu LTS:

```bash
sudo apt update
sudo apt install -y nginx mysql-server git build-essential
```

Instala Node.js 24 LTS con el administrador de versiones elegido y verifica:

```bash
node --version
npm --version
```

Instala PM2:

```bash
sudo npm install -g pm2
```

## 2. Base de datos

No uses `root` en producción:

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

Restringe el puerto 3306 al host local o red privada.

## 3. Código y dependencias

```bash
sudo mkdir -p /var/www/thagencia-tech-provider
sudo chown "$USER":"$USER" /var/www/thagencia-tech-provider
cd /var/www/thagencia-tech-provider
git clone URL_DEL_REPOSITORIO .
npm ci
```

Crear `backend/.env` desde el ejemplo y establecer credenciales reales. En producción:

```dotenv
NODE_ENV="production"
HOST="127.0.0.1"
PORT="3001"
DATABASE_URL="mysql://thagencia_app:PASSWORD@127.0.0.1:3306/thagenciatechprovider"
DATABASE_HOST="127.0.0.1"
DATABASE_PORT="3306"
DATABASE_USER="thagencia_app"
DATABASE_PASSWORD="PASSWORD"
DATABASE_NAME="thagenciatechprovider"
DATABASE_CONNECTION_LIMIT="10"
APP_ORIGIN="https://provider.ejemplo.com"
SESSION_TTL_DAYS="7"
WEBHOOK_WORKER_POLL_MS="1000"
WEBHOOK_DELIVERY_TIMEOUT_MS="10000"
WEBHOOK_DELIVERY_MAX_ATTEMPTS="5"
API_RATE_LIMIT_PER_MINUTE="60"
META_MESSAGE_TIMEOUT_MS="15000"
CREDENTIALS_ENCRYPTION_KEY="BASE64_DE_32_BYTES"
META_GRAPH_API_VERSION="v26.0"
META_GRAPH_API_BASE_URL="https://graph.facebook.com"
META_APP_ID="ID_DE_LA_APP"
META_APP_SECRET="SECRETO_DE_LA_APP"
META_CONFIG_ID="CONFIGURATION_ID"
META_WEBHOOK_VERIFY_TOKEN="TOKEN_DE_VERIFICACION"
```

Configura `frontend/.env.production`:

```dotenv
BACKEND_INTERNAL_URL="http://127.0.0.1:3001"
```

En Meta configura el dominio HTTPS final como dominio autorizado de la app y del SDK, y usa el Configuration ID de Facebook Login for Business que contiene los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.

Configura también los callbacks de cumplimiento con el mismo dominio público:

```text
Cancelar autorización:
https://provider.ejemplo.com/api/meta/deauthorize

Solicitudes de eliminación de datos:
https://provider.ejemplo.com/api/meta/data-deletion
```

La respuesta de eliminación genera una URL pública bajo `/data-deletion`. Consulta [META_COMPLIANCE.md](META_COMPLIANCE.md) para el contrato, la prueba y el tratamiento de conexiones existentes.

## 4. Migrar y compilar

```bash
npm run db:validate
npm run db:deploy
npm run db:generate
npm run build
```

Nunca ejecutes `prisma migrate dev` ni `prisma db push` en producción.

Para el primer despliegue, crea al menos un Superadmin con el comando documentado en `docs/SUPERADMIN.md`. Inyecta la contraseña temporalmente desde un gestor seguro y elimina las variables del proceso al finalizar.

Antes de abrir el registro al público, entra como Superadmin, configura SMTP y completa un envío de prueba. La verificación de correo es obligatoria: una cuenta cuyo mensaje no pudo entregarse permanecerá pendiente y sin acceso al panel. Consulta `docs/AUTHENTICATION.md` para la prueba posterior al despliegue.

## 5. Procesos PM2

El repositorio incluye `ecosystem.config.cjs`:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Ejecuta el comando adicional que imprima `pm2 startup` para habilitar el arranque tras reinicio.

Verificación:

```bash
pm2 status
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/ready
curl -I http://127.0.0.1:3000
```

`pm2 status` debe mostrar `thagencia-backend`, `thagencia-frontend` y `thagencia-webhook-worker` en estado `online`.

## 6. Nginx

Crear `/etc/nginx/sites-available/thagencia-provider`:

```nginx
server {
    listen 80;
    server_name provider.ejemplo.com;

    client_max_body_size 25m;

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
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activar y validar:

```bash
sudo ln -s /etc/nginx/sites-available/thagencia-provider /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 7. TLS y firewall

Instala Certbot y solicita certificado para el dominio. Abre solamente SSH, HTTP y HTTPS; no expongas 3000, 3001 ni 3306 públicamente.

Comprueba que `APP_ORIGIN` coincida exactamente con el origen público, incluido `https://` y sin slash final. La cookie de sesión usa `Secure` automáticamente cuando `NODE_ENV=production`.

Si usarás SMTP, permite únicamente la salida necesaria hacia el host y puerto del proveedor. Configura y prueba el servicio desde `Superadmin -> Settings`; no abras un puerto SMTP entrante en el VPS.

## 8. Actualizaciones

```bash
cd /var/www/thagencia-tech-provider
git pull --ff-only
npm ci
npm run db:deploy
npm run db:generate
npm run build
pm2 reload ecosystem.config.cjs --update-env
```

Antes de migrar, crea respaldo de MySQL. Verifica `/ready`, el registro con un correo controlado, la recuperación de contraseña, el panel, una API Key temporal, un envío outbound controlado, los estados inbound y los callbacks de cumplimiento después de cada despliegue.

## 9. Rollback

Prisma no revierte automáticamente migraciones destructivas. El rollback operativo consiste en restaurar el release anterior y, si el esquema cambió de forma incompatible, restaurar el backup validado. Las migraciones futuras deberán diseñarse con estrategia expand/migrate/contract.
