# Inbox multiagente

## Alcance

La ruta `/dashboard/inbox` reúne los mensajes recibidos por los webhooks nuevos de Meta y los mensajes enviados desde el chat o mediante `POST /api/v1/messages/send`.

Meta no permite importar todo el historial anterior. La plataforma empieza a conservar una conversación cuando recibe su primer webhook después de desplegar este módulo o cuando envía una plantilla a un contacto nuevo.

## Dominio persistente

- `Contact`: identidad `wa_id`, nombre de perfil y datos editables del contacto.
- `Conversation`: contacto + línea de WhatsApp, estado, no leídos y última actividad.
- `Message`: dirección, tipo, contenido, `wamid` y estado de entrega.
- `ConversationAssignment`: historial de asignación a agente y/o nombre de equipo.
- `Tag`: clasificación reutilizable por tenant.
- `InternalNote`: comentarios privados del equipo que nunca se envían a WhatsApp.

Una conversación es única por contacto y `WhatsAppConnection`. El mismo número puede mantener hilos separados cuando escribe a líneas distintas del tenant.

## Entradas desde Meta

```text
POST /api/webhooks/meta
  -> validar X-Hub-Signature-256
  -> resolver conexión por metadata.phone_number_id
  -> persistir WebhookLog idempotente
  -> upsert Contact y Conversation
  -> crear Message por cada wamid nuevo
  -> publicar evento SSE del tenant
```

Un inbound nuevo incrementa no leídos, actualiza `lastInboundAt` y reabre automáticamente una conversación resuelta. Los reintentos de Meta no duplican mensajes porque `Message.externalId` es único.

Los eventos `sent`, `delivered`, `read` y `failed` localizan el Message por `wamid` y actualizan sus timestamps. La transición no retrocede, por ejemplo, de leído a entregado si los webhooks llegan fuera de orden.

## Salidas unificadas

Existen dos superficies de envío:

- sesión de usuario: `POST /api/inbox/conversations/{conversationId}/messages`;
- API Key: `POST /api/v1/messages/send`.

Ambas usan la misma persistencia outbound. Cada intento crea un Message, actualiza la vista previa de Conversation y publica un evento en tiempo real. Los fallos de red o rechazos de Meta también quedan en el historial con estado `FAILED`.

El API Gateway devuelve `conversation_id` e `inbox_message_id`. Cuando recibe de nuevo la misma `Idempotency-Key`, reproduce la respuesta almacenada sin volver a llamar a Meta ni crear otro Message.

## Ventana de atención

La ventana abre durante 24 horas a partir del último mensaje inbound del contacto.

- Dentro de la ventana: texto, plantilla, imagen, documento, audio o video.
- Fuera de la ventana: solamente una plantilla aprobada.
- Contacto nuevo: solamente una plantilla aprobada puede iniciar la conversación.

El backend aplica esta regla tanto al chat como al API Gateway antes de enviar a Graph API. Meta puede rechazar adicionalmente una plantilla inexistente, no aprobada o incompatible con la línea.

## Operación del panel

La pantalla se divide en:

1. lista con búsqueda y filtros por estado, asignación, etiqueta y no leídos;
2. historial, estados de entrega y compositor;
3. contacto, asignación, etiquetas y notas internas.

Estados operativos:

- `OPEN`: requiere atención;
- `PENDING`: esperando seguimiento o respuesta;
- `RESOLVED`: trabajo concluido; un inbound nuevo la regresa a `OPEN`.

Abrir el detalle deja el contador de no leídos en cero. Una asignación puede señalar un agente, un equipo durable o ambos. Los equipos y sus membresías se administran desde `/dashboard/team`; si se eligen ambos, el backend valida que el agente pertenezca al equipo.

Los permisos `sendMessages`, `editContacts`, `assignConversations`, `changeStatus`, `manageTags`, `addNotes` y `manageTemplates` se configuran por Member. Owner y Admin conservan acceso completo por rol. Todas las mutaciones operativas relevantes generan auditoría durable.

## Tiempo real

`GET /api/inbox/events` mantiene un stream SSE autenticado con la cookie de sesión. Los eventos solo se publican a suscriptores del mismo tenant y notifican cambios en conversaciones, mensajes, notas, asignaciones o etiquetas.

Sin `REDIS_URL` se utiliza el bus local, adecuado para una instancia. Con `REDIS_URL`, Redis Pub/Sub distribuye los eventos entre todas las instancias de API y cada proceso entrega únicamente a sus sesiones SSE locales.

En Nginx, `/api/*` debe conservar streaming HTTP/1.1 y no almacenar la respuesta SSE en caché. El backend envía `X-Accel-Buffering: no` y heartbeats cada 20 segundos.

## Paginación, medios y reintentos

- `GET /api/inbox` acepta `cursor` y `limit` (10–100) y devuelve `nextCursor`.
- El detalle acepta `before` y `limit` (20–100) y devuelve `nextBefore`; el panel antepone páginas antiguas sin perder los mensajes recientes.
- `GET /api/inbox/messages/{messageId}/media` valida sesión y tenant, obtiene una URL temporal de Meta y descarga el binario con el token del backend. Aplica un límite de 30 MB y nunca revela la URL firmada ni el token.
- Los mensajes outbound `FAILED` exponen reintento. Cada intento crea un Message nuevo enlazado mediante `retry_of_message_id`, respeta la ventana de 24 horas y queda auditado.
- Multimedia outbound continúa aceptando URL pública desde el chat; el API Gateway también acepta un `media_id` existente.
- El selector de plantillas usa exclusivamente plantillas sincronizadas y aprobadas. Consulta [TEMPLATES.md](TEMPLATES.md).

## Verificación mínima

Después de desplegar:

1. ejecutar `npm run db:deploy`, `npm run db:generate` y `npm run build`;
2. enviar un mensaje inbound desde un teléfono controlado;
3. confirmar que aparece en `/dashboard/inbox` y abre la ventana;
4. responder desde el chat y desde una API Key;
5. repetir la misma `Idempotency-Key` y comprobar que no aparece otro mensaje;
6. esperar o simular webhooks `delivered` y `read` y confirmar sus indicadores;
7. probar que texto fuera de 24 horas devuelve `customer_service_window_closed` y una plantilla continúa permitida.
