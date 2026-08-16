export type PublicId = string;

export type TenantStatus = "ONBOARDING" | "ACTIVE" | "SUSPENDED";
export type UserRole = "OWNER" | "ADMIN" | "MEMBER";
export type UserStatus = "INVITED" | "PENDING_EMAIL_VERIFICATION" | "ACTIVE" | "DISABLED";
export type WhatsAppConnectionStatus =
  | "PENDING"
  | "ACTIVE"
  | "DISCONNECTED"
  | "ERROR";
export type MetaTokenType = "SHORT_LIVED" | "LONG_LIVED" | "SYSTEM_USER";
export type ApiKeyStatus = "ACTIVE" | "REVOKED";
export type WebhookDirection = "INBOUND" | "OUTBOUND";
export type WebhookSource = "META" | "API_GATEWAY" | "CRM" | "N8N" | "INTERNAL";
export type WebhookDeliveryStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "IGNORED";

export interface TenantContext {
  tenantId: bigint;
  tenantPublicId: PublicId;
  tenantStatus: TenantStatus;
}

export interface TenantUserIdentity extends TenantContext {
  userId: bigint;
  userPublicId: PublicId;
  email: string;
  role: UserRole;
  status: UserStatus;
}

export interface CreateWhatsAppConnectionInput {
  tenantId: bigint;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  accessToken: string;
  tokenType: MetaTokenType;
  tokenExpiresAt?: Date;
  webhookUrl?: string;
  webhookSecret?: string;
  coexistenceEnabled: boolean;
  metaBusinessId?: string;
  metadata?: Record<string, unknown>;
}

export interface WhatsAppConnectionSummary {
  publicId: PublicId;
  tenantPublicId: PublicId;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: WhatsAppConnectionStatus;
  tokenType: MetaTokenType;
  tokenExpiresAt: Date | null;
  webhookUrl: string | null;
  coexistenceEnabled: boolean;
}

export interface CreateApiKeyInput {
  tenantId: bigint;
  createdByUserId?: bigint;
  name: string;
  scopes: string[];
  expiresAt?: Date;
}

export interface IssuedApiKey {
  publicId: PublicId;
  /** Se muestra una sola vez y jamás se persiste en texto plano. */
  token: string;
  prefix: string;
  lastFour: string;
  scopes: string[];
  expiresAt: Date | null;
}

export interface AuthenticatedApiKey extends TenantContext {
  apiKeyId: bigint;
  apiKeyPublicId: PublicId;
  scopes: string[];
  status: ApiKeyStatus;
}

export interface CreateWebhookLogInput {
  tenantId?: bigint;
  connectionId?: bigint;
  apiKeyId?: bigint;
  actorUserId?: bigint;
  direction: WebhookDirection;
  source: WebhookSource;
  eventType: string;
  externalEventId?: string;
  deduplicationKey?: string;
  targetUrl?: string;
  requestPayload: Record<string, unknown>;
}
