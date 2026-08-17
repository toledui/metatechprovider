import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";

import { buildApp } from "./app.js";
import { PlatformRole } from "./generated/prisma/enums.js";
import { prisma } from "./lib/prisma.js";
import { encryptCredential, hmacSha256, sha256, verifyHmacSha256 } from "./lib/security.js";
import nodemailer from "nodemailer";
import { sendUsingTransport, type AppEmail } from "./mail/service.js";
import { readSetting, writeSetting } from "./settings/service.js";
import { deliverWebhookLog } from "./webhooks/delivery.js";
import { downloadMetaMedia } from "./meta/media.js";
import { createMetaTemplate, deleteMetaTemplate, listMetaTemplates, updateMetaTemplate } from "./meta/templates.js";
import { resolveInboxPermissions } from "./inbox/permissions.js";

function tokenFromEmail(email: AppEmail, route: string): string {
  const match = email.text.match(new RegExp(`${route.replace("/", "\\/")}\\?token=([^\\s]+)`));
  assert.ok(match?.[1], `El correo debe incluir un token para ${route}`);
  return decodeURIComponent(match[1]);
}

function metaSignedRequest(userId: string, appSecret: string): string {
  const payload = Buffer.from(JSON.stringify({
    algorithm: "HMAC-SHA256",
    user_id: userId,
    issued_at: Math.floor(Date.now() / 1_000),
  })).toString("base64url");
  const signature = createHmac("sha256", appSecret).update(payload).digest("base64url");
  return `${signature}.${payload}`;
}

