# Gestión de miembros del tenant

## Alcance implementado

Cada usuario pertenece a un único tenant y tiene uno de estos roles:

| Rol | Capacidades de equipo |
| --- | --- |
| `OWNER` | Invitar, cambiar roles, retirar miembros y transferir propiedad. |
| `ADMIN` | Invitar y retirar usuarios `MEMBER`. No puede administrar al owner ni a otros admins. |
| `MEMBER` | Consultar la composición del equipo sin modificarla. |

El modelo de un tenant por usuario mantiene simples el aislamiento, las sesiones y la operación del monolito. Una futura membresía en múltiples organizaciones requerirá separar `User` y `TenantMembership`.

## Invitaciones

1. Owner o admin envía correo y selecciona `ADMIN` o `MEMBER`.
2. El backend genera un token aleatorio; MySQL conserva únicamente SHA-256.
3. El enlace apunta a `/invite?token=...`, vence en 72 horas y es de un solo uso.
4. Al aceptarlo, la posesión del correo queda comprobada, se crea la contraseña con scrypt y se abre una sesión HttpOnly.
5. Si el correo correspondía a un miembro retirado del mismo tenant, la cuenta se reactiva con la nueva invitación.

Crear otra invitación pendiente para el mismo correo revoca la anterior. Si SMTP falla, la invitación recién creada también se revoca para evitar un acceso que el administrador no pudo entregar.

## Endpoints

| Método | Ruta | Acceso |
| --- | --- | --- |
| `GET` | `/api/team` | Cualquier miembro activo. |
| `POST` | `/api/team/invitations` | Owner o admin. |
| `GET` | `/api/team/invitations/preview?token=...` | Público con token. |
| `POST` | `/api/team/invitations/accept` | Público con token y mismo origen. |
| `DELETE` | `/api/team/invitations/:id` | Owner o admin. |
| `PATCH` | `/api/team/members/:id/role` | Solo owner. |
| `DELETE` | `/api/team/members/:id` | Owner; admin únicamente sobre members. |
| `POST` | `/api/team/ownership/transfer` | Solo owner. |

## Controles de seguridad

- Todas las mutaciones del panel validan origen contra `APP_ORIGIN`.
- Todas las búsquedas autenticadas incluyen `tenantId`.
- No se puede invitar como owner; la propiedad solo cambia mediante el endpoint dedicado.
- No se puede retirar al owner ni a la propia cuenta.
- Retirar un miembro revoca todas sus sesiones en la misma transacción.
- La transferencia usa una actualización condicional del owner actual para evitar carreras concurrentes.
- Las operaciones relevantes generan un `AuditLog` con actor, entidad, IP y metadatos no secretos.

## Base de datos

La migración `20260816060000_add_tenant_members_and_audit` crea:

- `tenant_invitations`, indexada por tenant/estado/fecha, tenant/correo/estado y expiración;
- `audit_logs`, indexada por tenant/fecha, acción/fecha y actor/fecha.

En producción se aplica con:

```bash
npm run db:deploy
npm run db:generate
```

## Prueba manual

1. Configura y prueba SMTP desde Superadmin.
2. Entra al panel del tenant y abre `/dashboard/team` desde la navegación `Equipo`.
3. Invita un correo diferente.
4. Abre el enlace recibido en una ventana privada.
5. Crea nombre y contraseña; debe entrar directamente al dashboard.
6. Desde el owner, cambia el rol y luego retira al usuario.
7. La siguiente solicitud de la sesión retirada debe responder `401`.
## Equipos y permisos del inbox

`/dashboard/team` administra también equipos operativos durables. Cada equipo pertenece a un tenant y mantiene membresías explícitas; una conversación puede asignarse al equipo, a uno de sus miembros o a ambos. Eliminar un equipo cierra sus asignaciones activas sin borrar el historial.

Los usuarios `MEMBER` disponen de siete permisos configurables: enviar mensajes, editar contactos, asignar conversaciones, cambiar estados, gestionar etiquetas, agregar notas y administrar plantillas. `OWNER` y `ADMIN` tienen acceso completo por definición de rol. Todo cambio de equipo, membresía o permiso queda en `audit_logs`.
