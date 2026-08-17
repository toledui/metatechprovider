# Documentación del proyecto

Esta carpeta es la fuente de verdad operativa y arquitectónica de THagencia Tech Provider.

| Documento | Contenido |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Componentes, responsabilidades, flujos y decisiones de seguridad. |
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | Instalación, base local, comandos y solución de problemas. |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Catálogo de variables de entorno. |
| [META_GRAPH_API.md](META_GRAPH_API.md) | Política de versión de Meta Graph API. |
| [EMBEDDED_SIGNUP.md](EMBEDDED_SIGNUP.md) | Flujo de onboarding, Coexistence, seguridad y configuración Meta. |
| [SUPERADMIN.md](SUPERADMIN.md) | Roles globales, panel administrativo y recuperación de acceso. |
| [SETTINGS.md](SETTINGS.md) | Configuración cifrada de SMTP, Meta y futuros proveedores. |
| [AUTHENTICATION.md](AUTHENTICATION.md) | Registro, verificación de correo, recuperación y controles de seguridad. |
| [TEAM_MANAGEMENT.md](TEAM_MANAGEMENT.md) | Invitaciones, roles, expulsión y transferencia de propiedad del tenant. |
| [WEBHOOKS.md](WEBHOOKS.md) | Webhook Meta, firma HMAC, worker, reintentos y configuración del tenant. |
| [API_GATEWAY.md](API_GATEWAY.md) | API Keys, idempotencia y envío outbound de texto, plantillas y multimedia. |
| [INBOX.md](INBOX.md) | Conversaciones, mensajes, ventana de 24 horas, colaboración y tiempo real. |
| [TEMPLATES.md](TEMPLATES.md) | Sincronización, CRUD, estados, variables y envío de plantillas. |
| [META_COMPLIANCE.md](META_COMPLIANCE.md) | Callbacks de desautorización y eliminación de datos exigidos por Meta. |
| [DEPLOYMENT_VPS.md](DEPLOYMENT_VPS.md) | Build y despliegue con Nginx, PM2, MySQL y TLS. |
| [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) | Configuración real de `app.thagencia.com`, operación del VPS, Meta, SMTP, actualizaciones y troubleshooting. |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | Avances, decisiones aprobadas y trabajo pendiente. |
| [SAAS_ROADMAP.md](SAAS_ROADMAP.md) | Orden de implementación de plantillas, inbox, multimedia, métricas, billing y administración. |

Cada módulo terminado debe actualizar como mínimo `PROJECT_STATUS.md` y, si cambia operación o infraestructura, el documento correspondiente.
