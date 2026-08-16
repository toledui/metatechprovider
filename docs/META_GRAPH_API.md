# Meta Graph API

## Versión adoptada

La versión vigente entregada para el proyecto es:

```text
v26.0
```

Se configura en `META_GRAPH_API_VERSION` y el backend construye las URLs mediante `metaGraphUrl()`. No deben escribirse URLs con versiones hardcodeadas dentro de servicios o controladores.

Ejemplo esperado:

```text
https://graph.facebook.com/v26.0/{phone_number_id}/messages
```

En la Parte 2, `FB.init()` recibe la misma versión desde `/api/config/public`; así backend y SDK comparten `META_GRAPH_API_VERSION` sin duplicar configuración en el bundle de Next.js.

## Política

1. Nunca realizar llamadas sin versión.
2. Revisar changelog de Meta antes de subir de versión.
3. Probar Embedded Signup, envío de texto, templates, multimedia y webhooks.
4. Actualizar backend y frontend en el mismo despliegue.
5. Registrar el cambio en `PROJECT_STATUS.md`.
6. Mantener la versión anterior disponible en una rama de rollback hasta validar producción.

Meta garantiza una ventana de vida limitada por versión y puede introducir cambios rápidos por seguridad o privacidad. Por ello la versión se trata como configuración desplegable, no como constante distribuida por el código.
