# Autenticación, verificación de correo y recuperación

## Requisito operativo

Antes de permitir registros en producción, configura y valida SMTP desde `Superadmin -> Settings -> SMTP`. El botón de prueba confirma conexión, autenticación y entrega. Si SMTP falla durante un registro, la cuenta queda pendiente y la pantalla permite solicitar otro enlace cuando el servicio vuelva a estar disponible.

`APP_ORIGIN` debe contener el origen público exacto y HTTPS, por ejemplo `https://provider.ejemplo.com`. Las URLs de verificación y recuperación se construyen únicamente con este valor; nunca se confía en el encabezado `Host` de la petición.

## Registro y verificación

1. `POST /api/auth/register` crea tenant y owner con estado `PENDING_EMAIL_VERIFICATION`.
2. El backend genera 32 bytes aleatorios, guarda solo su hash SHA-256 y envía el enlace `/verify-email?token=...`.
3. El registro no crea sesión ni entrega acceso al panel.
4. `POST /api/auth/email-verification/verify` consume el token y activa el usuario.
5. El usuario inicia sesión normalmente después de confirmar.

El enlace vence en 24 horas y es de un solo uso. `POST /api/auth/email-verification/resend` utiliza una respuesta genérica y limita la emisión a una vez por minuto por cuenta.

## Recuperación de contraseña

1. `/forgot-password` llama a `POST /api/auth/password/forgot`.
2. La respuesta siempre es la misma exista o no la cuenta, para dificultar la enumeración de usuarios.
3. Una cuenta activa recibe un enlace `/reset-password?token=...`, válido durante una hora.
4. `POST /api/auth/password/reset` exige una contraseña de 12 a 128 caracteres.
5. Al completar el cambio se consumen todos los tokens de recuperación pendientes y se revocan todas las sesiones del usuario.
6. El usuario recibe una notificación y debe iniciar sesión de nuevo; el restablecimiento no crea una sesión automáticamente.

Los cuerpos que contienen `password`, `token` o secretos están redactados en los logs de producción. Las páginas de enlaces sensibles usan política `no-referrer` y eliminan el token visible del historial después de procesarlo.

## Persistencia

La migración `add_user_email_verification_and_password_reset` incorpora:

- estado `PENDING_EMAIL_VERIFICATION` en `users.status`;
- tabla `user_tokens` con tipo, hash único, caducidad, consumo, IP de solicitud y fecha de creación;
- índices para resolver tokens y limitar solicitudes recientes;
- eliminación en cascada de tokens al eliminar un usuario.

Los registros expirados pueden eliminarse periódicamente con una tarea operativa futura. No contienen el token en texto plano.

## Comprobación posterior al despliegue

- Registrar una dirección controlada y comprobar que `/dashboard` no sea accesible antes de confirmar.
- Abrir el enlace de verificación y después iniciar sesión.
- Solicitar recuperación, cambiar la contraseña y comprobar que la anterior falle.
- Comprobar que una sesión abierta antes del cambio quede revocada.
- Confirmar que reutilizar cualquiera de los dos enlaces devuelve un error.

La prueba automatizada `npm test` cubre estos casos usando un transporte de correo simulado, sin enviar mensajes reales.
