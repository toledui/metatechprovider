# Settings globales

## Objetivo

El menú `Superadmin -> Settings` centraliza proveedores compartidos por toda la plataforma. La tabla `platform_settings` conserva un documento cifrado por proveedor y permite agregar integraciones sin añadir columnas cada vez.

Proveedores actuales:

- `smtp`: operativo.
- `meta`: operativo y usado por Embedded Signup.
- `stripe`: reservado para una fase futura de facturación.

## Cifrado

Todos los documentos se cifran con AES-256-GCM antes de almacenarse. `CREDENTIALS_ENCRYPTION_KEY` permanece fuera de MySQL y debe existir en `backend/.env` o en el gestor de secretos del VPS.

El frontend nunca recibe contraseñas, App Secrets ni Webhook Verify Tokens. Solo recibe indicadores como `passwordConfigured`.

Para desarrollo local:

```bash
npm run security:key:ensure
```

El comando no reemplaza una clave existente ni imprime su valor. Perder la clave impide descifrar Settings y tokens de Meta.

## SMTP

Campos disponibles:

- host y puerto;
- TLS directo (`secure`, obligatorio y normalizado automáticamente en el puerto 465);
- usuario y contraseña opcionales;
- nombre y correo remitente;
- Reply-To opcional;
- estado habilitado/deshabilitado.

El botón **Enviar correo de prueba** ejecuta primero `transporter.verify()` y después envía un mensaje real al destinatario indicado. La verificación comprueba DNS, conexión TCP, TLS y autenticación. El resultado muestra la respuesta SMTP, destinatarios aceptados o rechazados, modo TLS y Message ID. Una respuesta `250` confirma que el relay puso el mensaje en cola, no que el servidor final lo haya depositado en la bandeja.

El transporte fuerza TLS directo en el puerto 465 y STARTTLS obligatorio en el 587. Cada mensaje usa un envelope sender alineado con `From`, solicita DSN de fallo o demora cuando el relay lo soporta e incorpora un identificador de entrega rastreable. Los resultados y errores SMTP se registran sin incluir credenciales ni el buzón completo del destinatario.

Los correos generados por la app bloquean lectura de archivos y acceso a URLs desde Nodemailer mediante `disableFileAccess` y `disableUrlAccess`.

## Meta

Settings administra:

- Meta App ID;
- Meta App Secret;
- Facebook Login for Business Configuration ID;
- Webhook Verify Token utilizado por `/api/webhooks/meta`;
- estado habilitado/deshabilitado.

`META_GRAPH_API_VERSION` continúa como configuración operativa del despliegue. Si todavía no existe un registro Meta cifrado, el backend usa temporalmente `META_APP_ID`, `META_APP_SECRET` y `META_CONFIG_ID` desde el entorno. Después de guardar desde el panel, la base cifrada se convierte en fuente de verdad.

WABA ID, Phone Number ID y access tokens no son globales: permanecen en `whatsapp_connections`, aislados por tenant.

## Extender proveedores

Para integrar Stripe u otro servicio:

1. agregar su contrato tipado y esquema de validación;
2. usar `readSetting()` y `writeSetting()` con un identificador estable;
3. devolver únicamente datos no secretos al panel;
4. crear un test con transporte o cliente simulado;
5. documentar rotación y revocación de credenciales.
