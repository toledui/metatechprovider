# Cumplimiento de Meta: desautorización y eliminación de datos

## URLs que deben registrarse en Meta

Reemplaza `TU_DOMINIO` por el origen HTTPS configurado en `APP_ORIGIN`:

```text
Cancelar autorización
https://TU_DOMINIO/api/meta/deauthorize

Solicitudes de eliminación de datos
https://TU_DOMINIO/api/meta/data-deletion
```

Para producción no uses `localhost`: ambas URLs deben ser públicas, usar HTTPS y llegar al backend mediante la regla `/api/*` de Nginx.

## Contrato de los callbacks

Meta envía ambos callbacks como `POST` con contenido `application/x-www-form-urlencoded` y el campo `signed_request`. El backend:

1. separa firma y payload;
2. valida `HMAC-SHA256` con el App Secret activo de `Superadmin -> Settings -> Meta`;
3. compara la firma en tiempo constante;
4. rechaza solicitudes inválidas antes de consultar o modificar datos.

No se debe configurar la página visual `/data-deletion` como callback. Esa página es únicamente el comprobante público que el usuario puede consultar después de que el backend acepta una solicitud.

## Cancelación de autorización

`POST /api/meta/deauthorize` busca conexiones vinculadas al `user_id` firmado por Meta y las deja en estado `DISCONNECTED`. El proceso invalida localmente la credencial cifrada, elimina el webhook de entrega y borra su secreto. La información estructural se conserva para auditoría y para poder atender una solicitud de eliminación posterior.

La operación es idempotente: Meta puede repetir el callback sin volver a activar ni corromper una conexión.

## Eliminación de datos

`POST /api/meta/data-deletion` devuelve el contrato esperado por Meta:

```json
{
  "url": "https://TU_DOMINIO/data-deletion?code=CODIGO",
  "confirmation_code": "CODIGO"
}
```

El backend elimina los logs asociados y anonimiza la conexión: WABA, teléfono, nombre, Business ID, identificador de usuario Meta, token y configuración de webhook dejan de ser utilizables. Se conserva únicamente un registro técnico mínimo y no personal para demostrar el estado de la solicitud.

La solicitud es idempotente. Un reintento del mismo `signed_request` recibe el mismo código. MySQL solo conserva hashes SHA-256 del identificador Meta y del código de confirmación; el código público tiene 160 bits de entropía.

El estado se consulta en:

```text
GET /api/meta/data-deletion/status/{confirmation_code}
```

La página pública `/data-deletion?code=...` usa ese endpoint y muestra `PENDING`, `COMPLETED` o `FAILED` sin requerir sesión.

## Asociación con Embedded Signup

Durante Embedded Signup, `/debug_token` aporta el `user_id` de Meta. El backend lo guarda en `whatsapp_connections.meta_user_id` para resolver callbacks posteriores.

Las conexiones creadas antes de la migración `20260816041152_add_meta_compliance_callbacks` no tienen esa asociación. Cada línea existente debe ejecutar nuevamente **Reconectar con Meta** una vez. No hace falta borrar la conexión.

## Verificación posterior al despliegue

```bash
npm run db:deploy
npm run db:generate
npm run build
pm2 reload ecosystem.config.cjs --update-env
```

Después:

1. confirma que `APP_ORIGIN` coincide exactamente con el dominio HTTPS;
2. guarda y activa App ID, App Secret y Configuration ID desde Settings;
3. registra las dos URLs en Meta;
4. reconecta una línea de prueba;
5. usa la herramienta de prueba de Meta y verifica la respuesta HTTP y la página de estado;
6. revisa los logs del backend sin imprimir `signed_request` ni secretos.

Las pruebas automatizadas cubren firma inválida, desautorización válida, eliminación, consulta de estado, anonimización e idempotencia.
