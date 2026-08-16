# Embedded Signup y Coexistence

## Alcance implementado

La Parte 2 incluye registro/login por tenant, sesiones revocables, panel de conexiones y onboarding mediante Facebook Login for Business.

El componente `frontend/src/components/EmbeddedSignupButton.tsx`:

1. carga `https://connect.facebook.net/en_US/sdk.js` con `next/script`;
2. inicializa el SDK con App ID y Graph API configurada;
3. registra `sessionInfoListener` y valida el origen del mensaje;
4. ejecuta `FB.login()` con `response_type: code` y el Configuration ID;
5. cuando Coexistence está activo agrega `featureType: whatsapp_business_app_onboarding` y `sessionInfoVersion: 3`;
6. envía el código y los IDs observados al backend usando la sesión HttpOnly.

## Callback backend

`POST /api/auth/facebook/callback` requiere una sesión del panel y acepta:

```json
{
  "code": "CODIGO_TEMPORAL",
  "wabaId": "OPCIONAL",
  "phoneNumberId": "OPCIONAL",
  "businessId": "OPCIONAL",
  "coexistence": true
}
```

El backend intercambia el código, valida que el token corresponda a nuestra app, captura el `user_id` devuelto por `/debug_token`, resuelve WABA y número, suscribe la aplicación mediante `/{waba_id}/subscribed_apps` y cifra el token antes del `INSERT/UPDATE`.

No se acepta `tenant_id` desde el navegador. El tenant siempre proviene de la sesión autenticada. `phone_number_id` es único globalmente y no puede trasladarse silenciosamente entre tenants.

## Configuración en Meta

- App de tipo Business con WhatsApp agregado.
- Facebook Login for Business y una configuración de Embedded Signup.
- Permisos aprobados `whatsapp_business_messaging` y `whatsapp_business_management`.
- App ID, App Secret y Configuration ID en `backend/.env`.
- Dominio del panel autorizado; HTTPS obligatorio fuera del entorno local.
- Activos WABA asignados correctamente a la configuración.

Los nombres exactos de menús pueden variar con la interfaz de Meta. Mantén `META_GRAPH_API_VERSION` explícita y valida el flujo al actualizarla.

## Seguridad y operación

- El código temporal y los tokens se redactan de logs.
- El App Secret nunca se expone en `/api/config/public`.
- AES-256-GCM aporta confidencialidad e integridad a la credencial persistida.
- Si Meta devuelve más de un teléfono sin indicar el seleccionado, se responde `409` en vez de escoger uno arbitrariamente.
- La clave maestra debe respaldarse fuera de MySQL y rotarse mediante un proceso de recifrado planificado.
- La asociación `meta_user_id` permite procesar desautorización y eliminación de datos. Las conexiones anteriores a la migración de cumplimiento deben reconectarse una vez.

Los callbacks regulatorios y las URLs que deben registrarse en Meta se documentan en [META_COMPLIANCE.md](META_COMPLIANCE.md).
