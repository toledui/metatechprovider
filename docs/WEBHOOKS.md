# Webhooks inbound: Meta hacia n8n/CRM

## Flujo implementado

```text
Meta
  -> GET/POST /api/webhooks/meta
  -> validación de verify token o X-Hub-Signature-256
  -> resolución por metadata.phone_number_id
  -> INSERT idempotente en webhook_logs
  -> HTTP 200 a Meta

Webhook worker
  -> reclama el evento en MySQL
  -> firma el cuerpo con el secreto del tenant
  -> POST hacia n8n/CRM
  -> éxito o reintento persistente
```

La respuesta a Meta espera únicamente la persistencia en MySQL; nunca espera a n8n o al CRM. Si Node.js se reinicia después del `200`, el worker recupera el evento desde `webhook_logs`.

## Configuración en Meta

En `Superadmin -> Settings -> Meta` deben estar activos App ID, App Secret, Configuration ID y Webhook Verify Token.

En Meta Developers configura:

```text
Callback URL: https://TU_DOMINIO/api/webhooks/meta
Verify token: el mismo Webhook Verify Token guardado en Settings
```

Suscribe el campo `messages`. Embedded Signup ya ejecuta `POST /{waba_id}/subscribed_apps` al vincular una línea.

## Configuración por tenant

En `/dashboard`, sección Webhooks:

1. Selecciona la línea.
2. Guarda la URL HTTPS de producción de n8n o CRM.
3. Copia el secreto HMAC mostrado una sola vez.
4. Configura ese secreto en el receptor.
5. Usa `Enviar prueba` y revisa el historial.

El owner o un admin puede rotar el secreto. La rotación afecta todas las entregas posteriores, incluidos eventos pendientes.

## Firma enviada a n8n/CRM

Cada entrega incluye:

```text
Content-Type: application/json
X-THagencia-Event-Id: ID_PUBLICO_DEL_LOG
X-THagencia-Event-Type: message.text
X-THagencia-Timestamp: UNIX_SECONDS
X-THagencia-Signature-256: sha256=HEX_HMAC
```

La firma es `HMAC-SHA256(cuerpo_JSON_exacto, webhook_secret)`. El receptor debe calcularla sobre los bytes exactos recibidos antes de transformar el JSON.

Ejemplo Node.js:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const expected = createHmac("sha256", process.env.WEBHOOK_SECRET!)
  .update(rawBody)
  .digest("hex");
const received = request.headers["x-thagencia-signature-256"]?.replace("sha256=", "") ?? "";
const valid = expected.length === received.length && timingSafeEqual(
  Buffer.from(expected, "hex"),
  Buffer.from(received, "hex"),
);
```

## Payload entregado

Se conserva el formato de Meta. Cuando contiene varias entradas o cambios, el gateway crea una entrega independiente por cambio para resolver correctamente cada `phone_number_id`:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "metadata": { "phone_number_id": "PHONE_NUMBER_ID" },
        "messages": []
      }
    }]
  }]
}
```

## Estados y reintentos

| Estado | Significado |
| --- | --- |
| `RECEIVED` | Persistido y listo para entregar, o esperando próximo intento. |
| `PROCESSING` | Reclamado por un worker. |
| `SUCCEEDED` | El destino respondió HTTP 2xx. |
| `FAILED` | Agotó intentos o recibió un error no reintentable. |
| `IGNORED` | Sin teléfono, conexión, tenant activo o destino configurado. |

Son reintentables los errores de red, timeouts y HTTP `408`, `425`, `429` o `5xx`. El calendario es 1 minuto, 5 minutos, 15 minutos y 1 hora; después del quinto fallo queda `FAILED`. Las redirecciones no se siguen.

## Operación

El proceso `backend/dist/webhook-worker.js` es independiente de la API. `npm run dev` inicia frontend, API y worker. En producción `ecosystem.config.cjs` administra los tres procesos.

Variables opcionales:

```dotenv
WEBHOOK_WORKER_POLL_MS="1000"
WEBHOOK_DELIVERY_TIMEOUT_MS="10000"
WEBHOOK_DELIVERY_MAX_ATTEMPTS="5"
```

Si un worker muere con un evento en `PROCESSING`, otro worker lo devuelve a la cola después de cinco minutos.
