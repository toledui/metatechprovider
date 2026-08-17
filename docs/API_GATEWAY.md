# API Gateway outbound

## Alcance

La Parte 4 permite que n8n, Novemp u otro CRM envíe mensajes por una conexión del tenant sin conocer el access token de Meta.

```text
CRM/n8n -> Bearer API Key -> THagencia -> token cifrado -> Meta /messages
                                  |
                                  `-> Contact + Conversation + Message -> Inbox
```

Endpoint:

```text
POST /api/v1/messages/send
```

El gateway usa la versión configurada en `META_GRAPH_API_VERSION` (`v26.0` actualmente) y despacha a:

```text
https://graph.facebook.com/v26.0/{phone_number_id}/messages
```

La colección oficial de Meta confirma que `/messages` admite texto, multimedia y plantillas y devuelve un ID `wamid` para rastrear estados posteriores por webhook: [colección oficial de WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages).

## Crear una API Key

Desde `Panel del cliente -> API Keys`, un usuario `OWNER` o `ADMIN` puede crear una credencial con el scope `messages:send` y una expiración opcional.

El token empieza con `thk_` y se muestra una sola vez. MySQL almacena únicamente:

- hash SHA-256;
- prefijo y últimos cuatro caracteres para identificarlo;
- scopes, estado, expiración y último uso.

Revocar la clave invalida inmediatamente nuevas peticiones. Nunca se puede recuperar el token original; debe generarse otro.

## Headers obligatorios

```http
Authorization: Bearer thk_TOKEN
Idempotency-Key: pedido-10001
Content-Type: application/json
```

`Idempotency-Key` debe tener entre 8 y 128 caracteres alfanuméricos, punto, guion, guion bajo, dos puntos. Su valor debe representar una operación única en el sistema origen.

Si el CRM repite la misma clave con la misma API Key, el gateway devuelve el resultado almacenado y agrega:

```http
Idempotency-Replayed: true
```

No se vuelve a invocar a Meta. Una clave reutilizada con un cuerpo distinto sigue representando la operación original, por lo que el CRM nunca debe reciclarla.

## Selección de conexión

`connection_id` es el ID público mostrado por el panel, no el `phone_number_id` de Meta.

- Con una sola línea activa puede omitirse.
- Con más de una línea activa es obligatorio.
- Una API Key solo puede acceder a conexiones de su tenant.

## Ventana de atención de 24 horas

Texto, imagen, documento, audio y video solo se envían cuando la conversación tiene un mensaje inbound recibido durante las 24 horas anteriores. El gateway devuelve `409 customer_service_window_closed` antes de contactar a Meta cuando la ventana no está disponible.

Las plantillas aprobadas son la excepción: pueden iniciar una conversación con un número nuevo o reabrir una conversación fuera de la ventana. Al enviar una plantilla a un destino nuevo, el gateway crea su Contact y Conversation para que el intento aparezca inmediatamente en el inbox.

La misma regla se aplica al compositor de `/dashboard/inbox`; usar una API Key no permite saltarse la política.

## Texto

```json
{
  "connection_id": "ID_PUBLICO_CONEXION",
  "to": "5215512345678",
  "type": "text",
  "text": {
    "body": "Hola desde THagencia",
    "preview_url": false
  }
}
```

El gateway admite espacios, `+`, paréntesis y guiones en `to`, los elimina y valida entre 7 y 20 dígitos.

## Plantilla

```json
{
  "connection_id": "ID_PUBLICO_CONEXION",
  "to": "5215512345678",
  "type": "template",
  "template": {
    "name": "confirmacion_pedido",
    "language": "es_MX",
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Luis" },
          { "type": "text", "text": "10001" }
        ]
      }
    ]
  }
}
```

La plantilla debe existir y estar aprobada en el WABA. Meta documenta que el envío usa `type: template` y responde con un identificador `wamid`: [ejemplo oficial de plantilla](https://www.postman.com/meta/whatsapp-business-platform/request/o65u5m5/send-message-template-text).

## Multimedia

Tipos admitidos: `image`, `document`, `audio` y `video`. Cada objeto debe incluir exactamente uno de:

- `id`: ID de un archivo subido previamente a Meta;
- `link`: URL HTTPS públicamente accesible.

Imagen:

```json
{
  "to": "5215512345678",
  "type": "image",
  "image": {
    "link": "https://cdn.ejemplo.com/producto.jpg",
    "caption": "Producto disponible"
  }
}
```

Documento:

```json
{
  "to": "5215512345678",
  "type": "document",
  "document": {
    "id": "MEDIA_ID_META",
    "filename": "factura-10001.pdf",
    "caption": "Tu factura"
  }
}
```

Audio usa `audio: { "id" | "link" }`. Video permite `caption`, igual que imagen.

## Respuesta exitosa

```json
{
  "success": true,
  "request_id": "ID_PUBLICO_LOG",
  "message_id": "wamid...",
  "conversation_id": "ID_PUBLICO_CONVERSACION",
  "inbox_message_id": "ID_PUBLICO_MENSAJE",
  "meta": {
    "messaging_product": "whatsapp",
    "contacts": [],
    "messages": [{ "id": "wamid..." }]
  }
}
```

`request_id` permite localizar la auditoría del gateway. `conversation_id` abre el hilo correspondiente y `inbox_message_id` identifica el registro local. `message_id` permite correlacionar estados `sent`, `delivered`, `read` o `failed` que llegan por el webhook inbound.

Una respuesta de error de Meta también incluye `conversation_id` e `inbox_message_id`: el intento fallido permanece visible en el chat con su indicador y detalle de error.

## Errores

| HTTP | Código | Motivo |
| --- | --- | --- |
| 400 | `idempotency_key_required` | Header ausente o inválido. |
| 401 | `invalid_api_key` | Clave desconocida, revocada o expirada. |
| 403 | `insufficient_scope` | La clave no permite enviar mensajes. |
| 409 | `active_connection_not_found` | No hay línea activa para el tenant. |
| 409 | `customer_service_window_closed` | Texto o multimedia fuera de la ventana de 24 horas. |
| 409 | `idempotency_in_progress` | Otra petición con esa clave aún se procesa. |
| 422 | `validation_error` | Payload inválido. |
| 422 | `connection_id_required` | Hay varias líneas y no se eligió una. |
| 429 | `rate_limit_exceeded` | Se excedió el límite por API Key. |
| 502 | `meta_request_failed` | Meta respondió con error. |
| 502 | `meta_unavailable` | Timeout o error de red hacia Meta. |

Las respuestas incluyen `X-RateLimit-Limit` y `X-RateLimit-Remaining`. En `429` también incluyen `Retry-After: 60`.

## Observabilidad y seguridad

Cada intento aceptado crea un `WebhookLog` outbound con tenant, conexión, API Key, tipo, duración, status HTTP y respuesta de Meta. También crea exactamente un Message outbound y actualiza la Conversation correspondiente. Nunca se guarda el header `Authorization` ni el token descifrado.

La deduplicación usa SHA-256 de la API Key interna y `Idempotency-Key`. Un replay devuelve los mismos `request_id`, `conversation_id`, `inbox_message_id` y `message_id`; no llama otra vez a Meta ni duplica el historial. El índice `webhook_logs_api_key_received_at_idx` optimiza conteo por minuto e historial. El límite predeterminado es 60 mensajes/minuto por API Key y se configura con `API_RATE_LIMIT_PER_MINUTE`.

El gateway aplica su propia ventana de atención, pero Meta conserva la autoridad final sobre calidad, límites, categorías de plantilla y políticas de entrega.