test("verificación de correo, recuperación de contraseña y sesión revocable", async () => {
  const sentEmails: AppEmail[] = [];
  const metaAppSecret = `meta-secret-${randomBytes(16).toString("hex")}`;
  const metaVerifyToken = `verify-${randomBytes(16).toString("hex")}`;
  let metaMessageCalls = 0;
  let lastMetaMessageBody: Record<string, unknown> | undefined;
  const app = buildApp({
    sendEmail: async (email) => {
      sentEmails.push(email);
      return { messageId: `test-${sentEmails.length}` };
    },
    getMetaWebhookSecrets: async () => ({ appSecret: metaAppSecret, verifyToken: metaVerifyToken }),
    metaMessageFetcher: (async (_input: string | URL | Request, init?: RequestInit) => {
      metaMessageCalls += 1;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer meta-access-token-test");
      lastMetaMessageBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        messaging_product: "whatsapp",
        contacts: [{ input: "5215500000000", wa_id: "5215500000000" }],
        messages: [{ id: `wamid.outbound-${metaMessageCalls}` }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  const suffix = randomBytes(6).toString("hex");
  const email = `integration-${suffix}@example.test`;
  const password = `Test-${suffix}-Password!`;
  const newPassword = `Changed-${suffix}-Password!`;
  const testSettingProvider = `integration-${suffix}`;

  try {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: "https://localhost:3000" },
      payload: {
        organizationName: `Tenant Integration ${suffix}`,
        name: "Integration Test",
        email,
        password,
      },
    });
    assert.equal(register.statusCode, 201);
    assert.equal(register.json().requiresEmailVerification, true);
    assert.equal(register.json().emailSent, true);
    assert.equal(register.headers["set-cookie"], undefined);
    assert.equal(sentEmails.length, 1);

    const blockedLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://localhost:3000" },
      payload: { email, password },
    });
    assert.equal(blockedLogin.statusCode, 401);

    const verificationToken = tokenFromEmail(sentEmails[0]!, "/verify-email");
    const verify = await app.inject({
      method: "POST",
      url: "/api/auth/email-verification/verify",
      headers: { origin: "https://localhost:3000" },
      payload: { token: verificationToken },
    });
    assert.equal(verify.statusCode, 200);

    const reusedVerification = await app.inject({
      method: "POST",
      url: "/api/auth/email-verification/verify",
      headers: { origin: "https://localhost:3000" },
      payload: { token: verificationToken },
    });
    assert.equal(reusedVerification.statusCode, 400);

    const loginAfterVerification = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://localhost:3000" },
      payload: { email, password },
    });
    assert.equal(loginAfterVerification.statusCode, 200);
    const firstSetCookie = loginAfterVerification.headers["set-cookie"];
    const registrationCookie = (Array.isArray(firstSetCookie) ? firstSetCookie[0] : firstSetCookie)?.split(";")[0];
    assert.ok(registrationCookie?.startsWith("thagencia_session="));

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: registrationCookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, email);

    const connections = await app.inject({
      method: "GET",
      url: "/api/whatsapp/connections",
      headers: { cookie: registrationCookie },
    });
    assert.equal(connections.statusCode, 200);
    assert.deepEqual(connections.json().connections, []);

    const crossSite = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: registrationCookie, origin: "https://malicious.example" },
    });
    assert.equal(crossSite.statusCode, 403);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: registrationCookie, origin: "https://localhost:3000" },
    });
    assert.equal(logout.statusCode, 204);

    const revoked = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: registrationCookie } });
    assert.equal(revoked.statusCode, 401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://localhost:3000" },
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200);
    const loginCookie = login.headers["set-cookie"];
    assert.ok((Array.isArray(loginCookie) ? loginCookie.join(";") : loginCookie)?.includes("HttpOnly"));
    const authenticatedCookie = (Array.isArray(loginCookie) ? loginCookie[0] : loginCookie)?.split(";")[0];
    assert.ok(authenticatedCookie);

    const invitedEmail = `agent-${suffix}@example.test`;
    const invitedPassword = `Agent-${suffix}-Password!`;
    const inviteMember = await app.inject({
      method: "POST",
      url: "/api/team/invitations",
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { email: invitedEmail, role: "MEMBER" },
    });
    assert.equal(inviteMember.statusCode, 201);
    assert.equal(sentEmails.length, 2);
    const invitationToken = tokenFromEmail(sentEmails[1]!, "/invite");
    const invitationPreview = await app.inject({
      method: "GET",
      url: `/api/team/invitations/preview?token=${encodeURIComponent(invitationToken)}`,
    });
    assert.equal(invitationPreview.statusCode, 200);
    assert.equal(invitationPreview.json().invitation.email, invitedEmail);

    const acceptInvitation = await app.inject({
      method: "POST",
      url: "/api/team/invitations/accept",
      headers: { origin: "https://localhost:3000" },
      payload: { token: invitationToken, name: "Agente Integration", password: invitedPassword },
    });
    assert.equal(acceptInvitation.statusCode, 201);
    const invitedSetCookie = acceptInvitation.headers["set-cookie"];
    const invitedCookie = (Array.isArray(invitedSetCookie) ? invitedSetCookie[0] : invitedSetCookie)?.split(";")[0];
    assert.ok(invitedCookie);
    const reusedInvitation = await app.inject({
      method: "POST",
      url: "/api/team/invitations/accept",
      headers: { origin: "https://localhost:3000" },
      payload: { token: invitationToken, name: "Agente Integration", password: invitedPassword },
    });
    assert.equal(reusedInvitation.statusCode, 400);

    const team = await app.inject({ method: "GET", url: "/api/team", headers: { cookie: authenticatedCookie } });
    assert.equal(team.statusCode, 200);
    const invitedMember = team.json().members.find((member: { email: string }) => member.email === invitedEmail);
    assert.ok(invitedMember);
    const promoteMember = await app.inject({
      method: "PATCH",
      url: `/api/team/members/${invitedMember.id}/role`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { role: "ADMIN" },
    });
    assert.equal(promoteMember.statusCode, 200);
    assert.equal(promoteMember.json().member.role, "ADMIN");

    const transferOwnership = await app.inject({
      method: "POST",
      url: "/api/team/ownership/transfer",
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { newOwnerId: invitedMember.id },
    });
    assert.equal(transferOwnership.statusCode, 200);
    const transferBack = await app.inject({
      method: "POST",
      url: "/api/team/ownership/transfer",
      headers: { cookie: invitedCookie, origin: "https://localhost:3000" },
      payload: { newOwnerId: me.json().user.id },
    });
    assert.equal(transferBack.statusCode, 200);
    const removeMember = await app.inject({
      method: "DELETE",
      url: `/api/team/members/${invitedMember.id}`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
    });
    assert.equal(removeMember.statusCode, 204);
    const revokedMemberSession = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: invitedCookie } });
    assert.equal(revokedMemberSession.statusCode, 401);

    const forbiddenAdmin = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(forbiddenAdmin.statusCode, 403);

    const testUser = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: testUser.id },
      data: { platformRole: PlatformRole.SUPERADMIN },
    });
    const adminOverview = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(adminOverview.statusCode, 200);
    assert.ok(adminOverview.json().metrics.tenants >= 1);

    const adminSettings = await app.inject({
      method: "GET",
      url: "/api/admin/settings",
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(adminSettings.statusCode, 200);
    assert.equal(adminSettings.json().encryptionConfigured, true);
    assert.equal(JSON.stringify(adminSettings.json()).includes("appSecret\":"), false);

    await writeSetting(testSettingProvider, { secret: "encrypted-value" }, true, testUser.id);
    const encryptedSetting = await readSetting<{ secret: string }>(testSettingProvider);
    assert.equal(encryptedSetting?.config.secret, "encrypted-value");

    const ownTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: testUser.tenantId } });
    const selfSuspension = await app.inject({
      method: "PATCH",
      url: `/api/admin/tenants/${ownTenant.publicId}/status`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { status: "SUSPENDED" },
    });
    assert.equal(selfSuspension.statusCode, 409);

    await prisma.tenant.update({ where: { id: testUser.tenantId }, data: { status: "ACTIVE" } });
    const phoneNumberId = `phone-${suffix}`;
    const metaUserId = `meta-user-${suffix}`;
    const whatsappConnection = await prisma.whatsAppConnection.create({
      data: {
        tenantId: testUser.tenantId,
        wabaId: `waba-${suffix}`,
        phoneNumberId,
        displayPhoneNumber: "+525500000000",
        metaUserId,
        accessTokenEncrypted: encryptCredential("meta-access-token-test"),
        status: "ACTIVE",
        connectedAt: new Date(),
      },
    });
    const configureWebhook = await app.inject({
      method: "PUT",
      url: `/api/whatsapp/connections/${whatsappConnection.publicId}/webhook`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { webhookUrl: "http://127.0.0.1:5678/webhook/test", regenerateSecret: false },
    });
    assert.equal(configureWebhook.statusCode, 200);
    const webhookSecret = configureWebhook.json().webhookSecret as string;
    assert.ok(webhookSecret.length >= 32);

    const challenge = await app.inject({
      method: "GET",
      url: `/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(metaVerifyToken)}&hub.challenge=challenge-ok`,
    });
    assert.equal(challenge.statusCode, 200);
    assert.equal(challenge.body, "challenge-ok");

    const rejectedChallenge = await app.inject({
      method: "GET",
      url: "/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=nope",
    });
    assert.equal(rejectedChallenge.statusCode, 403);

    const metaPayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: `waba-${suffix}`,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "+525500000000", phone_number_id: phoneNumberId },
            contacts: [{ profile: { name: "Cliente de prueba" }, wa_id: "5215500000000" }],
            messages: [{ from: "5215500000000", id: `wamid.${suffix}`, timestamp: String(Math.floor(Date.now() / 1_000)), type: "text", text: { body: "Hola" } }],
          },
        }],
      }],
    });
    const metaSignature = `sha256=${hmacSha256(metaPayload, metaAppSecret)}`;
    const invalidMetaSignature = await app.inject({
      method: "POST",
      url: "/api/webhooks/meta",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "0".repeat(64) },
      payload: metaPayload,
    });
    assert.equal(invalidMetaSignature.statusCode, 401);

    const incoming = await app.inject({
      method: "POST",
      url: "/api/webhooks/meta",
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSignature },
      payload: metaPayload,
    });
    assert.equal(incoming.statusCode, 200);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/webhooks/meta",
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSignature },
      payload: metaPayload,
    });
    assert.equal(duplicate.statusCode, 200);
    const webhookLogs = await prisma.webhookLog.findMany({
      where: { connectionId: whatsappConnection.id, eventType: "message.text" },
    });
    assert.equal(webhookLogs.length, 1);
    assert.ok(["RECEIVED", "PROCESSING"].includes(webhookLogs[0]?.status ?? ""));

    const inbox = await app.inject({ method: "GET", url: "/api/inbox", headers: { cookie: authenticatedCookie } });
    assert.equal(inbox.statusCode, 200);
    assert.equal(inbox.json().conversations.length, 1);
    assert.equal(inbox.json().conversations[0].contact.name, "Cliente de prueba");
    const inboxConversationId = inbox.json().conversations[0].id as string;
    const inboxDetail = await app.inject({
      method: "GET",
      url: `/api/inbox/conversations/${inboxConversationId}`,
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(inboxDetail.statusCode, 200);
    assert.equal(inboxDetail.json().conversation.messages[0].text, "Hola");
    const addInboxNote = await app.inject({
      method: "POST",
      url: `/api/inbox/conversations/${inboxConversationId}/notes`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { body: "Contexto interno de prueba" },
    });
    assert.equal(addInboxNote.statusCode, 201);
    const resolveInboxConversation = await app.inject({
      method: "PATCH",
      url: `/api/inbox/conversations/${inboxConversationId}/status`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { status: "RESOLVED" },
    });
    assert.equal(resolveInboxConversation.statusCode, 200);
    const storedInboxConversation = await prisma.conversation.findUniqueOrThrow({ where: { publicId: inboxConversationId } });
    await prisma.conversation.update({
      where: { id: storedInboxConversation.id },
      data: { lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1_000) },
    });
    const blockedOutsideWindow = await app.inject({
      method: "POST",
      url: `/api/inbox/conversations/${inboxConversationId}/messages`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { type: "text", text: { body: "Respuesta fuera de ventana" } },
    });
    assert.equal(blockedOutsideWindow.statusCode, 409);
    assert.equal(blockedOutsideWindow.json().error, "customer_service_window_closed");
    assert.equal(metaMessageCalls, 0);
    await prisma.conversation.update({ where: { id: storedInboxConversation.id }, data: { lastInboundAt: new Date() } });

    const deliveryLog = webhookLogs[0]!;
    await prisma.webhookLog.update({ where: { id: deliveryLog.id }, data: { status: "PROCESSING" } });
    let deliveredBody = "";
    await deliverWebhookLog(deliveryLog.id, (async (_input: string | URL | Request, init?: RequestInit) => {
      deliveredBody = String(init?.body ?? "");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-thagencia-event-type"), "message.text");
      assert.equal(
        verifyHmacSha256(deliveredBody, headers.get("x-thagencia-signature-256") ?? undefined, webhookSecret),
        true,
      );
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch);
    assert.equal(JSON.parse(deliveredBody).object, "whatsapp_business_account");
    const deliveredLog = await prisma.webhookLog.findUniqueOrThrow({ where: { id: deliveryLog.id } });
    assert.equal(deliveredLog.status, "SUCCEEDED");
    assert.equal(deliveredLog.httpStatus, 200);
    assert.equal(deliveredLog.attemptCount, 1);

    const retryLog = await prisma.webhookLog.create({
      data: {
        tenantId: testUser.tenantId,
        connectionId: whatsappConnection.id,
        direction: "INBOUND",
        source: "META",
        eventType: "message.retry-test",
        status: "PROCESSING",
        targetUrl: "http://127.0.0.1:5678/webhook/test",
        requestPayload: { test: "retry" },
        processedAt: new Date(),
      },
    });
    await deliverWebhookLog(retryLog.id, (async () => new Response("temporary error", { status: 503 })) as typeof fetch);
    const scheduledRetry = await prisma.webhookLog.findUniqueOrThrow({ where: { id: retryLog.id } });
    assert.equal(scheduledRetry.status, "RECEIVED");
    assert.equal(scheduledRetry.attemptCount, 1);
    assert.ok(scheduledRetry.nextRetryAt && scheduledRetry.nextRetryAt > new Date());

    const visibleLogs = await app.inject({
      method: "GET",
      url: `/api/whatsapp/webhooks/logs?connectionId=${whatsappConnection.publicId}`,
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(visibleLogs.statusCode, 200);
    assert.ok(visibleLogs.json().logs.some((log: { status: string }) => log.status === "SUCCEEDED"));

    const createApiKey = await app.inject({
      method: "POST",
      url: "/api/api-keys",
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { name: "n8n Integration Test", expiresAt: null },
    });
    assert.equal(createApiKey.statusCode, 201);
    const apiKeyToken = createApiKey.json().token as string;
    const apiKeyPublicId = createApiKey.json().apiKey.id as string;
    assert.ok(apiKeyToken.startsWith("thk_"));
    assert.equal(JSON.stringify(createApiKey.json()).includes("keyHash"), false);

    const listedApiKeys = await app.inject({
      method: "GET",
      url: "/api/api-keys",
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(listedApiKeys.statusCode, 200);
    assert.equal(listedApiKeys.json().apiKeys[0].id, apiKeyPublicId);
    assert.equal(JSON.stringify(listedApiKeys.json()).includes(apiKeyToken), false);

    await prisma.conversation.update({
      where: { id: storedInboxConversation.id },
      data: { lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1_000) },
    });
    const gatewayBlockedOutsideWindow = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${apiKeyToken}`, "idempotency-key": `closed-${suffix}` },
      payload: {
        connection_id: whatsappConnection.publicId,
        to: "5215500000000",
        type: "text",
        text: { body: "No debe salir fuera de ventana" },
      },
    });
    assert.equal(gatewayBlockedOutsideWindow.statusCode, 409);
    assert.equal(gatewayBlockedOutsideWindow.json().error, "customer_service_window_closed");
    assert.equal(metaMessageCalls, 0);
    await prisma.conversation.update({ where: { id: storedInboxConversation.id }, data: { lastInboundAt: new Date() } });

    const noIdempotencyKey = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${apiKeyToken}` },
      payload: { to: "+52 1 55 0000 0000", type: "text", text: { body: "Hola" } },
    });
    assert.equal(noIdempotencyKey.statusCode, 400);

    const textOutbound = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${apiKeyToken}`, "idempotency-key": `text-${suffix}` },
      payload: {
        connection_id: whatsappConnection.publicId,
        to: "+52 1 55 0000 0000",
        type: "text",
        text: { body: "Hola desde el gateway", preview_url: false },
      },
    });
    assert.equal(textOutbound.statusCode, 200);
    assert.equal(textOutbound.json().success, true);
    assert.equal(textOutbound.json().message_id, "wamid.outbound-1");
    assert.equal(textOutbound.json().conversation_id, inboxConversationId);
    assert.ok(textOutbound.json().inbox_message_id);
    assert.equal(metaMessageCalls, 1);
    assert.equal(lastMetaMessageBody?.messaging_product, "whatsapp");
    assert.equal(lastMetaMessageBody?.to, "5215500000000");
    const inboxAfterGatewaySend = await app.inject({
      method: "GET",
      url: `/api/inbox/conversations/${inboxConversationId}`,
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(inboxAfterGatewaySend.statusCode, 200);
    assert.ok(inboxAfterGatewaySend.json().conversation.messages.some((message: { externalId: string; status: string }) =>
      message.externalId === "wamid.outbound-1" && message.status === "SENT"));

    const replayedOutbound = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${apiKeyToken}`, "idempotency-key": `text-${suffix}` },
      payload: { to: "5215500000000", type: "text", text: { body: "Este cuerpo no se reenviará" } },
    });
    assert.equal(replayedOutbound.statusCode, 200);
    assert.equal(replayedOutbound.headers["idempotency-replayed"], "true");
    assert.equal(replayedOutbound.json().message_id, "wamid.outbound-1");
    assert.equal(metaMessageCalls, 1);
    assert.equal(await prisma.message.count({ where: { externalId: "wamid.outbound-1" } }), 1);

    const templateOutbound = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${apiKeyToken}`, "idempotency-key": `template-${suffix}` },
      payload: {
        connection_id: whatsappConnection.publicId,
        to: "5215511111111",
        type: "template",
        template: { name: "hello_world", language: "es_MX", components: [] },
      },
    });
    assert.equal(templateOutbound.statusCode, 200);
    assert.notEqual(templateOutbound.json().conversation_id, inboxConversationId);
    assert.equal((lastMetaMessageBody?.template as { language?: { code?: string } }).language?.code, "es_MX");
    const inboxAfterNewTemplate = await app.inject({ method: "GET", url: "/api/inbox", headers: { cookie: authenticatedCookie } });
    assert.equal(inboxAfterNewTemplate.statusCode, 200);
    assert.ok(inboxAfterNewTemplate.json().conversations.some((conversation: { id: string; contact: { waId: string } }) =>
      conversation.id === templateOutbound.json().conversation_id && conversation.contact.waId === "5215511111111"));

    const imageOutbound = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${apiKeyToken}`, "idempotency-key": `image-${suffix}` },
      payload: {
        connection_id: whatsappConnection.publicId,
        to: "5215500000000",
        type: "image",
        image: { link: "https://example.test/image.jpg", caption: "Imagen de prueba" },
      },
    });
    assert.equal(imageOutbound.statusCode, 200);
    assert.equal(metaMessageCalls, 3);

    const invalidMedia = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${apiKeyToken}`, "idempotency-key": `invalid-media-${suffix}` },
      payload: {
        connection_id: whatsappConnection.publicId,
        to: "5215500000000",
        type: "image",
        image: { id: "MEDIA_ID", link: "https://example.test/image.jpg" },
      },
    });
    assert.equal(invalidMedia.statusCode, 422);
    assert.equal(metaMessageCalls, 3);

    const inboxTemplate = await app.inject({
      method: "POST",
      url: `/api/inbox/conversations/${inboxConversationId}/messages`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
      payload: { type: "template", template: { name: "hello_world", language: "es_MX" } },
    });
    assert.equal(inboxTemplate.statusCode, 201);
    assert.equal(inboxTemplate.json().message.status, "SENT");
    assert.equal(metaMessageCalls, 4);
    const statusPayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: `waba-${suffix}`,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "+525500000000", phone_number_id: phoneNumberId },
            statuses: [
              { id: "wamid.outbound-1", status: "delivered", timestamp: String(Math.floor(Date.now() / 1_000)), recipient_id: "5215500000000" },
              { id: "wamid.outbound-4", status: "delivered", timestamp: String(Math.floor(Date.now() / 1_000)), recipient_id: "5215500000000" },
            ],
          },
        }],
      }],
    });
    const deliveryStatusWebhook = await app.inject({
      method: "POST",
      url: "/api/webhooks/meta",
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${hmacSha256(statusPayload, metaAppSecret)}` },
      payload: statusPayload,
    });
    assert.equal(deliveryStatusWebhook.statusCode, 200);
    const inboxAfterDelivery = await app.inject({
      method: "GET",
      url: `/api/inbox/conversations/${inboxConversationId}`,
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(inboxAfterDelivery.statusCode, 200);
    assert.ok(inboxAfterDelivery.json().conversation.messages.some((message: { externalId: string; status: string }) =>
      message.externalId === "wamid.outbound-1" && message.status === "DELIVERED"));
    assert.ok(inboxAfterDelivery.json().conversation.messages.some((message: { externalId: string; status: string }) =>
      message.externalId === "wamid.outbound-4" && message.status === "DELIVERED"));

    const revokeApiKey = await app.inject({
      method: "DELETE",
      url: `/api/api-keys/${apiKeyPublicId}`,
      headers: { cookie: authenticatedCookie, origin: "https://localhost:3000" },
    });
    assert.equal(revokeApiKey.statusCode, 204);
    const rejectedRevokedKey = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${apiKeyToken}`, "idempotency-key": `revoked-${suffix}` },
      payload: { to: "5215500000000", type: "text", text: { body: "No debe enviarse" } },
    });
    assert.equal(rejectedRevokedKey.statusCode, 401);
    assert.equal(metaMessageCalls, 4);

    const signedRequest = metaSignedRequest(metaUserId, metaAppSecret);
    const invalidDeauthorization = await app.inject({
      method: "POST",
      url: "/api/meta/deauthorize",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ signed_request: `invalid.${signedRequest.split(".")[1]}` }).toString(),
    });
    assert.equal(invalidDeauthorization.statusCode, 401);

    const deauthorization = await app.inject({
      method: "POST",
      url: "/api/meta/deauthorize",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ signed_request: signedRequest }).toString(),
    });
    assert.equal(deauthorization.statusCode, 200);
    assert.equal(deauthorization.json().disconnectedConnections, 1);
    const disconnected = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: whatsappConnection.id } });
    assert.equal(disconnected.status, "DISCONNECTED");
    assert.equal(disconnected.webhookUrl, null);

    const deletion = await app.inject({
      method: "POST",
      url: "/api/meta/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ signed_request: signedRequest }).toString(),
    });
    assert.equal(deletion.statusCode, 200);
    const confirmationCode = deletion.json().confirmation_code as string;
    assert.ok(confirmationCode.length >= 32);
    assert.ok(String(deletion.json().url).includes(`/data-deletion?code=${confirmationCode}`));

    const deletionStatus = await app.inject({
      method: "GET",
      url: `/api/meta/data-deletion/status/${confirmationCode}`,
    });
    assert.equal(deletionStatus.statusCode, 200);
    assert.equal(deletionStatus.json().status, "COMPLETED");
    assert.equal(deletionStatus.json().affectedConnections, 1);

    const repeatedDeletion = await app.inject({
      method: "POST",
      url: "/api/meta/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ signed_request: signedRequest }).toString(),
    });
    assert.equal(repeatedDeletion.statusCode, 200);
    assert.equal(repeatedDeletion.json().confirmation_code, confirmationCode);
    const erasedConnection = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: whatsappConnection.id } });
    assert.ok(erasedConnection.deletedAt);
    assert.equal(erasedConnection.metaUserId, null);
    assert.ok(erasedConnection.phoneNumberId.startsWith("deleted_"));

    const forgotUnknown = await app.inject({
      method: "POST",
      url: "/api/auth/password/forgot",
      headers: { origin: "https://localhost:3000" },
      payload: { email: `unknown-${suffix}@example.test` },
    });
    assert.equal(forgotUnknown.statusCode, 200);
    const genericUnknown = forgotUnknown.json().message;

    const forgot = await app.inject({
      method: "POST",
      url: "/api/auth/password/forgot",
      headers: { origin: "https://localhost:3000" },
      payload: { email },
    });
    assert.equal(forgot.statusCode, 200);
    assert.equal(forgot.json().message, genericUnknown);
    assert.equal(sentEmails.length, 3);

    const resetToken = tokenFromEmail(sentEmails[2]!, "/reset-password");
    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset",
      headers: { origin: "https://localhost:3000" },
      payload: { token: resetToken, password: newPassword },
    });
    assert.equal(reset.statusCode, 200);
    assert.equal(sentEmails.length, 4);

    const revokedByReset = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: authenticatedCookie },
    });
    assert.equal(revokedByReset.statusCode, 401);

    const oldPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://localhost:3000" },
      payload: { email, password },
    });
    assert.equal(oldPasswordLogin.statusCode, 401);

    const newPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://localhost:3000" },
      payload: { email, password: newPassword },
    });
    assert.equal(newPasswordLogin.statusCode, 200);

    const reusedReset = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset",
      headers: { origin: "https://localhost:3000" },
      payload: { token: resetToken, password },
    });
    assert.equal(reusedReset.statusCode, 400);
  } finally {
    await prisma.platformSetting.deleteMany({ where: { provider: testSettingProvider } });
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.dataDeletionRequest.deleteMany({ where: { metaUserIdHash: sha256(`meta-user-${suffix}`) } });
      await prisma.webhookLog.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.conversationAssignment.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.inboxTeamMember.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.inboxTeam.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.internalNote.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.message.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.conversation.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.tag.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.contact.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.apiKey.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.whatsAppTemplate.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.whatsAppConnection.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.auditLog.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.tenantInvitation.deleteMany({ where: { tenantId: user.tenantId } });
      const tenantUsers = await prisma.user.findMany({ where: { tenantId: user.tenantId }, select: { id: true } });
      const tenantUserIds = tenantUsers.map((tenantUser) => tenantUser.id);
      await prisma.session.deleteMany({ where: { userId: { in: tenantUserIds } } });
      await prisma.userToken.deleteMany({ where: { userId: { in: tenantUserIds } } });
      await prisma.user.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.tenant.delete({ where: { id: user.tenantId } });
    }
    await app.close();
    await prisma.$disconnect();
  }
});

test("genera un correo con transporte de prueba sin entregar mensajes reales", async () => {
  const transporter = nodemailer.createTransport({ jsonTransport: true });
  const result = await sendUsingTransport(
    transporter,
    { fromName: "THagencia", fromEmail: "no-reply@thagencia.test", replyTo: "" },
    {
      to: "recipient@example.test",
      subject: "Prueba SMTP",
      text: "Mensaje de prueba",
      html: "<p>Mensaje de prueba</p>",
    },
  );

  assert.ok(result.messageId);
  const message = JSON.parse(String(result.message)) as { subject?: string; text?: string };
  assert.equal(message.subject, "Prueba SMTP");
  assert.equal(message.text, "Mensaje de prueba");
  transporter.close();
});

test("contratos seguros de plantillas, multimedia y permisos del inbox", async () => {
  const connection = { wabaId: "waba-test", accessTokenEncrypted: encryptCredential("meta-token-test") };
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const templateFetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer meta-token-test");
    calls.push({ url, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ data: [{ id: "tpl-1", name: "hola", language: "es_MX", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Hola {{1}}" }] }] }), { status: 200 });
    return new Response(JSON.stringify({ success: true, id: "tpl-1", status: "PENDING" }), { status: 200 });
  }) as typeof fetch;
  const templates = await listMetaTemplates(connection, templateFetcher);
  assert.equal(templates[0]?.status, "APPROVED");
  await createMetaTemplate(connection, { name: "hola" }, templateFetcher);
  await updateMetaTemplate(connection, "tpl-1", { components: [] }, templateFetcher);
  await deleteMetaTemplate(connection, "hola", templateFetcher);
  assert.ok(calls[0]?.url.includes("/waba-test/message_templates"));
  assert.deepEqual(calls.slice(1).map((call) => call.method), ["POST", "POST", "DELETE"]);

  const mediaFetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer meta-token-test");
    if (String(input).includes("media-id")) return new Response(JSON.stringify({ url: "https://lookaside.test/file", mime_type: "image/png", file_size: 4 }), { status: 200 });
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/png", "content-length": "4" } });
  }) as typeof fetch;
  const media = await downloadMetaMedia(connection, "media-id", mediaFetcher);
  assert.equal(media.contentType, "image/png");
  assert.deepEqual([...media.bytes], [1, 2, 3, 4]);

  const member = resolveInboxPermissions("MEMBER", { sendMessages: false, editContacts: true });
  assert.equal(member.sendMessages, false);
  assert.equal(member.editContacts, true);
  assert.equal(member.addNotes, true);
  assert.equal(resolveInboxPermissions("ADMIN", {}).manageTemplates, true);
});
