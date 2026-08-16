# Variables de entorno

Los valores reales viven en `backend/.env`, archivo excluido de Git. `backend/.env.example` contiene únicamente valores de ejemplo.

## Backend

| Variable | Secreta | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sí | URL utilizada por Prisma Migrate. |
| `DATABASE_HOST` | No | Host usado por el driver MariaDB/MySQL. |
| `DATABASE_PORT` | No | Puerto de la base de datos. |
| `DATABASE_USER` | Sí | Usuario MySQL. |
| `DATABASE_PASSWORD` | Sí | Contraseña MySQL. |
| `DATABASE_NAME` | No | Base del SaaS. |
| `DATABASE_CONNECTION_LIMIT` | No | Máximo inicial del pool del backend. |
| `HOST` | No | Interfaz donde escucha Node.js. |
| `PORT` | No | Puerto del backend. |
| `APP_ORIGIN` | No | Origen HTTPS del panel, usado para rechazar mutaciones cross-site. |
| `DEV_ALLOWED_ORIGINS` | No | Orígenes HTTPS adicionales separados por coma; solo se aceptan fuera de producción. |
| `SESSION_TTL_DAYS` | No | Vigencia de una sesión revocable del panel. |
| `WEBHOOK_WORKER_POLL_MS` | No | Intervalo de consulta cuando la cola está vacía. |
| `WEBHOOK_DELIVERY_TIMEOUT_MS` | No | Timeout de cada entrega hacia n8n/CRM. |
| `WEBHOOK_DELIVERY_MAX_ATTEMPTS` | No | Máximo de intentos antes de marcar una entrega como fallida. |
| `CREDENTIALS_ENCRYPTION_KEY` | Sí | Clave Base64 de 32 bytes para AES-256-GCM. |
| `META_GRAPH_API_VERSION` | No | Versión explícita, actualmente `v26.0`. |
| `META_GRAPH_API_BASE_URL` | No | Base oficial `https://graph.facebook.com`. |
| `META_APP_ID` | No | ID de la app de Meta. Se entrega al SDK del navegador. |
| `META_APP_SECRET` | Sí | Secreto de la app; solo backend. |
| `META_CONFIG_ID` | No | Configuration ID de Facebook Login for Business. |
| `META_WEBHOOK_VERIFY_TOKEN` | Sí | Fallback temporal para verificación de webhooks de Meta. |
| `API_RATE_LIMIT_PER_MINUTE` | No | Máximo de envíos outbound por API Key en una ventana de 60 segundos. Default `60`. |
| `META_MESSAGE_TIMEOUT_MS` | No | Timeout de cada envío hacia Graph API. Default `15000`. |
| `PHONE_NUMBER_ID` | Sí | Solo para compatibilidad con pruebas manuales. |
| `WABA_ID` | Sí | Solo para compatibilidad con pruebas manuales. |
| `ACCESS_TOKEN` | Sí | Token temporal de pruebas; no debe usarse como modelo SaaS. |

Las variables `META_*` actúan como fallback hasta guardar Meta desde Settings. Los secretos configurados en el panel se cifran en MySQL.

Genera la clave de cifrado una sola vez y guárdala también en el gestor seguro de respaldos del VPS:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Cambiarla sin recifrar los tokens existentes los vuelve ilegibles. Nunca la publiques ni la reutilices entre entornos.

## Frontend

| Variable | Secreta | Uso |
| --- | --- | --- |
| `BACKEND_INTERNAL_URL` | No | Destino interno de la reescritura `/api/*` en desarrollo. |

El frontend obtiene App ID, Config ID y versión desde `/api/config/public`; el App Secret y los tokens nunca forman parte del bundle.
