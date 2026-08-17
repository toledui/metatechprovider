# Roadmap de módulos SaaS

El núcleo Meta ya está operativo. Los módulos siguientes se desarrollan en este orden para reutilizar permisos, auditoría y límites comerciales.

## 1. Miembros del tenant — completado

Invitaciones, aceptación, roles Owner/Admin/Member, expulsión, transferencia de propiedad, cierre de sesiones y auditoría. Consulta [TEAM_MANAGEMENT.md](TEAM_MANAGEMENT.md).

## 2. Bandeja multiagente — completado

La bandeja persiste contactos, conversaciones y mensajes desde los webhooks nuevos de Meta. Incluye estados, no leídos, asignación a agentes/equipos, etiquetas, notas, envío de texto/plantillas/multimedia, ventana de 24 horas y actualización mediante SSE.

Los mensajes enviados desde el chat y desde el API Gateway convergen en el mismo historial. La `Idempotency-Key` del gateway impide tanto un segundo envío a Meta como un segundo Message en el inbox. Consulta [INBOX.md](INBOX.md).

Meta no ofrece una API para importar todo el historial previo del usuario. El inbox conserva los mensajes recibidos después de activar nuestros webhooks y los enviados a través de la plataforma. En Coexistence la disponibilidad final depende de los eventos que Meta entregue a la aplicación.

## 3. Gestión de plantillas — completado

- Sincronizar plantillas de cada WABA con Meta.
- Crear, listar y consultar estado/rechazo.
- Editar o eliminar cuando la API y el estado de Meta lo permitan.
- Previsualizar variables y enviar una prueba o conversación real.
- Registrar quién realizó cada cambio.

El catálogo local conserva estados y componentes por conexión. La interfaz permite sincronizar, crear, editar, eliminar, previsualizar variables, enviar pruebas e iniciar conversaciones. Consulta [TEMPLATES.md](TEMPLATES.md).

## 4. Biblioteca multimedia

La descarga autenticada de multimedia inbound ya está integrada en el inbox. Falta la biblioteca reusable y carga de archivos propios:

- Carga segura con límites MIME/tamaño y análisis básico.
- Upload a `/{phone_number_id}/media` y persistencia del `media_id`.
- Metadatos, propietario, caducidad, reutilización y eliminación.
- Asociación con mensajes y plantillas.

## 5. Métricas y observabilidad

- Volumen y tasa de éxito por tenant, línea, canal y periodo.
- Latencia de Meta/webhooks, reintentos y fallos.
- Productividad multiagente y tiempos de primera respuesta/resolución.
- Exportaciones CSV y alertas configurables.
- Retención y limpieza de logs.

## 6. Planes y facturación

- Productos y precios de Stripe administrados desde Settings.
- Trial, suscripción, portal de cliente y webhooks firmados.
- Entitlements durables para conexiones, usuarios, mensajes, almacenamiento y API Keys.
- Periodo de gracia y bloqueo controlado por impago sin perder datos.

## 7. Administración avanzada

- Alta manual de tenants y propietarios.
- Impersonación temporal, visible, auditable y revocable.
- Consulta de auditoría, bloqueo global de API Keys y sesiones.
- Herramientas de soporte, salud de conexiones y reintentos manuales.
