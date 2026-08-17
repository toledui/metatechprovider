# Plantillas de WhatsApp

## Alcance

La gestión de plantillas está integrada en `/dashboard/inbox`, dentro de **Plantillas / nueva conversación**. El backend usa siempre el token cifrado de la conexión; el navegador nunca llama directamente a Graph API ni recibe credenciales.

## Operaciones

- `GET /api/whatsapp/templates`: catálogo local por tenant, conexión y estado.
- `POST /api/whatsapp/templates/sync`: pagina `/{waba_id}/message_templates` y concilia el estado local.
- `POST /api/whatsapp/templates`: crea y envía una plantilla a revisión.
- `PATCH /api/whatsapp/templates/{templateId}`: actualiza componentes permitidos por Meta.
- `DELETE /api/whatsapp/templates/{templateId}`: elimina por nombre en el WABA y conserva estado local `DELETED` para auditoría.
- `POST /api/whatsapp/templates/{templateId}/test`: envía una plantilla aprobada a un número controlado.
- `POST /api/inbox/conversations`: inicia una conversación nueva usando una plantilla aprobada.

Cada registro conserva nombre, idioma, categoría, componentes, ID de Meta, estado, calidad, motivo de rechazo y última sincronización. Crear o editar no implica aprobación inmediata: Meta puede dejar la plantilla pendiente, rechazarla, pausarla o deshabilitarla.

## Variables y vista previa

El panel obtiene la vista previa del componente `BODY`, detecta variables consecutivas `{{1}}`, `{{2}}`, etc. y exige exactamente el número esperado antes de enviar. El compositor del chat solo ofrece plantillas locales con estado `APPROVED` y correspondientes a la misma conexión de la conversación.

Las plantillas con variables especiales en headers o botones permanecen visibles y sincronizadas, pero su edición visual avanzada deberá ampliar el constructor de componentes. El contrato backend conserva los componentes completos entregados por Meta.

## Permisos y auditoría

Owner y Admin administran plantillas por defecto. Para Member se controla con `manageTemplates`; el envío depende de `sendMessages`. Crear, editar, eliminar, sincronizar y enviar generan entradas en `audit_logs` sin guardar tokens.

La app de Meta debe disponer de `whatsapp_business_management` para administración y `whatsapp_business_messaging` para envíos.
